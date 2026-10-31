import { parseEspFlashAddress } from "../domain/firmware/espFlashSelection.js";
import { registerNativeFunctionMatchingTool } from "./registerNativeFunctionMatchingTool.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { workflowUnknownInput } from "../application/investigation/WorkflowUnknown.js";

import {
  getNavigationContext,
  inspectAddressContext,
} from "../application/AnalysisContextQueries.js";
import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import { createProcessCaptureEvidence } from "../application/process/ProcessEvidence.js";
import { captureProcessScenario } from "../process/capture/ProcessHarness.js";
import { ProcessCaptureResourceScope } from "../process/capture/ProcessCaptureLifecycle.js";
import { ProcessCaptureError } from "../process/capture/ProcessCaptureError.js";
import { toolContract } from "../contracts/toolContracts.js";
import { binaryTargetSummary } from "../application/binary/BinaryTargetSummary.js";
import { UnknownRegistryError } from "../domain/unknownRegistryError.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Evidence } from "../domain/evidence.js";
import type { ProcessCapture } from "../domain/process/processCaptureParsing.js";
import { err, ok, type Result } from "../domain/result.js";
import type { Logger } from "pino";
import type { ProviderAvailability } from "../application/AnalysisProvider.js";
import { mcpProgressReporter } from "./mcpProgress.js";
import { registerArtifactComparisonTool } from "./registerArtifactComparisonTool.js";
import { registerBundleComparisonTool } from "./registerBundleComparisonTool.js";
import { registerCloseLifecycleTool } from "./registerCloseLifecycleTool.js";
import { registerFunctionComparisonTool } from "./registerFunctionComparisonTool.js";
import { registerInvestigationTools } from "./registerInvestigationTools.js";
import { registerProcessComparisonTool } from "./registerProcessComparisonTool.js";
import {
  registerEvidenceTools,
  registerUnknownTools,
} from "./registerSessionRecordTools.js";
import {
  registerSessionStatusTool,
  type SessionAvailabilityProbes,
} from "./registerSessionStatusTool.js";
import { sessionAvailabilityPolicy } from "./sessionAvailabilityPolicy.js";
import type { AvailabilityPolicy } from "../application/CapabilityInventory.js";
import { logToolExecution } from "./toolLogging.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import { withAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";

const recordProcessResidualUnknowns = (
  session: BinarySessionPort,
  evidence: Evidence,
  residuals: ProcessCapture["residual_unknowns"],
): Result<null, AnalysisError> => {
  for (const residual of residuals) {
    const input = workflowUnknownInput(evidence.evidence_id, {
      question: `Was ${residual.scope} behavior fully observed during capture?`,
      severity: "medium",
      domain: `process-${residual.scope}`,
      required_authority: "controlled-replay",
      required_confidence: "observed",
      required_environment: evidence.environment,
      recommended_probes: [
        {
          operation: "capture_process_scenario",
          rationale:
            "Repeat with a scenario that observes the missing behavior.",
        },
      ],
      relationships: [],
    });
    if (!input.ok) return input;
    const unknown = session.recordUnknown(input.value);
    if (
      !unknown.ok &&
      !(
        unknown.error instanceof UnknownRegistryError &&
        unknown.error.reason === "already-exists"
      )
    )
      return unknown;
  }
  return ok(null);
};

interface ProcessToolRegistration {
  readonly server: EvidenceMcpServer;
  readonly session: BinarySessionPort;
  readonly logger: Logger;
  readonly captureContract: ReturnType<
    typeof toolContract<"capture_process_scenario">
  >;
  readonly resourceScope: ProcessCaptureResourceScope;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
}

const registerProcessTools = ({
  server,
  session,
  logger,
  captureContract,
  resourceScope,
  environment,
}: ProcessToolRegistration): void => {
  const admission = withAdmittedAnalysis({ kind: "session", session });
  server.registerTool(
    captureContract.name,
    toolRegistrationOptions(captureContract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        admission,
        captureContract.name,
        context.mcpReq.signal,
        async () => {
          const progress = mcpProgressReporter(context);
          const captured = await logToolExecution(
            logger,
            captureContract.name,
            () =>
              captureProcessScenario(
                input,
                context.mcpReq.signal,
                process.platform,
                environment,
                undefined,
                undefined,
                progress,
                resourceScope,
              ),
          );
          if (!captured.ok)
            return server.delivery.toCallToolResult(captured, captureContract);
          const evidence = createProcessCaptureEvidence(input, captured.value);
          const recorded = session.recordEvidence(evidence);
          if (!recorded.ok)
            return server.delivery.toCallToolResult(recorded, captureContract);
          const unknowns = recordProcessResidualUnknowns(
            session,
            evidence,
            captured.value.residual_unknowns,
          );
          if (!unknowns.ok)
            return server.delivery.toCallToolResult(unknowns, captureContract);
          return server.delivery.toEvidenceToolResult(
            evidence,
            captureContract,
            recorded,
          );
        },
      ),
  );
};

