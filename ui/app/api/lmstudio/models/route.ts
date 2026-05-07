import { NextResponse } from "next/server";
import { LMSTUDIO_BASE_URL } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LmsModel { id: string; object?: string; owned_by?: string; }

export async function GET() {
  const url = `${LMSTUDIO_BASE_URL.replace(/\/$/, "")}/models`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Authorization: "Bearer lm-studio" } });
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status, models: [] }, { status: 200 });
    }
    const json = (await res.json()) as { data?: LmsModel[] };
    return NextResponse.json({ ok: true, status: 200, models: json.data ?? [] });
  } catch (e) {
    return NextResponse.json({ ok: false, status: 0, models: [], error: (e as Error).message });
  } finally {
    clearTimeout(t);
  }
}
