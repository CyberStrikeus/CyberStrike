import { createHash } from "node:crypto";

import { z } from "zod";

import {
  NATIVE_UI_WAIT_STEP_MAX_MS,
  nativeUiDeadlineField,
} from "./nativeDeadlines.js";

import { decodeCanonicalBase64 } from "../webScreenshot.js";
import { readPngHeaderDimensions } from "../pngHeader.js";

const scope = {
  pid: z.int().positive(),
  window_id: z.int().positive(),
  screenshot: z.boolean().default(true),
  accessibility: z.boolean().default(true),
  max_nodes: z
    .int()
    .positive()
    .safe()
    .default(500)
    .describe(
      "Maximum accessibility nodes per capture; increase for large windows.",
    ),
  native_ui_deadline_ms: nativeUiDeadlineField,
};
/** Opt-in passive observation binds one already-running process and window. */
export const nativeUiObservationInputSchema = z.strictObject(scope);
/** Active scenarios use explicit actions and leave application state as-is. */
export const nativeUiScenarioInputSchema = z.strictObject({
  ...scope,
  steps: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("click"),
          path: z.array(z.int().nonnegative()).max(32),
        }),
        z.strictObject({
          kind: z.literal("scroll"),
          path: z.array(z.int().nonnegative()).max(32),
          direction: z.enum(["increment", "decrement"]),
        }),
        z.strictObject({
          kind: z.literal("key-entry"),
          path: z.array(z.int().nonnegative()).max(32),
          text: z.string(),
        }),
        z.strictObject({
          kind: z.literal("wait"),
          milliseconds: z
            .int()
            .min(0)
            .max(NATIVE_UI_WAIT_STEP_MAX_MS)
            .describe(
              "Wait duration in milliseconds. One wait step stays capped at 180000 ms. This release has no runtime override for that step cap. The operation deadline is native_ui_deadline_ms (omitted means 180000).",
            ),
        }),
      ]),
    )
    .min(1),
});
/** Ordered captures and failures distinguish missing observation from a failed action. */
const nativeUiScreenshotSchema = z
  .strictObject({
    mime_type: z.literal("image/png"),
    base64: z
      .string()
      .min(4)
      .describe(
        "Canonical base64 encoding of PNG bytes; the decoded bytes must have a PNG signature and IHDR chunk.",
      ),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .describe("SHA-256 digest of the decoded PNG bytes."),
    width: z
      .int()
      .positive()
      .describe("Must equal the width encoded in the PNG IHDR chunk."),
    height: z
      .int()
      .positive()
      .describe("Must equal the height encoded in the PNG IHDR chunk."),
  })
  .superRefine((screenshot, context) => {
    const bytes = decodeCanonicalBase64(screenshot.base64);
    if (bytes === undefined) {
      context.addIssue({
        code: "custom",
        message: "Invalid canonical PNG base64",
      });
      return;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== screenshot.sha256)
      context.addIssue({
        code: "custom",
        message: "PNG screenshot digest mismatch",
      });
    const dimensions = readPngHeaderDimensions(bytes);
    if (dimensions === undefined) {
      context.addIssue({
        code: "custom",
        message: "Screenshot bytes are not a PNG image",
      });
      return;
    }
    if (
      dimensions.width !== screenshot.width ||
      dimensions.height !== screenshot.height
    )
      context.addIssue({
        code: "custom",
        message: "PNG screenshot dimensions mismatch",
      });
  });

export const nativeUiSnapshotSchema = z.strictObject({
  window: z.strictObject({
    pid: z.int().positive(),
    window_id: z.int().positive(),
    executable: z.string(),
    launch_time: z.number(),
    title: z.string(),
  }),
  nodes: z.array(
    z.strictObject({
      path: z.array(z.int().nonnegative()),
      role: z.string().nullable(),
      title: z.string().nullable(),
      value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
      actions: z.array(z.string()),
      children_count: z.int().nonnegative().nullable(),
    }),
  ),
  truncated: z.boolean(),
  screenshot: nativeUiScreenshotSchema.nullable(),
  gaps: z.array(z.string()),
});
export const nativeUiResultSchema = z.strictObject({
  target_sha256: z.string(),
  initial: nativeUiSnapshotSchema,
  steps: z.array(
    z.strictObject({
      index: z.int().nonnegative(),
      kind: z.string(),
      before: nativeUiSnapshotSchema,
      after: nativeUiSnapshotSchema.nullable(),
      outcome: z.enum(["completed", "failed", "cancelled"]),
      reason: z.string().nullable(),
    }),
  ),
  restore: z.literal("leave-as-is"),
  limitations: z.array(z.string()),
});

export type NativeUiObservationResult = z.infer<typeof nativeUiResultSchema>;
