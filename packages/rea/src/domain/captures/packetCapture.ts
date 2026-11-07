import { z } from "zod";
import { fixedTupleSchema } from "../fixedTupleSchema.js";
import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "../localPath.js";

const argument = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => !value.includes("\0"), "NUL is not an argument character");
const captureInputShape = z.strictObject({
  path: localPathStringSchema.describe("Absolute local capture path"),
  fields: z
    .array(argument)
    .max(1024)
    .min(1)
    .describe(
      "TShark field names to return, e.g. ip.addr, usb.endpoint_address, btatt.opcode; frame.number is always included",
    ),
  display_filter: argument
    .nullable()
    .default(null)
    .describe(
      "Optional Wireshark display filter (-Y), applied within the read limit",
    ),
  decode_as: z
    .array(argument)
    .max(1024)
    .default([])
    .describe("Explicit TShark decode-as selections, e.g. tcp.port==8888,http"),
  packet_limit: z
    .number()
    .int()
    .positive()
    .max(2147483647)
    .nullable()
    .default(null)
    .describe(
      "Maximum input packets to read before filtering; omitted scans to EOF within resource limits",
    ),
  two_pass: z
    .boolean()
    .default(true)
    .describe(
      "Use two-pass analysis for fields requiring later packets; false requests a single pass",
    ),
  match_offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe("Skip this many matching packets after filtering; default 0"),
  match_limit: z
    .number()
    .int()
    .positive()
    .nullable()
    .default(50)
    .describe(
      "Return at most this many matching packets after filtering; default 50. Null explicitly returns all remaining matches within producer resource limits.",
    ),
});
// Bound UTF-8 selector text, terminators, option names and 64-bit argv pointers
// before Set/flatMap expansion. 32 KiB reserves headroom below Linux execve's
// 32-page argv+environment floor; ambient environments can still exhaust it.
export const withinPacketCaptureSelectorBudget = (input: {
  fields: readonly string[];
  decode_as: readonly string[];
  display_filter: string | null;
}): boolean => {
  if (input.fields.length > 1024 || input.decode_as.length > 1024) return false;
  let bytes = 0;
  for (const selections of [input.fields, input.decode_as])
    for (const value of selections) {
      bytes += Buffer.byteLength(value, "utf8") + 20;
      if (bytes > 32768) return false;
    }
  if (input.display_filter !== null)
    bytes += Buffer.byteLength(input.display_filter, "utf8") + 20;
  return bytes <= 32768;
};
export const packetCaptureSelectorBudgetIssue = {
  message:
    "Packet selectors exceed the 32 KiB encoded argument budget; reduce fields, decode-as rules or filter text.",
};
const packetCaptureSelectionSchema = captureInputShape.refine(
  withinPacketCaptureSelectorBudget,
  packetCaptureSelectorBudgetIssue,
);
export const inspectPacketCaptureInputSchema =
  packetCaptureSelectionSchema.safeExtend({
    path: absoluteLocalPathStringSchema.describe("Absolute local capture path"),
  });
export const packetCaptureOptionsSchema = captureInputShape
  .omit({ path: true })
  .refine(withinPacketCaptureSelectorBudget, packetCaptureSelectorBudgetIssue);
export type InspectPacketCaptureInput = z.infer<
  typeof inspectPacketCaptureInputSchema
>;

/** Values remain strings; repeated occurrences remain ordered arrays. */
export const packetFieldsSchema = z
  .object({
    "frame.number": fixedTupleSchema([z.string().regex(/^[1-9][0-9]*$/)]),
  })
  .catchall(z.array(z.string()));
export const packetCaptureSchema = z
  .strictObject({
    artifact: z.strictObject({
      path: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().nonnegative(),
    }),
    selection: packetCaptureSelectionSchema,
    packets: z.array(packetFieldsSchema),
    output_window: z.strictObject({
      matching_packets: z
        .number()
        .int()
        .nonnegative()
        .describe(
          "Matches in the completed producer output within the indicated input read scope, not total capture packets",
        ),
      returned_packets: z.number().int().nonnegative(),
      has_more: z.boolean(),
    }),
    read_scope: z.enum(["to-eof", "up-to-input-packet-limit"]),
    diagnostics: z.string(),
    tool: z.strictObject({
      configured_path: z.string(),
      selection_source: z
        .enum(["environment", "path"])
        .describe(
          "Whether REA_TSHARK_COMMAND selected the tool or PATH located it",
        ),
      path: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      version_banner: z.string(),
      version_diagnostics: z.string(),
      arguments: z.array(z.string()),
    }),
    configuration: z.literal("private-empty-personal-profile"),
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
      report.output_window.matching_packets - report.selection.match_offset,
      0,
    );
    const expected =
      report.selection.match_limit === null
        ? remaining
        : Math.min(remaining, report.selection.match_limit);
    if (
      report.packets.length !== expected ||
      report.output_window.returned_packets !== expected ||
      report.output_window.has_more !== remaining > expected
    )
      context.addIssue({
        code: "custom",
        path: ["output_window"],
        message:
          "Returned packet window must match examined matches and caller-selected offset/limit",
      });
  });
