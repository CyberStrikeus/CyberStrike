import { describeResidualUnknownGraphConstraint } from "./residualUnknownGraphError.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisUnsupportedTargetError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "./analysisErrorCore.js";
import { ArtifactOperationError } from "./artifactOperationError.js";
import { OPENABLE_APPLE_BUNDLE_TYPES_TEXT } from "./apple/appleBundleTypes.js";
import {
  BinaryTargetError,
  ConfigurationError,
  NoBinaryOpenError,
} from "./configurationErrors.js";
import { BrowserObservationError } from "./browserObservationError.js";
import {
  EvidenceFileError,
  EvidenceIntegrityError,
  EvidenceReferenceError,
  AnalysisSnapshotMismatchError,
  ResourceSnapshotMismatchError,
} from "./evidenceErrors.js";
import {
  HopperRemoteError,
  HopperProcessError,
  HopperStartError,
  HopperTimeoutError,
} from "./hopperErrors.js";
import { ProviderSelectionError } from "./providerSelectionError.js";
import { ProviderAdapterError } from "./providerAdapterError.js";
import { UnknownRegistryError } from "./unknownRegistryError.js";
import { providerRetryAction } from "./providerOperationHealth.js";
import { fixedAllowanceRemediation } from "./fixedAllowanceRemediation.js";
import {
  primaryAnalysisError,
  resolvedAnalysisError,
  type AnalysisError,
  type AnalysisErrorTag,
} from "./analysisErrorBase.js";
import type { AnalysisErrorProjection } from "./analysisErrorProjection.js";

/** File export when one MCP frame cannot carry the retained session bundle. */
export const MCP_TRANSPORT_EVIDENCE_EXPORT =
  "Export complete retained session evidence through export_evidence_bundle to a caller-selected path, or use complete CLI JSON output. The connection remains usable.";

/** Next step when one MCP frame cannot carry a complete retained session bundle. */
export const MCP_TRANSPORT_EVIDENCE_DISCOVERY = `Discover retained records with get_evidence_bundle and detail: summary, then inspect compatible records through inspect_analysis_view using an exact Evidence reference. ${MCP_TRANSPORT_EVIDENCE_EXPORT}`;

