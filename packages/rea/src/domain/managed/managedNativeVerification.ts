import { digestCanonicalValue } from "../canonicalDigest.js";
import {
  managedNativeVerificationResultSchema,
  type ManagedNativeVerificationResult,
} from "./managedNativeVerificationSchemas.js";
import {
  buildVerificationResult,
  collectNativeSymbols,
  verifyPinvoke,
} from "./managedNativeVerificationMatch.js";
import type { ManagedNativeVerificationSource } from "./managedNativeVerificationSource.js";

/** Pure verification over authenticated, parsed source facts. */
export const verifyManagedNativeVerificationSource = (
  source: ManagedNativeVerificationSource,
): ManagedNativeVerificationResult => {
  const { managedEvidence, managed, nativeObservations } = source;
  const native = collectNativeSymbols(nativeObservations);
  const pinvokeImports = managed.pinvoke_imports
    .map((item) =>
      verifyPinvoke({
        item,
        managedEvidenceId: managedEvidence.evidence_id,
        native,
      }),
    )
    .map(({ verification }) => verification);
  const withoutId = buildVerificationResult({
    managedEvidence,
    managed,
    native,
    pinvokeImports,
    nativeObservationCount: nativeObservations.length,
    nativeEvidenceIds: nativeObservations.map(
      ({ evidence }) => evidence.evidence_id,
    ),
  });
  return managedNativeVerificationResultSchema.parse({
    ...withoutId,
    verification_id: `mnv_${digestCanonicalValue(
      withoutId,
      "Managed/native verification",
    )}`,
  });
};

/** Input coverage can retain a residual question even when no item was produced. */
export const managedNativeVerificationHasUnknowns = (
  result: Pick<ManagedNativeVerificationResult, "coverage" | "summary">,
): boolean =>
  result.coverage.status !== "complete-within-inputs" ||
  result.summary.unresolved > 0 ||
  result.summary.contradicted > 0 ||
  result.summary.native_body_unresolved > 0;
