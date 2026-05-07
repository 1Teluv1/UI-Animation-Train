import { NextResponse } from "next/server";
import { jobQueue } from "@/lib/python";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ jobs: jobQueue.list() });
}
