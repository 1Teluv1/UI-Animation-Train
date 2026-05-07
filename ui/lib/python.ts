import { spawn, ChildProcess, exec } from "node:child_process";
import { EventEmitter } from "node:events";
import { PIPELINE_DIR, PYTHON_BIN } from "./paths";
import { JobKind, JobStatus, JobSummary } from "./types";
import { shortId } from "./utils";

const MAX_LOG_LINES = 5000;

export interface JobLogLine {
  stream: "stdout" | "stderr";
  text: string;
  ts: number;
}

export class Job extends EventEmitter {
  readonly id: string;
  readonly kind: JobKind;
  readonly command: string[];
  readonly startedAt: number;
  readonly detached: boolean;
  proc: ChildProcess | null;
  status: JobStatus = "running";
  exitCode: number | null = null;
  finishedAt: number | null = null;
  private buffer: JobLogLine[] = [];
  private partial: { stdout: string; stderr: string } = { stdout: "", stderr: "" };

  constructor(opts: {
    id: string;
    kind: JobKind;
    command: string[];
    proc: ChildProcess;
    detached?: boolean;
  }) {
    super();
    this.id = opts.id;
    this.kind = opts.kind;
    this.command = opts.command;
    this.proc = opts.proc;
    this.startedAt = Date.now();
    this.detached = !!opts.detached;
    this.attachStreams();
  }

  private push(line: JobLogLine): void {
    this.buffer.push(line);
    if (this.buffer.length > MAX_LOG_LINES) {
      this.buffer.splice(0, this.buffer.length - MAX_LOG_LINES);
    }
    this.emit("log", line);
  }

  private flushPartial(stream: "stdout" | "stderr"): void {
    const remaining = this.partial[stream];
    if (remaining.length > 0) {
      this.push({ stream, text: remaining, ts: Date.now() });
      this.partial[stream] = "";
    }
  }

  private feed(stream: "stdout" | "stderr", chunk: Buffer): void {
    const combined = this.partial[stream] + chunk.toString("utf-8");
    const lines = combined.split(/\r?\n/);
    this.partial[stream] = lines.pop() ?? "";
    for (const line of lines) {
      this.push({ stream, text: line, ts: Date.now() });
    }
  }

  private attachStreams(): void {
    if (!this.proc) return;
    this.proc.stdout?.on("data", (b: Buffer) => this.feed("stdout", b));
    this.proc.stderr?.on("data", (b: Buffer) => this.feed("stderr", b));
    this.proc.on("error", (err) => {
      this.push({ stream: "stderr", text: `[spawn error] ${err.message}`, ts: Date.now() });
    });
    this.proc.on("close", (code) => {
      this.flushPartial("stdout");
      this.flushPartial("stderr");
      this.exitCode = code;
      this.finishedAt = Date.now();
      if (this.status === "running") {
        this.status = code === 0 ? "done" : "error";
      }
      this.emit("exit", { code, status: this.status });
    });
  }

  getLog(): JobLogLine[] {
    return [...this.buffer];
  }

  summary(): JobSummary {
    return {
      id: this.id,
      kind: this.kind,
      status: this.status,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt ?? undefined,
      exitCode: this.exitCode,
      command: this.command,
      pid: this.proc?.pid,
      detached: this.detached,
      logLineCount: this.buffer.length,
    };
  }

  cancel(): void {
    if (!this.proc || this.status !== "running") return;
    this.status = "cancelled";
    const pid = this.proc.pid;
    try {
      this.proc.kill("SIGTERM");
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (this.proc && !this.proc.killed) {
        if (process.platform === "win32" && pid) {
          exec(`taskkill /F /T /PID ${pid}`, () => undefined);
        } else {
          try { this.proc.kill("SIGKILL"); } catch { /* ignore */ }
        }
      }
    }, 5000);
  }
}

class JobQueue {
  private current: Job | null = null;
  private history: Job[] = [];

  hasActive(): boolean {
    return !!this.current && this.current.status === "running";
  }

  active(): Job | null {
    return this.current && this.current.status === "running" ? this.current : null;
  }

  get(id: string): Job | null {
    if (this.current?.id === id) return this.current;
    return this.history.find((j) => j.id === id) ?? null;
  }

  list(): JobSummary[] {
    const items: JobSummary[] = [];
    if (this.current) items.push(this.current.summary());
    for (const j of this.history) {
      if (j !== this.current) items.push(j.summary());
    }
    return items;
  }

  spawnPython(kind: JobKind, scriptRelPath: string, args: string[], opts: { detached?: boolean } = {}): Job {
    if (this.hasActive()) {
      const a = this.current!;
      throw new Error(`another job is already running: ${a.id} (${a.kind})`);
    }
    const command = [PYTHON_BIN, scriptRelPath, ...args];
    const proc = spawn(PYTHON_BIN, [scriptRelPath, ...args], {
      cwd: PIPELINE_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    const job = new Job({ id: shortId(kind), kind, command, proc, detached: opts.detached });
    this.current = job;
    this.history.unshift(job);
    if (this.history.length > 50) this.history.length = 50;
    job.on("exit", () => {
      if (this.current?.id === job.id) {
        this.current = null;
      }
    });
    return job;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __JOB_QUEUE__: JobQueue | undefined;
}

export const jobQueue: JobQueue =
  globalThis.__JOB_QUEUE__ ?? (globalThis.__JOB_QUEUE__ = new JobQueue());
