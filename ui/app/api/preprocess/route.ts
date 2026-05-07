import { NextRequest, NextResponse } from "next/server";
import { jobQueue } from "@/lib/python";
import { jobToSseResponse } from "@/lib/sse";
import { preprocessRequestSchema } from "@/lib/schemas";

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
  const parsed = preprocessRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (jobQueue.hasActive()) {
    return NextResponse.json(
      { error: "another job is already running", active: jobQueue.active()?.summary() },
      { status: 409 },
    );
  }
  const r = parsed.data;
  const args: string[] = [
    "scripts/preprocess_dataset.py",
    "--resolution", String(r.resolution),
    "--fps", String(r.fps),
    "--duration-tolerance", String(r.durationTolerance),
    "--min-motion", String(r.minMotion),
    "--duplicate-threshold", String(r.duplicateThreshold),
    "--val-ratio", String(r.valRatio),
    "--seed", String(r.seed),
  ];
  if (r.verbose) args.push("--verbose");

  let job;
  try {
    job = jobQueue.spawnPython("preprocess", args[0], args.slice(1));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return jobToSseResponse(job);
}
