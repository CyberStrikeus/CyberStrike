import { z } from "zod";
import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "../localPath.js";
import { windowAnnotationText } from "./annotationTextWindow.js";

// These strings are single sigrok arguments, never shell fragments.
const selection = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => !value.includes("\0"), "NUL is not an argument character");
const signalInputShape = z.strictObject({
  path: localPathStringSchema.describe("Absolute local recording path"),
  decoders: selection.describe(
    "sigrok decoder stack, options and channel assignments, e.g. uart:rx=RX:baudrate=9600",
  ),
  input_format: selection
    .nullable()
    .default(null)
    .describe(
      "Explicit sigrok input format and options; omitted means autodetection",
    ),
  annotations: selection
    .nullable()
    .default(null)
    .describe("Optional annotation selection, e.g. uart=rx-data"),
  line_offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe("Skip this many literal LF-separated output lines; default 0"),
  line_limit: z
    .number()
    .int()
    .positive()
    .nullable()
    .default(50)
    .describe(
      "Return at most this many output lines; default 50. Null explicitly returns all remaining lines within producer limits. Lines are not annotation counts.",
    ),
});
export const withinSignalRecordingSelectorBudget = (input: {
  decoders: string;
  input_format: string | null;
  annotations: string | null;
}): boolean => {
  let bytes = 0;
  for (const [value, prefix] of [
    [input.decoders, "--protocol-decoders="],
    [input.input_format, "--input-format="],
    [input.annotations, "--protocol-decoder-annotations="],
  ] as const)
    if (value !== null)
      bytes +=
        Buffer.byteLength(prefix, "utf8") +
        Buffer.byteLength(value, "utf8") +
        9;
  return bytes <= 32768;
};
export const signalRecordingSelectorBudgetIssue = {
  message:
    "Signal selectors exceed the 32 KiB encoded argument budget; reduce decoder, format or annotation selections.",
};
const signalRecordingSelectionSchema = signalInputShape.refine(
  withinSignalRecordingSelectorBudget,
  signalRecordingSelectorBudgetIssue,
);
export const decodeSignalRecordingInputSchema =
  signalRecordingSelectionSchema.safeExtend({
    path: absoluteLocalPathStringSchema.describe(
      "Absolute local recording path",
    ),
  });
export const signalRecordingOptionsSchema = signalInputShape
  .omit({ path: true })
  .refine(
    withinSignalRecordingSelectorBudget,
    signalRecordingSelectorBudgetIssue,
  );
export type DecodeSignalRecordingInput = z.infer<
  typeof decodeSignalRecordingInputSchema
>;

export const signalRecordingSchema = z
  .strictObject({
    artifact: z.strictObject({
      path: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().nonnegative(),
    }),
    selection: signalRecordingSelectionSchema,
    annotations_text: z
      .string()
      .describe(
        "Selected literal lines of sigrok display output with unchanged sample ranges and line endings; not a lossless binary protocol representation",
      ),
    output_window: z.strictObject({
      total_lines: z
        .number()
        .int()
        .nonnegative()
        .describe(
          "Literal LF-separated lines in completed producer output, not annotation or sample counts",
        ),
      returned_lines: z.number().int().nonnegative(),
      has_more: z.boolean(),
    }),
    diagnostics: z.string(),
    tool: z.strictObject({
      configured_path: z.string(),
      path: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      version_banner: z.string(),
      version_diagnostics: z.string(),
      arguments: z.array(z.string()),
    }),
    resource_limiter: z.strictObject({
      configured_path: z.string(),
      path: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      arguments: z.array(z.string()),
    }),
    limits: z.strictObject({
      input_bytes: z.number().int().positive(),
      output_bytes: z.number().int().positive(),
      command_timeout_ms: z.number().int().positive(),
      address_space_bytes: z.number().int().nonnegative(),
      file_bytes: z.number().int().nonnegative(),
      cpu_seconds: z.number().int().nonnegative(),
    }),
    hardware_acquisition: z.literal("not-performed"),
  })
  .superRefine((report, context) => {
    const remaining = Math.max(
      report.output_window.total_lines - report.selection.line_offset,
      0,
    );
    const expected =
      report.selection.line_limit === null
        ? remaining
        : Math.min(remaining, report.selection.line_limit);
    if (
      report.output_window.returned_lines !== expected ||
      windowAnnotationText(report.annotations_text, 0, null).output_window
        .total_lines !== expected ||
      report.output_window.has_more !== remaining > expected
    )
      context.addIssue({
        code: "custom",
        path: ["output_window"],
        message:
          "Output text and window must agree with examined lines and selected offset/limit",
      });
  });
