import { NextRequest, NextResponse } from "next/server";
import { jobQueue } from "@/lib/python";
import { jobToSseResponse } from "@/lib/sse";
import { trainStartRequestSchema } from "@/lib/schemas";

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
  const parsed = trainStartRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (jobQueue.hasActive()) {
    return NextResponse.json(
      { error: "another job is already running", active: jobQueue.active()?.summary() },
      { status: 409 },
    );
  }
  const args: string[] = [];
  if (parsed.data.verbose) args.push("--verbose");
  let job;
  try {
    job = jobQueue.spawnPython("train", "scripts/train_wan_lora.py", args, {
      detached: parsed.data.detached,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return jobToSseResponse(job);
}
