import type { EspFlashSelection } from "../domain/firmware/espFlashLocation.js";
import type { ExecutableFormatHint } from "../domain/dosCom.js";
import { dispatchQueuedInterrupts } from "../process/queuedInterrupts.js";
import type {
  BinaryArchitecture,
  BinaryTarget,
} from "../domain/binaryTargetTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { DirectAnalysisDependencies } from "./DirectAnalysisDependencies.js";
import type { BinarySession } from "./binary/BinarySession.js";
import type { SessionProviderRoute } from "./binary/SessionProviderRouter.js";
import {
  routeAllowsSnapshotReplay,
  routeProviderIdentity,
} from "./binary/SessionProviderPolicy.js";
import type { ResolvedSessionOpen } from "./binary/BinarySessionOpen.js";
import { silentLogger } from "../logger.js";
import type { Logger } from "pino";
import { withEvidenceCallerInputPath } from "../domain/evidence.js";
import { createImmutableEvidenceBundle } from "../domain/evidenceBundle.js";
import { retainAnalysisResultSources } from "./investigation/recordEvidenceSources.js";
import type { Evidence } from "../domain/evidence.js";
import type { NativeToolName } from "../contracts/native/nativeToolContracts.js";
import type { EnhancedToolName } from "../contracts/enhancedInputs.js";
import {
  ARTIFACT_ANALYSIS_OPERATIONS,
  type ArtifactAnalysisOperation,
} from "../contracts/artifactToolContracts.js";
import {
  isManagedToolName,
  type ManagedToolName,
} from "../contracts/managed/managedToolContracts.js";
import {
  EvidenceFileError,
  AnalysisSnapshotMismatchError,
  type PublishedEvidenceFile,
} from "../domain/evidenceErrors.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { access, stat } from "node:fs/promises";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { requiresNativeSourceAdmissionBeforeReplay } from "./binary/AnalysisSnapshotCache.js";
import { classifyBinaryTargetFilesystemFailure } from "./BinaryTargetResolver.js";
import {
  snapshotEvidenceForQuery,
  snapshotMatchesTarget,
} from "../domain/analysisSnapshot.js";
import type { AnalysisProfileCommitment } from "../domain/analysisProfile.js";
import { profilelessNativeDispatchProfile } from "./binary/ProfilelessNativeWorkflowSnapshot.js";
import { err, ok, type Result } from "../domain/result.js";
import type { AnalysisSnapshot } from "../domain/analysisSnapshot.js";
import type {
  AnalysisExecution,
  ProviderIdentity,
} from "./AnalysisProvider.js";
import { createAnalysisExecutionEvidence } from "../domain/analysisObservation.js";
import { REA_WORKFLOW_PROVIDER } from "../domain/investigationProviders.js";
import { workflowAnalysisProfile } from "./WorkflowAnalysisProfile.js";
import {
  composedLimitationBudget,
  executeComposedWorkflow,
  createWorkflowEvidence,
  workflowSnapshotRecord,
  recordWorkflowUnknowns,
} from "./WorkflowEvidence.js";
import type { AnalysisProviderSelector } from "../domain/providerSelection.js";
import { resolveXrefsAddress } from "./XrefsAddressResolution.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../domain/analysisErrorCore.js";
import { deliverAnalysisEvidence } from "./EvidenceBundleCommands.js";
import type { BinaryTargetError } from "../domain/configurationErrors.js";
import {
  directAnalysisCleanupFailure,
  projectDirectAnalysisFailure,
  managedAnalysisCleanupFailure,
  withSessionCleanup,
} from "./DirectAnalysisCleanup.js";
import { completeProviderEvidence } from "./ProviderOperationExecution.js";
import { BUNDLE_RESOURCE_OPERATIONS } from "./binary/BundleResourceSession.js";

