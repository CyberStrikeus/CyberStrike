import type { EspFlashSelection } from "../../domain/firmware/espFlashLocation.js";
import type { InvestigationRecordPort } from "../investigation/InvestigationRecordPort.js";
import type { ExecutableFormatHint } from "../../domain/dosCom.js";
import type {
  BinaryArchitecture,
  BinaryTarget,
} from "../../domain/binaryTargetTypes.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { AnalysisSnapshot } from "../../domain/analysisSnapshot.js";
import type { AnalysisProfileCommitment } from "../../domain/analysisProfile.js";
import type { AnalysisProviderSelector } from "../../domain/providerSelection.js";
import type { BinarySessionDetail } from "../../contracts/sessionStatusContract.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";
import type { EvidenceIntegrityError } from "../../domain/evidenceErrors.js";
import type { AnalysisSnapshotLoader } from "./BinarySessionOpen.js";
import type { WorkflowSnapshotRecordInput } from "./BinarySessionRecords.js";
import type { ResolvedAppBundleResourceRoot } from "../AppBundleExecutable.js";

import type {
  AnalysisExecution,
  AnalysisOperation,
  AnalysisOperationPort,
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";

import type { SavedAnalysisSnapshot } from "../../domain/savedAnalysisSnapshot.js";
export type { SavedAnalysisSnapshot } from "../../domain/savedAnalysisSnapshot.js";

/** Target lifecycle used by CLI and MCP without exposing a concrete provider. */
export interface BinarySessionPort
  extends AnalysisOperationPort, InvestigationRecordPort {
  /** Execute only against a positively ready, already-created provider client. */
  executeIfProviderReady(
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options?: Pick<ExecutionOptions, "signal" | "selectorOrigin">,
  ): Promise<Result<AnalysisExecution, AnalysisError> | undefined>;
  /** Hold the active target binding through a complete composed operation. */
  withAdmittedAnalysis<Value>(
    operationName: string,
    signal: AbortSignal | undefined,
    operation: (analysis: AnalysisOperationPort) => Promise<Value>,
  ): Promise<Result<Value, AnalysisError>>;
  /** Serialize an external mutation and retire any active target afterward. */
  withAdmittedExternalMutation<Value>(
    _path: string | undefined,
    signal: AbortSignal | undefined,
    operation: () => Promise<Result<Value, AnalysisError>>,
    completionFailure: (
      value: Result<Value, AnalysisError>,
      error: AnalysisError,
    ) => AnalysisError,
    operationName?: string,
    cleanupRecovery?: (
      failure: AnalysisError | undefined,
    ) => Promise<Result<null, AnalysisError>>,
  ): Promise<Result<Result<Value, AnalysisError>, AnalysisError>>;
  open(
    path: string,
    options?: {
      readonly signal?: AbortSignal;
      readonly targetKind?: BinaryTarget["kind"];
      readonly formatHint?: ExecutableFormatHint;
      readonly architecture?: BinaryArchitecture;
      readonly entryPoint?: string;
      readonly espFlash?: EspFlashSelection;
      readonly snapshot?: AnalysisSnapshot;
      readonly loadSnapshot?: AnalysisSnapshotLoader;
      readonly providerId?: AnalysisProviderSelector;
    },
  ): Promise<Result<BinaryTarget, AnalysisError>>;
  /** Open a resource-only app root without selecting or inventing an executable target. */
  openBundleResources(
    path: string,
    options?: Pick<ExecutionOptions, "signal">,
  ): Promise<Result<ResolvedAppBundleResourceRoot, AnalysisError>>;
  close(
    options?: Pick<ExecutionOptions, "progress"> & {
      readonly retainProviderDocuments?: boolean;
    },
  ): Promise<Result<null, AnalysisError>>;
  /** Save a snapshot and close while excluding later provider requests. */
  closeWithSnapshot(
    path: string,
    overwrite: boolean,
    options?: Pick<ExecutionOptions, "progress">,
  ): Promise<Result<SavedAnalysisSnapshot, AnalysisError>>;
  /** Default complete detail; summary omits provider diagnostics and candidate capabilities. */
  status(options?: {
    readonly signal?: AbortSignal;
    readonly detail?: BinarySessionDetail;
  }): Promise<JsonValue>;
  activeTarget(): BinaryTarget | undefined;
  /** Read a snapshot with failed descriptors retained for session cleanup retry. */
  readAnalysisSnapshot(
    path: string,
    signal?: AbortSignal,
  ): Promise<Result<AnalysisSnapshot, AnalysisError>>;
  exportAnalysisSnapshot(): Result<AnalysisSnapshot, AnalysisError>;
  importAnalysisSnapshot(
    snapshot: AnalysisSnapshot,
  ): Result<number, AnalysisError>;
  providerIdentity(operation?: AnalysisOperation): ProviderIdentity;
  analysisProfile(
    operation?: AnalysisOperation,
  ): AnalysisProfileCommitment | undefined;
  allowsSnapshotReplay(operation: AnalysisOperation): boolean;
  /** Invalidate cached Evidence before an external command may mutate the target. */
  invalidateSnapshotForExternalMutation(): void;
  recordWorkflowSnapshot(
    input: WorkflowSnapshotRecordInput,
  ): Result<null, EvidenceIntegrityError>;
  onAvailabilityChanged?(listener: () => void | Promise<void>): () => void;
  onAnalysisSnapshotChanged?(listener: () => void | Promise<void>): () => void;
}
