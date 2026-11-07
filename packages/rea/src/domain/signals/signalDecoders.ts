import { z } from "zod";
import { signalRecordingSchema } from "./signalRecording.js";

export const inspectSignalDecodersInputSchema = z.strictObject({
  decoder: z
    .string()
    .regex(/^[a-zA-Z0-9_+\x2d]+$/u)
    .max(256)
    .nullable()
    .default(null)
    .describe(
      "Exact installed decoder ID for help; null searches the decoder catalog",
    ),
  query: z
    .string()
    .max(8192)
    .default("")
    .describe(
      "Case-insensitive literal substring in decoder ID/name or help lines; empty selects all",
    ),
  offset: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .default(0)
    .describe(
      "Number of matching decoders or help lines to skip; defaults to 0",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .default(50)
    .describe(
      "Maximum matching decoders or help lines returned; null requests all remaining",
    ),
});
export type InspectSignalDecodersInput = z.infer<
  typeof inspectSignalDecodersInputSchema
>;
export const signalDecodersSchema = z
  .strictObject({
    selection: inspectSignalDecodersInputSchema,
    decoders: z.array(z.strictObject({ id: z.string(), name: z.string() })),
    help_lines: z.array(
      z.strictObject({
        line_number: z.number().int().positive(),
        text: z.string(),
      }),
    ),
    output_window: z.strictObject({
      unit: z.enum(["decoders", "help-lines"]),
      examined: z.number().int().nonnegative(),
      matching: z.number().int().nonnegative(),
      returned: z.number().int().nonnegative(),
      has_more: z.boolean(),
    }),
    diagnostics: z.string(),
    tool: signalRecordingSchema.shape.tool,
    resource_limiter: signalRecordingSchema.shape.resource_limiter,
    limits: signalRecordingSchema.shape.limits,
    hardware_acquisition: z.literal("not-performed"),
  })
  .superRefine((report, context) => {
    const w = report.output_window;
    const catalog = report.selection.decoder === null;
    const remaining = Math.max(0, w.matching - report.selection.offset);
    const expected = Math.min(remaining, report.selection.limit ?? remaining);
    if (
      w.unit !== (catalog ? "decoders" : "help-lines") ||
      w.matching > w.examined ||
      w.returned !== expected ||
      (catalog ? report.decoders : report.help_lines).length !== expected ||
      (catalog ? report.help_lines : report.decoders).length !== 0 ||
      w.has_more !== remaining > expected
    )
      context.addIssue({
        code: "custom",
        path: ["output_window"],
        message:
          "Discovery coverage must match the selected page and result kind",
      });
  });
