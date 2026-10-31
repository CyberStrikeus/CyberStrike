import {
  resolveEvidenceRequest,
  type EvidenceLookup,
} from "../EvidenceInputResolver.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";

import {
  compareManagedMembers,
  compareManagedMembersRequestSchema,
  type ManagedMemberComparisonResult,
} from "../../domain/managed/managedMemberComparison.js";
import { readManagedMemberEvidence } from "../../domain/managed/managedMemberComparisonMatch.js";
import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  classifyBinaryTargetFilesystemFailure,
  parseBinaryTarget,
} from "../BinaryTargetResolver.js";
import { err, ok, type Result } from "../../domain/result.js";
import { inspectManagedMembersBytes } from "../../dotnet/ManagedMemberInspector.js";
import {
  readManagedSnapshot,
  verifyManagedSourceIdentity,
} from "../../dotnet/ManagedSnapshot.js";
import { managedInspectionInputFailure } from "../../dotnet/ManagedReaderFailure.js";
import {
  MANAGED_STATIC_PROVIDER,
  MANAGED_WORKFLOW_PROVIDER,
} from "../../domain/investigationProviders.js";

export interface ManagedMemberComparisonExecution {
  readonly evidence: Evidence;
  readonly summary: ManagedMemberComparisonResult["summary"];
  readonly sources: readonly [Evidence, Evidence];
}

/** Authenticate both source records, then compare their parsed observations. */
export const executeManagedMemberComparison = (
  input: unknown,
  lookup?: EvidenceLookup,
  options: Pick<ExecutionOptions, "signal"> = {},
): Result<ManagedMemberComparisonExecution, AnalysisError> => {
  const operation = "compare_managed_members";
  const request = resolveEvidenceRequest(
    operation,
    input,
    compareManagedMembersRequestSchema,
    lookup,
    options,
  );
  if (!request.ok) return request;
  const left = readManagedMemberEvidence(request.value.input.left, "left");
  if (!left.ok) return left;
  const right = readManagedMemberEvidence(request.value.input.right, "right");
  if (!right.ok) return right;
  if (left.value.evidence.evidence_id === right.value.evidence.evidence_id)
    return err(
      new AnalysisInputError(operation, undefined, [
        {
          path: ["right"],
          reason: "invalid_value",
          message: "Managed member Evidence must be distinct",
        },
      ]),
    );
  const result = compareManagedMembers(
    {
      evidenceId: left.value.evidence.evidence_id,
      result: left.value.result,
    },
    {
      evidenceId: right.value.evidence.evidence_id,
      result: right.value.result,
    },
  );
  const evidence = createManagedMemberComparisonEvidence(
    left.value.evidence,
    right.value.evidence,
    result,
  );
  return ok({
    evidence,
    summary: result.summary,
    sources: [left.value.evidence, right.value.evidence],
  });
};

interface ManagedMemberComparisonPathDependencies {
  readonly resolveTarget: typeof parseBinaryTarget;
  readonly readSnapshot: typeof readManagedSnapshot;
}

