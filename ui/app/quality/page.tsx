"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { QualityRecord } from "@/lib/types";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

interface QualityResp {
  items: QualityRecord[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    reasonCounts: Record<string, number>;
    motionScores: number[];
  };
}

function buildHistogram(scores: number[], bins = 12) {
  if (scores.length === 0) return [] as Array<{ bucket: string; count: number }>;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (min === max) return [{ bucket: min.toFixed(2), count: scores.length }];
  const step = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const s of scores) {
    let idx = Math.floor((s - min) / step);
    if (idx >= bins) idx = bins - 1;
    counts[idx] += 1;
  }
  return counts.map((c, i) => ({
    bucket: (min + step * (i + 0.5)).toFixed(2),
    count: c,
  }));
}

export default function QualityPage() {
  const [onlyFailed, setOnlyFailed] = useState(false);
  const { data } = useSWR<QualityResp>(`/api/quality?failed=${onlyFailed ? 1 : 0}`, fetcher, {
    refreshInterval: 10000,
  });
  const histo = useMemo(() => buildHistogram(data?.summary.motionScores ?? []), [data]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Quality Report
        </h1>
        <p className="text-sm text-muted-foreground">
          Per-sample metrics and pass/fail reasons from the latest preprocess run.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Total" value={data?.summary.total ?? 0} />
        <Stat label="Passed" value={data?.summary.passed ?? 0} accent="text-emerald-400" />
        <Stat label="Failed" value={data?.summary.failed ?? 0} accent="text-rose-400" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Motion score histogram</CardTitle></CardHeader>
          <CardContent style={{ height: 260 }}>
            {histo.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm italic">No data yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histo} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip cursor={{ fill: "hsl(var(--accent))" }} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldAlert className="h-4 w-4" />Failure reasons</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(data?.summary.reasonCounts ?? {}).length === 0 ? (
                <div className="text-sm text-muted-foreground italic">No failures recorded.</div>
              ) : (
                Object.entries(data!.summary.reasonCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between gap-2 rounded-md border bg-card/40 px-3 py-2">
                      <span className="text-sm">{reason}</span>
                      <Badge variant="secondary">{count}</Badge>
                    </div>
                  ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row flex items-center justify-between">
          <CardTitle className="text-sm">Per-sample report</CardTitle>
          <Button size="sm" variant={onlyFailed ? "default" : "outline"} onClick={() => setOnlyFailed((v) => !v)}>
            {onlyFailed ? "Showing failed only" : "Show failed only"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto rounded-md border max-h-[480px] scrollbar-thin">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">id</th>
                  <th className="text-left px-3 py-2">cat</th>
                  <th className="text-right px-3 py-2">w×h</th>
                  <th className="text-right px-3 py-2">fps</th>
                  <th className="text-right px-3 py-2">dur</th>
                  <th className="text-right px-3 py-2">motion</th>
                  <th className="text-left px-3 py-2">status</th>
                  <th className="text-left px-3 py-2">reasons</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((q) => (
                  <tr key={q.id} className="border-t">
                    <td className="px-3 py-1.5 font-mono text-[11px]">{q.id}</td>
                    <td className="px-3 py-1.5">{q.asset_type}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{q.metrics.width ?? "-"}×{q.metrics.height ?? "-"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{q.metrics.fps?.toFixed(1) ?? "-"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{q.metrics.duration?.toFixed(2) ?? "-"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{q.metrics.motion_score?.toFixed(2) ?? "-"}</td>
                    <td className="px-3 py-1.5">
                      {q.passed
                        ? <Badge variant="success" className="text-[10px]">pass</Badge>
                        : <Badge variant="destructive" className="text-[10px]">fail</Badge>}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{q.reasons.join("; ")}</td>
                  </tr>
                ))}
                {(data?.items ?? []).length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground italic">No quality records yet. Run preprocess first.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-3xl font-semibold mt-1 ${accent ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
