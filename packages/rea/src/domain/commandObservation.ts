import { z } from "zod";

/** Opaque producer text and the command capture's explicit completion facts. */
export const commandObservationSchema = z.strictObject({
  stdout: z.string(),
  stderr: z.string(),
  exit_code: z.union([z.string(), z.number(), z.null()]),
  signal: z.string().nullable(),
  output_truncated: z.boolean(),
  completion_status: z.enum(["complete", "unknown"]),
  artifact_sha256_after: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  artifact_changed: z.boolean().nullable(),
});

/** The GDB owner retains ordered records and derives its stream groupings. */
export const gdbCommandResultSchema = z.strictObject({
  command: z.string(),
  mi: z
    .string()
    .describe(
      "The console command's independently framed MI result record; empty when a separate read-only query proves completion but raw stdout prevents identifying the original result class.",
    ),
  records: z.array(z.string()),
  console: z.string(),
  target: z.string(),
  log: z.string(),
  process_exit_observed: z.boolean().exactOptional(),
  process_exit_code: z.number().int().nullable().exactOptional(),
  process_exit_signal: z.string().nullable().exactOptional(),
  output_truncated: z.boolean(),
  output_invalid_utf8: z.literal(true).exactOptional(),
  completion_status: z.enum(["complete", "unknown"]),
});

/** Read-only capture facts; protocol interpretation stays with the provider. */
export type GdbCommandResult = Readonly<
  Omit<z.infer<typeof gdbCommandResultSchema>, "records">
> & { readonly records: readonly string[] };

export const commandEvidenceDetailSchema = z
  .enum(["complete", "summary"])
  .default("complete")
  .describe(
    "complete returns the original Evidence; summary retains that complete parent and returns command output once with completion and source context.",
  );
