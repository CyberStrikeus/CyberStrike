import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { fileURLToPath } from "node:url";
import { accessSync, constants, statSync } from "node:fs";

import { createAnalysisExecution } from "../application/AnalysisProvider.js";
import type {
  AnalysisClient,
  AnalysisOperation,
  AnalysisClientContext,
  AnalysisProfileResolutionOptions,
  AnalysisProviderCandidate,
  CapabilityDescriptor,
  ProviderAvailability,
  ProviderIdentity,
  ProviderTargetSupport,
  RetainedResourceScope,
} from "../application/AnalysisProvider.js";
import type { AnalysisProfileCommitment } from "../domain/analysisProfile.js";
import type { AppConfig } from "../config/types.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { Logger } from "pino";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCapabilityUnavailableError } from "../domain/analysisErrorCore.js";
import { err, ok } from "../domain/result.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { HopperApplicationLauncher } from "./BridgeLauncher.js";
import {
  hopperDeclinedArchitectureReason,
  hopperLoaderArgsForTarget,
  isHopperDeclinedArchitecture,
  resolveHopperAnalysisProfile,
} from "./HopperAnalysisProfile.js";
import { mapHopperFileOffset } from "./HopperFileOffset.js";
import { HopperRegexSearch } from "./HopperRegexSearch.js";
import { HopperClient } from "./HopperClient.js";
import { projectHopperNameInventory } from "./HopperNameInventory.js";
import { hopperMachOImageSchema } from "./HopperMachOImage.js";
import {
  reconcileHopperCallers,
  reconciliationChildOptions,
} from "./HopperCallerReconciliation.js";
import { analysisClientFailureForOperation } from "../providers/AnalysisClientFailure.js";

import {
  hopperCapabilities,
  HOPPER_PROVIDER_IDENTITY,
} from "./HopperProviderCapabilities.js";

