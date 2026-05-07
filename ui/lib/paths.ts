import path from "node:path";

const UI_DIR = process.cwd();

function envPath(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim().length > 0 ? path.resolve(v) : path.resolve(fallback);
}

export const PIPELINE_DIR = envPath(
  "PIPELINE_DIR",
  path.join(UI_DIR, "..", "game_asset_video_pipeline"),
);

export const DATASET_DIR = path.join(PIPELINE_DIR, "dataset");
export const PROCESSED_DIR = path.join(DATASET_DIR, "processed");
export const VIDEOS_DIR = path.join(DATASET_DIR, "videos");
export const HTML_DIR = path.join(DATASET_DIR, "html");
export const FRAMES_DIR = path.join(DATASET_DIR, "frames");
export const METADATA_PATH = path.join(DATASET_DIR, "metadata.jsonl");
export const FAILED_PATH = path.join(DATASET_DIR, "failed.jsonl");
export const QUALITY_REPORT_PATH = path.join(DATASET_DIR, "quality_report.jsonl");
export const TRAIN_METADATA_PATH = path.join(PROCESSED_DIR, "train_metadata.jsonl");
export const VAL_METADATA_PATH = path.join(PROCESSED_DIR, "val_metadata.jsonl");

export const SCRIPTS_DIR = path.join(PIPELINE_DIR, "scripts");
export const TRAIN_DIR = path.join(PIPELINE_DIR, "train");
export const LORA_CONFIG_PATH = path.join(TRAIN_DIR, "lora_config.yaml");
export const OUTPUTS_DIR = path.join(PIPELINE_DIR, "outputs");

export const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  (process.platform === "win32" ? "python.exe" : "python3");

export const LMSTUDIO_BASE_URL =
  process.env.LMSTUDIO_BASE_URL || "http://localhost:1234/v1";