export const analysisErrorRemediationAction = (
  error: AnalysisError,
): string => {
  error = resolvedAnalysisError(error);
  if (
    (error instanceof ProviderAdapterError ||
      error instanceof AnalysisCapabilityUnavailableError) &&
    error.remediationAction !== undefined
  )
    return error.remediationAction;
  if (
    error instanceof BrowserObservationError &&
    error.remediationAction !== undefined
  )
    return error.remediationAction;
  if (
    error instanceof BrowserObservationError &&
    error.reason === "service_worker_blocked"
  )
    return "Set environment.service_workers to allow to permit this capture, or remove the service worker registration through the browser. REA never removes existing registrations.";
  if (error instanceof AnalysisCapabilityUnavailableError && error.retryable)
    return "Review details.reason, then retry the same analysis after the condition clears.";
  if (error instanceof EvidenceFileError && error.published !== undefined)
    return error.published.path === undefined
      ? "Resolve the reported staging cleanup failure. Publication completed; its path identity is excluded."
      : "Use the published file at details.published_path and resolve the reported staging cleanup failure.";
  if (
    error instanceof ProviderSelectionError &&
    error.remediationAction !== undefined
  )
    return error.remediationAction;
  if (error instanceof ResourceSnapshotMismatchError)
    return error.operation === "export"
      ? "Call close_binary without snapshot_path to close this resource-only session."
      : "Open an executable analysis target before importing a binary analysis snapshot.";
  if (error instanceof AnalysisSnapshotMismatchError)
    return "Run analysis without this snapshot, then save a fresh snapshot using the intended artifact, provider, and analysis profile.";
  if (error instanceof AnalysisUnsupportedTargetError)
    return (
      error.remediationAction ??
      "Select a target supported by this operation or choose an operation supporting the reported target format."
    );
  if (error instanceof AnalysisResourceConstraintError)
    return (
      error.remediationAction ??
      (error.fixedAllowance !== undefined
        ? fixedAllowanceRemediation(
            error.fixedAllowance.name,
            error.fixedAllowance.kind,
          )
        : error.resource === "capacity"
          ? "Wait for an active analysis to complete, then retry within the reported admission limits."
          : error.resource === "transport"
            ? MCP_TRANSPORT_EVIDENCE_DISCOVERY
            : error.resource === "cpu"
              ? "Review the reported worker CPU limits and observed signal. Retry with sufficient CPU time or a smaller artifact; REA retains tighter inherited limits."
              : error.resource === "file-size"
                ? "Review the reported worker file-size limits and write failure. Retry with a sufficient file-size allowance for the evidence reply; REA retains tighter inherited limits."
                : "Review the reported worker memory limits and available host memory. Retry with sufficient memory or a smaller artifact; REA retains tighter inherited limits.")
    );
  if (
    error instanceof AnalysisTimeoutError &&
    error.remediationAction !== undefined
  )
    return error.remediationAction;
  if (error instanceof AnalysisTimeoutError) return timeoutRemediation(error);
  if (
    error instanceof ArtifactOperationError &&
    error.reason === "limit" &&
    error.boundary === "capacity"
  )
    return "Use an artifact within the capacity reported in details.detail. Changing output detail or retrying the unchanged input does not remove this boundary.";
  if (error instanceof HopperTimeoutError)
    return error.operation === undefined
      ? "Review details.launcher and inspect Hopper for ongoing initial analysis or a pending loader, demo, or license dialog. For a large target, use update_analysis_settings with setting hopper.startup_timeout_ms and action set for the next startup attempt without restarting REA, or increase REA_HOPPER_STARTUP_TIMEOUT_MS for future REA processes. Allow at least that long in the MCP client. Resolve retained cleanup before reopening."
      : error.providerState === "busy"
        ? "Check binary_session.analysis_activity, wait for the active Hopper request to finish, then retry."
        : "Check binary_session for Hopper health, then retry the operation.";
  if (error instanceof HopperProcessError)
    return hopperProcessRemediation(error);
  if (error instanceof HopperStartError)
    return error.ownerRunId === undefined
      ? "Check the Hopper launcher and target details, then retry opening the target."
      : `Use the active REA session ${error.ownerRunId} or close it before opening this target again.`;
  if (error instanceof HopperRemoteError)
    return error.diagnosticType === "invalid_request"
      ? "Correct the reported address, document, or arguments and retry."
      : "Review the Hopper diagnostic details and correct the request or target; run `rea doctor` if the provider itself is failing. Repeating the unchanged request is not expected to succeed.";
  if (error instanceof EvidenceReferenceError)
    return error.reason === "missing" &&
      error.referenceScope === "retained-closure"
      ? "Import the originating Evidence bundle with the selected records and their complete linked sources into the current investigation, or re-run their producers there. Retry after the required records are retained. close_binary clears a server session's retained records."
      : "Use an exact Evidence reference available from the selected source, supply the complete inline Evidence, re-run its producer, or select/import its Evidence bundle. close_binary clears a server session's retained records.";
  if (
    error instanceof BinaryTargetError &&
    error.constraint === "directory_requires_file"
  )
    return `For a JavaScript/Electron application directory, call analyze_javascript_application with input_path or run \`rea analyze <directory>\`. For binary analysis, select its executable file or an Apple bundle directory (${OPENABLE_APPLE_BUNDLE_TYPES_TEXT}).`;
  if (
    error instanceof BinaryTargetError &&
    error.constraint === "bundle_type_unsupported"
  )
    return `Select the bundle's program file directly, or open a bundle directory of a supported type (${OPENABLE_APPLE_BUNDLE_TYPES_TEXT}).`;
  if (
    error instanceof BinaryTargetError &&
    (error.constraint === "bundle_executable_undeclared" ||
      error.constraint === "bundle_program_missing") &&
    error.infoPlist !== undefined
  )
    return `Read ${error.infoPlist} with inspect_plist (\`rea inspect-plist <path>\`) to review its CFBundleExecutable, then select an existing program file directly.`;
  if (
    error instanceof BinaryTargetError &&
    (error.constraint === "bundle_info_plist_missing" ||
      error.constraint === "bundle_layout_ambiguous" ||
      error.constraint === "bundle_current_version_missing" ||
      error.constraint === "bundle_path_escapes")
  )
    return "Review the bundle paths listed in details, then select the bundle's program file directly or repair the bundle layout.";
  if (
    error instanceof BinaryTargetError &&
    error.constraint === "load_selection_rejected"
  )
    return "Correct the reported load argument (--target-format, --architecture, or --entry-point on the CLI; format, architecture, or entry_point through MCP) and retry.";
  if (
    error instanceof BinaryTargetError &&
    error.constraint === "file_format_rejected"
  )
    return "Review the reported file-format reason and select a supported, well-formed target.";
  if (
    error instanceof BinaryTargetError &&
    error.constraint === "wasm_requires_static_inspection"
  )
    return `For static inspection, call inspect_wasm_artifact with ${JSON.stringify({ path: error.path })} or run \`rea inspect-wasm-artifact <path> --format json\`. This separate lane requires caller-supplied WABT 1.0.42 via absolute REA_WABT_BIN_DIRECTORY; check its availability in binary_session. REA does not execute WASM or install tools, and the header alone does not establish that the complete module is valid.`;
  if (
    error instanceof AnalysisAccessDeniedError ||
    (error instanceof BinaryTargetError && error.systemCode !== undefined)
  )
    return "Check the current process's read access to the selected path. Retry with a readable local file.";
  if (error instanceof AnalysisArtifactChangedError)
    return "Wait until the selected file is stable. For an active binary session, reopen the target with open_binary before retrying so REA acquires its current identity; for a CLI command or target-free tool, rerun the operation.";
  if (error instanceof ConfigurationError)
    return (
      error.remediationAction ??
      (error.settings.length > 0
        ? `Correct ${[...new Set(error.settings.map(({ setting }) => setting))].join(", ")} in the environment that starts REA (your shell or the MCP client's registration), then rerun.`
        : analysisErrorUserMessage(error))
    );
  if (error instanceof AnalysisInputError)
    return (
      error.remediationAction ??
      `Read the declared input schema or CLI usage for ${error.operation}; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.`
    );
  if (
    error instanceof AnalysisOutputError &&
    error.remediationAction !== undefined
  )
    return error.remediationAction;
  if (
    error instanceof UnknownRegistryError &&
    error.reason === "constraint" &&
    error.constraint !== undefined
  ) {
    const suffix = " Do not repeat the unchanged call.";
    switch (error.constraint.kind) {
      case "missing_evidence":
        return (
          "Use an Evidence ID retained in this session; obtain or import the missing Evidence before referencing it." +
          suffix
        );
      case "missing_unknown":
        return (
          "Use an unknown_id retained in this session; create or import the related unknown before referencing it." +
          suffix
        );
      case "resolution_unproven":
        return (
          "Supply supporting non-mutation Evidence matching the unknown's required authority, confidence and environment, or withdraw the unsupported resolution." +
          suffix
        );
      case "contradicting_evidence":
        return (
          "Reconcile the contradicting Evidence before claiming a verified resolution." +
          suffix
        );
      case "dependency_cycle":
        return (
          "Correct the depends-on relationships to remove the dependency cycle." +
          suffix
        );
      case "history_gap":
      case "revision_chain":
        break;
    }
  }
  if (error instanceof UnknownRegistryError && error.reason === "not-found")
    return "Check that the unknown_id belongs to this session, then retry.";
  return analysisErrorUserMessage(error);
};

