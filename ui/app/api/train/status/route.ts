import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OUTPUTS_DIR } from "@/lib/paths";
import { jobQueue } from "@/lib/python";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Checkpoint {
  name: string;
  path: string;
  step: number | null;
  files: string[];
  mtime: number;
}

async function listCheckpoints(): Promise<Checkpoint[]> {
  try {
    const runs = await fs.readdir(OUTPUTS_DIR, { withFileTypes: true });
    const out: Checkpoint[] = [];
    for (const run of runs) {
      if (!run.isDirectory()) continue;
      const runDir = path.join(OUTPUTS_DIR, run.name);
      const inner = await fs.readdir(runDir, { withFileTypes: true });
      for (const ck of inner) {
        if (!ck.isDirectory()) continue;
        const ckDir = path.join(runDir, ck.name);
        const stat = await fs.stat(ckDir);
        const m = /^checkpoint-(\d+)$/.exec(ck.name);
        const step = m ? Number(m[1]) : null;
        const files = (await fs.readdir(ckDir)).slice(0, 20);
        out.push({
          name: `${run.name}/${ck.name}`,
          path: ckDir,
          step,
          files,
          mtime: stat.mtimeMs,
        });
      }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  } catch {
    return [];
  }
}

export async function GET() {
  const [checkpoints] = await Promise.all([listCheckpoints()]);
  return NextResponse.json({
    active: jobQueue.active()?.summary() ?? null,
    jobs: jobQueue.list(),
    checkpoints,
  });
}
