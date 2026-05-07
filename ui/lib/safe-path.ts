import path from "node:path";
import { DATASET_DIR } from "./paths";

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const ALLOWED_TYPES = new Set(["videos", "html", "frames", "processed"]);

export class UnsafePathError extends Error {}

export function resolveDatasetFile(type: string, name: string): string {
  if (!ALLOWED_TYPES.has(type)) {
    throw new UnsafePathError(`type not allowed: ${type}`);
  }
  if (!NAME_RE.test(name)) {
    throw new UnsafePathError(`name not allowed: ${name}`);
  }
  const candidate = path.resolve(DATASET_DIR, type, name);
  const root = path.resolve(DATASET_DIR);
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new UnsafePathError("path escapes dataset root");
  }
  return candidate;
}

export function safeIdFromName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}