export const analysisErrorCategory = (
  error: AnalysisError,
): AnalysisErrorProjection["category"] => {
  error = primaryAnalysisError(error);
  if (error instanceof AnalysisCapabilityUnavailableError && error.retryable)
    return "unavailable";
  if (
    error instanceof BinaryTargetError &&
    error.constraint === "load_selection_rejected"
  )
    return "invalid_input";
  if (
    error instanceof BinaryTargetError &&
    (error.constraint === "wasm_requires_static_inspection" ||
      error.constraint === "file_format_rejected" ||
      error.constraint === "bundle_type_unsupported")
  )
    return "unsupported_target";
  if (
    error instanceof ProviderSelectionError &&
    error.reason === "provider_unavailable"
  )
    return "unavailable";
  if (error._tag === "ProcessCaptureError")
    return error.userCategory ?? "execution_failure";
  if (error instanceof BrowserObservationError)
    return error.userCategory ?? browserErrorCategory(error.reason);
  if (
    error instanceof HopperRemoteError &&
    error.diagnosticType === "invalid_request"
  )
    return "invalid_input";
  if (
    error instanceof HopperRemoteError &&
    error.diagnosticType === "authorization"
  )
    return "unavailable";
  if (error instanceof HopperProcessError || error instanceof HopperStartError)
    return "unavailable";
  if (error instanceof ArtifactOperationError)
    return artifactErrorCategory(error.reason);
  if (
    error instanceof EvidenceFileError &&
    (error.reason === "path-limit" || error.reason === "storage-limit")
  )
    return "resource_constraint";
  if (
    error instanceof EvidenceFileError &&
    (error.reason === "missing" ||
      error.reason === "symlink-traversal" ||
      error.reason === "not-file" ||
      error.reason === "wrong-kind" ||
      error.reason === "exists")
  )
    return "invalid_input";
  if (
    error instanceof UnknownRegistryError &&
    (error.reason === "already-exists" || error.reason === "constraint")
  )
    return "invalid_input";
  return STATIC_ERROR_CATEGORIES[error._tag] ?? "execution_failure";
};