export interface LifecycleToolRegistration extends SessionAvailabilityProbes {
  readonly server: EvidenceMcpServer;
  readonly session: BinarySessionPort;
  readonly logger: Logger;
  readonly openContract: ReturnType<typeof toolContract<"open_binary">>;
  readonly closeContract: ReturnType<typeof toolContract<"close_binary">>;
  readonly statusContract: ReturnType<typeof toolContract<"binary_session">>;
  readonly startedAt: string;
  readonly availabilityPolicy: () => AvailabilityPolicy;
  readonly closeProcessResources: () => Promise<Result<null, AnalysisError>>;
}

const registerLifecycleTools = (
  registration: LifecycleToolRegistration,
): void => {
  registerOpenLifecycleTool(registration);
  registerCloseLifecycleTool(registration);
  registerSessionStatusTool({
    ...registration,
    contract: registration.statusContract,
  });
};

const registerOpenLifecycleTool = ({
  server,
  session,
  logger,
  openContract,
}: LifecycleToolRegistration): void => {
  server.registerTool(
    openContract.name,
    toolRegistrationOptions(openContract),
    async (input, context) => {
      const snapshotPath = input.snapshot_path;
      const opened = await logToolExecution(logger, openContract.name, () =>
        session.open(input.path, {
          signal: context.mcpReq.signal,
          ...(input.format === undefined ? {} : { formatHint: input.format }),
          ...(input.architecture === undefined
            ? {}
            : { architecture: input.architecture }),
          ...(input.entry_point === undefined
            ? {}
            : { entryPoint: input.entry_point }),
          ...(input.flash_offset === undefined &&
          input.partition_table_offset === undefined
            ? {}
            : {
                espFlash: {
                  ...(input.flash_offset === undefined
                    ? {}
                    : {
                        flashOffset: parseEspFlashAddress(input.flash_offset),
                      }),
                  ...(input.partition_table_offset === undefined
                    ? {}
                    : {
                        partitionTableOffset: parseEspFlashAddress(
                          input.partition_table_offset,
                        ),
                      }),
                },
              }),
          ...(input.provider_id === undefined
            ? {}
            : { providerId: input.provider_id }),
          ...(snapshotPath === undefined
            ? {}
            : {
                // Read inside the open's turn: calls issued after it must not
                // overtake a file read that precedes its place in the order.
                loadSnapshot: () =>
                  session.readAnalysisSnapshot(
                    snapshotPath,
                    context.mcpReq.signal,
                  ),
              }),
        }),
      );
      return opened.ok
        ? server.delivery.toCallToolResult(
            {
              ok: true,
              value: binaryTargetSummary(opened.value),
            },
            openContract,
          )
        : server.delivery.toCallToolResult(opened, openContract);
    },
  );
};

/** Register MCP-only target lifecycle operations on a long-lived session. */
export interface SessionToolOptions extends Partial<SessionAvailabilityProbes> {
  readonly artifactResources: ArtifactResourceScope;
  /** Server environment snapshot that process capture resolves and inherits. */
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly startedAt?: string;
  readonly availabilityPolicy?: () => AvailabilityPolicy;
}

const registerContextTools = (
  server: EvidenceMcpServer,
  session: BinarySessionPort,
): void => {
  const navigationContract = toolContract("get_navigation_context");
  const addressContract = toolContract("inspect_address_context");
  server.registerTool(
    navigationContract.name,
    toolRegistrationOptions(navigationContract),
    async (input, context) => {
      const admitted = await session.withAdmittedAnalysis(
        navigationContract.name,
        context.mcpReq.signal,
        async (analysis) =>
          server.delivery.toCallToolResult(
            await getNavigationContext(analysis, input, context.mcpReq.signal),
            navigationContract,
          ),
      );
      return admitted.ok
        ? admitted.value
        : server.delivery.toCallToolResult(admitted, navigationContract);
    },
  );
  server.registerTool(
    addressContract.name,
    toolRegistrationOptions(addressContract),
    async (input, context) => {
      const admitted = await session.withAdmittedAnalysis(
        addressContract.name,
        context.mcpReq.signal,
        async (analysis) =>
          server.delivery.toCallToolResult(
            await inspectAddressContext(analysis, input, context.mcpReq.signal),
            addressContract,
          ),
      );
      return admitted.ok
        ? admitted.value
        : server.delivery.toCallToolResult(admitted, addressContract);
    },
  );
};

