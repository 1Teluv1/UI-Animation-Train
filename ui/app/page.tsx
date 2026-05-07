"use client";

import useSWR from "swr";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  CircleCheck,
  CircleX,
  Cpu,
  Database,
  HardDrive,
  Server,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VideoGrid } from "@/components/video-grid";
import type { MetadataRecord } from "@/lib/types";
import { formatBytes } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface HealthResp {
  python: { bin: string; version: string | null };
  ffmpeg: { available: boolean; source: string };
  gpus: Array<{ name: string; vramTotalMiB: number; vramFreeMiB: number; driver: string }>;
  pipeline: { dir: string; present: boolean };
  wan: { present: boolean; path: string | null };
}

interface StatsResp {
  total: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
  avgMotionScore: number | null;
  trainCount: number;
  valCount: number;
  qualityPassed: number;
  qualityFailed: number;
}

interface LmsModelsResp {
  ok: boolean;
  models: Array<{ id: string; owned_by?: string }>;
  error?: string;
}

function YesNo({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex items-center gap-1 text-emerald-400"><CircleCheck className="h-3.5 w-3.5" /> yes</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-rose-400"><CircleX className="h-3.5 w-3.5" /> no</span>
  );
}

export default function DashboardPage() {
  const { data: health } = useSWR<HealthResp>("/api/health", fetcher, { refreshInterval: 30000 });
  const { data: stats } = useSWR<StatsResp>("/api/dataset/stats", fetcher, { refreshInterval: 15000 });
  const { data: lms } = useSWR<LmsModelsResp>("/api/lmstudio/models", fetcher, { refreshInterval: 30000 });

  const [recent, setRecent] = useState<MetadataRecord[]>([]);
  useEffect(() => {
    fetch("/api/dataset/list?page=1&pageSize=5")
      .then((r) => r.json())
      .then((j) => setRecent(j.items ?? []))
      .catch(() => undefined);
  }, [stats?.total]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Local console for the Wan2.2 5B LoRA dataset & training pipeline.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/generate"><Sparkles className="h-4 w-4 mr-1" />Generate</Link></Button>
          <Button asChild size="sm"><Link href="/train"><Cpu className="h-4 w-4 mr-1" />Train</Link></Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Server className="h-4 w-4" />Environment</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Python" value={health?.python.version ?? "-"} />
            <Row label="ffmpeg" value={health?.ffmpeg.available ? "available" : "missing"} />
            <Row label="Pipeline dir" value={<YesNo value={!!health?.pipeline.present} />} />
            <Row label="Wan2.2 weights" value={<YesNo value={!!health?.wan.present} />} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><HardDrive className="h-4 w-4" />GPU</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {health?.gpus?.length ? health.gpus.map((g, i) => (
              <div key={i} className="space-y-1">
                <div className="font-medium truncate" title={g.name}>{g.name}</div>
                <div className="text-xs text-muted-foreground">
                  VRAM {formatBytes(g.vramFreeMiB * 1024 * 1024)} free / {formatBytes(g.vramTotalMiB * 1024 * 1024)}
                </div>
                <div className="text-xs text-muted-foreground">driver {g.driver}</div>
              </div>
            )) : <div className="text-muted-foreground italic text-sm">no GPU detected</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4" />LM Studio</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Status" value={lms?.ok ? <span className="text-emerald-400">online</span> : <span className="text-rose-400">offline</span>} />
            <Row label="Models" value={lms?.models?.length ?? 0} />
            {lms?.models?.slice(0, 3).map((m) => (
              <div key={m.id} className="text-xs text-muted-foreground truncate" title={m.id}>· {m.id}</div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Database className="h-4 w-4" />Dataset</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Total samples" value={stats?.total ?? 0} />
            <Row label="Train / Val" value={`${stats?.trainCount ?? 0} / ${stats?.valCount ?? 0}`} />
            <Row label="Quality pass" value={`${stats?.qualityPassed ?? 0} / ${(stats?.qualityPassed ?? 0) + (stats?.qualityFailed ?? 0)}`} />
            <Row label="Avg motion" value={stats?.avgMotionScore?.toFixed(2) ?? "-"} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row flex items-center justify-between">
          <CardTitle className="text-sm">Categories</CardTitle>
          <Button asChild variant="ghost" size="sm"><Link href="/dataset">Browse all →</Link></Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.keys(stats?.byCategory ?? {}).length === 0 && (
              <div className="text-sm text-muted-foreground italic">No samples generated yet. Try the Generate page.</div>
            )}
            {Object.entries(stats?.byCategory ?? {}).map(([k, v]) => (
              <Badge key={k} variant="secondary" className="text-xs">{k} · {v}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent samples</CardTitle></CardHeader>
        <CardContent>
          <VideoGrid items={recent} emptyHint="Generate a few samples to see them here." />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground text-xs uppercase tracking-wider">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