const browserErrorCategory = (
  reason: BrowserObservationError["reason"],
): AnalysisErrorProjection["category"] => {
  if (reason === "cancelled") return "cancelled";
  if (reason === "timeout") return "timeout";
  if (reason === "payload_limit") return "truncated";
  if (
    reason === "target_not_found" ||
    reason === "target_not_allowed" ||
    reason === "service_worker_blocked" ||
    reason === "target_changed" ||
    reason === "target_session_detached" ||
    reason === "endpoint_unreachable" ||
    reason === "disconnected"
  )
    return "unavailable";
  return "execution_failure";
};

const artifactErrorCategory = (
  reason: ArtifactOperationError["reason"],
): AnalysisErrorProjection["category"] => {
  if (reason === "integrity") return "integrity_mismatch";
  if (reason === "limit") return "truncated";
  if (reason === "cancelled") return "cancelled";
  if (reason === "unavailable") return "unavailable";
  return "execution_failure";
};

const STATIC_ERROR_CATEGORIES: Readonly<
  Partial<Record<AnalysisErrorTag, AnalysisErrorProjection["category"]>>
> = {
  ConfigurationError: "invalid_input",
  AnalysisInputError: "invalid_input",
  AnalysisAccessDeniedError: "unavailable",
  AnalysisArtifactChangedError: "integrity_mismatch",
  AnalysisCapabilityUnavailableError: "unsupported_provider",
  AnalysisUnsupportedTargetError: "unsupported_target",
  ProviderSelectionError: "unsupported_provider",
  EvidenceIntegrityError: "integrity_mismatch",
  AnalysisCancelledError: "cancelled",
  HopperCancelledError: "cancelled",
  AnalysisTimeoutError: "timeout",
  AnalysisResourceConstraintError: "resource_constraint",
  HopperTimeoutError: "timeout",
  NoBinaryOpenError: "unavailable",
  BinaryTargetError: "unavailable",
};

