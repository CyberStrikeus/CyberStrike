import { z } from "zod";
import type { GhidraExtensionResult } from "../GhidraExtensions.js";

const report = z
  .object({
    id: z.literal("nativeaot"),
    integration_api: z.literal(1),
    source_revision: z.literal("effeb734fc570c32650f88b159608979dc7b423e"),
    source_revision_authority: z.literal("build-reported-unattested"),
    status: z.enum([
      "complete",
      "partial",
      "not_applicable",
      "unsupported",
      "failed",
    ]),
    reason: z.string().nullable(),
    method_tables: z.int().nonnegative(),
    diagnostics: z.array(z.string()),
    header_address: z
      .string()
      .regex(/^0x[0-9a-f]+$/u)
      .optional(),
    discovery: z.enum(["symbol", "signature-heuristic"]).optional(),
    format_major: z.int().optional(),
    format_minor: z.int().optional(),
    derived_memory: z
      .object({
        address: z.string().regex(/^0x[0-9a-f]+$/u),
        size_bytes: z.int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        file_offset: z.null(),
      })
      .optional(),
    coverage: z
      .strictObject({
        frozen_object_candidates: z.int().nonnegative(),
        frozen_objects_annotated: z.int().nonnegative(),
        basis: z.literal(
          "rehydrated-pointer-candidates-and-committed-instance-types",
        ),
      })
      .optional(),
    types: z
      .array(
        z.object({
          address: z.string().regex(/^0x[0-9a-f]+$/u),
          type: z.string().min(1),
        }),
      )
      .optional(),
  })
  .strict();

type NativeAotReport = z.infer<typeof report>;

const validateNonRecoveryMetadata = (
  value: NativeAotReport,
  recovered: boolean,
): string | null => {
  if (recovered) return null;
  if (value.reason === null || value.reason.trim().length === 0)
    return "NativeAOT non-recovery status omits its required reason.";
  return value.method_tables !== 0 ||
    value.types !== undefined ||
    value.derived_memory !== undefined ||
    value.coverage !== undefined
    ? "NativeAOT non-recovery status carries recovered metadata."
    : null;
};

/** Validate the pinned producer representation before its result enters Evidence. */
export const validateNativeAotReport = (
  value: GhidraExtensionResult,
): string | null => {
  if (
    value.status === "failed" &&
    typeof value.result.loader_failure === "string" &&
    value.result.loader_failure === value.reason
  )
    return null;
  const parsed = report.safeParse(value.result);
  if (
    !parsed.success ||
    parsed.data.status !== value.status ||
    parsed.data.reason !== value.reason
  )
    return "NativeAOT extension returned a malformed or inconsistent producer report.";
  return validateRecoveredMetadata(parsed.data);
};

const validateRecoveredMetadata = (value: NativeAotReport): string | null => {
  const recovered = ["complete", "partial"].includes(value.status);
  if (
    recovered &&
    (value.method_tables === 0 ||
      value.format_major !== 9 ||
      value.format_minor !== 1 ||
      value.types?.length !== value.method_tables ||
      value.derived_memory === undefined ||
      value.header_address === undefined ||
      value.discovery === undefined ||
      value.coverage === undefined ||
      value.reason !== null)
  )
    return "NativeAOT recovery omitted its supported format, method-table inventory or derived-memory identity.";
  const nonRecoveryInvalid = validateNonRecoveryMetadata(value, recovered);
  if (nonRecoveryInvalid !== null) return nonRecoveryInvalid;
  const coverage = value.coverage;
  if (
    coverage !== undefined &&
    (coverage.frozen_objects_annotated > coverage.frozen_object_candidates ||
      (value.status === "complete" &&
        coverage.frozen_objects_annotated !==
          coverage.frozen_object_candidates))
  )
    return "NativeAOT recovery coverage contradicts its reported completion status.";
  const types = value.types ?? [];
  if (new Set(types.map((type) => type.address)).size !== types.length)
    return "NativeAOT recovery repeated a method-table identity.";
  return null;
};
