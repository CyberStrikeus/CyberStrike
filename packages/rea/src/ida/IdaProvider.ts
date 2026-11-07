import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";
import { launchRegexMatchingLimitation } from "../process/RegexMatcher.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import {
  createAnalysisProfile,
  analysisProfilesEqual,
} from "../domain/analysisProfile.js";
import type { AnalysisProfileCommitment } from "../domain/analysisProfile.js";
import {
  isElfMetadataArchitecture,
  type BinaryArchitecture,
  type BinaryTarget,
} from "../domain/binaryTargetTypes.js";
import { err, ok } from "../domain/result.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type {
  AnalysisClient,
  AnalysisProviderBoundClientFactory,
  AnalysisProviderInspectionOptions,
  AnalysisProfileResolutionOptions,
  AnalysisProviderReadinessSnapshot,
  CapabilityDescriptor,
  AnalysisProviderCandidate,
  ProviderAvailability,
  ProviderTargetSupport,
  RetainedResourceScope,
} from "../application/AnalysisProvider.js";
import type { AppConfig } from "../config/types.js";
import type { ConfigurationError } from "../domain/configurationErrors.js";
import { idaRegistrationDigest } from "./IdaRegistrationIdentity.js";
import { isDeepStrictEqual } from "node:util";
import type { Result } from "../domain/result.js";
import {
  readIdaConfiguration,
  idaCompatibilityProfile,
  IDA_COMPATIBILITY_PROFILES,
  type IdaConfiguration,
  idaConfigurationError,
} from "./IdaConfiguration.js";
import {
  createIdaMcpConnection,
  type IdaMcpConnection,
} from "./IdaMcpConnection.js";
import {
  idaCapabilities,
  IDA_PROVIDER_IDENTITY,
} from "./IdaProviderCapabilities.js";
import { IdaSessionClient } from "./IdaSessionClient.js";
import { inspectIdaWorkspaceReadiness } from "./IdaWorkspaceReadiness.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { ProviderInspectionScope } from "../application/ProviderInspectionScope.js";
import type { ProviderRejectionCode } from "../domain/providerSelection.js";

/**
 * Families IDA admits today. Every other family is refused, including families
 * that REA recognizes after this list was written.
 */
const IDA_ARCHITECTURES = new Set<BinaryArchitecture>([
  "x86",
  "x86_64",
  "arm",
  "arm64",
]);

/** Bring-your-own IDA MCP candidate; discovery performs no provider startup. */
export class IdaProvider implements AnalysisProviderCandidate {
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
  readonly #registrationByScope = new WeakMap<
    ProviderInspectionScope,
    Promise<Result<IdaConfiguration, ConfigurationError>>
  >();
  private readonly environment: NodeJS.ProcessEnv;
  constructor(
    private readonly config: AppConfig,
    environment: Readonly<NodeJS.ProcessEnv>,
    private readonly connectionFactory: (
      config: IdaConfiguration,
      environment: Readonly<NodeJS.ProcessEnv>,
    ) => IdaMcpConnection = createIdaMcpConnection,
  ) {
    this.environment = snapshotEnvironment(environment);
  }