export const analysisErrorUserMessage = (error: AnalysisError): string => {
  error = resolvedAnalysisError(error);
  if (error instanceof AnalysisSnapshotMismatchError) return error.message;
  if (error instanceof AnalysisUnsupportedTargetError) return error.message;
  if (error instanceof AnalysisResourceConstraintError) return error.reason;
  if (error instanceof AnalysisAccessDeniedError)
    return "Host filesystem permissions denied read access to the selected path.";
  if (error instanceof AnalysisArtifactChangedError)
    return "The selected artifact changed during acquisition; no stable snapshot was decoded.";
  if (error instanceof AnalysisInputError)
    return (
      error.userMessage ??
      "Analysis input is invalid. Check the arguments and try again."
    );
  if (error instanceof AnalysisTimeoutError)
    return error.userMessage ?? timeoutUserMessage(error);
  const hopperMessage = hopperErrorUserMessage(error);
  if (hopperMessage !== undefined) return hopperMessage;
  if (error.userMessage !== undefined) return error.userMessage;
  if (error instanceof AnalysisCapabilityUnavailableError && error.retryable)
    return "Required runtime controls are unavailable for this attempt.";
  const standardMessage = standardErrorMessage(error._tag);
  if (standardMessage !== undefined) return standardMessage;
  if (error instanceof ArtifactOperationError) return artifactMessage(error);
  if (error instanceof EvidenceReferenceError)
    return error.reason === "missing"
      ? error.referenceScope === "retained-closure"
        ? `Evidence ${error.evidenceId} is missing from the required retained Evidence closure in the current investigation. Import its originating bundle or re-create the required observations before retrying.`
        : `Evidence ${error.evidenceId} is not available from the selected source. Supply complete inline Evidence, re-run its producer, or select/import its bundle before using this reference.`
      : `Evidence ${error.evidenceId} does not match the requested reference (${error.reason}). Check the expected and actual identity in the diagnostic details.`;
  if (error instanceof EvidenceIntegrityError)
    return "Evidence is invalid or has changed. Recreate or re-import it, then try again.";
  if (error instanceof EvidenceFileError) return evidenceFileMessage(error);
  if (
    error instanceof UnknownRegistryError &&
    error.reason === "already-exists"
  )
    return "This residual unknown already exists in the session. Reuse it or call update_unknown with its current expected_revision; do not repeat record_unknown.";
  if (error instanceof UnknownRegistryError && error.reason === "not-found")
    return "The requested residual unknown does not exist in this session. Check the unknown_id and try again.";
  if (error instanceof UnknownRegistryError && error.constraint !== undefined)
    return describeResidualUnknownGraphConstraint(error.constraint);
  if (error instanceof UnknownRegistryError)
    return "Evidence state changed before the update completed. Refresh the current state and try again.";
  if (error instanceof ConfigurationError)
    return error.settings.length === 0
      ? "REA configuration is invalid. Run `rea doctor` and fix the reported setting."
      : `REA configuration is invalid: ${error.settings
          .map(({ setting, constraint }) =>
            constraint.includes(setting)
              ? constraint.replace(/\.$/u, "")
              : `${setting}: ${constraint}`,
          )
          .join("; ")}.`;
  if (error instanceof NoBinaryOpenError) return error.message;
  if (
    error instanceof BinaryTargetError &&
    error.constraint === "wasm_requires_static_inspection"
  )
    return `${error.message}. Static WebAssembly inspection uses a separate optional WABT lane, not a native analysis engine.`;
  if (error instanceof BinaryTargetError)
    return error.constraint === "directory_requires_file"
      ? `open_binary accepts files and Apple bundle directories (${OPENABLE_APPLE_BUNDLE_TYPES_TEXT}). This target is another directory; JavaScript/Electron application directories can be analyzed directly with analyze_javascript_application or \`rea analyze <directory>\`.`
      : error.constraint === undefined
        ? `${error.message}. Check that the path exists, is readable, and points to a supported file.`
        : `${error.message}.`;
  if (error._tag === "ProcessCaptureError")
    return (
      error.userMessage ??
      "Process capture could not complete. Run `rea doctor`, then review capture policy and try again."
    );
  return "Analysis could not complete. Run `rea doctor`, then try again.";
};