export const registerSessionTools = (
  server: EvidenceMcpServer,
  session: BinarySessionPort,
  logger: Logger,
  options: SessionToolOptions,
): void => {
  const openContract = toolContract("open_binary");
  const openBundleResourcesContract = toolContract("open_bundle_resources");
  const closeContract = toolContract("close_binary");
  const statusContract = toolContract("binary_session");
  const exportContract = toolContract("export_evidence_bundle");
  const importContract = toolContract("import_evidence_bundle");
  const captureContract = toolContract("capture_process_scenario");
  const compareContract = toolContract("compare_process_captures");
  const compareArtifactsContract = toolContract("compare_artifacts");
  const compareFunctionsContract = toolContract("compare_functions");
  const compareBundlesContract = toolContract("compare_bundles");
  const snapshotContract = toolContract("get_evidence_bundle");
  const processResources = new ProcessCaptureResourceScope();
  server.registerTool(
    openBundleResourcesContract.name,
    toolRegistrationOptions(openBundleResourcesContract),
    async (input, context) => {
      const opened = await logToolExecution(
        logger,
        openBundleResourcesContract.name,
        () =>
          session.openBundleResources(input.path, {
            signal: context.mcpReq.signal,
          }),
      );
      if (!opened.ok)
        return server.delivery.toCallToolResult(
          opened,
          openBundleResourcesContract,
        );
      const root = opened.value;
      return server.delivery.toCallToolResult(
        {
          ok: true,
          value: {
            caller_path: root.callerPath,
            canonical_path: root.canonicalPath,
            info_plist_path: root.infoPlistPath,
            layout: root.layout,
            executable_sha256: root.executableSha256,
          },
        },
        openBundleResourcesContract,
      );
    },
  );
  registerLifecycleTools({
    ...options,
    server,
    session,
    logger,
    openContract,
    closeContract,
    statusContract,
    startedAt: options.startedAt ?? new Date().toISOString(),
    availabilityPolicy: sessionAvailabilityPolicy(
      options.availabilityPolicy,
      {},
    ),
    androidAnalysisAvailability:
      options.androidAnalysisAvailability ?? missingAndroidAvailability,
    closeProcessResources: async () => {
      try {
        await processResources.retryCleanup();
        return ok(null);
      } catch (cause: unknown) {
        if (cause instanceof AnalysisError) return err(cause);
        return err(
          new ProcessCaptureError(
            "process capture cleanup remains incomplete",
            {
              cause,
              reason: "cleanup_incomplete",
              cleanup: {
                reason: "process capture cleanup remains incomplete",
                resources: ["process_capture_resources"],
              },
              executionFailure:
                cause instanceof Error
                  ? cause.message || cause.name
                  : String(cause),
            },
          ),
        );
      }
    },
  });
  registerEvidenceTools({
    server,
    session,
    resources: options.artifactResources,
    exportContract,
    importContract,
    snapshotContract,
  });
  registerProcessTools({
    server,
    session,
    logger,
    captureContract,
    resourceScope: processResources,
    environment: options.environment,
  });
  const closeServer = server.close.bind(server);
  server.close = async () => {
    const results = await Promise.allSettled([
      closeServer(),
      processResources.close(),
    ]);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, "REA session cleanup failed");
  };
  const previousOnclose = server.server.onclose;
  server.server.onclose = () => {
    try {
      previousOnclose?.();
    } finally {
      void processResources.close().catch((cause: unknown) => {
        logger.error(
          { error: cause instanceof Error ? cause.message : String(cause) },
          "Process capture cleanup failed during server shutdown",
        );
      });
    }
  };
  registerProcessComparisonTool(server, session, compareContract);
  registerArtifactComparisonTool(
    server,
    session,
    compareArtifactsContract,
    options.artifactResources,
  );
  registerFunctionComparisonTool(server, session, compareFunctionsContract);
  registerNativeFunctionMatchingTool(
    server,
    session,
    logger,
    options.environment,
  );
  registerBundleComparisonTool(
    server,
    session,
    compareBundlesContract,
    options.artifactResources,
  );
  registerInvestigationTools(server, session);
  registerUnknownTools({ server, session });
  registerContextTools(server, session);
};

const missingAndroidAvailability = async (): Promise<ProviderAvailability> => ({
  status: "unavailable",
  code: "not_configured",
  reason:
    "Set REA_JADX_MCP_JAR to a caller-supplied jadx-headless-mcp 0.7.1 JAR and provide a full JDK on Linux, macOS, or Windows x64 with its matching bundled native controls.",
  diagnostics: { configured: false },
});
