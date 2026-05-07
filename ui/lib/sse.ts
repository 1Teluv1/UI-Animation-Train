import { Job, JobLogLine } from "./python";

const ENC = new TextEncoder();

function frame(event: string, data: unknown): Uint8Array {
  return ENC.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function jobToSseResponse(job: Job): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      safeEnqueue(frame("start", job.summary()));
      for (const line of job.getLog()) {
        safeEnqueue(frame("log", line));
      }

      const onLog = (line: JobLogLine) => safeEnqueue(frame("log", line));
      const onExit = (payload: { code: number | null; status: string }) => {
        safeEnqueue(frame("exit", { ...payload, summary: job.summary() }));
        cleanup();
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* ignore */ }
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(ENC.encode(`: ping ${Date.now()}\n\n`)); } catch { closed = true; }
      }, 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        job.off("log", onLog);
        job.off("exit", onExit);
      };

      job.on("log", onLog);
      job.on("exit", onExit);

      if (job.status !== "running") {
        onExit({ code: job.exitCode, status: job.status });
      }
    },
    cancel() {
      // Client disconnected; nothing to undo because the job survives.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
