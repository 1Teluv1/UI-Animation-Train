import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { LORA_CONFIG_PATH } from "@/lib/paths";
import { parseYaml } from "@/lib/yaml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const text = await fs.readFile(LORA_CONFIG_PATH, "utf-8");
    let parsed: unknown = null;
    try {
      parsed = parseYaml(text);
    } catch {
      parsed = null;
    }
    return NextResponse.json({ path: LORA_CONFIG_PATH, text, parsed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}

export async function PUT(req: NextRequest) {
  let body: { text?: string };
  try {
    body = (await req.json()) as { text?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.text !== "string") {
    return NextResponse.json({ error: "missing 'text'" }, { status: 400 });
  }
  try {
    parseYaml(body.text);
  } catch (e) {
    return NextResponse.json({ error: `yaml parse error: ${(e as Error).message}` }, { status: 400 });
  }
  await fs.writeFile(LORA_CONFIG_PATH, body.text, "utf-8");
  return NextResponse.json({ ok: true, path: LORA_CONFIG_PATH, bytes: body.text.length });
}
