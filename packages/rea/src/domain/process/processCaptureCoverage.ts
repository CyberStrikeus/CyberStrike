import { z } from "zod";
import type { UnverifiedProcessCapture } from "./processCapture.js";
import type { ProcessObservationSource } from "./processObservation.js";

const byteRetentionSchema = z.strictObject({
  budget_bytes: z.int().nonnegative(),
  observed_bytes: z.int().nonnegative(),
  retained_bytes: z.int().nonnegative(),
  observed_frames: z.int().nonnegative(),
  retained_frames: z.int().nonnegative(),
  unknown_size_frames: z.int().nonnegative().optional(),
  normalization_over_budget_frames: z.int().nonnegative().optional(),
});

const enumerationOmissionReasonSchema = z.enum([
  "identity_changed",
  "directory_unavailable",
  "entry_unavailable",
  "symlink_not_followed",
]);

/** Filesystem enumeration and whole-file digest coverage for one checkpoint. */
export const filesystemCoverageSchema = z.strictObject({
  files_limit: z.int().nonnegative(),
  depth_limit: z.int().nonnegative(),
  enumeration_truncated: z.boolean(),
  enumeration_reasons: z.array(
    z.enum([
      "files_limit",
      "depth_limit",
      "unrepresentable_name",
      ...enumerationOmissionReasonSchema.options,
    ]),
  ),
  enumeration_omissions: z.array(
    z.union([
      z.strictObject({
        path: z.string(),
        reason: enumerationOmissionReasonSchema,
        system_code: z.string().nullable(),
      }),
      z.strictObject({
        path: z.string(),
        reason: z.literal("unrepresentable_name"),
        system_code: z.null(),
        raw_name_hex: z.string().regex(/^(?:[0-9a-f]{2})+$/u),
      }),
    ]),
  ),
  unobserved_subtrees: z
    .array(
      z.strictObject({
        path: z.string(),
        reason: z.enum(["symlink_not_followed", "observer_owned"]),
      }),
    )
    .optional(),
  hash_budget_bytes: z.int().nonnegative(),
  hashed_bytes: z.int().nonnegative(),
  hash_omissions: z.array(
    z.strictObject({
      path: z.string(),
      size_bytes: z.int().nonnegative(),
      remaining_budget_bytes: z.int().nonnegative(),
      reason: z.enum([
        "file_bytes_budget",
        "file_changed_or_short_read",
        "file_unavailable",
      ]),
      system_code: z.string().nullable(),
    }),
  ),
});
export type FilesystemCoverage = z.infer<typeof filesystemCoverageSchema>;

/** Actual budget accounting; rendered bytes count state and visible lines, not JSON. */
export const processCaptureTruncationDetailsSchema = z.strictObject({
  raw_terminal: byteRetentionSchema
    .extend({
      redacted_bytes: z.int().nonnegative().optional(),
    })
    .describe(
      "Original PTY UTF-8 admission accounting. retained_bytes counts the safe projection; redacted_bytes counts removed bytes from admitted chunks. Their sum consumes the original output budget. Whole chunks are otherwise retained or omitted.",
    ),
  rendered_terminal: byteRetentionSchema.describe(
    "Cumulative UTF-8 bytes of serialized state plus visible lines, evaluated from retained PTY input; whole frames are retained or omitted. observed_bytes contains the exact total for size-known frames; unknown_size_frames counts frames whose complete size was not calculated. normalization_over_budget_frames identifies the subset stopped by an ordered normalization stage rather than final representation retention.",
  ),
  normalized_terminal: z
    .strictObject({
      budget_bytes: z.int().nonnegative(),
      retained_bytes: z.int().nonnegative(),
      omitted_frames: z.int().nonnegative(),
    })
    .optional()
    .describe(
      "UTF-8 bytes of normalized raw-chunk text retained under output_bytes; omitted frames can have unknown final size when normalization exceeded an intermediate bound.",
    ),
  filesystem_before: filesystemCoverageSchema,
  filesystem_after: filesystemCoverageSchema,
  process: z.strictObject({
    sample_limit: z.int().nonnegative(),
    sampling_partial: z.boolean(),
    retained_samples: z.int().nonnegative(),
    sample_limit_reached: z.boolean(),
    sampling_failures: z.int().nonnegative(),
    first_sampling_failure: z.string().nullable(),
    coverage: z.literal("sampled"),
  }),
});
export type ProcessCaptureTruncationDetails = z.infer<
  typeof processCaptureTruncationDetailsSchema
>;
export type TerminalRetention = ProcessCaptureTruncationDetails["raw_terminal"];
export type NormalizedTerminalRetention = NonNullable<
  ProcessCaptureTruncationDetails["normalized_terminal"]
>;
export type ProcessSamplingCoverage =
  ProcessCaptureTruncationDetails["process"];

const omitted = (retention: TerminalRetention): boolean =>
  retention.observed_frames > retention.retained_frames;
const filesystemTruncated = (coverage: FilesystemCoverage): boolean =>
  coverage.enumeration_truncated ||
  coverage.enumeration_omissions.length > 0 ||
  coverage.hash_omissions.length > 0;

/** Derive the aggregate truncation flag from independent producer observations. */
export const hasCaptureTruncation = (
  details: ProcessCaptureTruncationDetails,
): boolean =>
  omitted(details.raw_terminal) ||
  omitted(details.rendered_terminal) ||
  (details.normalized_terminal?.omitted_frames ?? 0) > 0 ||
  (details.rendered_terminal.unknown_size_frames ?? 0) > 0 ||
  filesystemTruncated(details.filesystem_before) ||
  filesystemTruncated(details.filesystem_after) ||
  details.process.sampling_partial;

/** Whether producer accounting reports a gap in the selected observation source. */
export const processSourceTruncated = (
  capture: Pick<UnverifiedProcessCapture, "truncation_details">,
  source: ProcessObservationSource,
): boolean => {
  const details = capture.truncation_details;
  switch (source) {
    case "terminal_raw":
      return omitted(details.raw_terminal);
    case "terminal_rendered":
      return (
        omitted(details.raw_terminal) || omitted(details.rendered_terminal)
      );
    case "filesystem":
      return (
        filesystemTruncated(details.filesystem_before) ||
        filesystemTruncated(details.filesystem_after)
      );
    case "process":
      return details.process.sampling_partial;
    case "interaction":
    case "lifecycle":
      return false;
  }
};
