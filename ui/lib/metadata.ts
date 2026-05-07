import { promises as fs, createReadStream } from "node:fs";
import readline from "node:readline";
import { MetadataRecord, QualityRecord } from "./types";

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonlAll<T>(filePath: string): Promise<T[]> {
  if (!(await exists(filePath))) return [];
  const out: T[] = [];
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export async function readMetadata(filePath: string): Promise<MetadataRecord[]> {
  return readJsonlAll<MetadataRecord>(filePath);
}

export async function readQualityReport(filePath: string): Promise<QualityRecord[]> {
  return readJsonlAll<QualityRecord>(filePath);
}

export interface DatasetStats {
  total: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
  avgMotionScore: number | null;
  trainCount: number;
  valCount: number;
  qualityPassed: number;
  qualityFailed: number;
}

export async function computeStats(opts: {
  metadataPath: string;
  qualityPath: string;
  trainPath: string;
  valPath: string;
}): Promise<DatasetStats> {
  const [meta, quality, train, val] = await Promise.all([
    readMetadata(opts.metadataPath),
    readQualityReport(opts.qualityPath),
    readJsonlAll<MetadataRecord>(opts.trainPath),
    readJsonlAll<MetadataRecord>(opts.valPath),
  ]);

  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const r of meta) {
    byCategory[r.asset_type] = (byCategory[r.asset_type] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  }
  let qualityPassed = 0, qualityFailed = 0, motionSum = 0, motionN = 0;
  for (const q of quality) {
    if (q.passed) qualityPassed++; else qualityFailed++;
    const ms = q.metrics?.motion_score;
    if (typeof ms === "number" && Number.isFinite(ms)) { motionSum += ms; motionN++; }
  }
  return {
    total: meta.length,
    byCategory,
    bySource,
    avgMotionScore: motionN > 0 ? motionSum / motionN : null,
    trainCount: train.length,
    valCount: val.length,
    qualityPassed,
    qualityFailed,
  };
}
