"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JobRunnerPanel, useJobRunner } from "@/components/job-runner";
import { VideoGrid } from "@/components/video-grid";
import { ASSET_TYPES, type AssetType, type MetadataRecord } from "@/lib/types";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

export default function GeneratePage() {
  const [category, setCategory] = useState<AssetType>("ui_reward");
  const [count, setCount] = useState(2);
  const [duration, setDuration] = useState(2.0);
  const [seed, setSeed] = useState(0);
  const [startId, setStartId] = useState<string>("");
  const [noLlm, setNoLlm] = useState(true);
  const [alsoWebm, setAlsoWebm] = useState(false);
  const [keepFrames, setKeepFrames] = useState(false);

  const { state, start, cancel } = useJobRunner();
  const { data: lms } = useSWR("/api/lmstudio/ping", fetcher, { refreshInterval: 30000 });
  const [lastBatch, setLastBatch] = useState<MetadataRecord[]>([]);

  async function fetchRecent() {
    try {
      const j = await fetch(`/api/dataset/list?page=1&pageSize=${count}&category=${category}`).then((r) => r.json());
      setLastBatch(j.items ?? []);
    } catch { /* ignore */ }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!noLlm && !lms?.ok) {
      toast.error("LM Studio is offline. Toggle 'no-llm' to use bundled templates instead.");
      return;
    }
    await start(() =>
      fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          count,
          duration,
          seed,
          startId: startId === "" ? undefined : Number(startId),
          noLlm,
          alsoWebm,
          keepFrames,
          verbose: true,
        }),
      }),
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Generate Dataset (Phase 1)
        </h1>
        <p className="text-sm text-muted-foreground">
          Spawn the LM Studio HTML pipeline (or bundled templates) and capture each clip to MP4.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spec</CardTitle>
            <CardDescription>Sequential by design — only one job runs at a time.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label className="mb-1.5 block">Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as AssetType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Count</Label>
                <Input type="number" min={1} max={2000} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              </div>
              <div>
                <Label className="mb-1.5 block">Duration (s)</Label>
                <Input type="number" step={0.1} min={0.5} max={10} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
              </div>
              <div>
                <Label className="mb-1.5 block">Seed</Label>
                <Input type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
              </div>
              <div>
                <Label className="mb-1.5 block">Start ID (optional)</Label>
                <Input type="number" min={0} value={startId} placeholder="auto" onChange={(e) => setStartId(e.target.value)} />
              </div>

              <div className="col-span-2 grid grid-cols-3 gap-3 pt-2">
                <ToggleRow label="No LLM (use templates)" checked={noLlm} onChange={setNoLlm} />
                <ToggleRow label="Also WebM" checked={alsoWebm} onChange={setAlsoWebm} />
                <ToggleRow label="Keep PNG frames" checked={keepFrames} onChange={setKeepFrames} />
              </div>

              <div className="col-span-2 pt-2">
                <Button type="submit" disabled={state.status === "running"} className="w-full">
                  <Sparkles className="h-4 w-4 mr-2" />
                  {state.status === "running" ? "Running…" : "Start Generation"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live output</CardTitle>
            <CardDescription>stdout / stderr stream from the python script.</CardDescription>
          </CardHeader>
          <CardContent>
            <JobRunnerPanel
              state={state}
              onCancel={cancel}
              height={420}
            />
            {(state.status === "done" || state.status === "error" || state.status === "cancelled") && (
              <div className="pt-3 flex justify-end">
                <Button size="sm" variant="outline" onClick={fetchRecent}>Refresh preview</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Latest preview</CardTitle></CardHeader>
        <CardContent>
          <VideoGrid items={lastBatch} emptyHint="Run a job and click 'Refresh preview'." />
        </CardContent>
      </Card>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border bg-card/30 px-3 py-2 cursor-pointer">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
