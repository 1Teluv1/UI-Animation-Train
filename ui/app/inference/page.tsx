"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JobRunnerPanel, useJobRunner } from "@/components/job-runner";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

const DEFAULT_PROMPTS = [
  "[UI_REWARD] A shiny gold coin icon pops upward, spins once, emits small sparkles, then settles down. Clean mobile game UI animation.",
  "[EMOJI_MOTION] A cute yellow emoji smiles widely, bounces twice, sparkles around its face, then gently returns to the center.",
  "[GAME_VFX] A stylized blue magic burst appears at the center, expands outward, releases tiny glowing particles, and fades away.",
];

interface StatusResp {
  checkpoints: Array<{ name: string; path: string; step: number | null; mtime: number }>;
}

export default function InferencePage() {
  const [loraPath, setLoraPath] = useState<string>("");
  const [seed, setSeed] = useState<string>("");
  const [prompts, setPrompts] = useState<string>(DEFAULT_PROMPTS.join("\n"));

  const { data: status } = useSWR<StatusResp>("/api/train/status", fetcher);
  const { state, start, cancel } = useJobRunner();

  useEffect(() => {
    if (loraPath) return;
    const ck = status?.checkpoints?.find((c) => c.name.endsWith("/final"))
      ?? status?.checkpoints?.[0];
    if (ck) setLoraPath(ck.path);
  }, [status, loraPath]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const promptList = prompts.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    await start(() =>
      fetch("/api/inference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loraPath: loraPath || undefined,
          seed: seed === "" ? undefined : Number(seed),
          prompts: promptList,
          verbose: true,
        }),
      }),
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Wand2 className="h-5 w-5" />
          Sample Inference
        </h1>
        <p className="text-sm text-muted-foreground">
          Run <code className="font-mono text-xs">scripts/sample_inference.py</code> with the chosen checkpoint.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Inputs</CardTitle>
            <CardDescription>Outputs land in <code className="font-mono text-xs">outputs/icon_lora/final/sample_videos/</code>.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <Label className="mb-1.5 block text-xs">LoRA checkpoint</Label>
                <Select value={loraPath || "__base__"} onValueChange={(v) => setLoraPath(v === "__base__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Base model only" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__base__">Base model only</SelectItem>
                    {status?.checkpoints?.map((c) => (
                      <SelectItem key={c.path} value={c.path}>{c.name}{c.step !== null ? ` (step ${c.step})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {loraPath && <div className="text-[11px] text-muted-foreground mt-1 break-all font-mono">{loraPath}</div>}
              </div>

              <div>
                <Label className="mb-1.5 block text-xs">Seed (optional)</Label>
                <Input type="number" placeholder="auto" value={seed} onChange={(e) => setSeed(e.target.value)} />
              </div>

              <div>
                <Label className="mb-1.5 block text-xs">Prompts (one per line)</Label>
                <Textarea
                  rows={8}
                  className="font-mono text-xs"
                  value={prompts}
                  onChange={(e) => setPrompts(e.target.value)}
                />
              </div>

              <Button type="submit" disabled={state.status === "running"} className="w-full">
                <Wand2 className="h-4 w-4 mr-1" />
                {state.status === "running" ? "Generating…" : "Generate Samples"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live output</CardTitle>
            <CardDescription>Wan2.2 weights must be installed; see <code className="font-mono text-xs">/train</code> for setup.</CardDescription>
          </CardHeader>
          <CardContent>
            <JobRunnerPanel state={state} onCancel={cancel} height={520} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
