import {
  existingGhidraAnalysisProfile,
  ghidraPinnedLanguage,
  resolveGhidraAnalysisProfile,
} from "./GhidraAnalysisProfile.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { resolveGhidraProject } from "./GhidraProjectSnapshot.js";
import { DeferredAnalysisClient } from "../providers/DeferredAnalysisClient.js";
import type { ProviderInspectionScope } from "../application/ProviderInspectionScope.js";
import { analysisClientFailureForOperation } from "../providers/AnalysisClientFailure.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import {
  SharedStartupAttempt,
  STARTUP_OWNER_CLOSED,
} from "../process/SharedStartupAttempt.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import type {
  AnalysisClient,
  AnalysisClientContext,
  AnalysisProviderInspectionOptions,
  RetainedResourceScope,
  AnalysisProfileResolutionOptions,
  AnalysisProfileResolution,
  AnalysisProviderCandidate,
  AnalysisProviderReadinessSnapshot,
  CapabilityDescriptor,
  ProviderAvailability,
  ProviderIdentity,
  ProviderTargetSupport,
} from "../application/AnalysisProvider.js";
import type { AppConfig } from "../config/types.js";
import {
  createAnalysisProfile,
  type AnalysisProfileCommitment,
} from "../domain/analysisProfile.js";
import {
  isMachOFormat,
  RAW_ONLY_ARCHITECTURES,
  type BinaryArchitecture,
  type BinaryTarget,
} from "../domain/binaryTargetTypes.js";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonValue,
} from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { Logger } from "pino";
import { GhidraClient } from "./GhidraClient.js";
import {
  ghidraInstallationDiagnostics,
  inspectGhidraInstallation,
  type GhidraInstallationHost,
  type GhidraInstallationInspection,
} from "./GhidraInstallation.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { resolveGhidraAnalysisSeeds } from "./GhidraAnalysisSeeds.js";
import {
  admitGhidraLanguageOverride,
  readGhidraLanguageCatalog,
} from "./GhidraLanguageCatalog.js";
import { ghidraFileFailure } from "./GhidraFileArtifacts.js";
import {
  ghidraProcessorUnsupportedReason,
  isGhidraPspTarget,
} from "./GhidraPspProfile.js";
import { resolveGhidraExtensions } from "./extensions/GhidraExtensions.js";
import {
  CAPABILITIES,
  existingProjectCapabilities,
  EXISTING_PROJECT_WINDOWS_UNAVAILABLE,
  windowsP0Capabilities,
  GHIDRA_PROVIDER_IDENTITY,
  WINDOWS_P0_NATIVE_PE_ARCHITECTURES,
} from "./GhidraProviderCapabilities.js";
import {
  createGhidraProviderClient,
  admitGhidraClient,
  type GhidraProviderClientFactory,
} from "./GhidraProviderClient.js";
import {
  inspectWindowsNativeReadiness,
  type WindowsNativeReadiness,
  windowsNativeCapabilities,
} from "../process/WindowsAuthority.js";

const SUPPORTED_ARCHITECTURES = new Set<BinaryArchitecture>([
  "x86",
  "x86_64",
  "arm",
  "arm64",
  "mips",
  "6502",
  "riscv",
  "powerpc",
  "m68k",
  "hexagon",
]);

/** Names every admitted family, so the refusal cannot drift from the set. */
const admittedArchitecturesText = (): string => {
  const rawOnly = new Set<BinaryArchitecture>(RAW_ONLY_ARCHITECTURES);
  const admitted = [...SUPPORTED_ARCHITECTURES];
  const detected = admitted.filter((family) => !rawOnly.has(family));
  const raw = admitted.filter((family) => rawOnly.has(family));
  return `Admitted families: ${detected.join(", ")}; raw-binary only: ${raw.join(", ")}.`;
};

