import { NextResponse } from "next/server";
import {
  METADATA_PATH,
  QUALITY_REPORT_PATH,
  TRAIN_METADATA_PATH,
  VAL_METADATA_PATH,
} from "@/lib/paths";
import { computeStats } from "@/lib/metadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const stats = await computeStats({
    metadataPath: METADATA_PATH,
    qualityPath: QUALITY_REPORT_PATH,
    trainPath: TRAIN_METADATA_PATH,
    valPath: VAL_METADATA_PATH,
  });
  return NextResponse.json(stats);
}
