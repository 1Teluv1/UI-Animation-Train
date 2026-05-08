import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { readMetadata } from "@/lib/metadata";
import { METADATA_PATH, VIDEOS_DIR } from "@/lib/paths";
import type { AssetType, MetadataRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi"]);
const ASSET_TYPE_GUESS: AssetType[] = [
  "ui_reward",
  "emoji_motion",
  "game_vfx",
  "item_showcase",
  "button_motion",
];

function fallbackAssetType(fileName: string): AssetType {
  for (const t of ASSET_TYPE_GUESS) {
    if (fileName.startsWith(`${t}_`)) return t;
  }
  return "ui_reward";
}

export async function GET() {
  const [metadata, entries] = await Promise.all([
    readMetadata(METADATA_PATH),
    fs.readdir(VIDEOS_DIR, { withFileTypes: true }),
  ]);

  const byName = new Map<string, MetadataRecord>();
  for (const m of metadata) {
    byName.set(path.basename(m.video), m);
  }

  const files = entries
    .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name);

  const withStat = await Promise.all(
    files.map(async (name) => {
      const abs = path.join(VIDEOS_DIR, name);
      const stat = await fs.stat(abs);
      return { name, mtimeMs: stat.mtimeMs };
    }),
  );

  withStat.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const items: MetadataRecord[] = withStat.map(({ name, mtimeMs }) => {
    const found = byName.get(name);
    if (found) return found;
    const ext = path.extname(name);
    const baseName = path.basename(name, ext);
    return {
      id: `${baseName}${ext.toLowerCase() === ".webm" ? "_webm" : ""}`,
      video: `videos/${name}`,
      html: "",
      webm: ext.toLowerCase() === ".webm" ? `videos/${name}` : null,
      caption: name,
      asset_type: fallbackAssetType(baseName),
      subject: baseName,
      motion_preset: "file_scan",
      duration: 0,
      fps: 0,
      resolution: "-",
      source: "fallback_template",
      created_at: new Date(mtimeMs).toISOString(),
    };
  });

  return NextResponse.json({ total: items.length, items });
}