/** Ghidra candidate backed by an isolated ephemeral headless Program session. */
export class GhidraProvider implements AnalysisProviderCandidate {
  readonly #inspectionResources = new ArtifactResourceScope();
  readonly #inspectionWork = new Set<Promise<unknown>>();
  #lifetime = new AbortController();
  readonly #observations = new WeakMap<
    ProviderInspectionScope,
    {
      readonly lifetime: AbortSignal;
      readonly installation: GhidraInstallationInspection;
    }
  >();
  #inspectionAttempt:
    | SharedStartupAttempt<Result<GhidraInstallationInspection, AnalysisError>>
    | undefined;
  readonly #inspectionOwner: RetainedResourceScope = {
    retain: (owner, resource) =>
      this.#inspectionResources.retain({
        kind: "lease",
        resource,
        lease: AnalysisCleanupLease.forCloseOwner(owner, resource),
      }),
    run: (operation) => this.#inspectionResources.run(operation),
  };
  #closing: Promise<Result<null, AnalysisError>> | undefined;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    environment: Readonly<NodeJS.ProcessEnv>,
    private readonly installationHost?: GhidraInstallationHost,
    private readonly clientFactory: GhidraProviderClientFactory = (options) =>
      new GhidraClient(options),
  ) {
    this.environment = snapshotEnvironment(
      environment,
      installationHost?.platform,
    );
  }

  identity(): ProviderIdentity {
    return GHIDRA_PROVIDER_IDENTITY;
  }

  capabilities(): readonly CapabilityDescriptor[] {
    const platform = this.installationHost?.platform ?? process.platform;
    return this.config.ghidraExistingProject !== undefined
      ? existingProjectCapabilities(platform)
      : platform === "win32"
        ? windowsP0Capabilities()
        : CAPABILITIES;
  }

  async inspectAvailability(
    options: AnalysisProviderInspectionOptions = {},
  ): Promise<ProviderAvailability> {
    return (await this.inspectReadinessSnapshot(options)).availability;
  }

  inspectReadinessSnapshot(
    options: AnalysisProviderInspectionOptions = {},
  ): Promise<AnalysisProviderReadinessSnapshot> {
    return this.#runInspectionWork(
      (signal) => this.#readinessSnapshot(signal, options.scope),
      options.signal,
    );
  }

  async #readinessSnapshot(
    signal: AbortSignal,
    scope?: ProviderInspectionScope,
  ): Promise<AnalysisProviderReadinessSnapshot> {
    const installation = await this.#inspectInstallation(
      signal,
      "binary_session",
      scope,
    );
    const readiness =
      installation.platform === "win32"
        ? inspectWindowsNativeReadiness(installation.platform)
        : undefined;
    const availability = this.#availability(installation, readiness);
    if (availability.status === "available" && signal.aborted)
      throw new AnalysisCancelledError("binary_session", {
        cause: signal.reason,
        diagnostics: availability.diagnostics,
      });
    return {
      availability,
      capabilities:
        this.config.ghidraExistingProject !== undefined
          ? existingProjectCapabilities(installation.platform)
          : readiness === undefined
            ? CAPABILITIES
            : windowsP0Capabilities(readiness),
    };
  }

  #availability(
    installation: GhidraInstallationInspection,
    readiness: WindowsNativeReadiness | undefined,
  ): ProviderAvailability {
    const diagnostics = ghidraInstallationDiagnostics(installation);
    if (
      this.config.ghidraExistingProject !== undefined &&
      installation.platform === "win32"
    )
      return {
        status: "unavailable",
        code: "unsupported_host",
        reason: EXISTING_PROJECT_WINDOWS_UNAVAILABLE,
        diagnostics,
      };
    if (installation.status === "available" && readiness?.available === false)
      return {
        status: "unavailable",
        code: readiness.code,
        reason: readiness.reason,
        diagnostics: {
          ...diagnostics,
          windows_security: jsonObjectSchema.parse(
            windowsNativeCapabilities(installation.platform, readiness),
          ),
          windows_native_failure: {
            stage: readiness.failureStage,
            remediation: readiness.remediation,
          },
        },
      };
    return installation.status === "available"
      ? {
          status: "available",
          code: null,
          reason: null,
          diagnostics,
        }
      : {
          status: "unavailable",
          code: installation.rejection.code,
          reason: installation.rejection.reason,
          diagnostics,
        };
  }

  inspectTargetSupport(target: BinaryTarget): ProviderTargetSupport {
    const hostPlatform = this.installationHost?.platform ?? process.platform;
    const diagnostics = {
      host_platform: hostPlatform,
      target_kind: target.kind,
      target_format: target.format,
      architecture: target.architecture ?? null,
      available_architectures:
        target.kind === "executable"
          ? [...target.availableArchitectures]
          : null,
      executable_role: target.executableRole ?? null,
      managed: target.managed ?? null,
    };
    if (target.kind !== "executable")
      return {
        status: "unsupported",
        code: "target_kind_unsupported",
        reason: `Ghidra v1 imports executable targets, not ${target.kind} targets.`,
        diagnostics,
      };
    if (hostPlatform === "win32")
      return inspectWindowsP0TargetSupport(target, diagnostics);
    const mipsReason =
      isGhidraPspTarget(target) &&
      (hostPlatform !== "linux" ||
        (this.installationHost?.architecture ?? process.arch) !== "x64")
        ? "The initial PSP Allegrex profile is verified on Linux x64 only."
        : ghidraProcessorUnsupportedReason(target);
    if (mipsReason !== null)
      return {
        status: "unsupported",
        code: "architecture_unsupported",
        reason: mipsReason,
        diagnostics,
      };
    if (
      isMachOFormat(target.format) &&
      target.availableArchitectures.length > 1
    )
      return {
        status: "unsupported",
        code: "architecture_unsupported",
        reason:
          "Ghidra v1 cannot enforce the selected architecture when importing a universal Mach-O; analyze a thinned Mach-O slice instead.",
        diagnostics,
      };
    if (!SUPPORTED_ARCHITECTURES.has(target.architecture))
      return {
        status: "unsupported",
        code: "architecture_unsupported",
        reason: `Ghidra v1 has no ${target.architecture} lane. ${admittedArchitecturesText()}`,
        diagnostics,
      };
    return {
      status: "supported",
      code: null,
      reason: null,
      diagnostics,
    };
  }

  hasPendingOwnedResources(): boolean {
    return (
      this.#inspectionWork.size > 0 ||
      this.#inspectionAttempt !== undefined ||
      this.#inspectionResources.hasPending
    );
  }

  closeOwnedResources() {
    this.#closing ??= Promise.resolve()
      .then(async () => {
        this.#lifetime.abort(STARTUP_OWNER_CLOSED);
        this.#inspectionAttempt?.close();
        await Promise.allSettled([
          ...this.#inspectionWork,
          ...(this.#inspectionAttempt === undefined
            ? []
            : [this.#inspectionAttempt.promise]),
        ]);
        return this.#closeInspectionResources();
      })
      .finally(() => {
        this.#lifetime = new AbortController();
        this.#closing = undefined;
      });
    return this.#closing;
  }

  async #closeInspectionResources() {
    try {
      await this.#inspectionResources.retryCleanup();
      return ok(null);
    } catch (cause: unknown) {
      const error = new ProviderCleanupError(
        "ghidra",
        cause instanceof ArtifactReaderFailure
          ? (cause.cleanup?.resources ?? [])
          : [],
        { reason: providerFailureText(cause) },
        { cause },
      );
      bindArtifactFileCleanup(cause, error);
      return err(error);
    }
  }

  async resolveAnalysisProfile(
    target: BinaryTarget,
    options?: AnalysisProfileResolutionOptions,
  ): Promise<Result<AnalysisProfileResolution, AnalysisError>> {
    try {
      return await this.#runInspectionWork(async (signal) => {
        const result = await this.#resolveProfile(target, {
          ...options,
          signal,
        });
        if (!result.ok && result.error instanceof AnalysisCancelledError)
          return err(
            analysisClientFailureForOperation(
              result.error,
              "ghidra",
              "open_binary",
            ),
          );
        if (result.ok && signal.aborted)
          return err(
            new AnalysisCancelledError("open_binary", {
              cause: signal.reason,
              diagnostics: {
                completed_profile_digest: result.value.profile?.digest ?? null,
              },
            }),
          );
        return result;
      }, options?.signal);
    } catch (cause: unknown) {
      return err(
        analysisClientFailureForOperation(
          cause,
          "ghidra",
          cause instanceof AnalysisCancelledError
            ? "open_binary"
            : "resolve_analysis_profile",
        ),
      );
    }
  }

  async #resolveProfile(
    target: BinaryTarget,
    options?: AnalysisProfileResolutionOptions,
  ) {
    const installation = await this.#inspectInstallation(
      options?.signal,
      "resolve_analysis_profile",
      options?.scope,
    );
    if (
      this.config.ghidraExistingProject !== undefined &&
      target.kind === "executable" &&
      installation.status === "available"
    ) {
      if (
        installation.platform === "win32" ||
        ghidraPinnedLanguage(target) !== undefined ||
        !(
          target.format === "elf" ||
          target.format === "pe" ||
          isMachOFormat(target.format)
        )
      )
        return err(existingProjectUnsupported());
      const project = await resolveGhidraProject(
        this.config.ghidraExistingProject,
        target,
        this.#inspectionResources,
        options?.signal,
      );
      return ok({
        profile: existingGhidraAnalysisProfile(
          target,
          {
            ...GHIDRA_PROVIDER_IDENTITY,
            version: installation.providerVersion,
          },
          jsonValueSchema.parse(project),
        ),
      });
    }
    const resolved = await resolveGhidraAnalysisProfile(
      target,
      GHIDRA_PROVIDER_IDENTITY,
      installation,
      this.#inspectionResources,
      options?.signal,
      this.config.ghidraLanguageOverride,
      this.config.ghidraDisabledAnalyzers,
    );
    if (!resolved.ok || resolved.value.profile === null) return resolved;
    const override = this.config.ghidraLanguageOverride;
    if (override !== undefined && installation.status === "available") {
      let catalog: Awaited<ReturnType<typeof readGhidraLanguageCatalog>>;
      try {
        catalog = await readGhidraLanguageCatalog(
          installation.installDir,
          this.#inspectionResources,
          options?.signal,
        );
      } catch (cause: unknown) {
        return err(
          ghidraFileFailure(cause, "resolve_analysis_profile", {
            setting: "REA_GHIDRA_LANGUAGE_ID",
          }),
        );
      }
      const refused = admitGhidraLanguageOverride(
        override,
        catalog,
        installation.providerVersion,
      );
      if (refused !== null) return err(refused);
    }
    const extensions = await resolveGhidraExtensions(
      this.config,
      target,
      installation.platform,
      this.#inspectionResources,
      options?.signal,
    );
    if (!extensions.ok) return extensions;
    if (options?.signal?.aborted === true)
      return err(
        new AnalysisCancelledError("open_binary", {
          cause: options.signal.reason,
        }),
      );
    const seeds = await resolveGhidraAnalysisSeeds(
      this.config.ghidraSeedFile,
      this.#inspectionResources,
      options?.signal,
    );
    if (!seeds.ok) return seeds;
    if (extensions.value.length === 0 && seeds.value === undefined)
      return resolved;
    return ok({
      ...resolved.value,
      profile: createAnalysisProfile(resolved.value.profile.provider, {
        ...resolved.value.profile.parameters,
        ...(extensions.value.length === 0
          ? {}
          : { analysis_extensions: jsonValueSchema.parse(extensions.value) }),
        ...(seeds.value === undefined
          ? {}
          : { analysis_seeds: jsonValueSchema.parse(seeds.value) }),
      }),
    });
  }

  createClient(
    target: BinaryTarget,
    profile?: AnalysisProfileCommitment,
    context?: AnalysisClientContext,
  ): AnalysisClient {
    return new DeferredAnalysisClient(async (signal, resourceOwner) => {
      const admitted = admitGhidraClient(
        target,
        profile,
        this.installationHost?.platform ?? process.platform,
      );
      if (!admitted.ok) throw admitted.error;
      const installation = await this.#observeInstallation(
        signal,
        resourceOwner,
      );
      const created = createGhidraProviderClient({
        config: this.config,
        environment: this.environment,
        logger: this.logger,
        clientFactory: this.clientFactory,
        admission: admitted.value,
        ...(context === undefined ? {} : { context }),
        installation,
        signal,
      });
      if (!created.ok) throw created.error;
      return created.value;
    }, "ghidra");
  }

  async #runInspectionWork<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    callerSignal?: AbortSignal,
  ): Promise<T> {
    if (this.#closing !== undefined) {
      const closed = await this.#closing;
      if (!closed.ok) throw closed.error;
    }
    const signal =
      callerSignal === undefined
        ? this.#lifetime.signal
        : AbortSignal.any([callerSignal, this.#lifetime.signal]);
    if (signal.aborted)
      throw new AnalysisCancelledError("ghidra:inspection", {
        cause: signal.reason,
      });
    const work = Promise.resolve().then(() => operation(signal));
    this.#inspectionWork.add(work);
    try {
      return await work;
    } finally {
      this.#inspectionWork.delete(work);
    }
  }

  async #inspectInstallation(
    callerSignal: AbortSignal | undefined,
    operation: string,
    scope?: ProviderInspectionScope,
  ): Promise<GhidraInstallationInspection> {
    if (callerSignal?.aborted)
      throw new AnalysisCancelledError(operation, {
        cause: callerSignal.reason,
      });
    if (scope?.active) {
      const observed = this.#observations.get(scope);
      if (observed?.lifetime === this.#lifetime.signal)
        return observed.installation;
    }
    let attempt = this.#inspectionAttempt;
    if (attempt === undefined) {
      attempt = new SharedStartupAttempt(
        (signal) =>
          Promise.resolve().then(async () => {
            try {
              return ok(await this.#observeInstallation(signal));
            } catch (cause: unknown) {
              return err(
                analysisClientFailureForOperation(
                  cause,
                  "ghidra",
                  "ghidra:inspection",
                ),
              );
            }
          }),
        this.#lifetime.signal,
      );
      const owned = attempt;
      this.#inspectionAttempt = owned;
      void owned.promise.then(
        () => {
          if (this.#inspectionAttempt === owned)
            this.#inspectionAttempt = undefined;
        },
        () => {
          if (this.#inspectionAttempt === owned)
            this.#inspectionAttempt = undefined;
        },
      );
    }
    const waited = await attempt.wait(callerSignal);
    if (waited.status === "cancelled")
      throw new AnalysisCancelledError(operation, {
        cause: callerSignal?.reason,
      });
    if (!waited.value.ok)
      throw analysisClientFailureForOperation(
        waited.value.error,
        "ghidra",
        operation,
      );
    if (
      waited.value.value.status === "available" &&
      (callerSignal?.aborted || attempt.signal.aborted)
    )
      throw new AnalysisCancelledError(operation, {
        cause: callerSignal?.aborted
          ? callerSignal.reason
          : attempt.signal.reason,
        diagnostics: ghidraInstallationDiagnostics(waited.value.value),
      });
    if (scope?.active && !callerSignal?.aborted && !attempt.signal.aborted)
      this.#observations.set(scope, {
        lifetime: this.#lifetime.signal,
        installation: waited.value.value,
      });
    return waited.value.value;
  }

  #observeInstallation(
    signal: AbortSignal,
    resourceOwner: RetainedResourceScope = this.#inspectionOwner,
  ): Promise<GhidraInstallationInspection> {
    const options = {
      resourceOwner,
      signal,
      environment: this.environment,
      ...(this.config.ghidraInstallDir === undefined
        ? {}
        : { installDir: this.config.ghidraInstallDir }),
      ...(this.config.ghidraJavaHome === undefined
        ? {}
        : { javaHome: this.config.ghidraJavaHome }),
      ...(this.installationHost?.platform === undefined
        ? {}
        : { platform: this.installationHost.platform }),
      ...(this.installationHost?.architecture === undefined
        ? {}
        : { architecture: this.installationHost.architecture }),
    };
    return this.installationHost === undefined
      ? inspectGhidraInstallation(options)
      : inspectGhidraInstallation(options, this.installationHost);
  }
}

/** The selected project, not the target or provider, is what this host cannot serve. */
const existingProjectUnsupported = (): ConfigurationError => {
  const constraint =
    "Existing-project mode supports native ELF/PE/Mach-O programs on POSIX without fresh-import loader preparation or pinned language overrides; unset REA_GHIDRA_PROJECT_PATH to use fresh import for this target/host.";
  return new ConfigurationError(constraint, {
    settings: [{ setting: "REA_GHIDRA_PROJECT_PATH", constraint }],
  });
};

const providerFailureText = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const inspectWindowsP0TargetSupport = (
  target: BinaryTarget,
  diagnostics: Readonly<Record<string, JsonValue>>,
): ProviderTargetSupport => {
  // The raw 6502 lane uses the same immutable snapshot and native ownership boundary.
  if (target.format === "raw-binary" && target.architecture === "6502")
    return { status: "supported", code: null, reason: null, diagnostics };
  // DOL is verified on POSIX hosts only; Windows P0 does not admit it, like the other non-PE lanes.
  if (target.format === "gamecube-dol")
    return {
      status: "unsupported",
      code: "target_format_unsupported",
      reason:
        "GameCube DOL analysis is not part of Windows Ghidra P0; it is verified on POSIX hosts only.",
      diagnostics,
    };
  if (target.format !== "pe")
    return {
      status: "unsupported",
      code: "target_format_unsupported",
      reason:
        "Windows Ghidra P0 accepts native PE and explicitly selected raw 6502 targets only.",
      diagnostics,
    };
  if (!WINDOWS_P0_NATIVE_PE_ARCHITECTURES.includes(target.architecture))
    return {
      status: "unsupported",
      code: "architecture_unsupported",
      reason:
        "Windows Ghidra P0 accepts x86, x86-64, ARM and ARM64 PE targets only.",
      diagnostics,
    };
  if (
    target.executableRole !== "application" &&
    target.executableRole !== "shared-library"
  )
    return {
      status: "unsupported",
      code: "target_role_unsupported",
      reason:
        "Windows Ghidra P0 accepts PE applications and DLLs, not non-executable or unclassified images.",
      diagnostics,
    };
  if (target.managed !== false)
    return {
      status: "unsupported",
      code: "managed_target_unsupported",
      reason:
        "Windows Ghidra P0 accepts native PE applications and DLLs; managed or unclassified PE targets are unsupported.",
      diagnostics,
    };
  if (
    (target.architecture === "arm" && target.peMachine !== 0x01c4) ||
    (target.architecture === "arm64" && target.peMachine !== 0xaa64)
  )
    return {
      status: "unsupported",
      code: "architecture_unsupported",
      reason:
        "Windows Ghidra P0 ARM PE targets require observed ARMNT (0x01c4) or ARM64 (0xaa64) COFF machines; legacy ARM/Thumb and unknown machines are unsupported.",
      diagnostics: { ...diagnostics, pe_machine: target.peMachine ?? null },
    };
  return {
    status: "supported",
    code: null,
    reason: null,
    diagnostics,
  };
};
