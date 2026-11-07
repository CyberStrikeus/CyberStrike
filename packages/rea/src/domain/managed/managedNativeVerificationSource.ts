import { getEvidenceInputContract } from "../evidenceInputContract.js";
import { managedNativeVerificationRequestSchema } from "./managedNativeVerificationSchemas.js";

import type { Evidence } from "../evidence.js";
import { AnalysisInputError } from "../analysisErrorCore.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import { EvidenceIntegrityError } from "../evidenceErrors.js";
import { analysisInputErrorFromIssues } from "../inputIssueProjection.js";
import { readEvidence, readEvidencePayload } from "../evidenceValidation.js";
import { err, ok, type Result } from "../result.js";
import { functionDossierSchema } from "../native/functionDossier.js";
import { retainedInspectMachoSchema } from "../native/nativeInspection.js";
import {
  managedNativeBoundaryInspectionSchema,
  type ManagedNativeBoundaryInspection,
} from "./managedArtifact.js";
import { readManagedInspectionEvidence } from "./managedInspectionEvidence.js";
import type { NativeSymbol } from "./managedNativeVerificationSchemas.js";

const OPERATION = "verify_managed_native_boundaries" as const;
const MANAGED_OPERATION = "inspect_managed_native_boundaries" as const;

const requestFrameSchema = getEvidenceInputContract(
  managedNativeVerificationRequestSchema,
).frameSchema;

export interface ManagedNativeVerificationSource {
  readonly managedEvidence: Evidence;
  readonly managed: ManagedNativeBoundaryInspection;
  readonly nativeObservations: readonly ManagedNativeObservationFacts[];
}

export interface ManagedNativeObservationFacts {
  readonly evidence: Evidence;
  readonly symbols: readonly NativeSymbol[];
  readonly supported: boolean;
}

const inputFailure = (
  path: readonly (string | number)[],
  message: string,
): AnalysisInputError =>
  new AnalysisInputError(OPERATION, { userMessage: message }, [
    { path, reason: "invalid_value", message },
  ]);

const readNativeObservation = (
  raw: unknown,
): Result<
  ManagedNativeVerificationSource["nativeObservations"][number],
  AnalysisInputError | EvidenceIntegrityError
> => {
  const read = readEvidence(raw);
  if (!read.ok) return read;
  const evidence = read.value;
  if (evidence.operation === "inspect_macho") {
    const payload = readEvidencePayload(
      retainedInspectMachoSchema,
      evidence.normalized_result,
    );
    if (!payload.ok) return payload;
    return ok({
      evidence,
      supported: true,
      symbols: payload.value.exports.items.map((symbol) => ({
        evidence_id: evidence.evidence_id,
        operation: evidence.operation,
        name: symbol.name,
        address: symbol.address,
        module_name: evidence.subject?.name ?? null,
        module_path: evidence.subject?.local_path ?? null,
        source: "macho-export" as const,
      })),
    });
  }
  if (evidence.operation === "analyze_function") {
    const payload = readEvidencePayload(
      functionDossierSchema,
      evidence.normalized_result,
    );
    if (!payload.ok) return payload;
    return ok({
      evidence,
      supported: true,
      symbols: [
        {
          evidence_id: evidence.evidence_id,
          operation: evidence.operation,
          name: payload.value.procedure.name,
          address: payload.value.procedure.address,
          module_name: evidence.subject?.name ?? null,
          module_path: evidence.subject?.local_path ?? null,
          source: "function-dossier" as const,
        },
      ],
    });
  }
  return ok({ evidence, supported: false, symbols: [] });
};

/** Authenticate and parse source Evidence once, retaining it for session recording. */
export const readManagedNativeVerificationSource = (
  rawInput: unknown,
): Result<ManagedNativeVerificationSource, AnalysisError> => {
  const frame = requestFrameSchema.safeParse(rawInput);
  if (!frame.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, frame.error.issues, rawInput, {
        cause: frame.error,
      }),
    );
  const managed = readManagedInspectionEvidence(
    frame.data.managed_boundaries,
    MANAGED_OPERATION,
    managedNativeBoundaryInspectionSchema,
    { operation: OPERATION, path: ["managed_boundaries"] },
  );
  if (!managed.ok) return managed;

  const nativeObservations: ManagedNativeVerificationSource["nativeObservations"][number][] =
    [];
  const ids = new Set([managed.value.evidence.evidence_id]);
  for (const [index, raw] of frame.data.native_observations.entries()) {
    const native = readNativeObservation(raw);
    if (!native.ok) return native;
    const id = native.value.evidence.evidence_id;
    if (ids.has(id))
      return err(
        inputFailure(
          ["native_observations", index],
          id === managed.value.evidence.evidence_id
            ? "Native observation Evidence must be distinct from managed boundary Evidence"
            : "Native observation Evidence IDs must be unique",
        ),
      );
    ids.add(id);
    nativeObservations.push(native.value);
  }
  return ok({
    managedEvidence: managed.value.evidence,
    managed: managed.value.result,
    nativeObservations,
  });
};