const hopperErrorUserMessage = (error: AnalysisError): string | undefined => {
  if (error instanceof HopperTimeoutError) {
    if (error.operation === undefined)
      return "REA timed out waiting for Hopper bridge readiness, which includes initial analysis. Hopper may still be analyzing the target or waiting for a loader, demo, or license dialog. Review the captured launcher outcome and resolve retained cleanup before retrying.";
    const request = error.operation;
    return error.providerState === "busy"
      ? `Hopper timed out during ${request} while the provider remained busy. Check binary_session.analysis_activity, wait for the active request to finish, then retry.`
      : `Hopper timed out during ${request} before it started. Check binary_session for provider health, then retry.`;
  }
  if (error instanceof HopperProcessError) return hopperProcessMessage(error);
  if (error instanceof HopperStartError)
    return (
      error.userMessage ??
      "Hopper could not start. Check the launcher and target details, then retry opening the target."
    );
  if (error instanceof HopperRemoteError)
    return `Hopper ${error.operation ?? "analysis"} failed (${String(error.code)}, ${error.diagnosticType}): ${error.safeMessage}`;
  return undefined;
};

const RESTART_OWNED_PROVIDER =
  "Restart the owned provider by calling close_binary, then open the target again and retry.";
const RESTART_UNREACHABLE_HOPPER = `${RESTART_OWNED_PROVIDER} If Hopper may have exited, call export_evidence_bundle before close_binary; closing clears retained records.`;

const hopperProcessRemediation = (error: HopperProcessError): string => {
  if (error.failureCode !== undefined && error.userMessage !== undefined)
    return error.userMessage;
  if (error.stage === "launch")
    return "Review the captured launcher diagnostics and Hopper setup, then retry opening the target.";
  if (error.providerState === "unreachable") return RESTART_UNREACHABLE_HOPPER;
  if (providerRetryAction(error.providerState) === "restart_provider")
    return RESTART_OWNED_PROVIDER;
  return "Read binary_session.provider_operation_health for this request before retrying or restarting the owned provider.";
};

const hopperProcessMessage = (error: HopperProcessError): string => {
  const stage = error.stage;
  const where = error.operation ?? stage;
  const request =
    error.requestId === undefined
      ? ""
      : ` Request id ${String(error.requestId)}.`;
  const startup =
    error.userMessage === undefined ? "" : ` ${error.userMessage}`;
  if (error.providerState === "exited") {
    const signal = error.launcherFailure?.signal;
    const exit =
      error.exitCode === null
        ? signal === undefined || signal === null
          ? "no exit code was observed"
          : `signal ${signal}`
        : `exit code ${String(error.exitCode)}`;
    const recovery =
      error.failureCode === undefined && stage !== "launch"
        ? ` ${RESTART_OWNED_PROVIDER}`
        : "";
    return `Hopper exited during ${where} (${exit}).${startup}${recovery}${request}`;
  }
  if (error.providerState === "unreachable")
    return `Hopper became unreachable during ${where}; its process exit was not observed. ${RESTART_UNREACHABLE_HOPPER}${startup}${request}`;
  return `Hopper failed during ${where} and REA could not determine whether the provider is busy, exited, or unreachable.${startup} Read binary_session.provider_operation_health for this request before retrying or restarting.${request}`;
};

