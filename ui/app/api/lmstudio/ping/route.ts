import { NextResponse } from "next/server";
import { LMSTUDIO_BASE_URL } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const url = `${LMSTUDIO_BASE_URL.replace(/\/$/, "")}/models`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Authorization: "Bearer lm-studio" } });
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      url,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, status: 0, url, error: (e as Error).message });
  } finally {
    clearTimeout(t);
  }
}
