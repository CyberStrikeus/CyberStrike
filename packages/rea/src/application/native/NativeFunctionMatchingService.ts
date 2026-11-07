import { NativeMatchingAdmission } from "./NativeMatchingAdmission.js";
import { loadNativeMatchingBundleSources } from "./NativeMatchingBundleSources.js";
import { RegularFileCleanupFailure } from "../../filesystem/OwnedRegularFile.js";
import { matchFunctionInventories } from "../../domain/native/matchFunctionInventories.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { setImmediate } from "node:timers/promises";
import {
  matchNativeFunctionsInputSchema,
  type MatchNativeFunctionsInput,
} from "../../contracts/native/functionMatchingContracts.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { readFunctionInventory } from "../../domain/native/functionInventory.js";
import { nativeFunctionMatchingSchema } from "../../domain/native/functionMatching.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { EvidenceLookup } from "../EvidenceInputResolver.js";
import { resolveNativeMatchingSources } from "./NativeMatchingSources.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { NativeMatchingAllowance } from "../../config/nativeMatchingAllowance.js";
import { FUNCTION_COMPARISON_PROVIDER } from "../../domain/comparisonEvidenceIdentity.js";

const OPERATION = "match_native_functions";

/** Effective admission budget, separate from caller-authored Evidence parameters. */
export interface NativeFunctionMatchingOptions extends ExecutionOptions {
  readonly representationAllowance?: NativeMatchingAllowance;
}
export interface NativeFunctionMatchingResult {
  readonly evidence: Evidence;
  readonly sources: readonly Evidence[];
  readonly detail: MatchNativeFunctionsInput["detail"];
}

/** Pair existing observations through one source/analysis admission. */
export const matchNativeFunctions = async (
  rawInput: unknown,
  options?: NativeFunctionMatchingOptions,
  lookup?: EvidenceLookup,
): Promise<Result<NativeFunctionMatchingResult, AnalysisError>> => {
  const admission = new NativeMatchingAdmission(
    OPERATION,
    options?.signal,
    options?.representationAllowance,
  );
  try {
    await setImmediate();
    await admission.checkpoint();
    await admission.admit(rawInput);
    const parsed = matchNativeFunctionsInputSchema.safeParse(rawInput);
    if (!parsed.success)
      return err(
        analysisInputErrorFromIssues(OPERATION, parsed.error.issues, rawInput),
      );
    return ok(await matchWithAdmission(parsed.data, admission, lookup));
  } catch (cause: unknown) {
    return matchingFailure(cause, options);
  }
};

const matchWithAdmission = async (
  input: MatchNativeFunctionsInput,
  admission: NativeMatchingAdmission,
  lookup: EvidenceLookup | undefined,
): Promise<NativeFunctionMatchingResult> => {
  const checkpoint = admission.checkpoint;
  const {
    left,
    right,
    leftObservations,
    rightObservations,
    directLinks,
    sources,
  } = await resolveNativeMatchingSources(input, admission, lookup);
  const leftFunctions = await readFunctionInventory(
    left,
    leftObservations,
    checkpoint,
  );
  const rightFunctions = await readFunctionInventory(
    right,
    rightObservations,
    checkpoint,
  );
  const compatible =
    left.subject?.architecture != null &&
    left.subject.architecture === right.subject?.architecture;
  const { matches, summary } = await matchFunctionInventories(
    leftFunctions,
    rightFunctions,
    { identicalBytesComparable: compatible, checkpoint },
  );
  const limitations = [
    ...new Set([
      ...left.limitations.map((x) => `Left: ${x}`),
      ...right.limitations.map((x) => `Right: ${x}`),
      "Coverage is restricted to the supplied provider-observed inventories; missing/truncated inventory facts never prove absence from either binary.",
      "Only unique exact symbols and bytes are paired. Compatible observed CFG/call/string fingerprints propose unresolved candidates, never identity or equivalence. Missing structural coverage stays unknown.",
      "Name or byte correspondence is not behavioral equivalence; use analyze_function for selected pairs, then compare_functions. Existing dossier pairs include directly usable retained-reference inputs.",
      ...(!compatible
        ? [
            "Identical-byte matching unavailable: input architectures are missing or differ.",
          ]
        : []),
    ]),
  ];
  const report = nativeFunctionMatchingSchema.parse({
    left: {
      evidence_id: left.evidence_id,
      sha256: left.subject!.digest.sha256,
      functions: leftFunctions.length,
    },
    right: {
      evidence_id: right.evidence_id,
      sha256: right.subject!.digest.sha256,
      functions: rightFunctions.length,
    },
    scope: "provider-observed-inputs",
    source_coverage: {
      status:
        summary.only_left + summary.only_right + summary.unresolved > 0
          ? "partial"
          : "complete-within-inputs",
      left_inventory_completeness: "unknown",
      right_inventory_completeness: "unknown",
      left_byte_fingerprints: leftFunctions.filter(
        (x) => x.fingerprint !== null,
      ).length,
      left_structural_candidates: leftFunctions.filter(
        (x) => x.member.structural_candidate_sha256 !== null,
      ).length,
      right_structural_candidates: rightFunctions.filter(
        (x) => x.member.structural_candidate_sha256 !== null,
      ).length,
      right_byte_fingerprints: rightFunctions.filter(
        (x) => x.fingerprint !== null,
      ).length,
    },
    summary,
    matches,
    limitations,
  });
  await checkpoint();
  const evidence = createEvidence(undefined, FUNCTION_COMPARISON_PROVIDER, {
    operation: OPERATION,
    predicateType: "rea.native-function-matching",
    confidence: "derived",
    authority: "analyst-inference",
    parameters: {
      left_evidence_id: left.evidence_id,
      right_evidence_id: right.evidence_id,
      left_observation_ids: leftObservations.map((x) => x.evidence_id),
      right_observation_ids: rightObservations.map((x) => x.evidence_id),
      algorithm: "exact-symbol-body-bytes-and-structural-candidates-v1",
    },
    result: report,
    limitations,
    evidenceLinks: directLinks,
  });
  await checkpoint();
  return { evidence, sources, detail: input.detail };
};

/** Preserve cleanup owners and expected failures; unexpected implementation failures escape. */
const matchingFailure = (
  cause: unknown,
  options: ExecutionOptions | undefined,
): Result<never, AnalysisError> => {
  if (cause instanceof RegularFileCleanupFailure) throw cause;
  if (options?.signal?.aborted)
    return err(
      new AnalysisCancelledError(OPERATION, { cause: options.signal.reason }),
    );
  if (cause instanceof AnalysisError) return err(cause);
  throw cause;
};

/** Load selected portable records; do not retain unrelated records across bundles. */
export const matchNativeFunctionsFromBundles = async (
  input: MatchNativeFunctionsInput,
  paths: readonly string[],
  resources: ArtifactResourceScope,
  options?: NativeFunctionMatchingOptions,
): Promise<Result<NativeFunctionMatchingResult, AnalysisError>> => {
  try {
    const admission = new NativeMatchingAdmission(
      OPERATION,
      options?.signal,
      options?.representationAllowance,
    );
    await admission.admit(input);
    const loaded = await loadNativeMatchingBundleSources({
      input,
      paths,
      resources,
      admission,
    });
    await setImmediate();
    await admission.checkpoint();
    return ok(await matchWithAdmission(loaded.input, admission, loaded.lookup));
  } catch (cause: unknown) {
    return matchingFailure(cause, options);
  }
};