type DirectAnalysisTool =
  | "annotate_native_function"
  | "inspect_native_load_image"
  | "read_bytes"
  | "search_bytes"
  | "address_to_file_offset"
  | "binary_overview"
  | "procedure_pseudo_code"
  | "read_function_instructions"
  | "inspect_native_instruction"
  | "inspect_native_data_type"
  | "resolve_native_call_targets"
  | "analyze_function"
  | "inspect_native_api"
  | "inspect_native_dispatch_metadata"
  | "search_strings"
  | "search_procedures"
  | "xrefs"
  | "trace_feature"
  | "trace_native_ui_action"
  | "trace_native_values"
  | "decompile_all";

// These one-shot CLI questions require native utilities, not a deep engine.
// Runtime observation retains the ordinary session and authority checks.
const NATIVE_INSPECTION_OPERATIONS: ReadonlySet<string> = new Set([
  "inspect_macho",
  "inspect_signature",
  "list_architectures",
  "inspect_plist",
  "demangle_swift",
] satisfies readonly NativeToolName[]);

const ARTIFACT_ANALYSIS_OPERATION_SET: ReadonlySet<string> = new Set(
  ARTIFACT_ANALYSIS_OPERATIONS,
);
/**
 * Open one binary, execute one tool, and always release provider resources.
 * Unlike MCP mode, every CLI invocation is intentionally isolated and does not
 * retain a target or provider client for a subsequent command.
 */
export const runDirectAnalysis = async (
  dependencies: DirectAnalysisDependencies,
  path: string,
  tool: DirectAnalysisTool,
  arguments_: Readonly<Record<string, JsonValue>>,
  options: {
    readonly logger?: Logger;
    readonly snapshotPath?: string | undefined;
    readonly signal?: AbortSignal;
    readonly providerId?: AnalysisProviderSelector;
    readonly formatHint?: ExecutableFormatHint;
    readonly architecture?: BinaryArchitecture;
    readonly entryPoint?: string;
    readonly espFlash?: EspFlashSelection;
  } = {},
): Promise<Result<Evidence, JsonValue>> =>
  withProcessCancellation(options.signal, (signal) =>
    runAnalysis(dependencies, path, tool, arguments_, {
      logger: options.logger ?? silentLogger,
      snapshotPath: options.snapshotPath,
      signal,
      ...targetSelection(options),
      ...(options.providerId === undefined
        ? {}
        : { providerId: options.providerId }),
    }),
  );

/** How the caller asks an artifact target to be read. */
export interface ArtifactTargetSelection {
  readonly formatHint?: ExecutableFormatHint;
  readonly espFlash?: EspFlashSelection;
}

/** The caller's target interpretation, forwarded unchanged to every open. */
const targetSelection = (options: {
  readonly formatHint?: ExecutableFormatHint;
  readonly architecture?: BinaryArchitecture;
  readonly entryPoint?: string;
  readonly espFlash?: EspFlashSelection;
}) => ({
  ...(options.formatHint === undefined
    ? {}
    : { formatHint: options.formatHint }),
  ...(options.architecture === undefined
    ? {}
    : { architecture: options.architecture }),
  ...(options.entryPoint === undefined
    ? {}
    : { entryPoint: options.entryPoint }),
  ...(options.espFlash === undefined ? {} : { espFlash: options.espFlash }),
});

