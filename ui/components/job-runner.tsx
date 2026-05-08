"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogViewer, type LogLine } from "@/components/log-viewer";
import { StatusBadge } from "@/components/status-badge";
import type { JobStatus, JobSummary } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

interface RunnerState {
  status: JobStatus | "idle";
  summary: JobSummary | null;
  exitCode: number | null;
  lines: LogLine[];
  startedAt: number | null;
  finishedAt: number | null;
}

const initial: RunnerState = {
  status: "idle",
  summary: null,
  exitCode: null,
  lines: [],
  startedAt: null,
  finishedAt: null,
};

interface BusyConflictResponse {
  error?: string;
  active?: JobSummary;
}

export interface JobRunnerHandle {
  start: (init: () => Promise<Response>) => Promise<void>;
  cancel: () => Promise<void>;
}

export function useJobRunner(): {
  state: RunnerState;
  start: (init: () => Promise<Response>) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<RunnerState>(initial);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const summaryRef = useRef<JobSummary | null>(null);

  const stop = useCallback(async () => {
    const reader = readerRef.current;
    readerRef.current = null;
    if (reader) {
      try { await reader.cancel(); } catch { /* ignore */ }
    }
  }, []);

  const cancel = useCallback(async () => {
    const id = summaryRef.current?.id;
    if (!id) return;
    try {
      await fetch(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    } catch { /* ignore */ }
  }, []);

  const start = useCallback(async (init: () => Promise<Response>) => {
    await stop();
    setState({ ...initial, status: "running", startedAt: Date.now() });
    summaryRef.current = null;

    let res: Response;
    try {
      res = await init();
    } catch (e) {
      setState((s) => ({
        ...s,
        status: "error",
        finishedAt: Date.now(),
        lines: [...s.lines, { stream: "stderr", text: `[runner] request error: ${(e as Error).message}` }],
      }));
      return;
    }
    if (!res.ok || !res.body) {
      let detail = res.statusText;
      try {
        const payload = (await res.json()) as BusyConflictResponse;
        if (res.status === 409 && payload?.active) {
          const active = payload.active;
          const activeSec = Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000));
          detail =
            `이미 실행 중인 작업이 있어 시작할 수 없습니다. ` +
            `active=${active.id} (${active.kind}, ${activeSec}s 경과)`;
        } else if (payload?.error) {
          detail = payload.error;
        } else {
          detail = JSON.stringify(payload);
        }
      } catch { /* ignore */ }
      setState((s) => ({
        ...s,
        status: "error",
        finishedAt: Date.now(),
        lines: [...s.lines, { stream: "stderr", text: `[runner] HTTP ${res.status}: ${detail}` }],
      }));
      return;
    }

    const reader = res.body.getReader();
    readerRef.current = reader;
    const decoder = new TextDecoder("utf-8");
    let buf = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const evtBlock of events) {
          if (!evtBlock.trim() || evtBlock.startsWith(":")) continue;
          let event = "message";
          let data = "";
          for (const ln of evtBlock.split("\n")) {
            if (ln.startsWith("event:")) event = ln.slice(6).trim();
            else if (ln.startsWith("data:")) data += ln.slice(5).trim();
          }
          if (!data) continue;
          let payload: unknown;
          try { payload = JSON.parse(data); } catch { continue; }
          if (event === "start") {
            const sum = payload as JobSummary;
            summaryRef.current = sum;
            setState((s) => ({ ...s, summary: sum, startedAt: sum.startedAt }));
          } else if (event === "log") {
            const line = payload as LogLine;
            setState((s) => ({ ...s, lines: [...s.lines, line] }));
          } else if (event === "exit") {
            const p = payload as { code: number | null; status: JobStatus; summary?: JobSummary };
            setState((s) => ({
              ...s,
              status: p.status,
              exitCode: p.code,
              finishedAt: Date.now(),
              summary: p.summary ?? s.summary,
            }));
          }
        }
      }
    } catch (e) {
      setState((s) => ({
        ...s,
        status: "error",
        finishedAt: Date.now(),
        lines: [...s.lines, { stream: "stderr", text: `[runner] stream error: ${(e as Error).message}` }],
      }));
    }
    readerRef.current = null;
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    summaryRef.current = null;
    setState(initial);
  }, [stop]);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { state, start, cancel, reset };
}

export function JobRunnerPanel({
  state,
  onCancel,
  height = 320,
}: {
  state: RunnerState;
  onCancel: () => void;
  height?: number;
}) {
  const elapsed =
    state.startedAt ? (state.finishedAt ?? Date.now()) - state.startedAt : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {state.status === "running" ? (
          <span className="inline-flex items-center gap-1.5 text-amber-300"><Loader2 className="h-3 w-3 animate-spin" /> running…</span>
        ) : state.status === "idle" ? (
          <span className="inline-flex items-center gap-1.5"><Play className="h-3 w-3" /> idle</span>
        ) : (
          <StatusBadge status={state.status} />
        )}
        {state.summary && <span>· id <span className="font-mono">{state.summary.id}</span></span>}
        {state.startedAt && <span>· {formatDuration(elapsed)}</span>}
        {state.exitCode !== null && state.status !== "idle" && state.status !== "running" && (
          <span>· exit {state.exitCode}</span>
        )}
        <span className="ml-auto">
          {state.status === "running" && (
            <Button size="sm" variant="destructive" onClick={onCancel} className="gap-1.5">
              <Square className="h-3 w-3" /> Cancel
            </Button>
          )}
        </span>
      </div>
      <LogViewer lines={state.lines} height={height} />
    </div>
  );
}
