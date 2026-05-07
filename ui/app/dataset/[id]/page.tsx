"use client";

import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VideoPlayer, videoUrlFor } from "@/components/video-player";
import type { MetadataRecord } from "@/lib/types";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

interface ListResp { items: MetadataRecord[]; total: number; }

export default function DatasetDetailPage({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  const { data } = useSWR<ListResp>(`/api/dataset/list?page=1&pageSize=200`, fetcher);
  const record = data?.items.find((r) => r.id === id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm"><Link href="/dataset"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>
        {record && (
          <div className="flex gap-2">
            <Badge variant="outline">{record.asset_type}</Badge>
            <Badge variant={record.source === "prompt_bank" ? "default" : "secondary"}>
              {record.source === "prompt_bank" ? "prompt_bank" : record.source}
            </Badge>
          </div>
        )}
      </div>

      {!record ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {data ? "Sample not found in current page. Use filters or refresh." : "Loading…"}
          </CardContent>
        </Card>
      ) : (
        <>
          <header>
            <h1 className="text-2xl font-semibold tracking-tight font-mono">{record.id}</h1>
            <p className="text-sm text-muted-foreground">{record.subject} · {record.motion_preset} · {record.duration}s @ {record.fps}fps</p>
          </header>

          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Preview</CardTitle></CardHeader>
              <CardContent>
                <VideoPlayer src={videoUrlFor(record.video)} className="aspect-square" />
                <div className="mt-3 text-xs text-muted-foreground">{videoUrlFor(record.video)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Caption</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{record.caption}</p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Metadata</CardTitle></CardHeader>
              <CardContent>
                <pre className="overflow-auto rounded-md border bg-black/40 p-3 font-mono text-[11px] leading-snug">
{JSON.stringify(record, null, 2)}
                </pre>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-sm">User prompt</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  prompt_id: <code className="font-mono">{record.prompt_id ?? "-"}</code>
                </div>
                <pre className="overflow-auto rounded-md border bg-black/40 p-3 font-mono text-[11px] leading-snug whitespace-pre-wrap break-words">
{record.user_prompt ?? "(no user_prompt in metadata; regenerate to include it)"}
                </pre>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-sm">HTML source</CardTitle></CardHeader>
              <CardContent>
                <iframe
                  src={`/api/dataset/file/html/${encodeURIComponent(record.id + ".html")}`}
                  className="w-full h-[420px] rounded-md border bg-white"
                  sandbox="allow-scripts"
                />
                <div className="mt-2 text-xs text-muted-foreground">
                  rendered preview · path: <code className="font-mono">{record.html}</code>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
