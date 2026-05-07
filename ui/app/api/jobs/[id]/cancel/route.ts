import { NextResponse } from "next/server";
import { jobQueue } from "@/lib/python";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const job = jobQueue.get(ctx.params.id);
  if (!job) {
    return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  }
  job.cancel();
  return NextResponse.json({ ok: true, summary: job.summary() });
}
