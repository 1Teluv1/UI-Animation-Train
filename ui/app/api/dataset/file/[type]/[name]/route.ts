import { NextRequest } from "next/server";
import { promises as fs, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { resolveDatasetFile, UnsafePathError } from "@/lib/safe-path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
};

function mimeFor(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME[name.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m) return null;
  let start = m[1] === "" ? NaN : Number(m[1]);
  let end = m[2] === "" ? NaN : Number(m[2]);
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    start = size - end;
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (start < 0 || end >= size || start > end) return null;
  return { start, end };
}

export async function GET(req: NextRequest, ctx: { params: { type: string; name: string } }) {
  let abs: string;
  try {
    abs = resolveDatasetFile(ctx.params.type, ctx.params.name);
  } catch (e) {
    if (e instanceof UnsafePathError) {
      return new Response(e.message, { status: 400 });
    }
    return new Response("error", { status: 500 });
  }
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return new Response("not found", { status: 404 });
  }
  if (!stat.isFile()) {
    return new Response("not a file", { status: 400 });
  }
  const ct = mimeFor(ctx.params.name);
  const range = parseRange(req.headers.get("range"), stat.size);
  if (range) {
    const { start, end } = range;
    const stream = createReadStream(abs, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": ct,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }
  const stream = createReadStream(abs);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
