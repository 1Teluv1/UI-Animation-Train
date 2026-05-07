"use client";

import { useCallback, useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

export default function GeneratePage() {
  const [category, setCategory] = useState<AssetType>("ui_reward");
  const [count, setCount] = useState(2);
  const [startId, setStartId] = useState<string>("");
  const [alsoWebm, setAlsoWebm] = useState(false);
  const [keepFrames, setKeepFrames] = useState(false);

  const { state, start, cancel } = useJobRunner();
  const { data: lms } = useSWR("/api/lmstudio/ping", fetcher, { refreshInterval: 30000 });
  const [lastBatch, setLastBatch] = useState<MetadataRecord[]>([]);
  const busy = state.status === "running";

  const fetchRecent = useCallback(async () => {
    try {
      const j = await fetch(`/api/dataset/list?page=1&pageSize=${count}&category=${category}`).then((r) => r.json());
      setLastBatch(j.items ?? []);
    } catch { /* ignore */ }
  }, [category, count]);

  /** While a job runs, metadata.jsonl grows sample-by-sample — poll so Latest preview updates mid-run. */
  useEffect(() => {
    if (!busy) return;
    void fetchRecent();
    const id = setInterval(() => void fetchRecent(), 2000);
    return () => clearInterval(id);
  }, [busy, fetchRecent]);

  /** Final refresh when the job ends (interval may have stopped slightly before the last line landed). */
  useEffect(() => {
    if (state.status === "done" || state.status === "error" || state.status === "cancelled") {
      void fetchRecent();
    }
  }, [state.status, fetchRecent]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lms?.ok) {
      toast.error("LM Studio is offline.");
      return;
    }
    await start(() =>
      fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          count,
          startId: startId === "" ? undefined : Number(startId),
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
          Spawn the LM Studio HTML pipeline with prompt bank entries and capture each clip to MP4.
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
                <Select value={category} onValueChange={(v) => setCategory(v as AssetType)} disabled={busy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Count</Label>
                <Input type="number" min={1} max={2000} value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={busy} />
              </div>
              <div>
                <Label className="mb-1.5 block">Mode</Label>
                <Input value="Prompt bank (LLM only)" disabled />
              </div>
              <div>
                <Label className="mb-1.5 block">Start ID (optional)</Label>
                <Input type="number" min={0} value={startId} placeholder="auto" onChange={(e) => setStartId(e.target.value)} disabled={busy} />
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-3 pt-2">
                <ToggleRow label="Also WebM" checked={alsoWebm} onChange={setAlsoWebm} disabled={busy} />
                <ToggleRow label="Keep PNG frames" checked={keepFrames} onChange={setKeepFrames} disabled={busy} />
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
            <div className="pt-3 flex justify-end gap-2">
              {busy && (
                <span className="text-xs text-muted-foreground self-center mr-auto">Preview 아래도 약 2초마다 갱신됩니다.</span>
              )}
              {(state.status === "done" || state.status === "error" || state.status === "cancelled") && (
                <Button size="sm" variant="outline" onClick={fetchRecent}>Refresh preview</Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest preview</CardTitle>
          <CardDescription>
            같은 카테고리에서 최신 순 최대 {count}개입니다. 생성 중에도 주기적으로 갱신됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VideoGrid items={lastBatch} emptyHint="작업을 시작하면 완료된 클립이 여기에 순서대로 나타납니다." />
        </CardContent>
      </Card>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border bg-card/30 px-3 py-2",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}
