export type AssetType =
  | "ui_reward"
  | "emoji_motion"
  | "game_vfx"
  | "item_showcase"
  | "button_motion";

export const ASSET_TYPES: AssetType[] = [
  "ui_reward",
  "emoji_motion",
  "game_vfx",
  "item_showcase",
  "button_motion",
];

export type JobKind =
  | "generate"
  | "preprocess"
  | "train_smoke"
  | "train"
  | "inference";

export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface JobSummary {
  id: string;
  kind: JobKind;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  command: string[];
  pid?: number;
  detached?: boolean;
  logLineCount: number;
}

export interface MetadataRecord {
  id: string;
  video: string;
  html: string;
  webm?: string | null;
  caption: string;
  asset_type: AssetType;
  subject: string;
  motion_preset?: string;
  motion?: string;
  style?: string;
  background?: string;
  duration: number;
  fps: number;
  resolution: string;
  source: "lm_studio" | "fallback_template";
  created_at: string;
}

export interface QualityRecord {
  id: string;
  asset_type: string;
  video: string;
  passed: boolean;
  reasons: string[];
  metrics: {
    width?: number;
    height?: number;
    fps?: number | null;
    duration?: number | null;
    nb_frames?: number | null;
    frame_count?: number;
    motion_score?: number;
    composite_hash?: string;
  };
}

export interface SseLogEvent {
  stream: "stdout" | "stderr";
  text: string;
}

export interface SseExitEvent {
  code: number | null;
  status: JobStatus;
}
