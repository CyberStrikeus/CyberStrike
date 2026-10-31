import { KunaDocumentError } from "./KunaDocumentError.js";
import { KUNA_STRING_MIN_LENGTH } from "./KunaLimits.js";
import { accessSync, constants, statSync } from "node:fs";

import type {
  AnalysisClient,
  AnalysisProfileResolutionOptions,
  AnalysisProviderCandidate,
  ProviderAvailability,
  ProviderTargetSupport,
} from "../application/AnalysisProvider.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import {
  createAnalysisProfile,
  type AnalysisProfileCommitment,
} from "../domain/analysisProfile.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { err, ok } from "../domain/result.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import {
  resolveRegexMatchingDeadline,
  type RegexMatchingDeadline,
} from "../config/regexMatchingDeadline.js";
import {
  resolveRegexWorkerHeapRequest,
  type RegexWorkerHeapRequest,
} from "../config/regexWorkerHeapRequest.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import {
  kunaFileCleanupError,
  kunaRetainedResourceCleanupError,
  type KunaProcessLauncher,
} from "./KunaCommand.js";
import {
  readKunaConfiguration,
  type KunaConfiguration,
} from "./KunaConfiguration.js";
import {
  createKunaResourceScope,
  inspectKunaInstallation,
} from "./KunaInstallation.js";
import { KunaProjectCache } from "./KunaProjectCache.js";
import {
  KUNA_PROVIDER_IDENTITY,
  kunaCapabilities,
} from "./KunaProviderCapabilities.js";
import { KUNA_COMMAND_REMEDIATION, KUNA_PROVIDER_ID } from "./KunaRelease.js";
import { KunaRunSlots } from "./KunaRunSlots.js";
import { KunaSessionClient } from "./KunaSessionClient.js";
import { kunaUnavailable } from "./KunaUnavailable.js";

/** Architectures REA verified Kuna on: x86-64 and AArch64 ELF and Mach-O, plus ARM Thumb. */
const VERIFIED_ARCHITECTURES: ReadonlySet<string> = new Set([
  "x86_64",
  "arm64",
  "arm",
]);

/**
 * Bring-your-own Kuna candidate. Discovery reads configuration and the
 * executable's metadata only; the version probe runs when a target is opened.
 */
export class KunaProvider implements AnalysisProviderCandidate {
  readonly #environment: Readonly<NodeJS.ProcessEnv>;
  readonly #deadline: RegexMatchingDeadline;
  readonly #heapRequest: RegexWorkerHeapRequest;
  readonly #platform: NodeJS.Platform;
  readonly #launcher: KunaProcessLauncher | undefined;
  readonly #probeTimeoutMs: number | undefined;
  readonly #singleFunctionRuns: number | undefined;
  #cache: KunaProjectCache | undefined;
  #runSlots: KunaRunSlots | undefined;

