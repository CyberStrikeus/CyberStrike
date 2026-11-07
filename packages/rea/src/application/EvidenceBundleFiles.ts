import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { requireAuthenticationHeadroom } from "./JsonAuthenticationHeadroom.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";

import { describeValidationFailure } from "../domain/validationFailure.js";
import {
  safeParseImmutableEvidenceBundle,
  safeParseEvidenceBundle,
  type EvidenceBundle,
} from "../domain/evidenceBundle.js";
import {
  EvidenceFileError,
  EvidenceIntegrityError,
  type PublishedEvidenceFile,
} from "../domain/evidenceErrors.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  AnalysisCancelledError,
  type AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { safeParseProcessCapture } from "../domain/process/processCaptureParsing.js";
import {
  bufferedJsonParts,
  canonicalJsonParts,
} from "../domain/jsonSerialization.js";
import { readJsonFile, writeTextParts } from "./JsonFiles.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";

type EvidenceReadFailure =
  | EvidenceFileError
  | EvidenceIntegrityError
  | AnalysisResourceConstraintError
  | AnalysisCancelledError;
type EvidenceWriteFailure =
  | EvidenceFileError
  | EvidenceIntegrityError
  | AnalysisCancelledError;

/** Project a published bundle with record and residual-unknown revision counts. */
export const evidenceBundleExportReceipt = (
  bundle: EvidenceBundle,
  published: PublishedEvidenceFile,
) => ({
  path: published.path,
  bytes: published.bytes,
  records: bundle.records.length,
  unknowns: bundle.unknowns.length,
});

/** Read and validate an evidence bundle at the caller-supplied path. */
export const readEvidenceBundle = (
  path: string,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
  operation = "import_evidence_bundle",
): Promise<Result<EvidenceBundle, EvidenceReadFailure>> =>
  readBundle(path, false, signal, resources, operation);

/** Read an authenticated immutable snapshot for a subsequent session import. */
export const readImmutableEvidenceBundle = (
  path: string,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
  operation = "import_evidence_bundle",
): Promise<Result<EvidenceBundle, EvidenceReadFailure>> =>
  readBundle(path, true, signal, resources, operation);

/** Join both comparison reads and preserve cleanup owned by either failed input. */
export const readComparisonEvidenceBundles = async (
  leftPath: string,
  rightPath: string,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
  operation = "compare_bundles",
): Promise<
  Result<
    { readonly left: EvidenceBundle; readonly right: EvidenceBundle },
    AnalysisError
  >
> => {
  const [left, right] = await Promise.all([
    readImmutableEvidenceBundle(leftPath, signal, resources, operation),
    readImmutableEvidenceBundle(rightPath, signal, resources, operation),
  ]);
  if (!left.ok) {
    if (!right.ok && right.error.cleanupIncomplete)
      return err(
        analysisErrorWithCleanupFailure(
          left.error,
          right.error,
          operation,
        ).bindCleanupDependencies([left.error, right.error]),
      );
    return left;
  }
  if (!right.ok) return right;
  return ok({ left: left.value, right: right.value });
};

const readBundle = async (
  path: string,
  immutable: boolean,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
  operation = "import_evidence_bundle",
): Promise<Result<EvidenceBundle, EvidenceReadFailure>> => {
  if (signal?.aborted)
    return err(
      new AnalysisCancelledError(operation, {
        cause: signal.reason,
      }),
    );
  const loaded = await readJsonFile(path, signal, resources, operation);
  if (!loaded.ok) return loaded;
  if (signal?.aborted)
    return err(
      new AnalysisCancelledError(operation, {
        cause: signal.reason,
      }),
    );
  return authenticateEvidenceBundleValue(loaded.value, path, {
    operation,
    immutable,
  });
};

/** Authenticate a loaded bundle once, preserving file-reader failure and process-capture semantics. */
export const authenticateEvidenceBundleValue = (
  value: unknown,
  path: string,
  options: { readonly operation: string; readonly immutable?: boolean },
): Result<EvidenceBundle, EvidenceReadFailure> => {
  const { operation } = options;
  const headroom = requireAuthenticationHeadroom(value, {
    operation,
    path: absoluteCallerPath(path),
    description:
      "Insufficient heap headroom to authenticate the Evidence bundle",
  });
  if (!headroom.ok) return headroom;
  const parsed =
    options.immutable === true
      ? safeParseImmutableEvidenceBundle(value)
      : safeParseEvidenceBundle(value);
  if (!parsed.ok) {
    const failure = parsed.error;
    if (failure.kind === "single-record")
      return err(
        new EvidenceFileError("read", "wrong-kind", {
          path: absoluteCallerPath(path),
          cause: failure.cause,
          userMessage: failure.message,
        }),
      );
    return err(
      new EvidenceIntegrityError("Evidence bundle validation failed", {
        cause: failure.cause,
        userMessage: failure.message,
      }),
    );
  }
  return validateBundlePayloads(parsed.value);
};

/** Validate typed payloads without restricting historical workflow or provider identities. */
const validateBundlePayloads = (
  bundle: EvidenceBundle,
): Result<EvidenceBundle, EvidenceIntegrityError> => {
  for (const record of bundle.records) {
    if (record.predicate_type !== "rea.process-capture") continue;
    const parsedCapture = safeParseProcessCapture(record.normalized_result);
    if (!parsedCapture.success) {
      return err(
        new EvidenceIntegrityError("Evidence bundle validation failed", {
          cause: parsedCapture.error,
          userMessage: `Process capture record ${record.evidence_id} has an invalid normalized_result (${describeValidationFailure(parsedCapture.error)}). Recreate or re-export the bundle, then try again.`,
        }),
      );
    }
  }
  return ok(bundle);
};

/** Atomically write deterministic evidence JSON at the caller-supplied path. */
export const writeEvidenceBundle = async (
  bundle: EvidenceBundle,
  path: string,
  overwrite: boolean,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
  operation = "export_evidence_bundle",
): Promise<
  Result<
    { readonly path: string; readonly bytes: number },
    EvidenceWriteFailure
  >
> => {
  if (signal?.aborted === true)
    return err(
      new AnalysisCancelledError(operation, {
        cause: signal.reason,
      }),
    );
  const checked = safeParseEvidenceBundle(bundle);
  if (!checked.ok) {
    return err(
      new EvidenceIntegrityError("Evidence bundle validation failed", {
        cause: checked.error.cause,
      }),
    );
  }
  const validated = validateBundlePayloads(checked.value);
  if (!validated.ok) return validated;
  return writeTextParts(
    bufferedJsonParts(canonicalJsonParts(validated.value)),
    path,
    overwrite,
    resources,
    signal === undefined ? undefined : { signal, operation },
  );
};
