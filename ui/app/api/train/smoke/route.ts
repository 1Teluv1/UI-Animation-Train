import { NextResponse } from "next/server";
import { jobQueue } from "@/lib/python";
import { jobToSseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST() {
  if (jobQueue.hasActive()) {
    return NextResponse.json(
      { error: "another job is already running", active: jobQueue.active()?.summary() },
      { status: 409 },
    );
  }
  let job;
  try {
    job = jobQueue.spawnPython("train_smoke", "scripts/train_wan_lora.py", ["--smoke-test", "--verbose"]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return jobToSseResponse(job);
}
