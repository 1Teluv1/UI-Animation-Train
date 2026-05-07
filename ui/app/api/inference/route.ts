import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { jobQueue } from "@/lib/python";
import { jobToSseResponse } from "@/lib/sse";
import { inferenceRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = inferenceRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (jobQueue.hasActive()) {
    return NextResponse.json(
      { error: "another job is already running", active: jobQueue.active()?.summary() },
      { status: 409 },
    );
  }
  const args: string[] = ["scripts/sample_inference.py"];
  if (parsed.data.loraPath) {
    args.push("--lora", parsed.data.loraPath);
  }
  if (parsed.data.seed !== undefined) {
    args.push("--seed", String(parsed.data.seed));
  }
  if (parsed.data.verbose) args.push("--verbose");

  let promptsFile: string | null = null;
  if (parsed.data.prompts && parsed.data.prompts.length > 0) {
    promptsFile = path.join(tmpdir(), `prompts_${Date.now()}.txt`);
    await fs.writeFile(promptsFile, parsed.data.prompts.join("\n"), "utf-8");
    args.push("--prompts", promptsFile);
  }

  let job;
  try {
    job = jobQueue.spawnPython("inference", args[0], args.slice(1));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  if (promptsFile) {
    job.on("exit", () => {
      fs.unlink(promptsFile!).catch(() => undefined);
    });
  }
  return jobToSseResponse(job);
}
