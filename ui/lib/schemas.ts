import { z } from "zod";
import { ASSET_TYPES } from "./types";

export const generateRequestSchema = z.object({
  category: z.enum(ASSET_TYPES as [string, ...string[]]),
  count: z.number().int().min(1).max(2000),
  startId: z.number().int().min(0).optional(),
  alsoWebm: z.boolean().default(false),
  keepFrames: z.boolean().default(false),
  verbose: z.boolean().default(true),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const preprocessRequestSchema = z.object({
  resolution: z.number().int().default(512),
  fps: z.number().int().default(24),
  durationTolerance: z.number().min(0).max(1).default(0.05),
  minMotion: z.number().min(0).default(2.0),
  duplicateThreshold: z.number().int().min(0).default(8),
  valRatio: z.number().min(0).max(1).default(0.1),
  seed: z.number().int().min(0).default(0),
  verbose: z.boolean().default(true),
});
export type PreprocessRequest = z.infer<typeof preprocessRequestSchema>;

export const inferenceRequestSchema = z.object({
  loraPath: z.string().optional(),
  prompts: z.array(z.string().min(1)).min(1).max(10).optional(),
  seed: z.number().int().optional(),
  verbose: z.boolean().default(true),
});
export type InferenceRequest = z.infer<typeof inferenceRequestSchema>;

export const trainStartRequestSchema = z.object({
  detached: z.boolean().default(true),
  verbose: z.boolean().default(true),
});
export type TrainStartRequest = z.infer<typeof trainStartRequestSchema>;

export const datasetListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(24),
  category: z.string().optional(),
  source: z.enum(["prompt_bank", "lm_studio", "fallback_template"]).optional(),
  motionPreset: z.string().optional(),
  search: z.string().optional(),
});
export type DatasetListQuery = z.infer<typeof datasetListQuerySchema>;
