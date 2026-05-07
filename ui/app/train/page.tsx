"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Cpu, FlaskConical, Play, Save, AlertTriangle, CircleCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfigEditor } from "@/components/config-editor";
import { JobRunnerPanel, useJobRunner } from "@/components/job-runner";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

interface ConfigResp { path: string; text: string; parsed?: unknown }
interface HealthResp {
  pipeline: { dir: string; present: boolean };
  wan: { present: boolean; path: string | null };
}
interface StatusResp {
  active: { id: string; kind: string } | null;
  checkpoints: Array<{ name: string; path: string; step: number | null; mtime: number; files: string[] }>;
}

export default function TrainPage() {
  const [text, setText] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const { data: cfg } = useSWR<ConfigResp>("/api/lora-config", fetcher);
  const { data: health } = useSWR<HealthResp>("/api/health", fetcher, { refreshInterval: 30000 });
  const { data: status, mutate: refreshStatus } = useSWR<StatusResp>("/api/train/status", fetcher, {
    refreshInterval: 8000,
  });

  useEffect(() => {
    if (cfg?.text && !dirty) {
      setText(cfg.text);
    }
  }, [cfg, dirty]);

  const smoke = useJobRunner();
  const train = useJobRunner();

  async function onSave() {
    try {
      const res = await fetch("/api/lora-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast.success(`Saved ${j.bytes} bytes to lora_config.yaml`);
      setDirty(false);
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    }
  }

  async function onSmoke() {
    if (dirty) {
      toast.info("You have unsaved changes — save first to use them.");
    }
    await smoke.start(() => fetch("/api/train/smoke", { method: "POST" }));
    refreshStatus();
  }

  async function onStart() {
    if (dirty) {
      toast.info("You have unsaved changes — save first to use them.");
    }
    await train.start(() =>
      fetch("/api/train/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detached: true, verbose: true }),
      }),
    );
    refreshStatus();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          LoRA Training (Phase 3)
        </h1>
        <p className="text-sm text-muted-foreground">
          Edit <code className="font-mono text-xs">train/lora_config.yaml</code>, run a 1-step smoke test, then start full training.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="flex-row flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">lora_config.yaml</CardTitle>
              <CardDescription>{cfg?.path}</CardDescription>
            </div>
            <div className="flex gap-2">
              {dirty && <Badge variant="warning">unsaved</Badge>}
              <Button size="sm" onClick={onSave} disabled={!dirty}>
                <Save className="h-4 w-4 mr-1" />Save
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ConfigEditor
              value={text}
              onChange={(next) => { setText(next); setDirty(next !== cfg?.text); }}
              height={520}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Environment</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row icon={health?.pipeline.present ? "ok" : "warn"} label="Pipeline dir" value={health?.pipeline.dir ?? "-"} />
              <Row
                icon={health?.wan.present ? "ok" : "warn"}
                label="Wan2.2 weights"
                value={health?.wan.path ?? "(not configured)"}
              />
              {!health?.wan.present && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                  Smoke test will exit with a clear &quot;weights missing&quot; message until you set <code className="font-mono">model.base_model_path</code>.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Button onClick={onSmoke} disabled={smoke.state.status === "running" || train.state.status === "running"} className="w-full" variant="secondary">
                <FlaskConical className="h-4 w-4 mr-1" />
                {smoke.state.status === "running" ? "Smoke running…" : "Smoke Test (1 step)"}
              </Button>
              <Button onClick={onStart} disabled={smoke.state.status === "running" || train.state.status === "running"} className="w-full">
                <Play className="h-4 w-4 mr-1" />
                {train.state.status === "running" ? "Training…" : "Start Training"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Checkpoints</CardTitle></CardHeader>
            <CardContent>
              {status?.checkpoints?.length ? (
                <ul className="space-y-1 text-xs font-mono">
                  {status.checkpoints.map((c) => (
                    <li key={c.path} className="flex items-center justify-between rounded border bg-card/30 px-2 py-1">
                      <span className="truncate" title={c.path}>{c.name}</span>
                      {c.step !== null && <Badge variant="outline" className="text-[10px]">step {c.step}</Badge>}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-muted-foreground italic">No checkpoints saved yet.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Smoke test output</CardTitle></CardHeader>
          <CardContent><JobRunnerPanel state={smoke.state} onCancel={smoke.cancel} height={320} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Training output</CardTitle></CardHeader>
          <CardContent><JobRunnerPanel state={train.state} onCancel={train.cancel} height={320} /></CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: "ok" | "warn"; label: string; value: React.ReactNode }) {
  const Icon = icon === "ok" ? CircleCheck : AlertTriangle;
  const color = icon === "ok" ? "text-emerald-400" : "text-amber-400";
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground"><Icon className={`h-3.5 w-3.5 ${color}`} />{label}</div>
      <div className="text-xs font-mono text-right max-w-[60%] truncate" title={String(value ?? "")}>{value}</div>
    </div>
  );
}