/** Execute one provider-native semantic operation with atomic provenance. */
export const runProviderAnalysis = async (
  dependencies: DirectAnalysisDependencies,
  ...[
    path,
    tool,
    arguments_,
    logger = silentLogger,
    signal,
    delivery,
    selection,
  ]:
    | readonly [
        path: string,
        tool: NativeToolName | ArtifactAnalysisOperation | ManagedToolName,
        arguments_: Readonly<Record<string, JsonValue>>,
        logger?: Logger | undefined,
        signal?: AbortSignal | undefined,
      ]
    | readonly [
        path: string,
        tool: "inspect_managed_members",
        arguments_: Readonly<Record<string, JsonValue>>,
        logger: Logger | undefined,
        signal: AbortSignal | undefined,
        delivery: {
          readonly detail?: "complete" | "summary";
          readonly evidenceBundlePath?: string;
        },
      ]
    | readonly [
        path: string,
        tool: ArtifactAnalysisOperation,
        arguments_: Readonly<Record<string, JsonValue>>,
        logger: Logger | undefined,
        signal: AbortSignal | undefined,
        delivery: undefined,
        selection: ArtifactTargetSelection,
      ]
): Promise<Result<Evidence, JsonValue>> => {
  if (delivery !== undefined && tool !== "inspect_managed_members")
    return err(
      cliError(
        new AnalysisInputError(tool, undefined, [
          {
            path: ["delivery"],
            reason: "invalid_value",
            message:
              "Evidence delivery options are only supported by inspect_managed_members",
          },
        ]),
      ),
    );
  if (
    delivery?.detail === "summary" &&
    delivery.evidenceBundlePath === undefined
  )
    return err(
      cliError(
        new AnalysisInputError(tool, undefined, [
          {
            path: ["evidence_bundle"],
            reason: "missing_argument",
            message:
              "summary detail requires --evidence-bundle so complete Evidence remains available to later CLI commands",
          },
        ]),
      ),
    );
  return withProcessCancellation(signal, async (operationSignal) => {
    // The selected CLI path is a request fact. Keep it out of provider inputs
    // and target identity, which may use the resolved executable instead.
    const evidenceParameters = { ...arguments_, input_path: path };
    if (isManagedToolName(tool)) {
      const original = await runManagedProviderAnalysis(
        dependencies,
        path,
        tool,
        arguments_,
        evidenceParameters,
        operationSignal,
      );
      await dispatchQueuedInterrupts();
      if (!original.ok) return err(cliError(original.error, path));
      const evidence = withEvidenceCallerInputPath(original.value, path);
      if (operationSignal.aborted)
        return err(
          cliError(
            new AnalysisCancelledError(tool, {
              cause: operationSignal.reason,
              partialObservation: evidence,
            }),
          ),
        );
      const result =
        delivery?.evidenceBundlePath === undefined
          ? ok(evidence)
          : await deliverAnalysisEvidence(
              evidence,
              delivery.evidenceBundlePath,
              delivery.detail,
              operationSignal,
            );
      return result.ok ? ok(result.value) : err(cliError(result.error, path));
    }
    return runAnalysis(dependencies, path, tool, arguments_, {
      logger,
      snapshotPath: undefined,
      signal: operationSignal,
      evidenceParameters,
      ...targetSelection(selection ?? {}),
      ...(ARTIFACT_ANALYSIS_OPERATION_SET.has(tool)
        ? { createSession: dependencies.createArtifactBinarySession }
        : NATIVE_INSPECTION_OPERATIONS.has(tool)
          ? { createSession: dependencies.createNativeBinarySession }
          : {}),
    });
  });
};

/** Execute managed metadata inspection in an isolated managed-only session. */
export const runManagedProviderExecution = async (
  dependencies: Pick<DirectAnalysisDependencies, "createManagedBinarySession">,
  path: string,
  tool: ManagedToolName,
  signal?: AbortSignal,
  parameters: Readonly<Record<string, JsonValue>> = {},
): Promise<Result<AnalysisExecution, AnalysisError>> =>
  withProcessCancellation(signal, async (operationSignal) => {
    const session = await dependencies.createManagedBinarySession();
    return withSessionCleanup(
      session,
      async () => {
        const opened = await session.open(path, { signal: operationSignal });
        if (!opened.ok) return opened;
        return await session.execute(tool, parameters, {
          signal: operationSignal,
        });
      },
      managedAnalysisCleanupFailure,
    );
  });

/** Preserve typed managed Evidence before selecting its CLI delivery. */
const runManagedProviderAnalysis = async (
  dependencies: Pick<DirectAnalysisDependencies, "createManagedBinarySession">,
  path: string,
  tool: ManagedToolName,
  arguments_: Readonly<Record<string, JsonValue>>,
  evidenceParameters: Readonly<Record<string, JsonValue>>,
  signal?: AbortSignal,
): Promise<Result<Evidence, AnalysisError>> => {
  const execution = await runManagedProviderExecution(
    dependencies,
    path,
    tool,
    signal,
    arguments_,
  );
  if (!execution.ok) return execution;
  const value = execution.value;
  return ok(
    createAnalysisExecutionEvidence(
      tool,
      evidenceParameters,
      value,
      "observed",
      { immutable: true },
    ),
  );
};

