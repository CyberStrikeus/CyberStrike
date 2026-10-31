import type { MatchNativeFunctionsInput } from "../../contracts/native/functionMatchingContracts.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { isImmutableEvidence, type Evidence } from "../../domain/evidence.js";
import { readEvidence } from "../../domain/evidenceValidation.js";
import { retainedEvidenceReferenceSchema } from "../../domain/evidenceReference.js";
import {
  resolveEvidenceInput,
  type EvidenceLookup,
} from "../EvidenceInputResolver.js";
import type { NativeMatchingAdmission } from "./NativeMatchingAdmission.js";

import { nativeMatchingInputError } from "./NativeMatchingInputError.js";

const INVENTORY_OPERATIONS = ["list_procedures"] as const;
const OBSERVATION_OPERATIONS = [
  "list_names",
  "procedure_info",
  "read_bytes",
  "analyze_function",
] as const;

/** Authenticate selected roles and their closure without interpreting dependencies as observations. */
export const resolveNativeMatchingSources = async (
  input: MatchNativeFunctionsInput,
  admission: NativeMatchingAdmission,
  lookup: EvidenceLookup | undefined,
): Promise<{
  readonly left: Evidence;
  readonly right: Evidence;
  readonly leftObservations: readonly Evidence[];
  readonly rightObservations: readonly Evidence[];
  readonly directLinks: readonly string[];
  readonly sources: readonly Evidence[];
}> => {
  const sources = new Map<string, Evidence>();
  /**
   * Charge only what matching copies. A retained immutable record is borrowed
   * without cloning. When matching never parses its result, or charges the
   * representation it derives from it (inventory rows), only its envelope is
   * charged; walking the result would charge resident memory as if matching
   * had allocated it.
   */
  const resolve = async (
    input: unknown,
    path?: readonly (string | number)[],
    borrowable = false,
  ): Promise<Evidence> => {
    const reference = retainedEvidenceReferenceSchema.safeParse(input);
    let raw = input,
      borrowed: Evidence | undefined;
    if (reference.success) {
      const found = resolveEvidenceInput(reference.data, lookup);
      if (!found.ok) throw found.error;
      raw = found.value;
      if (borrowable && isImmutableEvidence(found.value))
        borrowed = found.value;
    }
    if (borrowed !== undefined) await admission.admitBorrowed(borrowed);
    else await admission.admit(raw);
    const checked = readEvidence(raw);
    if (!checked.ok)
      throw path !== undefined && !reference.success
        ? nativeMatchingInputError(
            input,
            path,
            admission.operation,
            checked.error,
          )
        : checked.error;
    const evidence = checked.value;
    const cached = sources.get(evidence.evidence_id);
    if (cached !== undefined) return cached;
    sources.set(evidence.evidence_id, evidence);
    return evidence;
  };
  const select = async (
    raw: unknown,
    path: readonly (string | number)[],
    operations: readonly string[],
    borrowable = false,
  ): Promise<Evidence> => {
    const evidence = await resolve(raw, path, borrowable);
    if (
      evidence.predicate_type !== "rea.analysis" ||
      !operations.includes(evidence.operation) ||
      evidence.subject === null
    ) {
      const message = `Expected artifact-bound rea.analysis ${operations.join(" or ")} Evidence, received ${evidence.predicate_type} ${evidence.operation}`;
      throw new AnalysisInputError(
        admission.operation,
        { userMessage: message },
        [{ path, reason: "invalid_value", message }],
      );
    }
    return evidence;
  };
  // readFunctionInventory charges each inventory row before parsing it.
  const left = await select(input.left, ["left"], INVENTORY_OPERATIONS, true);
  const right = await select(
    input.right,
    ["right"],
    INVENTORY_OPERATIONS,
    true,
  );
  const observations = async (
    inputs: readonly unknown[],
    field: "left_observations" | "right_observations",
    inventory: Evidence,
  ): Promise<Evidence[]> => {
    const result: Evidence[] = [];
    const seen = new Set<string>();
    for (const [index, input] of inputs.entries()) {
      const record = await select(
        input,
        [field, index],
        OBSERVATION_OPERATIONS,
      );
      if (
        digestCanonicalValue(record.subject) !==
          digestCanonicalValue(inventory.subject) ||
        digestCanonicalValue(record.provider) !==
          digestCanonicalValue(inventory.provider) ||
        digestCanonicalValue(record.analysis_profile) !==
          digestCanonicalValue(inventory.analysis_profile) ||
        (record.parameters.document ?? null) !==
          (inventory.parameters.document ?? null)
      ) {
        const message =
          "Select an observation from the inventory's exact target, provider, analysis profile and document context.";
        throw new AnalysisInputError(
          admission.operation,
          { userMessage: message },
          [{ path: [field, index], reason: "invalid_value", message }],
        );
      }
      if (!seen.has(record.evidence_id)) {
        seen.add(record.evidence_id);
        result.push(record);
      }
    }
    return result;
  };
  const leftObservations = await observations(
    input.left_observations,
    "left_observations",
    left,
  );
  const rightObservations = await observations(
    input.right_observations,
    "right_observations",
    right,
  );
  const directLinks = [...sources.keys()].sort();
  for (const source of sources.values())
    for (const id of source.evidence_links)
      if (!sources.has(id))
        // Closure records are only returned for retention, never parsed.
        await resolve(
          { kind: "retained-evidence", evidence_id: id },
          undefined,
          true,
        );
  return {
    left,
    right,
    leftObservations,
    rightObservations,
    directLinks,
    sources: [...sources.values()],
  };
};
