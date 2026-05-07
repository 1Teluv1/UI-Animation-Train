import { NextRequest, NextResponse } from "next/server";
import { METADATA_PATH } from "@/lib/paths";
import { readMetadata } from "@/lib/metadata";
import { datasetListQuerySchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = datasetListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const q = parsed.data;
  const all = await readMetadata(METADATA_PATH);
  const filtered = all.filter((r) => {
    if (q.category && r.asset_type !== q.category) return false;
    if (q.source && r.source !== q.source) return false;
    if (q.motionPreset && r.motion_preset !== q.motionPreset) return false;
    if (q.search) {
      const needle = q.search.toLowerCase();
      const hay = `${r.subject} ${r.caption}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const start = (q.page - 1) * q.pageSize;
  const items = filtered.slice(start, start + q.pageSize);
  return NextResponse.json({
    page: q.page,
    pageSize: q.pageSize,
    total: filtered.length,
    items,
  });
}
