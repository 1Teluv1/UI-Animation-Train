"use client";

import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { MetadataRecord } from "@/lib/types";

export function MetadataTable({ items, detailBase = "/dataset" }: { items: MetadataRecord[]; detailBase?: string }) {
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">id</th>
            <th className="text-left px-3 py-2">category</th>
            <th className="text-left px-3 py-2">subject</th>
            <th className="text-left px-3 py-2">motion</th>
            <th className="text-left px-3 py-2">source</th>
            <th className="text-right px-3 py-2">duration</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground italic">No records.</td></tr>
          )}
          {items.map((m) => (
            <tr key={m.id} className="border-t hover:bg-accent/30 transition-colors">
              <td className="px-3 py-2 font-mono text-xs">
                <Link href={`${detailBase}/${encodeURIComponent(m.id)}`} className="hover:underline">{m.id}</Link>
              </td>
              <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{m.asset_type}</Badge></td>
              <td className="px-3 py-2">{m.subject}</td>
              <td className="px-3 py-2 text-muted-foreground">{m.motion_preset}</td>
              <td className="px-3 py-2">
                <Badge variant={m.source === "lm_studio" ? "default" : "secondary"} className="text-[10px]">
                  {m.source === "lm_studio" ? "LLM" : "fallback"}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{m.duration.toFixed(1)}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
