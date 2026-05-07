import { NextRequest, NextResponse } from "next/server";
import { jobQueue } from "@/lib/python";
import { jobToSseResponse } from "@/lib/sse";
import { generateRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600; // seconds (best-effort hint)

function buildArgs(req: ReturnType<typeof generateRequestSchema.parse>): string[] {
  const args: string[] = [
    "scripts/generate_dataset.py",
    "--count", String(req.count),
    "--category", req.category,
    "--seed", String(req.seed),
    "--duration", String(req.duration),
  ];
  if (req.startId !== undefined) args.push("--start-id", String(req.startId));
  if (req.noLlm) args.push("--no-llm");
  if (req.alsoWebm) args.push("--also-webm");
  if (req.keepFrames) args.push("--keep-frames");
  if (req.verbose) args.push("--verbose");
  return args;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (jobQueue.hasActive()) {
    const a = jobQueue.active();
    return NextResponse.json(
      { error: "another job is already running", active: a?.summary() },
      { status: 409 },
    );
  }
  const args = buildArgs(parsed.data);
  let job;
  try {
    job = jobQueue.spawnPython("generate", args[0], args.slice(1));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return jobToSseResponse(job);
}