const standardErrorMessage = (tag: AnalysisErrorTag): string | undefined => {
  if (UNREADABLE_OUTPUT_TAGS.has(tag))
    return "Analysis returned an unreadable result. Run `rea doctor` and review the reported details; repeating the unchanged request is not expected to succeed.";
  if (UNSUPPORTED_PROVIDER_TAGS.has(tag))
    return "This analysis is unavailable for the current target. Choose another analysis or target.";
  if (CANCELLED_TAGS.has(tag))
    return "Analysis was cancelled. Start it again when ready.";
  if (TIMEOUT_TAGS.has(tag))
    return "Analysis took too long. Try a smaller request, then run `rea doctor` if it continues.";
  if (ADAPTER_FAILURE_TAGS.has(tag))
    return "Analysis could not complete. Run `rea doctor` and review the reported details; repeating the unchanged request is not expected to succeed.";
  if (START_FAILURE_TAGS.has(tag))
    return "Analysis could not start or stopped unexpectedly. Run `rea doctor`, then try again.";
  return undefined;
};

const timeoutUserMessage = (error: AnalysisTimeoutError): string =>
  `REA's ${error.operation} operation reached its ${String(error.timeoutMs)}ms server/provider deadline. This is not a client-side timeout; extending only the MCP client's deadline does not change this budget.`;

const timeoutRemediation = (error: AnalysisTimeoutError): string =>
  `Inspect any partial Evidence, provider diagnostics and reported session/provider cleanup state for ${error.operation}. Reduce the request if supported, or resolve the reported provider condition before retrying. Do not repeat the unchanged call or retry while work or cleanup may still be active.`;

const UNREADABLE_OUTPUT_TAGS: ReadonlySet<AnalysisErrorTag> = new Set([
  "AnalysisProtocolError",
  "AnalysisOutputError",
  "HopperProtocolError",
]);
const UNSUPPORTED_PROVIDER_TAGS: ReadonlySet<AnalysisErrorTag> = new Set([
  "AnalysisCapabilityUnavailableError",
  "ProviderSelectionError",
]);
const CANCELLED_TAGS: ReadonlySet<AnalysisErrorTag> = new Set([
  "AnalysisCancelledError",
  "HopperCancelledError",
]);
const TIMEOUT_TAGS: ReadonlySet<AnalysisErrorTag> = new Set([
  "AnalysisTimeoutError",
  "HopperTimeoutError",
]);
const ADAPTER_FAILURE_TAGS: ReadonlySet<AnalysisErrorTag> = new Set([
  "ProviderAdapterError",
  "HopperRemoteError",
]);
const START_FAILURE_TAGS: ReadonlySet<AnalysisErrorTag> = new Set([
  "HopperProcessError",
  "HopperStartError",
]);

/** Operations that accept integrity_policy for declared-integrity mismatches. */
const INTEGRITY_POLICY_OPERATIONS: ReadonlySet<
  ArtifactOperationError["operation"]
> = new Set([
  "inventory_artifact",
  "inspect_artifact",
  "extract_artifact",
  "analyze_javascript_application",
]);