/** Concrete analysis provider backed by REA's private Hopper bridge. */
export class HopperProvider implements AnalysisProviderCandidate {
  private readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly #launcherPath: string;
  readonly #ownedResources = new ArtifactResourceScope();
  readonly #inspectionOwner: RetainedResourceScope = {
    retain: (owner, resource) =>
      this.#ownedResources.retain({
        kind: "lease",
        resource,
        lease: AnalysisCleanupLease.forCloseOwner(owner, resource),
      }),
    run: (operation) => this.#ownedResources.run(operation),
  };

  /**
   * Host platform, injected so availability and launch-mode decisions can be
   * exercised for any host rather than only the machine running the suite.
   * Mirrors `GhidraProvider`, which already threads its installation host's
   * platform the same way.
   */
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    environment: Readonly<NodeJS.ProcessEnv>,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.environment = snapshotEnvironment(environment, platform);
    // Bind lookup once; retain config's selected spelling for diagnostics.
    this.#launcherPath = absoluteCallerPath(config.hopperLauncherPath);
  }

  identity(): ProviderIdentity {
    return HOPPER_PROVIDER_IDENTITY;
  }

  capabilities(): readonly CapabilityDescriptor[] {
    return hopperCapabilities(
      this.config.regexMatchingDeadline,
      this.config.regexWorkerHeapRequest,
    );
  }

  inspectAvailability(): ProviderAvailability {
    const diagnostics = {
      launcher_path: this.config.hopperLauncherPath,
      platform: this.platform,
    };
    if (this.platform !== "darwin" && this.platform !== "linux")
      return {
        status: "unavailable",
        code: "unsupported_host",
        reason: `Hopper integration is not supported on ${this.platform}.`,
        diagnostics,
      };
    try {
      accessSync(this.#launcherPath, constants.X_OK);
      // A searchable directory, such as an .app bundle, also passes X_OK.
      if (!statSync(this.#launcherPath).isFile())
        throw new TypeError("Hopper launcher is not a regular file");
      return {
        status: "available",
        code: null,
        reason: null,
        diagnostics,
      };
    } catch (cause: unknown) {
      // best-effort cleanup: optional launcher probing; failure means unavailable.
      void cause;
      return {
        status: "unavailable",
        code: "executable_missing",
        reason: `Hopper launcher is missing or not executable: ${this.config.hopperLauncherPath}`,
        diagnostics,
      };
    }
  }

  inspectTargetSupport(target: BinaryTarget): ProviderTargetSupport {
    const diagnostics = {
      target_kind: target.kind,
      target_format: target.format,
      architecture: target.architecture ?? null,
    };
    if (target.kind !== "executable" && target.kind !== "database")
      return {
        status: "unsupported",
        code: "target_kind_unsupported",
        reason: `Hopper cannot directly analyze ${target.kind} targets.`,
        diagnostics,
      };
    if (target.kind === "database" && this.platform === "darwin")
      return {
        status: "unsupported",
        code: "target_kind_unsupported",
        reason:
          "This Hopper macOS launcher cannot start REA's analysis bridge when opening a saved Hopper database. Open an executable target instead; saved-database analysis is unavailable until Hopper exposes a database launch route that runs the bridge script.",
        diagnostics,
      };
    if (target.kind === "database")
      return {
        status: "supported",
        code: null,
        reason: null,
        diagnostics,
      };
    if (target.format === "gamecube-dol")
      return {
        status: "unsupported",
        code: "target_format_unsupported",
        reason:
          "GameCube DOL analysis requires the Ghidra adapter with a caller-selected gamecube-dol format.",
        diagnostics,
      };
    if (isHopperDeclinedArchitecture(target.architecture))
      return {
        status: "unsupported",
        code: "architecture_unsupported",
        reason: hopperDeclinedArchitectureReason(target.architecture),
        diagnostics,
      };
    if (target.format === "raw-binary")
      return {
        status: "unsupported",
        code: "target_format_unsupported",
        reason:
          "Headerless raw-binary analysis requires the Ghidra adapter with a caller-supplied architecture and entry point.",
        diagnostics,
      };
    if (target.format === "dos-mz" || target.format === "dos-com")
      return {
        status: "unsupported",
        code: "target_format_unsupported",
        reason:
          "DOS MZ/COM analysis requires the Ghidra 16-bit real-mode adapter.",
        diagnostics,
      };
    return {
      status: "supported",
      code: null,
      reason: null,
      diagnostics,
    };
  }

  resolveAnalysisProfile(
    target: BinaryTarget,
    options?: AnalysisProfileResolutionOptions,
  ) {
    const resourceScope = options?.resourceScope ?? this.#inspectionOwner;
    return resolveHopperAnalysisProfile(target, {
      launcherPath: this.#launcherPath,
      loaderArgsOverride: this.config.hopperLoaderArgs,
      provider: HOPPER_PROVIDER_IDENTITY,
      resourceScope,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  hasPendingOwnedResources(): boolean {
    return this.#ownedResources.hasPending;
  }

  async closeOwnedResources() {
    try {
      await this.#ownedResources.close();
      return ok(null);
    } catch (cause: unknown) {
      const failure = new ProviderCleanupError(
        HOPPER_PROVIDER_IDENTITY.id,
        this.#ownedResources.cleanupResources,
        { reason: cause instanceof Error ? cause.message : String(cause) },
        { cause, operation: "close_owned_resources" },
      );
      bindArtifactFileCleanup(cause, failure);
      return err(failure);
    }
  }

  createClient(
    target: BinaryTarget,
    profile?: AnalysisProfileCommitment,
    context?: AnalysisClientContext,
  ): AnalysisClient {
    if (target.kind !== "executable" && target.kind !== "database")
      return {
        execute: (operation) =>
          Promise.resolve(
            err(
              new AnalysisCapabilityUnavailableError(
                HOPPER_PROVIDER_IDENTITY.id,
                operation,
                `Hopper cannot open ${target.kind} targets directly. Inventory or extract the artifact first.`,
              ),
            ),
          ),
        close: () => Promise.resolve(ok(null)),
      };
    const preparation = profile?.parameters.prepared_image;
    const parsedImage =
      preparation === undefined
        ? undefined
        : hopperMachOImageSchema.safeParse(preparation);
    if (parsedImage?.success === false)
      return {
        execute: (operation) =>
          Promise.resolve(
            err(
              new AnalysisCapabilityUnavailableError(
                HOPPER_PROVIDER_IDENTITY.id,
                operation,
                "Hopper prepared-image profile is malformed; resolve the analysis profile again.",
              ),
            ),
          ),
        close: () => Promise.resolve(ok(null)),
      };
    const preparedImage = parsedImage?.data;
    const container =
      preparedImage === undefined
        ? profile?.parameters.macho_container
        : "thin";
    const derivedLoaderArgs = hopperLoaderArgsForTarget(
      target,
      container === "thin" || container === "fat32" || container === "fat64"
        ? container
        : undefined,
    );
    if (!derivedLoaderArgs.ok)
      return {
        execute: () => Promise.resolve(err(derivedLoaderArgs.error)),
        close: () => Promise.resolve(ok(null)),
      };
    const executionProvider = profile?.provider ?? HOPPER_PROVIDER_IDENTITY;
    const client = new HopperClient({
      launcher: new HopperApplicationLauncher({
        environment: this.environment,
        launcherPath: this.#launcherPath,
        targetPath: target.path,
        targetKind: target.kind,
        ...(target.kind === "executable"
          ? { targetSha256: target.sha256 }
          : {}),
        ...(preparedImage === undefined
          ? {}
          : {
              preparedImage: {
                image: preparedImage,
                sourceSha256: target.sha256,
              },
            }),
        loaderArgs:
          this.config.hopperLoaderArgs.length > 0
            ? this.config.hopperLoaderArgs
            : derivedLoaderArgs.value,
        bridgeScriptPath: fileURLToPath(
          new URL("../../bridge/hopper_bridge.py", import.meta.url),
        ),
        bridgeMaxRequestBytes: this.config.bridgeMaxRequestBytes,
        ...(this.platform === "linux"
          ? {
              launchMode: "verified_linux_demo" as const,
              demoHelperPath: fileURLToPath(
                new URL("../../scripts/hopper-demo-x11.py", import.meta.url),
              ),
            }
          : { launchMode: "native" as const }),
      }),
      ...(context === undefined ? {} : { runId: context.runId }),
      startupTimeoutMs: this.config.hopperStartupTimeoutMs,
      readStartupTimeoutMs: () => this.config.hopperStartupTimeoutMs,
      bridgeMaxRequestBytes: this.config.bridgeMaxRequestBytes,
      logger: this.logger.child({ layer: "bridge" }),
      onDiagnostic: (diagnostic) =>
        this.logger.info(diagnostic, "Hopper bridge reported a diagnostic"),
    });
    const regexSearch = new HopperRegexSearch(
      client,
      this.config.regexMatchingDeadline,
      this.config.regexWorkerHeapRequest,
    );
    const sourceReads = new ArtifactResourceScope();
    const sourceLeases = new WeakMap<OwnedFileHandle, AnalysisCleanupLease>();
    const retainSourceDescriptor = (owner: OwnedFileHandle): void => {
      const lease = AnalysisCleanupLease.forCloseOwner(owner, target.path);
      sourceLeases.set(owner, lease);
      sourceReads.retain({
        kind: "lease",
        resource: target.path,
        lease,
      });
    };
    const projectExecution = (
      operation: AnalysisOperation,
      normalized: JsonValue,
      rawResult: JsonValue | null = null,
      reconciliationReason?: string,
    ) =>
      createAnalysisExecution(normalized, executionProvider, {
        // Retain the source reply when an adapter-owned projection changes it.
        rawResult,
        ...(reconciliationReason === undefined
          ? {}
          : { cachePolicy: "live" as const }),
        ...(profile === undefined ? {} : { analysisProfile: profile }),
        ...(operation === "procedure_callers" ||
        operation === "procedure_callees" ||
        operation === "analyze_function"
          ? {
              relationshipCoverage: {
                status: "unknown" as const,
                limited_directions:
                  operation === "procedure_callers"
                    ? (["callers"] as const)
                    : operation === "procedure_callees"
                      ? (["callees"] as const)
                      : (["callers", "callees"] as const),
                reason:
                  reconciliationReason ??
                  "Hopper reports caller and callee procedures through independent public API inventories. Their completeness, including resolved tail calls and agreement between reverse and forward relationships, has not been established. Observed relationships are retained.",
              },
            }
          : {}),
        limitations: [
          ...(reconciliationReason === undefined ||
          operation !== "procedure_references"
            ? []
            : [reconciliationReason]),
          ...(target.kind !== "executable"
            ? []
            : [
                preparedImage === undefined
                  ? "REA loaded a digest-verified private executable copy. Evidence identifies the selected original source; Hopper document names describe the private image. The owned image and its Hopper document close together."
                  : "REA loaded a verified thin Mach-O image prepared from the original source. Identity and file offsets refer to the original file. The owned temporary image and its Hopper document close together, including on MCP shutdown.",
              ]),
          ...(this.capabilities().find(
            (descriptor) => descriptor.operation === operation,
          )?.limitations ?? []),
          ...(operation === "read_bytes"
            ? [
                "Hopper byte reads stop at the containing segment's exclusive end; a readable prefix is returned with complete=false when the requested range crosses it.",
              ]
            : []),
          ...(operation === "procedure_references"
            ? [
                "Native CallReference classifications and unresolved targets are preserved. Detailed reference flags and coverage beyond reported CallReference objects remain unknown.",
              ]
            : []),
        ],
      });
    return {
      execute: async (operation, parameters, options) => {
        try {
          return await sourceReads.run(async () => {
            const willReconcile =
              operation === "procedure_callers" ||
              operation === "analyze_function" ||
              (operation === "procedure_references" &&
                parameters.direction === "incoming");
            const result =
              (operation === "search_strings" ||
                operation === "search_procedures") &&
              parameters.mode === "regex"
                ? await regexSearch.execute(operation, parameters, options)
                : await client.callTool(
                    operation === "procedure_callers"
                      ? "rea_caller_base"
                      : operation,
                    parameters,
                    willReconcile
                      ? reconciliationChildOptions(options)
                      : options,
                  );
            if (!result.ok)
              return operation === "procedure_callers"
                ? err(
                    analysisClientFailureForOperation(
                      result.error,
                      "hopper",
                      operation,
                    ),
                  )
                : result;
            const mapped =
              operation === "address_to_file_offset"
                ? await mapHopperFileOffset(target, result.value, {
                    ...(options?.signal === undefined
                      ? {}
                      : { signal: options.signal }),
                    retainFailedClose: retainSourceDescriptor,
                    onCleanupMarker: (marker) => {
                      if (!(marker.cause instanceof RegularFileCleanupFailure))
                        return;
                      sourceLeases
                        .get(marker.cause.owner)
                        ?.bindCleanupError(marker);
                    },
                  })
                : result;
            if (!mapped.ok) return mapped;
            const reconciled =
              operation === "procedure_callers" ||
              operation === "analyze_function" ||
              (operation === "procedure_references" &&
                parameters.direction === "incoming")
                ? await reconcileHopperCallers(
                    client,
                    operation,
                    parameters,
                    mapped.value,
                    options,
                    this.config.hopperCallerScanBudget,
                  )
                : undefined;
            if (reconciled !== undefined && !reconciled.ok) return reconciled;
            const reconciledResult = reconciled?.value.result ?? mapped.value;
            const inventory =
              operation === "list_names"
                ? projectHopperNameInventory(reconciledResult)
                : { result: reconciledResult, changed: false };
            return ok(
              projectExecution(
                operation,
                inventory.result,
                reconciled?.value.rawResult ??
                  (inventory.changed || mapped !== result
                    ? result.value
                    : null),
                reconciled?.value.reason,
              ),
            );
          });
        } catch (cause: unknown) {
          if (!(cause instanceof ArtifactReaderFailure)) throw cause;
          return err(hopperSourceCleanupError(cause, operation));
        }
      },
      executeIfReady: async (operation, parameters, options) => {
        if (operation !== "list_documents" && operation !== "list_procedures")
          return undefined;
        const result = await client.callToolIfReady(
          operation,
          parameters,
          options?.signal === undefined ? {} : { signal: options.signal },
        );
        if (result === undefined || !result.ok) return result;
        return ok(projectExecution(operation, result.value));
      },
      runtimeLineageSnapshots: () => {
        const observation = client.runtimeLineage();
        return observation === null
          ? []
          : [{ provider: executionProvider, observation }];
      },
      requestActivitySnapshots: () => {
        const activity = client.requestActivity();
        return [
          {
            provider: executionProvider,
            active:
              activity === null
                ? null
                : {
                    requestId: activity.requestId,
                    operation: activity.operation,
                    elapsedMs: activity.elapsedMs,
                    callerState: activity.callerState,
                  },
            queuedRequests: activity?.queuedRequests ?? 0,
          },
        ];
      },
      operationHealthSnapshot: () => client.operationHealth(),
      close: async (options) => {
        await regexSearch.close();
        let descriptors: AnalysisError | undefined;
        try {
          await sourceReads.retryCleanup();
        } catch (cause: unknown) {
          if (!(cause instanceof ArtifactReaderFailure)) throw cause;
          descriptors = hopperSourceCleanupError(cause, "close_binary");
        }
        const closed = await client.close(options);
        if (descriptors === undefined) return closed;
        return closed.ok
          ? err(descriptors)
          : err(
              analysisErrorWithCleanupFailure(
                closed.error,
                descriptors,
                "close_binary",
              ).bindCleanupDependencies([closed.error, descriptors]),
            );
      },
    };
  }
}

/** Report descriptor cleanup that is still owned by this Hopper client. */
const hopperSourceCleanupError = (
  cause: ArtifactReaderFailure,
  operation: string,
): AnalysisError => {
  const leases = cause.cleanupLeases ?? [];
  const failure = new ProviderCleanupError(
    HOPPER_PROVIDER_IDENTITY.id,
    cause.cleanup?.resources ?? [
      ...new Set(leases.flatMap((lease) => lease.cleanupResources ?? [])),
    ],
    { reason: cause.cleanup?.reason ?? cause.message },
    { operation, cause },
  );
  bindArtifactFileCleanup(cause, failure);
  return failure;
};
