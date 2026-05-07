"use client";

import Link from "next/link";
import { videoUrlFor, VideoPlayer } from "@/components/video-player";
import { Badge } from "@/components/ui/badge";
import type { MetadataRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

export function VideoGrid({
  items,
  detailHrefBase = "/dataset",
  emptyHint = "No samples yet.",
}: {
  items: MetadataRecord[];
  detailHrefBase?: string;
  emptyHint?: string;
}) {
  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground italic">{emptyHint}</div>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
      {items.map((m) => (
        <Link
          key={m.id}
          href={`${detailHrefBase}/${encodeURIComponent(m.id)}`}
          className={cn(
            "group rounded-md border bg-card overflow-hidden hover:border-primary/60 hover:shadow-lg transition-all",
          )}
        >
          <div className="aspect-square bg-black overflow-hidden">
            <VideoPlayer src={videoUrlFor(m.video)} controls={false} className="rounded-none" />
          </div>
          <div className="p-2 space-y-1">
            <div className="flex items-center justify-between gap-1">
              <Badge variant="outline" className="text-[10px]">{m.asset_type}</Badge>
              <Badge variant={m.source === "lm_studio" ? "default" : "secondary"} className="text-[10px]">
                {m.source === "lm_studio" ? "LLM" : "fallback"}
              </Badge>
            </div>
            <div className="text-xs font-medium truncate" title={m.subject}>{m.subject}</div>
            <div className="text-[11px] text-muted-foreground truncate" title={m.caption}>
              {m.motion_preset} · {m.duration}s
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