  identity() {
    return IDA_PROVIDER_IDENTITY;
  }
  capabilities(): readonly CapabilityDescriptor[] {
    const profiles = [
      ...idaCapabilities(
        IDA_COMPATIBILITY_PROFILES.legacy,
        false,
        this.#regexLimitation(),
      ),
      ...idaCapabilities(
        IDA_COMPATIBILITY_PROFILES.native,
        true,
        this.#regexLimitation(),
      ),
      ...idaCapabilities(
        IDA_COMPATIBILITY_PROFILES.modern,
        true,
        this.#regexLimitation(),
      ),
    ];
    const byOperation = new Map<string, (typeof profiles)[number][]>();
    for (const capability of profiles) {
      const existing = byOperation.get(capability.operation) ?? [];
      existing.push(capability);
      byOperation.set(capability.operation, existing);
    }
    return [...byOperation.values()].map((variants): CapabilityDescriptor => {
      const first = variants[0]!;
      const available = variants.some(({ available }) => available);
      const effects = {
        mutatesArtifact: variants.some(
          ({ effects }) => effects.mutatesArtifact,
        ),
        launchesProcess: variants.some(
          ({ effects }) => effects.launchesProcess,
        ),
        mayShowUi: variants.some(({ effects }) => effects.mayShowUi),
        mayAccessNetwork: variants.some(
          ({ effects }) => effects.mayAccessNetwork,
        ),
        mayWriteFilesystem: variants.some(
          ({ effects }) => effects.mayWriteFilesystem,
        ),
        changesPermissions: variants.some(
          ({ effects }) => effects.changesPermissions,
        ),
        requiresRoot: variants.some(({ effects }) => effects.requiresRoot),
      };
      const limitations = [
        ...new Set(variants.flatMap(({ limitations }) => limitations)),
      ];
      const descriptor = {
        provider: first.provider,
        operation: first.operation,
        ...(first.cachePolicy === undefined
          ? {}
          : { cachePolicy: first.cachePolicy }),
        effects,
        limitations,
      };
      return available
        ? { ...descriptor, available: true, reason: null }
        : {
            ...descriptor,
            available: false,
            reason:
              first.reason ??
              "No configured IDA compatibility profile admits this operation.",
          };
    });
  }
  hasPendingOwnedResources() {
    return this.#ownedResources.hasPending;
  }
  async closeOwnedResources() {
    try {
      await this.#ownedResources.close();
      return ok(null);
    } catch (cause: unknown) {
      const failure = new ProviderCleanupError(
        IDA_PROVIDER_IDENTITY.id,
        this.#ownedResources.cleanupResources,
        { cause: cause instanceof Error ? cause.message : String(cause) },
        { cause, operation: "close_owned_resources" },
      );
      bindArtifactFileCleanup(cause, failure);
      return err(failure);
    }
  }
  async inspectAvailability(
    options?: AnalysisProviderInspectionOptions,
  ): Promise<ProviderAvailability> {
    return (await this.inspectReadinessSnapshot(options)).availability;
  }
  async inspectReadinessSnapshot(
    options?: AnalysisProviderInspectionOptions,
  ): Promise<AnalysisProviderReadinessSnapshot> {
    const config = await this.#configuration(options);
    const capabilities = config.ok
      ? idaCapabilities(
          idaCompatibilityProfile(config.value),
          "command" in config.value,
          this.#regexLimitation(),
        )
      : this.capabilities();
    const registrationDiagnostics = {
      configured: this.config.idaMcpConfigPath !== undefined,
      registration_path: this.config.idaMcpConfigPath ?? null,
      live_connection_probed: false,
    };
    const unavailableCapabilities = (
      reason: string,
      code: ProviderRejectionCode,
    ) =>
      capabilities.map((capability) =>
        capability.available
          ? {
              ...capability,
              available: false as const,
              reason,
              availabilityCode: code,
            }
          : capability,
      );
    if (!config.ok) {
      const failure = projectAnalysisError(config.error);
      return {
        availability: {
          status: "unavailable",
          code:
            this.config.idaMcpConfigPath === undefined
              ? "not_configured"
              : "open_options_invalid",
          reason: failure.message,
          diagnostics: {
            ...registrationDiagnostics,
            configuration_details: failure.details ?? null,
            configuration_remediation: failure.remediation.action,
          },
        },
        capabilities: unavailableCapabilities(
          failure.message,
          this.config.idaMcpConfigPath === undefined
            ? "not_configured"
            : "open_options_invalid",
        ),
      };
    }
    if (config.value.mode === "headless") {
      const { privacy, unusable } = await inspectIdaWorkspaceReadiness(
        config.value.workspaceRoot,
      );
      if (!privacy.available)
        return {
          availability: {
            status: "unavailable" as const,
            code: privacy.code,
            reason: privacy.reason,
            diagnostics: {
              ...registrationDiagnostics,
              mode: "headless",
              private_workspace_available: false,
              windows_native_failure: {
                stage: privacy.failureStage,
                remediation: privacy.remediation,
              },
            },
          },
          capabilities: unavailableCapabilities(privacy.reason, privacy.code),
        };
      if (unusable !== undefined)
        return {
          availability: {
            status: "unavailable" as const,
            code: "open_options_invalid" as const,
            reason: unusable,
            diagnostics: {
              ...registrationDiagnostics,
              mode: "headless",
              workspace_root: config.value.workspaceRoot ?? null,
              private_workspace_available: false,
              configuration_remediation:
                "Set workspaceRoot to an existing directory REA can create entries in, or omit it to use the system temporary directory; see docs/ida-provider.md.",
            },
          },
          capabilities: unavailableCapabilities(
            unusable,
            "open_options_invalid",
          ),
        };
    }
    return {
      availability: {
        status: "available" as const,
        code: null,
        reason: null,
        diagnostics: {
          ...registrationDiagnostics,
          mode: config.value.mode,
          transport: "command" in config.value ? "stdio" : "http",
        },
      },
      capabilities,
    };
  }
  inspectTargetSupport(target: BinaryTarget): ProviderTargetSupport {
    const diagnostics = {
      target_kind: target.kind,
      target_format: target.format,
    };
    if (target.format === "gamecube-dol")
      return {
        status: "unsupported",
        code: "target_format_unsupported",
        reason:
          "IDA does not admit caller-selected GameCube DOL images. Open the target with Ghidra and select format gamecube-dol.",
        diagnostics,
      };
    if (target.kind !== "executable")
      return {
        status: "unsupported",
        code: "target_kind_unsupported",
        reason:
          "IDA MCP integration admits executable inputs, not analysis databases. Select the original input binary.",
        diagnostics,
      };
    if (target.format === "raw-binary")
      return {
        status: "unsupported",
        code: "target_format_unsupported",
        reason:
          "IDA does not admit headerless raw binaries. Open the target with Ghidra and supply architecture and entry_point.",
        diagnostics,
      };
    if (!IDA_ARCHITECTURES.has(target.architecture))
      return {
        status: "unsupported",
        code: "architecture_unsupported",
        // Header-declared families that Ghidra admits keep the pointer there.
        reason:
          isElfMetadataArchitecture(target.architecture) ||
          target.architecture === "hexagon"
            ? `REA's IDA adapter has no verified ${target.architecture} lane. Select a supported Ghidra profile instead.`
            : `REA's IDA adapter has no verified ${target.architecture} lane.`,
        diagnostics,
      };
    return target.format === "mach-o-universal"
      ? {
          status: "unknown",
          code: null,
          reason:
            "IDA mode has not been resolved, so universal Mach-O slice identity is unknown.",
          diagnostics,
        }
      : { status: "supported", code: null, reason: null, diagnostics };
  }
  async inspectTargetSupportWithOptions(
    target: BinaryTarget,
    options: AnalysisProviderInspectionOptions,
  ): Promise<ProviderTargetSupport> {
    const base = this.inspectTargetSupport(target);
    if (base.status === "unsupported" || target.format !== "mach-o-universal")
      return base;
    // Attached identity is the recorded whole-input digest, which every slice
    // of a universal file shares, so it cannot prove the GUI loaded the slice
    // admission selected. Headless mode thins that slice into its own input.
    const config = await this.#configuration(options);
    if (!config.ok)
      return {
        status: "unknown",
        code: null,
        reason: "IDA mode could not be resolved from the registration.",
        diagnostics: base.diagnostics,
      };
    if (config.value.mode === "attached")
      return {
        status: "unsupported",
        code: "target_format_unsupported",
        reason: `Attached IDA records only the whole-file digest of a universal Mach-O, so REA cannot verify that the open database is its ${target.architecture} slice. Extract that slice with lipo -thin and open the thin file in both IDA and REA, or use headless mode.`,
        diagnostics: { ...base.diagnostics, mode: "attached" },
      };
    return {
      status: "supported",
      code: null,
      reason: null,
      diagnostics: base.diagnostics,
    };
  }
  async resolveAnalysisProfile(
    target: BinaryTarget,
    options?: AnalysisProfileResolutionOptions,
  ) {
    if (options?.signal?.aborted === true)
      return err(
        new AnalysisCancelledError("ida:profile", {
          cause: options.signal.reason,
        }),
      );
    const config = await this.#configuration(options);
    if (!config.ok) return config;
    const profile = createAnalysisProfile(IDA_PROVIDER_IDENTITY, {
      version_scope: "rea-ida-adapter",
      engine_version: null,
      upstream_distribution_version: null,
      mode: config.value.mode,
      compatibility_profile: idaCompatibilityProfile(config.value).identity,
      database_revision: null,
      cache_policy: "live",
      registration_digest: idaRegistrationDigest(config.value),
    });
    if (options?.scope !== undefined)
      this.#registrationByScope.delete(options.scope);
    const registration = config.value;
    const createClient: AnalysisProviderBoundClientFactory = (
      requestedTarget,
      requestedProfile,
    ) =>
      isDeepStrictEqual(requestedTarget, target) &&
      analysisProfilesEqual(requestedProfile, profile)
        ? this.#createBoundClient(registration, target, profile)
        : this.#unboundClient(
            "IDA client factory received a target or profile different from the resolved binding.",
          );
    return ok({
      profile,
      createClient,
    });
  }
  createClient(
    _target: BinaryTarget,
    _profile?: AnalysisProfileCommitment,
  ): AnalysisClient {
    return this.#unboundClient(
      "IDA client creation requires the provider-owned selected profile binding.",
    );
  }
  async #configuration(options?: AnalysisProviderInspectionOptions) {
    const scope = options?.scope;
    if (scope?.active === true) {
      const existing = this.#registrationByScope.get(scope);
      if (existing !== undefined) return existing;
    }
    const signal = options?.signal;
    const pending =
      this.config.idaMcpConfigPath === undefined
        ? Promise.resolve(readIdaConfigurationNotConfigured())
        : readIdaConfiguration(this.config.idaMcpConfigPath, {
            ...(signal === undefined ? {} : { signal }),
            resourceScope: options?.resourceScope ?? this.#inspectionOwner,
          });
    if (scope?.active === true) this.#registrationByScope.set(scope, pending);
    const registration = await pending;
    return registration;
  }
  #regexLimitation(): string {
    return launchRegexMatchingLimitation(
      this.config.regexMatchingDeadline,
      this.config.regexWorkerHeapRequest,
    );
  }
  #createBoundClient(
    config: IdaConfiguration,
    target: BinaryTarget,
    profile: AnalysisProfileCommitment,
  ): AnalysisClient {
    return new IdaSessionClient(
      config,
      target,
      this.connectionFactory(config, this.environment),
      profile,
      this.config,
    );
  }
  #unboundClient(reason: string): AnalysisClient {
    const error = idaConfigurationError(reason);
    return {
      execute: async () => err(error),
      close: async () => ok(null),
    };
  }
}

const readIdaConfigurationNotConfigured = () =>
  err(
    idaConfigurationError(
      "Set REA_IDA_MCP_CONFIG to an upstream IDA MCP JSON registration; see docs/ida-provider.md.",
    ),
  );
