import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LORA_CONFIG_PATH, PIPELINE_DIR, PYTHON_BIN } from "@/lib/paths";
import { readYaml } from "@/lib/yaml";

const pexec = promisify(exec);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface GpuInfo { name: string; vramTotalMiB: number; vramFreeMiB: number; driver: string; }
interface LoraConfigShape { model?: { base_model_path?: string } }

async function pythonVersion(): Promise<string | null> {
  try {
    const { stdout } = await pexec(`"${PYTHON_BIN}" --version`, { timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function ffmpegStatus(): Promise<{ available: boolean; source: string }> {
  try {
    const { stdout } = await pexec(`"${PYTHON_BIN}" -c "import shutil,imageio_ffmpeg; p=shutil.which('ffmpeg') or imageio_ffmpeg.get_ffmpeg_exe(); print(p)"`, { timeout: 8000 });
    const p = stdout.trim();
    if (!p) return { available: false, source: "" };
    return { available: true, source: p };
  } catch {
    return { available: false, source: "" };
  }
}

async function gpuInfo(): Promise<GpuInfo[]> {
  try {
    const { stdout } = await pexec(
      `nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader,nounits`,
      { timeout: 5000 },
    );
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, total, free, driver] = line.split(",").map((s) => s.trim());
        return {
          name,
          vramTotalMiB: Number(total) || 0,
          vramFreeMiB: Number(free) || 0,
          driver,
        };
      });
  } catch {
    return [];
  }
}

async function pipelinePresent(): Promise<boolean> {
  try {
    const stat = await fs.stat(PIPELINE_DIR);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function wanWeightsPresent(): Promise<{ present: boolean; path: string | null }> {
  try {
    const cfg = await readYaml<LoraConfigShape>(LORA_CONFIG_PATH);
    const rel = cfg?.model?.base_model_path;
    if (!rel) return { present: false, path: null };
    const abs = path.isAbsolute(rel) ? rel : path.resolve(PIPELINE_DIR, rel);
    try {
      const stat = await fs.stat(abs);
      return { present: stat.isDirectory(), path: abs };
    } catch {
      return { present: false, path: abs };
    }
  } catch {
    return { present: false, path: null };
  }
}

export async function GET() {
  const [py, ffmpeg, gpus, pipeline, wan] = await Promise.all([
    pythonVersion(),
    ffmpegStatus(),
    gpuInfo(),
    pipelinePresent(),
    wanWeightsPresent(),
  ]);

  return NextResponse.json({
    python: { bin: PYTHON_BIN, version: py },
    ffmpeg,
    gpus,
    pipeline: { dir: PIPELINE_DIR, present: pipeline },
    wan,
  });
}
