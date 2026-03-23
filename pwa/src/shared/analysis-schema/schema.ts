import { z } from "zod";

const quantumSchema = z.object({
  start: z.number(),
  duration: z.number(),
  confidence: z.number().optional(),
});

const segmentSchema = z.object({
  start: z.number(),
  duration: z.number(),
  confidence: z.number(),
  loudness_start: z.number(),
  loudness_max: z.number(),
  loudness_max_time: z.number(),
  pitches: z.array(z.number()).length(12),
  timbre: z.array(z.number()).length(12),
});

const trackSchema = z.object({
  title: z.string().optional(),
  artist: z.string().optional(),
  duration: z.number().optional(),
  tempo: z.number().optional(),
  time_signature: z.number().optional(),
});

const engineVersionSchema = z.number().int();
const engineOriginSchema = z.enum([
  "forever-jukebox",
  "forever-jukebox-android",
  "forever-jukebox-pwa",
]);

export const analysisSchema = z.object({
  engine_version: engineVersionSchema.optional(),
  engine_origin: engineOriginSchema.optional(),
  sections: z.array(quantumSchema),
  bars: z.array(quantumSchema),
  beats: z.array(quantumSchema),
  tatums: z.array(quantumSchema),
  segments: z.array(segmentSchema),
  track: trackSchema.optional(),
});

export type AnalysisOutput = z.infer<typeof analysisSchema>;

export function validateAnalysis(input: unknown): AnalysisOutput {
  return analysisSchema.parse(input);
}
