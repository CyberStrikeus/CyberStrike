import { z } from "zod";
import { packetCaptureSchema } from "./packetCapture.js";

export const inspectPacketFieldsInputSchema = z.strictObject({
  kind: z
    .enum(["protocols", "fields"])
    .default("protocols")
    .describe(
      "Return protocol registrations or field definitions; defaults to protocols",
    ),
  protocol: z
    .string()
    .min(1)
    .max(8192)
    .nullable()
    .default(null)
    .describe(
      "Exact protocol abbreviation; selects that protocol or its registered fields",
    ),
  query: z
    .string()
    .max(8192)
    .default("")
    .describe(
      "Case-insensitive literal substring in name, abbreviation or field description",
    ),
  offset: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .default(0)
    .describe("Number of matching records to skip; defaults to 0"),
  limit: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .default(50)
    .describe(
      "Maximum matches returned; null requests all remaining within the record budget",
    ),
});
export type InspectPacketFieldsInput = z.infer<
  typeof inspectPacketFieldsInputSchema
>;
export const packetFieldRecordSchema = z.strictObject({
  source_line: z.number().int().positive(),
  kind: z.enum(["protocol", "field"]),
  name: z.string(),
  abbreviation: z.string(),
  field_type: z.string().nullable(),
  parent_protocol: z.string().nullable(),
  display_base: z.string().nullable(),
  bitmask: z.string().nullable(),
  description: z.string().nullable(),
});
export type PacketFieldRecord = z.infer<typeof packetFieldRecordSchema>;
export const packetFieldsCatalogSchema = z
  .strictObject({
    selection: inspectPacketFieldsInputSchema,
    records: z.array(packetFieldRecordSchema),
    output_window: z.strictObject({
      examined: z.number().int().nonnegative(),
      matching: z.number().int().nonnegative(),
      returned: z.number().int().nonnegative(),
      has_more: z.boolean(),
    }),
    diagnostics: z.string(),
    tool: packetCaptureSchema.shape.tool,
    resource_limiter: packetCaptureSchema.shape.resource_limiter,
    limits: packetCaptureSchema.shape.limits.extend({
      record_budget_bytes: z.literal(8388608),
    }),
    configuration: z.literal("private-empty-personal-profile"),
    hardware_acquisition: z.literal("not-performed"),
  })
  .superRefine((report, context) => {
    const w = report.output_window;
    const remaining = Math.max(0, w.matching - report.selection.offset);
    const expected = Math.min(remaining, report.selection.limit ?? remaining);
    if (
      w.matching > w.examined ||
      w.returned !== expected ||
      report.records.length !== expected ||
      w.has_more !== remaining > expected ||
      report.records.some(
        (row) =>
          row.kind !==
          (report.selection.kind === "protocols" ? "protocol" : "field"),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["output_window"],
        message:
          "Field discovery coverage must match the selected page and record kind",
      });
  });