/** Inspect two local PE artifacts and return one derived comparison Evidence. */
export const compareManagedMemberPaths = async (
  input: {
    readonly leftPath: string;
    readonly rightPath: string;
  },
  dependencies: Partial<ManagedMemberComparisonPathDependencies> = {},
  resources?: ArtifactResourceScope,
): Promise<Result<Evidence, AnalysisError>> => {
  const operation = "compare_managed_members";
  const resolveTarget = dependencies.resolveTarget ?? parseBinaryTarget;
  const readSnapshot = dependencies.readSnapshot ?? readManagedSnapshot;
  let partialEvidence: Evidence | undefined;
  try {
    const [leftTarget, rightTarget] = await Promise.all([
      resolveTarget(
        input.leftPath,
        resources === undefined ? {} : { resources },
      ),
      resolveTarget(
        input.rightPath,
        resources === undefined ? {} : { resources },
      ),
    ]);
    // Report an unopenable path like every other path-based command does,
    // with the failed path and constraint, rather than a bare input error.
    if (!leftTarget.ok) {
      if (!rightTarget.ok && rightTarget.error.cleanupIncomplete)
        return err(
          analysisErrorWithCleanupFailure(
            leftTarget.error,
            rightTarget.error,
            operation,
          ).bindCleanupDependencies([leftTarget.error, rightTarget.error]),
        );
      return err(leftTarget.error);
    }
    if (!rightTarget.ok) return err(rightTarget.error);
    const inspectTarget = async (
      target: BinaryTarget,
      inputField: "leftPath" | "rightPath",
    ) => {
      const { path } = target;
      const selectedPath = input[inputField];
      let snapshot: Awaited<ReturnType<typeof readManagedSnapshot>>;
      try {
        snapshot = await readSnapshot(path, operation, {
          expectedSha256: target.sha256,
          ...(resources === undefined ? {} : { resources }),
        });
      } catch (cause: unknown) {
        const failure = classifyBinaryTargetFilesystemFailure(path, cause);
        if (failure !== undefined) throw failure;
        throw cause;
      }
      const admitted = verifyManagedSourceIdentity(target, snapshot, operation);
      if (!admitted.ok) throw admitted.error;
      // Member comparison never reads literals or spends their decode budget.
      let inspection: ReturnType<typeof inspectManagedMembersBytes>;
      try {
        inspection = inspectManagedMembersBytes(snapshot.bytes, target, {
          userStrings: false,
        });
      } catch (cause: unknown) {
        throw (
          managedInspectionInputFailure(
            operation,
            selectedPath,
            cause,
            inputField,
          ) ?? cause
        );
      }
      const evidence = createEvidence(target, MANAGED_STATIC_PROVIDER, {
        operation: "inspect_managed_members",
        parameters: {},
        result: inspection,
        rawResult: null,
        limitations: inspection.limitations,
        locations: [{ kind: "artifact-path", path: selectedPath }],
      });
      return { inspection, evidence };
    };
    const left = await inspectTarget(leftTarget.value, "leftPath");
    partialEvidence = left.evidence;
    const right = await inspectTarget(rightTarget.value, "rightPath");
    const result = compareManagedMembers(
      {
        evidenceId: left.evidence.evidence_id,
        result: left.inspection,
      },
      {
        evidenceId: right.evidence.evidence_id,
        result: right.inspection,
      },
    );
    return ok(
      createManagedMemberComparisonEvidence(
        left.evidence,
        right.evidence,
        result,
        { leftPath: input.leftPath, rightPath: input.rightPath },
      ),
    );
  } catch (cause: unknown) {
    const failure = asOutputFailure(operation, cause);
    return err(
      partialEvidence === undefined
        ? failure
        : failure.retainPartialObservation(partialEvidence),
    );
  }
};

const createManagedMemberComparisonEvidence = (
  left: Evidence,
  right: Evidence,
  result: ManagedMemberComparisonResult,
  sourcePaths?: { readonly leftPath: string; readonly rightPath: string },
): Evidence =>
  createEvidence(undefined, MANAGED_WORKFLOW_PROVIDER, {
    predicateType: "rea.managed-member-comparison",
    operation: "compare_managed_members",
    parameters: {
      left_evidence_id: left.evidence_id,
      right_evidence_id: right.evidence_id,
      ...(sourcePaths === undefined
        ? {}
        : {
            left_path: sourcePaths.leftPath,
            right_path: sourcePaths.rightPath,
          }),
    },
    result,
    rawResult: null,
    confidence: "inferred",
    authority: "analyst-inference",
    environment: null,
    limitations: result.limitations,
    locations:
      sourcePaths === undefined
        ? []
        : [
            { kind: "artifact-path", path: sourcePaths.leftPath },
            { kind: "artifact-path", path: sourcePaths.rightPath },
          ],
    evidenceLinks: result.evidence_links,
  });

const asOutputFailure = (operation: string, cause: unknown): AnalysisError =>
  cause instanceof AnalysisError
    ? cause
    : new AnalysisOutputError(
        operation,
        "Managed member comparison produced invalid output",
        { cause },
      );