const runAnalysis = async (
  dependencies: DirectAnalysisDependencies,
  path: string,
  tool:
    | NativeToolName
    | ArtifactAnalysisOperation
    | ManagedToolName
    | DirectAnalysisTool,
  arguments_: Readonly<Record<string, JsonValue>>,
  options: {
    readonly logger: Logger;
    readonly snapshotPath: string | undefined;
    readonly signal: AbortSignal;
    readonly evidenceParameters?: Readonly<Record<string, JsonValue>>;
    readonly createSession?: () => BinarySession | Promise<BinarySession>;
    readonly providerId?: AnalysisProviderSelector;
    readonly formatHint?: ExecutableFormatHint;
    readonly architecture?: BinaryArchitecture;
    readonly entryPoint?: string;
    readonly espFlash?: EspFlashSelection;
  },
): Promise<Result<Evidence, JsonValue>> => {
  const { logger, signal, snapshotPath } = options;
  const evidenceParameters = options.evidenceParameters ?? arguments_;
  let session: BinarySession;
  if (options.createSession !== undefined) {
    session = await options.createSession();
  } else {
    const config = dependencies.readConfiguration();
    if (!config.ok) return err(cliError(config.error));
    session = await (
      tool === "inspect_native_dispatch_metadata" && snapshotPath === undefined
        ? dependencies.createNativeDispatchBinarySession
        : dependencies.createBinarySession
    )(config.value, logger);
  }
  let publishedSnapshot: PublishedEvidenceFile | undefined;
  const execute = async (): Promise<Result<Evidence, AnalysisError>> => {
    let isDirectory = false;
    if (BUNDLE_RESOURCE_OPERATIONS.has(tool)) {
      const inspected = await inspectBundleResourceInput(path);
      if (!inspected.ok) return err(inspected.error);
      isDirectory = inspected.value;
    }
    if (BUNDLE_RESOURCE_OPERATIONS.has(tool) && isDirectory) {
      const opened = await session.openBundleResources(path, { signal });
      if (!opened.ok) return err(opened.error);
      const execution = await session.execute(tool, arguments_, { signal });
      if (!execution.ok) return err(execution.error);
      return ok(
        withEvidenceCallerInputPath(
          createAnalysisExecutionEvidence(
            tool,
            evidenceParameters,
            execution.value,
            "observed",
          ),
          path,
        ),
      );
    }
    const prepared = await prepareSnapshot({
      session,
      path,
      snapshotPath,
      signal,
      ...targetSelection(options),
    });
    if (!prepared.ok) return err(prepared.error);
    const { snapshot } = prepared.value;
    let resolvedTarget: ResolvedSessionOpen | undefined;
    if (snapshot !== undefined && prepared.value.target !== undefined) {
      const preview = await session.previewTarget(prepared.value.target, {
        signal,
        snapshot,
        ...targetSelection(options),
        ...(options.providerId === undefined
          ? {}
          : { providerId: options.providerId }),
      });
      if (!preview.ok) return err(preview.error);
      resolvedTarget = preview.value;
      const route = preview.value.route;
      const bindingProfile =
        route.profile ?? nativeDispatchBindingProfile(route, tool);
      const evidenceProfile = analysisProfileForRoute(route, tool);
      // A parsed Windows path does not prove Ghidra's native snapshot owner
      // admitted the selected source; CLI replay must wait for that client.
      if (
        bindingProfile !== undefined &&
        evidenceProfile !== undefined &&
        !requiresNativeSourceAdmissionBeforeReplay(
          route.binding?.identity.id,
        ) &&
        tool !== "trace_native_ui_action" &&
        tool !== "decompile_all" &&
        routeAllowsSnapshotReplay(route, tool)
      ) {
        const cached = snapshotEvidenceForQuery(snapshot, {
          target: preview.value.target,
          bindingProfile,
          operation: tool,
          parameters: arguments_,
          provider: isWorkflowEvidenceTool(tool)
            ? REA_WORKFLOW_PROVIDER
            : routeProviderIdentity(route, tool),
          evidenceProfile,
        });
        if (cached !== undefined)
          return ok(withEvidenceCallerInputPath(cached, path));
      }
    }
    const openOptions = {
      signal,
      ...targetSelection(options),
      ...(snapshot === undefined ? {} : { snapshot }),
      ...(options.providerId === undefined
        ? {}
        : { providerId: options.providerId }),
    };
    const opened =
      resolvedTarget === undefined
        ? await session.open(path, openOptions)
        : await session.openResolvedTarget(resolvedTarget, openOptions);
    if (!opened.ok) return err(opened.error);
    const evidenceProfile = analysisProfileForEvidence(session, tool);
    const executed = await executeAnalysisTool({
      session,
      openedTarget: opened.value,
      tool,
      arguments: arguments_,
      evidenceParameters,
      signal,
      evidenceProfile,
    });
    if (!executed.ok) return executed;
    const { cachePolicy } = executed.value;
    const evidence = withEvidenceCallerInputPath(executed.value.evidence, path);
    // Provider execution may have already recorded the same semantic Evidence
    // without this invocation's request path. Import replaces that metadata
    // while retaining the authenticated result and snapshot binding.
    const recorded = session.importEvidenceBundle(
      createImmutableEvidenceBundle([evidence]),
    );
    if (!recorded.ok)
      return err(recorded.error.retainPartialObservation(evidence));
    if (isWorkflowEvidenceTool(tool)) {
      const unknowns = recordWorkflowUnknowns({
        name: tool,
        result: evidence.normalized_result,
        evidenceId: evidence.evidence_id,
        recordUnknown: (unknown) => session.recordUnknown(unknown),
      });
      if (!unknowns.ok)
        return err(unknowns.error.retainPartialObservation(evidence));
    }
    if (
      isWorkflowEvidenceTool(tool) &&
      tool !== "trace_native_ui_action" &&
      snapshotPath !== undefined &&
      session.allowsSnapshotReplay(tool)
    ) {
      const workflowRecord = workflowSnapshotRecord(
        evidence,
        tool,
        evidenceProfile,
        cachePolicy,
      );
      if (workflowRecord !== undefined) {
        const recorded = session.recordWorkflowSnapshot(workflowRecord);
        if (!recorded.ok)
          return err(recorded.error.retainPartialObservation(evidence));
      }
    }
    if (
      tool !== "trace_native_ui_action" &&
      tool !== "decompile_all" &&
      snapshotPath !== undefined
    ) {
      const snapshot = session.exportAnalysisSnapshot();
      if (!snapshot.ok)
        return err(snapshot.error.retainPartialObservation(evidence));
      const written = await session.writeAnalysisSnapshot(
        snapshot.value,
        snapshotPath,
        true,
      );
      if (written.ok) publishedSnapshot = written.value;
      else {
        const published =
          written.error instanceof EvidenceFileError
            ? written.error.published
            : undefined;
        if (published?.path !== undefined)
          publishedSnapshot = { path: published.path, bytes: published.bytes };
        const released =
          published !== undefined && (await session.closeFileResources()).ok;
        if (!released || published?.path === undefined)
          return err(written.error.retainPartialObservation(evidence));
      }
    }
    return ok(evidence);
  };
  const outcome = await withSessionCleanup<{
    readonly result: Result<Evidence, AnalysisError>;
    readonly cleanupError?: AnalysisError;
  }>(
    session,
    async () => ({ result: await execute() }),
    (value, cleanupError) => ({ ...value, cleanupError }),
  );
  await dispatchQueuedInterrupts();
  const result = outcome.result.ok
    ? completeProviderEvidence(outcome.result.value, signal)
    : outcome.result;
  if (!result.ok && publishedSnapshot !== undefined)
    result.error.retainDiagnostics({
      analysis_snapshot: { ...publishedSnapshot },
    });
  if (outcome.cleanupError !== undefined) {
    // A committed snapshot remains published even when final close fails.
    if (result.ok && publishedSnapshot !== undefined)
      outcome.cleanupError.retainDiagnostics({
        analysis_snapshot: { ...publishedSnapshot },
      });
    return err(
      directAnalysisCleanupFailure(result, outcome.cleanupError, path),
    );
  }
  return result.ok ? ok(result.value) : err(cliError(result.error, path));
};