  constructor(
    environment: Readonly<NodeJS.ProcessEnv>,
    options: {
      readonly platform?: NodeJS.Platform;
      readonly launcher?: KunaProcessLauncher;
      /** Test seam for bounded installation-probe lifecycle cases. */
      readonly probeTimeoutMs?: number;
      /** Test seam for foreground native runs; production derives it from the host. */
      readonly singleFunctionRuns?: number;
      /**
       * Deadline already resolved at startup. Omitted means resolve the
       * selected environment; an invalid setting is refused.
       */
      readonly regexMatchingDeadline?: RegexMatchingDeadline;
      /**
       * Heap request already resolved at startup. Omitted means resolve the
       * selected environment; an invalid setting is refused.
       */
      readonly regexWorkerHeapRequest?: RegexWorkerHeapRequest;
    } = {},
  ) {
    this.#platform = options.platform ?? process.platform;
    this.#environment = snapshotEnvironment(environment, this.#platform);
    this.#deadline =
      options.regexMatchingDeadline ??
      resolveRegexMatchingDeadline(this.#environment);
    this.#heapRequest =
      options.regexWorkerHeapRequest ??
      resolveRegexWorkerHeapRequest(this.#environment);
    this.#launcher = options.launcher;
    this.#probeTimeoutMs = options.probeTimeoutMs;
    this.#singleFunctionRuns = options.singleFunctionRuns;
  }

  identity() {
    return KUNA_PROVIDER_IDENTITY;
  }

  capabilities() {
    const availability = this.inspectAvailability();
    return kunaCapabilities(
      availability.status === "available"
        ? { available: true }
        : {
            available: false,
            reason: availability.reason,
            code: availability.code,
          },
      this.#deadline,
      this.#heapRequest,
    );
  }

  inspectAvailability(): ProviderAvailability {
    const configuration = readKunaConfiguration(
      this.#environment,
      this.#platform,
    );
    if (!configuration.ok)
      return {
        status: "unavailable",
        code: configuration.error.code,
        reason: configuration.error.reason,
        diagnostics: {
          configured: configuration.error.code !== "not_configured",
          version_probed: false,
        },
      };
    const { command } = configuration.value;
    try {
      accessSync(command, constants.X_OK);
      if (!statSync(command).isFile())
        throw new KunaDocumentError("command_not_file");
    } catch (cause: unknown) {
      return {
        status: "unavailable",
        code: "executable_missing",
        reason: `Cannot execute REA_KUNA_COMMAND ${command}: ${cause instanceof Error ? cause.message : String(cause)}. ${KUNA_COMMAND_REMEDIATION}`,
        diagnostics: { configured: true, command, version_probed: false },
      };
    }
    return {
      status: "available",
      code: null,
      reason: null,
      diagnostics: {
        configured: true,
        command,
        cache_root: configuration.value.cacheRoot,
        jobs: configuration.value.jobs,
        version_probed: false,
      },
    };
  }

  inspectTargetSupport(target: BinaryTarget): ProviderTargetSupport {
    const diagnostics = {
      target_kind: target.kind,
      target_format: target.format,
    };
    if (target.kind !== "executable")
      return {
        status: "unsupported",
        code: "target_kind_unsupported",
        reason: "Kuna decompiles executable images, not databases or archives.",
        diagnostics,
      };
    if (target.format !== "elf" && target.format !== "mach-o")
      return {
        status: "unsupported",
        code: "target_format_unsupported",
        reason:
          target.format === "mach-o-universal"
            ? "REA's Kuna provider has no verified universal Mach-O slice selection yet; open a thin slice or use another provider."
            : `REA verified the Kuna provider on ELF and thin Mach-O images; ${target.format} is not admitted yet.`,
        diagnostics,
      };
    if (!VERIFIED_ARCHITECTURES.has(target.architecture))
      return {
        status: "unsupported",
        code: "architecture_unsupported",
        reason: `REA verified the Kuna provider on x86-64, AArch64 and ARM; ${target.architecture} is not admitted yet.`,
        diagnostics: { ...diagnostics, architecture: target.architecture },
      };
    return { status: "supported", code: null, reason: null, diagnostics };
  }

  async resolveAnalysisProfile(
    _target: BinaryTarget,
    options?: AnalysisProfileResolutionOptions,
  ) {
    if (options?.signal?.aborted === true)
      return err(
        new AnalysisCancelledError("kuna:profile", {
          cause: options.signal.reason,
        }),
      );
    let installation: Awaited<ReturnType<typeof inspectKunaInstallation>>;
    const resourceScope = options?.resourceScope;
    if (resourceScope === undefined)
      return err(
        kunaUnavailable(
          "kuna:profile",
          "Kuna profile inspection requires a durable resource scope",
        ),
      );
    const kunaResources = createKunaResourceScope(resourceScope);
    try {
      installation = await inspectKunaInstallation(this.#environment, {
        platform: this.#platform,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        resourceScope: kunaResources.owner,
        ...(this.#launcher === undefined
          ? {}
          : { processLauncher: this.#launcher }),
        ...(this.#probeTimeoutMs === undefined
          ? {}
          : { probeTimeoutMs: this.#probeTimeoutMs }),
      });
    } catch (cause: unknown) {
      const retainedCleanup = kunaRetainedResourceCleanupError(
        cause,
        "kuna:profile",
      );
      if (retainedCleanup !== undefined) return err(retainedCleanup);
      if (!(cause instanceof RegularFileCleanupFailure)) {
        const cancellation = kunaResources.installationCancellationError(
          cause,
          "kuna:profile",
        );
        if (cancellation !== undefined) return err(cancellation);
      }
      if (!(cause instanceof RegularFileCleanupFailure)) throw cause;
      const error = kunaFileCleanupError(cause, "kuna:profile");
      kunaResources.bindFailure(cause, error);
      return err(error);
    }
    if (!installation.ok) {
      const error = kunaUnavailable("open_binary", installation.error.reason, {
        diagnostics: installation.error.diagnostics,
        ...(!kunaResources.hasPending
          ? {}
          : {
              cleanup: {
                reason: "Kuna version-probe process cleanup is unconfirmed.",
                resources: kunaResources.cleanupResources ?? [],
              },
            }),
      });
      kunaResources.bindRetainedFailure(error);
      return err(error);
    }
    const { value } = installation;
    return ok({
      profile: createAnalysisProfile(
        { ...KUNA_PROVIDER_IDENTITY, version: value.version },
        {
          kuna_version: value.version,
          kuna_sha256: value.sha256,
          kuna_command: value.configuration.command,
          kuna_executable: value.executable,
          verified_release: value.verified,
          jobs: value.configuration.jobs,
          export: "decompile-project",
          reference_graph: {
            command: "decompile-graph",
            schema_version: 4,
            bodies: false,
            edge_kind: "call",
          },
          xrefs: { command: "xrefs", direction: "to", exact_address: true },
          strings: {
            command: "strings",
            encoding: "all",
            min_length: KUNA_STRING_MIN_LENGTH,
            termination: "any",
            xrefs: false,
          },
          cache_policy: "live",
        },
      ),
    });
  }

  /** Shared cache cleanup belongs to the candidate, not a retired client. */
  closeOwnedResources() {
    return this.#cache?.close() ?? Promise.resolve(ok(null));
  }

  hasPendingOwnedResources(): boolean {
    return this.#cache?.hasPendingCleanup === true;
  }

  createClient(
    target: BinaryTarget,
    profile?: AnalysisProfileCommitment,
  ): AnalysisClient {
    const configuration = readKunaConfiguration(
      this.#environment,
      this.#platform,
    );
    if (!configuration.ok)
      return {
        execute: async (operation) =>
          err(kunaUnavailable(operation, configuration.error.reason)),
        close: async () => ok(null),
      };
    return new KunaSessionClient(target, profile, {
      cache: this.#projectCache(configuration.value),
      runSlots: this.#foregroundSlots(configuration.value),
      environment: this.#environment,
      deadline: this.#deadline,
      heapRequest: this.#heapRequest,
      ...(this.#launcher === undefined ? {} : { launcher: this.#launcher }),
    });
  }

  /** One cache per provider, so sessions of one server share exports in flight. */
  #projectCache(configuration: KunaConfiguration): KunaProjectCache {
    this.#cache ??= new KunaProjectCache(configuration.cacheRoot, {
      maxBytes: configuration.cacheMaxBytes,
      ...(this.#launcher === undefined ? {} : { launcher: this.#launcher }),
    });
    return this.#cache;
  }

  /** One admission pool per provider, so concurrent sessions share the host's cores. */
  #foregroundSlots(configuration: KunaConfiguration): KunaRunSlots {
    this.#runSlots ??=
      this.#singleFunctionRuns === undefined
        ? KunaRunSlots.forHost(configuration.jobs)
        : new KunaRunSlots(this.#singleFunctionRuns);
    return this.#runSlots;
  }
}
