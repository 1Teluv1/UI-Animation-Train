"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { ListChecks, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JobRunnerPanel, useJobRunner } from "@/components/job-runner";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

interface StatsResp {
  total: number;
  trainCount: number;
  valCount: number;
  qualityPassed: number;
  qualityFailed: number;
}

export default function PreprocessPage() {
  const [resolution, setResolution] = useState(512);
  const [fps, setFps] = useState(24);
  const [durationTolerance, setDurationTolerance] = useState(0.05);
  const [minMotion, setMinMotion] = useState(2.0);
  const [duplicateThreshold, setDuplicateThreshold] = useState(8);
  const [valRatio, setValRatio] = useState(0.1);
  const [seed, setSeed] = useState(0);

  const { state, start, cancel } = useJobRunner();
  const { data: stats, mutate } = useSWR<StatsResp>("/api/dataset/stats", fetcher);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await start(() =>
      fetch("/api/preprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution, fps, durationTolerance, minMotion, duplicateThreshold,
          valRatio, seed, verbose: true,
        }),
      }),
    );
    mutate();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ListChecks className="h-5 w-5" />
          Preprocess Dataset (Phase 2)
        </h1>
        <p className="text-sm text-muted-foreground">
          Validate, dedupe, score motion, and split metadata.jsonl into train/val.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Options</CardTitle>
            <CardDescription>Same flags as <code className="font-mono text-xs">scripts/preprocess_dataset.py</code>.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
              <Field label="Resolution"><Input type="number" value={resolution} onChange={(e) => setResolution(Number(e.target.value))} /></Field>
              <Field label="FPS"><Input type="number" value={fps} onChange={(e) => setFps(Number(e.target.value))} /></Field>
              <Field label="Duration tol. (s)"><Input type="number" step={0.01} value={durationTolerance} onChange={(e) => setDurationTolerance(Number(e.target.value))} /></Field>
              <Field label="Min motion score"><Input type="number" step={0.1} value={minMotion} onChange={(e) => setMinMotion(Number(e.target.value))} /></Field>
              <Field label="Dup threshold (bits)"><Input type="number" value={duplicateThreshold} onChange={(e) => setDuplicateThreshold(Number(e.target.value))} /></Field>
              <Field label="Val ratio"><Input type="number" step={0.05} min={0} max={1} value={valRatio} onChange={(e) => setValRatio(Number(e.target.value))} /></Field>
              <Field label="Seed"><Input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></Field>
              <div className="col-span-2">
                <Button type="submit" disabled={state.status === "running"} className="w-full">
                  {state.status === "running" ? "Running…" : "Run Preprocess"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live output</CardTitle>
            <CardDescription>OpenCV / ffprobe pipeline output streamed live.</CardDescription>
          </CardHeader>
          <CardContent>
            <JobRunnerPanel state={state} onCancel={cancel} height={420} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3 flex-row flex items-center justify-between">
          <CardTitle className="text-sm">Result summary</CardTitle>
          <Button asChild variant="outline" size="sm"><Link href="/quality"><ShieldCheck className="h-4 w-4 mr-1" />View Quality Report</Link></Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Metric label="Total" value={stats?.total ?? 0} />
            <Metric label="Quality pass / fail" value={`${stats?.qualityPassed ?? 0} / ${stats?.qualityFailed ?? 0}`} />
            <Metric label="Train" value={stats?.trainCount ?? 0} />
            <Metric label="Val" value={stats?.valCount ?? 0} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-card/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