const executeAnalysisTool = async (input: {
  readonly session: BinarySession;
  readonly openedTarget: BinaryTarget;
  readonly tool:
    | NativeToolName
    | ArtifactAnalysisOperation
    | ManagedToolName
    | DirectAnalysisTool;
  readonly arguments: Readonly<Record<string, JsonValue>>;
  readonly evidenceParameters: Readonly<Record<string, JsonValue>>;
  readonly signal: AbortSignal;
  readonly evidenceProfile: AnalysisProfileCommitment | undefined;
}): Promise<
  Result<
    {
      readonly evidence: Evidence;
      readonly cachePolicy?: "live";
    },
    AnalysisError
  >
> => {
  const { session, tool, signal, evidenceProfile } = input;
  if (tool === "analyze_function") {
    const { executeFunctionAnalysisEvidence } =
      await import("./FunctionAnalysisEvidence.js");
    let result = await executeFunctionAnalysisEvidence(
      session,
      input.arguments,
      input.openedTarget,
      { signal },
    );
    result = retainAnalysisResultSources(
      tool,
      (source) => session.recordEvidence(source),
      result,
    );
    return result.ok ? ok({ evidence: result.value }) : result;
  }
  if (isWorkflowEvidenceTool(tool)) {
    const { EnhancedTools } = await import("./EnhancedTools.js");
    let result = await executeComposedWorkflow(
      session,
      (observed) =>
        new EnhancedTools(observed).execute(tool, input.arguments, signal),
      composedLimitationBudget(tool),
    );
    result = retainAnalysisResultSources(
      tool,
      (source) => session.recordEvidence(source),
      result,
    );
    if (!result.ok) return result;
    const evidence = createWorkflowEvidence({
      target: input.openedTarget,
      operation: tool,
      parameters: input.evidenceParameters,
      result: result.value.result,
      upstreamProfile: evidenceProfile,
      upstreamLimitations: result.value.limitations,
      ...(result.value.evidenceLinks === undefined
        ? {}
        : { upstreamEvidenceLinks: result.value.evidenceLinks }),
    });
    return ok({
      evidence,
      ...(result.value.cachePolicy === undefined
        ? {}
        : { cachePolicy: result.value.cachePolicy }),
    });
  }
  let result = await session.execute(tool, input.arguments, { signal });
  if (
    tool === "xrefs" &&
    typeof input.arguments.address === "string" &&
    !result.ok &&
    result.error instanceof AnalysisInputError &&
    !result.error.cleanupIncomplete &&
    result.error.issues.length > 0 &&
    result.error.issues.every(
      ({ path, reason }) =>
        path.length === 1 &&
        path[0] === "address" &&
        reason === "invalid_format",
    )
  ) {
    const address = await resolveXrefsAddress(
      session,
      input.arguments.address,
      signal,
    );
    if (!address.ok) return address;
    if (address.value !== input.arguments.address)
      result = await session.execute(
        tool,
        { ...input.arguments, address: address.value },
        { signal },
      );
  }
  if (!result.ok) return result;
  const evidence = createAnalysisExecutionEvidence(
    tool,
    input.evidenceParameters,
    {
      ...result.value,
      subject:
        result.value.subject === undefined
          ? input.openedTarget
          : result.value.subject,
    },
    "observed",
  );
  return ok({ evidence });
};

