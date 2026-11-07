import type { AnalysisErrorOptions } from "../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";

/**
 * Bridge codes for a well-formed address without one exact original-file
 * offset. The bridge owns the classification; consumers read these codes,
 * never its message text.
 */
const FILE_OFFSET_OUTCOMES = {
  address_unmapped: "unmapped",
  address_uninitialized: "uninitialized",
  file_mapping_absent: "absent",
  file_mapping_ambiguous: "ambiguous",
  file_offset_unrepresentable: "unrepresentable",
} as const;

/** Why Ghidra established no single exact offset for a well-formed address. */
export type GhidraFileOffsetOutcome =
  (typeof FILE_OFFSET_OUTCOMES)[keyof typeof FILE_OFFSET_OUTCOMES];

/** Classify a bridge code, or undefined for any other remote failure. */
export const ghidraFileOffsetOutcome = (
  code: string | undefined,
): GhidraFileOffsetOutcome | undefined =>
  code !== undefined && Object.hasOwn(FILE_OFFSET_OUTCOMES, code)
    ? FILE_OFFSET_OUTCOMES[code as keyof typeof FILE_OFFSET_OUTCOMES]
    : undefined;

const LOAD_IMAGE =
  "inspect_native_load_image (CLI: `rea inspect-native-load-image <path> --provider ghidra --json`)";
const UNCHANGED = "Do not repeat the unchanged call.";
const SELECT_MAPPED = `Review Ghidra's memory blocks and source-file mappings with ${LOAD_IMAGE}, then select an address inside an initialized mapping of the admitted file. ${UNCHANGED}`;

const REMEDIATION: Readonly<Record<GhidraFileOffsetOutcome, string>> = {
  unmapped: SELECT_MAPPED,
  uninitialized: SELECT_MAPPED,
  absent: SELECT_MAPPED,
  ambiguous: `Review the candidate source-file mappings with ${LOAD_IMAGE} and keep each candidate offset distinct; REA does not choose one. ${UNCHANGED}`,
  unrepresentable: `Review Ghidra's source-file mappings with ${LOAD_IMAGE}; REA reports offsets only within the exact JSON integer range. ${UNCHANGED}`,
};

/**
 * Report the bridge's reason as the headline. The request satisfied its
 * contract, so the projection omits schema-repair recovery and names the
 * mapping outcome beside the caller's exact address.
 */
export const ghidraFileOffsetUnavailable = (
  operation: string,
  outcome: GhidraFileOffsetOutcome,
  reason: string,
  address: string | undefined,
  options: AnalysisErrorOptions,
): AnalysisInputError =>
  new AnalysisInputError(
    operation,
    {
      ...options,
      userMessage: `${reason.trim().replace(/\.$/u, "")}. REA establishes no single exact original-file offset for this well-formed address and does not derive or choose one.`,
      remediationAction: REMEDIATION[outcome],
      conformsToInputContract: true,
    },
    [
      {
        path: ["address"],
        reason: "invalid_value",
        message: reason,
        observed: {
          ...(address === undefined ? {} : { address }),
          file_mapping: outcome,
        },
      },
    ],
  );
