"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface LogLine {
  stream: "stdout" | "stderr";
  text: string;
  ts?: number;
}

export function LogViewer({
  lines,
  className,
  emptyHint = "No output yet.",
  height = 320,
  followTail = true,
}: {
  lines: LogLine[];
  className?: string;
  emptyHint?: string;
  height?: number;
  followTail?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!followTail || !ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, followTail]);

  return (
    <div
      ref={ref}
      style={{ height }}
      className={cn(
        "scrollbar-thin overflow-auto rounded-md border bg-black/40 p-3 font-mono text-[11px] leading-snug",
        className,
      )}
    >
      {lines.length === 0 ? (
        <div className="text-muted-foreground italic">{emptyHint}</div>
      ) : (
        lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words",
              l.stream === "stderr" ? "text-amber-300" : "text-zinc-200",
            )}
          >
            {l.text || "\u00A0"}
          </div>
        ))
      )}
    </div>
  );
}