const withProcessCancellation = async <Value>(
  suppliedSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<Value>,
): Promise<Value> => {
  if (suppliedSignal !== undefined) return operation(suppliedSignal);
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  // Package runners can forward a terminal interrupt after REA already received
  // it directly. Keep both guards installed until provider cleanup has settled.
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    return await operation(controller.signal);
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
};

const prepareSnapshot = async (options: {
  readonly session: Pick<
    BinarySession,
    "readAnalysisSnapshot" | "resolveTarget"
  >;
  readonly path: string;
  readonly formatHint?: ExecutableFormatHint;
  readonly architecture?: BinaryArchitecture;
  readonly entryPoint?: string;
  readonly espFlash?: EspFlashSelection;
  readonly snapshotPath: string | undefined;
  readonly signal: AbortSignal;
}): Promise<
  Result<
    { readonly snapshot?: AnalysisSnapshot; readonly target?: BinaryTarget },
    AnalysisError
  >
> => {
  const { path, snapshotPath, session } = options;
  if (snapshotPath === undefined || !(await fileExists(snapshotPath)))
    return ok({});
  const loaded = await session.readAnalysisSnapshot(
    snapshotPath,
    options.signal,
  );
  if (!loaded.ok) return loaded;
  const target = await session.resolveTarget(path, {
    signal: options.signal,
    ...targetSelection(options),
  });
  if (!target.ok) return target;
  if (!snapshotMatchesTarget(loaded.value.target, target.value))
    return err(
      new AnalysisSnapshotMismatchError(
        "Analysis snapshot target does not match the requested binary",
      ),
    );
  return ok({ snapshot: loaded.value, target: target.value });
};

