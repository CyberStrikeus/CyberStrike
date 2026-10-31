import { createHash } from "node:crypto";

import { z } from "zod";
import { utcDateTimeSchema } from "./offsetDateTime.js";

import { webRuntimeCommandTimeoutSchema } from "./browserDeadline.js";
import { browserCompletenessSchema } from "./browserCompleteness.js";
import {
  browserAllowedOriginsSchema,
  browserObservationEndpointSchema,
} from "./browserObservation.js";
import { browserVersionSchema } from "./browserObservationSchemas.js";

/** Self-verifying inline PNG artifact for CLI/MCP parity. */
export const webScreenshotArtifactSchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    bytes: z.int().min(1),
    media_type: z.literal("image/png"),
    data_base64: z.string(),
  })
  .superRefine((artifact, context) => {
    const bytes = decodeCanonicalBase64(artifact.data_base64);
    if (bytes === undefined) {
      context.addIssue({ code: "custom", message: "Invalid canonical base64" });
      return;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== artifact.bytes || sha256 !== artifact.sha256)
      context.addIssue({
        code: "custom",
        message: "Screenshot artifact digest or size mismatch",
      });
  });
export type WebScreenshotArtifact = z.infer<typeof webScreenshotArtifactSchema>;

/** Input for one read-only visible-viewport screenshot. */
export const captureWebScreenshotInputSchema = z.strictObject({
  cdp_endpoint: browserObservationEndpointSchema,
  allowed_origins: browserAllowedOriginsSchema,
  target_id: z.string().min(1),
  command_timeout_ms: webRuntimeCommandTimeoutSchema,
});
export type CaptureWebScreenshotInput = z.infer<
  typeof captureWebScreenshotInputSchema
>;

/** Screenshot observation with embedded immutable artifact bytes. */
export const webScreenshotSchema = z.object({
  browser: browserVersionSchema,
  target: z.object({
    target_id: z.string(),
    url: z.string(),
    origin: z.string(),
  }),
  captured_at: utcDateTimeSchema,
  viewport: z.object({
    width: z.int().min(1),
    height: z.int().min(1),
  }),
  artifact: webScreenshotArtifactSchema,
  completeness: browserCompletenessSchema,
  limitations: z.array(z.string()),
});
export type WebScreenshot = z.infer<typeof webScreenshotSchema>;

/** Input for local pixel comparison of two screenshot artifacts. */
export const compareWebScreenshotsInputSchema = z.strictObject({
  before: webScreenshotArtifactSchema,
  after: webScreenshotArtifactSchema,
  channel_threshold: z.int().min(0).max(255).default(0),
});
export type CompareWebScreenshotsInput = z.infer<
  typeof compareWebScreenshotsInputSchema
>;

/** Value-only visual difference metrics; no OCR or image mutation. */
const webScreenshotDiffContextShape = {
  before: z.object({
    width: z.int().min(1),
    height: z.int().min(1),
  }),
  after: z.object({
    width: z.int().min(1),
    height: z.int().min(1),
  }),
  channel_threshold: z.int().min(0).max(255),
  limitations: z.array(z.string()),
};

export const webScreenshotDiffSchema = z
  .discriminatedUnion("status", [
    z.object({
      ...webScreenshotDiffContextShape,
      status: z.literal("identical"),
      compared_pixels: z.int().positive(),
      changed_pixels: z.literal(0),
      changed_ratio: z.literal(0),
      maximum_channel_delta: z.int().min(0).max(255),
      mean_absolute_channel_delta: z.number().min(0).max(255),
    }),
    z.object({
      ...webScreenshotDiffContextShape,
      status: z.literal("different"),
      compared_pixels: z.int().positive(),
      changed_pixels: z.int().positive(),
      changed_ratio: z.number().positive().max(1),
      maximum_channel_delta: z.int().positive().max(255),
      mean_absolute_channel_delta: z.number().positive().max(255),
    }),
    z.object({
      ...webScreenshotDiffContextShape,
      status: z.literal("dimension_mismatch"),
      compared_pixels: z.literal(0),
      changed_pixels: z.null(),
      changed_ratio: z.null(),
      maximum_channel_delta: z.null(),
      mean_absolute_channel_delta: z.null(),
    }),
  ])
  .superRefine((diff, context) => {
    const sameDimensions =
      diff.before.width === diff.after.width &&
      diff.before.height === diff.after.height;
    if (sameDimensions !== (diff.status !== "dimension_mismatch"))
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Screenshot comparison status must match viewport dimensions",
      });
    if (
      diff.status !== "dimension_mismatch" &&
      diff.compared_pixels !== diff.before.width * diff.before.height
    )
      context.addIssue({
        code: "custom",
        path: ["compared_pixels"],
        message: "Compared pixel count must match the shared dimensions",
      });
  });
export type WebScreenshotDiff = z.infer<typeof webScreenshotDiffSchema>;

/** Create a content-addressed PNG artifact from captured bytes. */
export const createWebScreenshotArtifact = (
  bytes: Buffer,
): WebScreenshotArtifact => {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return webScreenshotArtifactSchema.parse({
    sha256,
    bytes: bytes.byteLength,
    media_type: "image/png",
    data_base64: bytes.toString("base64"),
  });
};

/** Strict canonical base64 decoder used before digest validation. */
export const decodeCanonicalBase64 = (value: string): Buffer | undefined => {
  if (value.length === 0 || value.length % 4 !== 0) return undefined;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : undefined;
};