const artifactMessage = ({
  operation,
  reason,
  artifactDetails: details,
  detail,
}: ArtifactOperationError): string => {
  if (reason === "cancelled")
    return "Artifact operation was cancelled. Start it again when ready.";
  if (reason === "limit")
    return (
      detail ??
      "Artifact processing reached a resource limit. Select an artifact within the reported limits and retry."
    );
  if (reason === "path")
    return (
      detail ??
      "Artifact contains a conflicting internal path. Inspect the reported path before retrying."
    );
  if (reason === "unavailable" && details?.unpacked === true)
    return `ASAR unpacked companion bytes are unavailable for ${details.logicalPath}. Select the archive in place with its .unpacked directory beside it, then retry.`;
  if (reason === "unavailable")
    return "Artifact processing is unavailable. Review the reported availability reason and resolve that condition before retrying.";
  if (
    reason === "integrity" &&
    details !== undefined &&
    INTEGRITY_POLICY_OPERATIONS.has(operation)
  )
    return `${
      details?.unpacked === true &&
      "calculatedSha256" in details &&
      details.calculatedSha256 !== null
        ? `Declared ASAR integrity for unpacked entry ${details.logicalPath} contradicts its companion file; packaging tools commonly sign or strip unpacked native binaries after writing the archive.`
        : "Artifact bytes contradict declared integrity."
    } If expected, rerun ${operation === "inventory_artifact" ? "inspect_artifact" : operation} with integrity_policy=record-and-continue (CLI: --integrity-policy record-and-continue) to retain observed bytes as untrusted; otherwise get a fresh copy.`;
  if (reason === "format" || reason === "integrity")
    return "Artifact is invalid or has changed. Get a fresh copy and try again.";
  return "Artifact could not be read or written. Check file access and try again.";
};

const evidenceFileMessage = ({
  operation,
  reason,
  published,
  systemCode,
}: EvidenceFileError): string => {
  if (published !== undefined)
    return "The output file was published, but staging cleanup remains incomplete.";
  if (reason === "path-limit")
    return "Filesystem path-length constraints prevented reading or atomic publication at the selected path. Choose a shorter local path.";
  if (reason === "storage-limit")
    return systemCode === "EFBIG"
      ? "The host file-size limit prevented Evidence publication. Increase the inherited file-size allowance and retry."
      : systemCode === undefined
        ? "A host filesystem resource limit prevented Evidence publication. Check the file-size allowance, filesystem space and quota before retrying."
        : "The filesystem lacks space or quota for Evidence publication. Free space or increase quota and retry.";
  if (reason === "symlink-traversal")
    return "The selected path cannot be resolved because its symbolic-link chain loops or exceeds the host traversal limit. Repair the chain or select another path.";
  if (reason === "missing")
    return operation === "read"
      ? "Evidence file does not exist at the selected path. Check the path and try again."
      : "Evidence output directory does not exist. Choose an existing directory and try again.";
  if (reason === "not-file")
    return "Evidence path does not point to a regular file. Choose a file and try again.";
  if (reason === "exists")
    return "Evidence file already exists. Choose another path or allow overwrite.";
  if (reason === "invalid-json")
    return "Evidence file is not valid JSON. Repair or recreate the file and try again.";
  return "Evidence file could not be accessed. Check file permissions and try again.";
};

const KNOWN_ERROR_TAGS = {
  AnalysisProtocolError: true,
  AnalysisInputError: true,
  AnalysisAccessDeniedError: true,
  AnalysisArtifactChangedError: true,
  AnalysisOutputError: true,
  AnalysisCapabilityUnavailableError: true,
  AnalysisUnsupportedTargetError: true,
  AnalysisCancelledError: true,
  AnalysisTimeoutError: true,
  AnalysisResourceConstraintError: true,
  ProviderSelectionError: true,
  ProviderAdapterError: true,
  BrowserObservationError: true,
  ArtifactOperationError: true,
  ProcessCaptureError: true,
  EvidenceIntegrityError: true,
  EvidenceFileError: true,
  UnknownRegistryError: true,
  HopperTimeoutError: true,
  HopperCancelledError: true,
  HopperProtocolError: true,
  HopperRemoteError: true,
  HopperProcessError: true,
  HopperStartError: true,
  ConfigurationError: true,
  NoBinaryOpenError: true,
  BinaryTargetError: true,
} as const satisfies Readonly<Record<AnalysisErrorTag, true>>;

export const assertKnownAnalysisErrorTag = (tag: AnalysisErrorTag): void => {
  if (KNOWN_ERROR_TAGS[tag] !== true)
    throw new TypeError("Unknown analysis error tag");
};