const inspectBundleResourceInput = async (
  path: string,
): Promise<Result<boolean, BinaryTargetError>> => {
  const callerPath = absoluteCallerPath(path);
  try {
    return ok((await stat(callerPath)).isDirectory());
  } catch (cause: unknown) {
    const failure = classifyBinaryTargetFilesystemFailure(callerPath, cause);
    if (failure !== undefined) return err(failure);
    throw cause;
  }
};

const analysisProfileForRoute = (
  route: SessionProviderRoute,
  tool:
    | NativeToolName
    | ArtifactAnalysisOperation
    | ManagedToolName
    | DirectAnalysisTool,
): AnalysisProfileCommitment | undefined => {
  const profile = route.profile;
  const nativeDispatchProfile =
    profile === null || profile === undefined
      ? nativeDispatchBindingProfile(route, tool)
      : undefined;
  if (profile === null || profile === undefined) {
    if (nativeDispatchProfile === undefined) return undefined;
    return isWorkflowEvidenceTool(tool)
      ? workflowAnalysisProfile(nativeDispatchProfile, tool)
      : nativeDispatchProfile;
  }
  if (isWorkflowEvidenceTool(tool))
    return workflowAnalysisProfile(profile, tool);
  const provider = routeProviderIdentity(route, tool);
  return provider.id === profile.provider.id ? profile : undefined;
};

const nativeDispatchBindingProfile = (
  route: SessionProviderRoute,
  operation: string,
): AnalysisProfileCommitment | undefined => {
  if (operation !== "inspect_native_dispatch_metadata") return undefined;
  return profilelessNativeDispatchProfile(route);
};

const analysisProfileForEvidence = (
  session: BinarySession,
  tool:
    | NativeToolName
    | ArtifactAnalysisOperation
    | ManagedToolName
    | DirectAnalysisTool,
): AnalysisProfileCommitment | undefined => {
  if (!isWorkflowEvidenceTool(tool)) return session.analysisProfile(tool);
  return session.analysisProfile() ?? session.analysisProfile(tool);
};

const isWorkflowEvidenceTool = (
  tool:
    | NativeToolName
    | ArtifactAnalysisOperation
    | ManagedToolName
    | DirectAnalysisTool,
): tool is Exclude<
  Extract<DirectAnalysisTool, EnhancedToolName>,
  "analyze_function"
> =>
  tool === "binary_overview" ||
  tool === "inspect_native_api" ||
  tool === "inspect_native_dispatch_metadata" ||
  tool === "trace_feature" ||
  tool === "trace_native_values" ||
  tool === "trace_native_ui_action" ||
  tool === "decompile_all";

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch (cause: unknown) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      return false;
    throw cause;
  }
};

const cliError = (
  error: AnalysisError,
  callerInputPath?: string,
): JsonValue => ({
  error: "Analysis failed",
  ...(callerInputPath === undefined
    ? projectAnalysisError(error)
    : projectDirectAnalysisFailure(error, callerInputPath)),
});
