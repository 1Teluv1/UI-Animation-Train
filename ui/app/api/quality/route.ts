import { NextRequest, NextResponse } from "next/server";
import { QUALITY_REPORT_PATH } from "@/lib/paths";
import { readQualityReport } from "@/lib/metadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const onlyFailed = url.searchParams.get("failed") === "1";
  const all = await readQualityReport(QUALITY_REPORT_PATH);
  const items = onlyFailed ? all.filter((q) => !q.passed) : all;
  const reasonCounts: Record<string, number> = {};
  let passed = 0;
  let failed = 0;
  const motionScores: number[] = [];
  for (const q of all) {
    if (q.passed) passed++;
    else {
      failed++;
      for (const r of q.reasons) {
        const key = r.split(/[<:!=]/)[0].trim().slice(0, 60);
        reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
      }
    }
    const ms = q.metrics?.motion_score;
    if (typeof ms === "number" && Number.isFinite(ms)) motionScores.push(ms);
  }
  return NextResponse.json({
    items,
    summary: { total: all.length, passed, failed, reasonCounts, motionScores },
  });
}
