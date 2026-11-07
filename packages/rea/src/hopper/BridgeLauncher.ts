import { execFile } from "node:child_process";
import { chmod, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import {
  hopperCancelledBySignal,
  HopperCancelledError,
  HopperProcessError,
  HopperStartError,
} from "../domain/hopperErrors.js";
import { err, ok, type Result } from "../domain/result.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  ArtifactReaderFailure,
  artifactPrimaryCleanupLeases,
} from "../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLeaseGroup } from "../artifacts/AnalysisCleanupLease.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { cleanupOwnedProcessGroup } from "../process/ProcessOwnership.js";
import type {
  OwnedProcessGroup,
  ProcessCleanupResult,
} from "../process/ProcessOwnership.js";
import { execFileOutput } from "../process/ExecFileOutput.js";
import {
  type ProviderProcessHandle,
  type ProviderProcessLaunch,
  spawnOwnedProviderProcess,
} from "../process/ProviderProcess.js";
import { waitForAbortableDelay } from "../process/ProviderDeadline.js";
import {
  selectLinuxPrivateDisplayStrategy,
  type LinuxPrivateDisplayRunnableStrategy,
  type LinuxPrivateDisplaySelection,
} from "./LinuxPrivateDisplayProbe.js";

import {
  prepareHopperMachOImage,
  type HopperMachOImage,
} from "./HopperMachOImage.js";
import {
  prepareHopperExecutableImage,
  type HopperImageCopyFileSystem,
} from "./HopperImageCopy.js";

import {
  acquireHopperTargetLease,
  acquireLinuxHopperApplicationLease,
} from "../process/HopperLease.js";
import type { OwnedLease } from "../process/OwnedLease.js";
import {
  MAXIMUM_BRIDGE_MAX_REQUEST_BYTES,
  MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
  type BridgeMaxRequestBytes,
} from "../config/bridgeMaxRequestBytes.js";
import { HOPPER_SHUTDOWN_TIMEOUT_MS } from "./HopperSessionValues.js";
import { verifyMacHopperNativeHelper } from "./HopperMacPublisher.js";
import { inspectLinuxHopperLauncher } from "../application/LinuxHopper.js";
import { retryLinuxHopperPublisherCleanup } from "../application/LinuxHopperPublisher.js";

const execFileAsync = promisify(execFile);
const HOPPER_BACKGROUND_STARTUP_MS = 5_000;
/**
 * Bound for the Linux demo helper's orderly shutdown during teardown.
 * The helper stops Hopper and Xvfb with SIGTERM (up to 2s each in
 * stop_process); Xvfb removes its /tmp/.X<n>-lock on that clean exit.
 */
const LINUX_DEMO_ORDERLY_SHUTDOWN_GRACE_MS = 10_000;

const bindRetainedArtifactCleanup = (
  error: AnalysisError,
  cause: unknown,
): void => {
  const leases = artifactPrimaryCleanupLeases(cause);
  if (leases !== undefined && leases.length > 0) {
    new AnalysisCleanupLeaseGroup(error, leases);
    return;
  }
  if (cause instanceof AnalysisError && cause.cleanupIncomplete)
    error.bindCleanupDependencies([cause]);
};

/** Coordinates for one private bridge session. */
export interface BridgeSession {
  readonly directory: string;
  readonly socketPath: string;
  readonly token: string;
  readonly runId: string;
}

/** Process handle returned by a bridge launcher. */
export type BridgeLaunch = {
  /** Verified publisher and sealed native-helper identity; omission is unknown. */
  readonly nativeHelperVerified?: true;
  /** Only literal native-helper arguments support a pre-handoff denial conclusion. */
  readonly authorizationDenialBeforeHandoff?: true;
  /** Release application/target exclusivity only after verified document and process cleanup. */
  readonly releaseLease?: () => Promise<void>;
  /** Exact launch command retained in local ownership metadata. */
  readonly launcherCommand?: string;
} & (
  | (ProviderProcessLaunch & {
      readonly shutdownMode: "bridge-request";
      readonly preparedImagePath?: string;
      /** The owned helper may hand off to an external GUI application. */
      readonly providerLifetime: "launcher-process" | "external-application";
    })
  | (Extract<ProviderProcessLaunch, { readonly ownsProcessLifetime: true }> & {
      readonly shutdownMode: "process-cleanup";
      readonly preparedImagePath?: string;
      readonly providerLifetime: "launcher-process";
      readonly cleanup: NonNullable<ProviderProcessLaunch["cleanup"]>;
    })
);

/** Application-owned capability that starts the in-Hopper bridge. */
export interface BridgeLauncher {
  /** Retry owned pre-launch resources even when no application was started. */
  cleanup?(): Promise<Result<null, ProviderCleanupError>>;
  launch(
    session: BridgeSession,
    options?: { readonly signal?: AbortSignal },
  ): Promise<
    Result<
      BridgeLaunch,
      HopperStartError | HopperCancelledError | HopperProcessError
    >
  >;
}

interface SharedHopperApplicationLauncherOptions {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly launcherPath: string;
  readonly targetPath: string;
  readonly targetKind: "executable" | "database";
  /** Selected artifact identity; provider-created executable launches always supply it. */
  readonly targetSha256?: string;
  readonly loaderArgs: readonly string[];
  readonly bridgeScriptPath: string;
  /** Caller-selected request ceiling. Omitted or source default leaves the bridge at 16 MiB. */
  readonly bridgeMaxRequestBytes?: BridgeMaxRequestBytes;
  readonly preparedImage?: {
    readonly image: HopperMachOImage;
    readonly sourceSha256: string;
  };
}

/** Explicit launcher contract; the Linux adapter verifies its pinned Hopper build before execution. */
export type HopperApplicationLauncherOptions =
  | (SharedHopperApplicationLauncherOptions & {
      readonly launchMode: "native";
      readonly demoHelperPath?: never;
    })
  | (SharedHopperApplicationLauncherOptions & {
      readonly launchMode: "verified_linux_demo";
      readonly demoHelperPath: string;
    });

export interface HopperApplicationLauncherDependencies {
  readonly imageFileSystem?: HopperImageCopyFileSystem;
  readonly verifyNativeHelper?: typeof verifyMacHopperNativeHelper;
  readonly verifyLinuxLauncher?: typeof inspectLinuxHopperLauncher;
  readonly retryPublisherCleanup?: typeof retryLinuxHopperPublisherCleanup;
  readonly platform?: NodeJS.Platform;
  readonly acquireTargetLease?: typeof acquireHopperTargetLease;
  readonly acquireApplicationLease?: typeof acquireLinuxHopperApplicationLease;
  readonly selectPrivateDisplay?: (options: {
    readonly environment: Readonly<NodeJS.ProcessEnv>;
    readonly helperPath: string;
    readonly signal?: AbortSignal;
  }) => Promise<LinuxPrivateDisplaySelection>;
  /**
   * How long teardown waits for the Linux demo helper's orderly shutdown
   * (stdin EOF → SIGTERM to Hopper and Xvfb) before the process-group kill.
   */
  readonly demoOrderlyShutdownGraceMs?: number;
}

/**
 * Launches Hopper through its documented CLI and injects only REA's owned bridge.
 *
 * Hopper's `hopper` helper internally issues an AppleScript `activate` command.
 * Consequently, opening a target may bring Hopper to the foreground even though
 * REA first asks macOS to start the application hidden and in the background.
 * REA cannot reliably suppress that activation without replacing Hopper's
 * supported launcher; callers must treat possible foreground UI as an upstream
 * Hopper constraint, not as evidence that analysis failed.
 *
 * REA owns only the short-lived launcher helper's run-token-authenticated
 * process group. It does not claim ownership of the Hopper GUI process that
 * macOS LaunchServices may create or reuse.
 */
export class HopperApplicationLauncher implements BridgeLauncher {
  readonly #preparedImageResources = new ArtifactResourceScope();
  readonly #probeResources = new ArtifactResourceScope();

  constructor(
    readonly options: HopperApplicationLauncherOptions,
    readonly dependencies: HopperApplicationLauncherDependencies = {},
  ) {}

  async cleanup(): Promise<Result<null, ProviderCleanupError>> {
    const failures: ProviderCleanupError[] = [];
    try {
      await this.#preparedImageResources.retryCleanup();
    } catch (cause: unknown) {
      const observation = ArtifactReaderFailure.cleanupObservation(
        cause,
        this.#preparedImageResources.cleanupResources,
      );
      const failure = new ProviderCleanupError(
        "hopper",
        observation.resources,
        { reason: observation.reason },
        { cause },
      );
      bindRetainedArtifactCleanup(failure, cause);
      failures.push(failure);
    }
    try {
      await this.#probeResources.retryCleanup();
    } catch (cause: unknown) {
      const observation = ArtifactReaderFailure.cleanupObservation(
        cause,
        this.#probeResources.cleanupResources,
      );
      const failure = new ProviderCleanupError(
        "hopper",
        observation.resources,
        { reason: observation.reason },
        { cause },
      );
      bindRetainedArtifactCleanup(failure, cause);
      failures.push(failure);
    }
    if (usesLinuxDemo(this.options)) {
      try {
        await (
          this.dependencies.retryPublisherCleanup ??
          retryLinuxHopperPublisherCleanup
        )();
      } catch (cause: unknown) {
        const observation = ArtifactReaderFailure.cleanupObservation(
          cause,
          "hopper-publisher-verification",
        );
        const failure = new ProviderCleanupError(
          "hopper",
          observation.resources,
          { reason: observation.reason },
          { cause },
        );
        bindRetainedArtifactCleanup(failure, cause);
        failures.push(failure);
      }
    }
    if (failures.length === 0) return ok(null);
    if (failures.length === 1) return err(failures[0]!);
    const resources = [
      ...new Set(failures.flatMap((failure) => failure.cleanupResources)),
    ];
    const failure = new ProviderCleanupError(
      "hopper",
      resources,
      {
        reason: failures.map((failure) => failure.message).join("; "),
      },
      {
        cause: new AggregateError(
          failures,
          "Hopper image and publisher cleanup remain incomplete",
        ),
      },
    );
    return err(failure.bindCleanupDependencies(failures));
  }

  async launch(
    session: BridgeSession,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<
    Result<
      BridgeLaunch,
      HopperStartError | HopperCancelledError | HopperProcessError
    >
  > {
    const leaseResult = await this.#acquireLaunchLease(session.runId);
    if (!leaseResult.ok) return leaseResult;
    const lease = leaseResult.value;
    const outcome = await (async () => {
      let loadedPath = this.options.targetPath;
      const preparedImage = this.options.preparedImage;
      const sourceSha256 =
        preparedImage?.sourceSha256 ??
        (this.options.targetKind === "executable"
          ? this.options.targetSha256
          : undefined);
      if (sourceSha256 !== undefined) {
        let prepared: Awaited<ReturnType<typeof prepareHopperMachOImage>>;
        try {
          const copyOptions = {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            resourceScope: this.#preparedImageResources,
            ...(this.dependencies.imageFileSystem === undefined
              ? {}
              : { fileSystem: this.dependencies.imageFileSystem }),
          };
          prepared = await this.#preparedImageResources.run(() =>
            preparedImage === undefined
              ? prepareHopperExecutableImage(
                  this.options.targetPath,
                  sourceSha256,
                  join(session.directory, "image.executable"),
                  copyOptions,
                )
              : prepareHopperMachOImage(
                  this.options.targetPath,
                  sourceSha256,
                  preparedImage.image,
                  join(session.directory, "image.macho"),
                  copyOptions,
                ),
          );
        } catch (cause: unknown) {
          const failure = new HopperStartError({
            cause,
            userMessage: `Previous Hopper image cleanup remains incomplete: ${cause instanceof Error ? cause.message : String(cause)}`,
            cleanup: {
              reason: cause instanceof Error ? cause.message : String(cause),
              resources: this.#preparedImageResources.cleanupResources,
            },
          });
          bindRetainedArtifactCleanup(failure, cause);
          return err(failure);
        }
        if (!prepared.ok) return prepared;
        loadedPath = prepared.value;
      }
      const ownsProcessLifetime = usesLinuxDemo(this.options);
      const bootstrap = await this.#writeBootstrap(
        session,
        ownsProcessLifetime,
        loadedPath,
      );
      if (!bootstrap.ok) return bootstrap;
      const launched = await this.#launchPreparedTarget({
        session,
        signal: options.signal,
        bootstrapPath: bootstrap.value,
        loadedPath,
        ownsProcessLifetime,
        lease,
      });
      return launched;
    })().catch((cause: unknown) => err(new HopperStartError({ cause })));
    if (outcome.ok || lease === undefined) return outcome;
    const released = await this.#probeResources.release({
      kind: "lease",
      resource: lease.socketPath ?? session.directory,
      lease,
    });
    if (released.kind === "released") return outcome;
    const cleanup = this.#probeResources.cleanupFailure({ kind: "completed" }, [
      released,
    ]);
    const leaseFailure = new HopperStartError({
      cause: cleanup,
      cleanup: cleanup.cleanup,
    });
    bindRetainedArtifactCleanup(leaseFailure, cleanup);
    const failure = new HopperStartError({
      cause: cleanup,
      cleanupPrimary: outcome.error,
      cleanup: cleanup.cleanup,
      ...(outcome.error.userMessage === undefined
        ? {}
        : { userMessage: outcome.error.userMessage }),
    });
    failure.bindCleanupDependencies([outcome.error, leaseFailure]);
    return err(failure);
  }

  async #launchPreparedTarget(input: {
    readonly session: BridgeSession;
    readonly signal: AbortSignal | undefined;
    readonly bootstrapPath: string;
    readonly loadedPath: string;
    readonly ownsProcessLifetime: boolean;
    readonly lease: OwnedLease | undefined;
  }): Promise<
    Result<
      BridgeLaunch,
      HopperStartError | HopperCancelledError | HopperProcessError
    >
  > {
    const { session, signal, bootstrapPath, ownsProcessLifetime, lease } =
      input;
    const action =
      this.options.targetKind === "database" ? "--database" : "--executable";
    const argumentsForTarget = [
      ...this.options.loaderArgs,
      "--analysis",
      "-Y",
      bootstrapPath,
      action,
      input.loadedPath,
    ];
    let launched = false;
    try {
      if (signal?.aborted === true) return err(hopperCancelledBySignal(signal));
      if ((this.dependencies.platform ?? process.platform) === "darwin") {
        // The vendor helper embeds argv in AppleScript quoted literals. Check
        // the actual prepared paths before even starting the application. Do
        // not rewrite caller names or double-escape values passed to the helper.
        const rejected = [
          this.options.launcherPath,
          ...argumentsForTarget,
        ].findIndex((value) => /["\\\r\n]/u.test(value));
        if (rejected !== -1)
          return err(
            new HopperStartError({
              userMessage:
                "The macOS Hopper launcher cannot pass double quotes, backslashes or line breaks literally through its AppleScript handoff. Select launcher, target and runtime paths and loader arguments without these characters; the selected values were not rewritten.",
              launchRejection: {
                boundary: "argument_encoding",
                reason: "applescript_literal",
                ...(rejected === 0
                  ? { source: "launcher_path" as const }
                  : {
                      source: "argument" as const,
                      argument_index: rejected - 1,
                    }),
              },
            }),
          );
      }
      let expectedLinuxSha256: string | undefined;
      if (usesLinuxDemo(this.options)) {
        const inspected = await (
          this.dependencies.verifyLinuxLauncher ?? inspectLinuxHopperLauncher
        )(this.options.launcherPath, this.options.environment, signal);
        if (!inspected.ok)
          return inspected.error.reason === "cancelled"
            ? err(cancelledLauncherVerification(signal, inspected.error))
            : err(
                new HopperStartError({
                  userMessage: inspected.error.message,
                  cause: inspected.error,
                  launchRejection: {
                    boundary: "publisher_verification",
                    reason: inspected.error.reason,
                  },
                }),
              );
        expectedLinuxSha256 = inspected.value.sha256;
      }
      const display = await this.#privateDisplay(signal);
      if (!display.ok) return err(display.error);
      const nativeHelperVerified =
        (this.dependencies.platform ?? process.platform) === "darwin" &&
        this.options.launchMode === "native" &&
        (await (
          this.dependencies.verifyNativeHelper ?? verifyMacHopperNativeHelper
        )(this.options.launcherPath, this.options.environment, signal)) ===
          "verified";
      const prepared = await prepareHopperApplication(
        this.options.launcherPath,
        this.options.environment,
        signal,
      );
      if (!prepared) return err(hopperCancelledBySignal(signal));
      const linuxDemo = linuxDemoLaunch(
        this.options,
        session,
        argumentsForTarget,
        display.strategy,
        expectedLinuxSha256,
      );
      const started = await launchHopperProcess({
        options: this.options,
        session,
        bootstrapPath,
        ownsProcessLifetime,
        argumentsForTarget,
        linuxDemo,
        signal,
      });
      if (started === null) return err(hopperCancelledBySignal(signal));
      launched = true;
      const cleanup = () =>
        cleanupHopperLauncherSession({
          helper: linuxDemo === undefined ? undefined : started.process,
          ownership: started.ownership,
          orderlyShutdownGraceMs:
            this.dependencies.demoOrderlyShutdownGraceMs ??
            LINUX_DEMO_ORDERLY_SHUTDOWN_GRACE_MS,
        });
      const ownedLauncher = {
        ...(input.loadedPath === this.options.targetPath
          ? {}
          : { preparedImagePath: input.loadedPath }),
        process: started.process,
        ownsProcessLifetime: true as const,
        ownership: started.ownership,
        cleanup,
        launcherCommand: linuxDemo?.command ?? this.options.launcherPath,
        ...(lease === undefined ? {} : { releaseLease: () => lease.release() }),
      };
      return ownsProcessLifetime
        ? ok({
            ...ownedLauncher,
            providerLifetime: "launcher-process",
            shutdownMode: "process-cleanup",
          })
        : ok({
            ...ownedLauncher,
            providerLifetime: "external-application",
            shutdownMode: "bridge-request",
            ...(nativeHelperVerified
              ? { nativeHelperVerified: true as const }
              : {}),
            // Argument admission above established literal handoff semantics.
            ...((this.dependencies.platform ?? process.platform) === "darwin"
              ? { authorizationDenialBeforeHandoff: true as const }
              : {}),
          });
    } catch (cause: unknown) {
      return err(hopperLaunchFailure(cause, signal));
    } finally {
      // Remove the token-bearing bootstrap file on every non-success path.
      // This is best effort: the caller owns session.directory and performs
      // authoritative private-runtime cleanup, retaining it when removal fails.
      if (!launched)
        await rm(bootstrapPath, { force: true }).catch(() => undefined);
    }
  }

  async #acquireLaunchLease(
    runId: string,
  ): Promise<Result<OwnedLease | undefined, HopperStartError>> {
    const platform = this.dependencies.platform ?? process.platform;
    const applicationLease =
      platform === "linux" && usesLinuxDemo(this.options);
    if (!applicationLease && platform !== "darwin") return ok(undefined);
    try {
      const acquisition = applicationLease
        ? await (
            this.dependencies.acquireApplicationLease ??
            acquireLinuxHopperApplicationLease
          )({ runId, resources: this.#probeResources })
        : await (
            this.dependencies.acquireTargetLease ?? acquireHopperTargetLease
          )({
            targetPath: this.options.targetPath,
            targetKind: this.options.targetKind,
            loaderArgs: this.options.loaderArgs,
            runId,
            resources: this.#probeResources,
          });
      if (!acquisition.acquired)
        return err(
          new HopperStartError({
            ownerRunId: acquisition.owner.runId,
            userMessage: applicationLease
              ? `Linux Hopper is already active in REA session ${acquisition.owner.runId}; it cannot open ${this.options.targetPath} in another session. This build forwards new launches to the existing application. Use the owning REA session to switch targets, or close it before retrying.`
              : `This Hopper target is already open in REA session ${acquisition.owner.runId}. ` +
                "Use that REA session or close it before opening this target again.",
          }),
        );
      return ok(acquisition.lease);
    } catch (cause: unknown) {
      return err(
        cause instanceof HopperStartError
          ? cause
          : new HopperStartError({ cause }),
      );
    }
  }

  async #writeBootstrap(
    session: BridgeSession,
    ownsProcessLifetime: boolean,
    loadedPath: string,
  ): Promise<Result<string, HopperStartError>> {
    const bootstrapPath = `${session.directory}/bootstrap.py`;
    try {
      await writeFile(
        bootstrapPath,
        bridgeBootstrapSource(
          session,
          this.options,
          ownsProcessLifetime,
          loadedPath,
        ),
        { encoding: "utf8", mode: 0o600 },
      );
      await chmod(bootstrapPath, 0o600);
      return ok(bootstrapPath);
    } catch (cause: unknown) {
      // Best effort; the caller also owns cleanup of the private runtime root.
      await rm(bootstrapPath, { force: true }).catch(() => undefined);
      return err(new HopperStartError({ cause }));
    }
  }

  async #privateDisplay(signal: AbortSignal | undefined): Promise<
    | {
        readonly ok: true;
        readonly strategy: LinuxPrivateDisplayRunnableStrategy | undefined;
      }
    | {
        readonly ok: false;
        readonly error: HopperProcessError | HopperCancelledError;
      }
  > {
    if (!usesLinuxDemo(this.options)) return { ok: true, strategy: undefined };
    const selection = await (
      this.dependencies.selectPrivateDisplay ??
      selectLinuxPrivateDisplayStrategy
    )({
      helperPath: this.options.demoHelperPath,
      environment: this.options.environment,
      ...(signal === undefined ? {} : { signal }),
    });
    const pending = selection.ok ? undefined : selection.cleanup;
    if (pending !== undefined)
      this.#probeResources.retain({
        kind: "lease",
        resource: "hopper-private-display-probe",
        lease: pending.lease,
      });
    const cleanup =
      pending === undefined
        ? undefined
        : {
            reason: pending.reason,
            resources: [
              ...(pending.lease.cleanupResources ?? [
                "hopper-private-display-probe",
              ]),
            ],
          };
    const error =
      signal?.aborted === true
        ? new HopperCancelledError(signal.reason, { cleanup })
        : selection.ok
          ? undefined
          : new HopperProcessError(selection.exitCode, {
              diagnostic: selection.diagnostic,
              cleanup,
            });
    if (error === undefined)
      return {
        ok: true,
        strategy: selection.ok ? selection.strategy : undefined,
      };
    if (pending !== undefined)
      new AnalysisCleanupLeaseGroup(error, [pending.lease]);
    return { ok: false, error };
  }
}

/** Bootstrap assignments Hopper execs before the bridge module. Exported for the ceiling regression. */
export const bridgeBootstrapSource = (
  session: BridgeSession,
  options: SharedHopperApplicationLauncherOptions,
  ownsProcessLifetime: boolean,
  loadedPath: string,
): string => {
  const limit = options.bridgeMaxRequestBytes;
  const injectedLimit =
    limit?.source === "setting" &&
    Number.isSafeInteger(limit.maximumBytes) &&
    limit.maximumBytes >= MINIMUM_BRIDGE_MAX_REQUEST_BYTES &&
    limit.maximumBytes <= MAXIMUM_BRIDGE_MAX_REQUEST_BYTES
      ? `REA_BRIDGE_MAX_REQUEST_BYTES = ${String(limit.maximumBytes)}`
      : undefined;
  return [
    `REA_SOCKET = ${JSON.stringify(session.socketPath)}`,
    `REA_TOKEN = ${JSON.stringify(session.token)}`,
    `REA_RUN_ID = ${JSON.stringify(session.runId)}`,
    `REA_TARGET_PATH = ${JSON.stringify(loadedPath)}`,
    `REA_OWNS_PROCESS_LIFETIME = ${ownsProcessLifetime ? "True" : "False"}`,
    `REA_RECONNECT_TIMEOUT_SECONDS = ${HOPPER_SHUTDOWN_TIMEOUT_MS / 1_000}`,
    ...(injectedLimit === undefined ? [] : [injectedLimit]),
    `exec(compile(open(${JSON.stringify(options.bridgeScriptPath)}, 'rb').read(), ${JSON.stringify(options.bridgeScriptPath)}, 'exec'))`,
    "",
  ].join("\n");
};

const launchHopperProcess = async (input: {
  readonly options: HopperApplicationLauncherOptions;
  readonly session: BridgeSession;
  readonly bootstrapPath: string;
  readonly ownsProcessLifetime: boolean;
  readonly argumentsForTarget: readonly string[];
  readonly linuxDemo: ReturnType<typeof linuxDemoLaunch>;
  readonly signal: AbortSignal | undefined;
}): Promise<Awaited<ReturnType<typeof spawnOwnedProviderProcess>> | null> => {
  const ownershipCommand =
    input.linuxDemo?.ownershipCommand ?? input.options.launcherPath;
  const spawn = (arguments_: readonly string[]) =>
    spawnOwnedProviderProcess({
      command: input.options.launcherPath,
      arguments: arguments_,
      runId: input.session.runId,
      expectedCommand: ownershipCommand,
      hostEnvironment: input.options.environment,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  if (input.linuxDemo !== undefined)
    return spawnOwnedProviderProcess({
      command: input.linuxDemo.command,
      arguments: input.linuxDemo.args,
      runId: input.session.runId,
      expectedCommand: ownershipCommand,
      hostEnvironment: input.options.environment,
      // The helper observes EOF when this REA process exits, including SIGKILL.
      stdin: "pipe",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  return spawn(input.argumentsForTarget);
};

export const linuxDemoLaunch = (
  options: HopperApplicationLauncherOptions,
  session: BridgeSession,
  hopperArgs: readonly string[],
  strategy: LinuxPrivateDisplayRunnableStrategy | undefined,
  expectedSha256?: string,
):
  | {
      readonly command: string;
      readonly args: readonly string[];
      readonly ownershipCommand: string;
    }
  | undefined => {
  if (!usesLinuxDemo(options) || options.demoHelperPath === undefined)
    return undefined;
  if (expectedSha256 === undefined || !/^[a-f0-9]{64}$/u.test(expectedSha256))
    throw new TypeError(
      "Linux Hopper launch requires an authenticated launcher SHA-256",
    );
  const helperArguments = [
    options.demoHelperPath,
    "--owner-stdin",
    "--strategy",
    strategy ?? "direct",
    ...(strategy === "user-mount-namespace" ? ["--mount-private-x11"] : []),
    "--hopper",
    options.launcherPath,
    "--expected-launcher-sha256",
    expectedSha256,
    "--socket",
    session.socketPath,
    "--",
    options.launcherPath,
    ...hopperArgs,
  ];
  if (strategy === "user-mount-namespace")
    return {
      command: "/usr/bin/unshare",
      ownershipCommand: "/usr/bin/python3",
      args: [
        "--user",
        "--map-root-user",
        "--mount",
        "--propagation",
        "private",
        "/usr/bin/python3",
        ...helperArguments,
      ],
    };
  return {
    command: "/usr/bin/python3",
    ownershipCommand: "/usr/bin/python3",
    args: helperArguments,
  };
};

const cancelledLauncherVerification = (
  signal: AbortSignal | undefined,
  error: Error,
): HopperCancelledError => {
  if (signal?.aborted === true) return new HopperCancelledError(signal.reason);
  return Object.hasOwn(error, "cause")
    ? new HopperCancelledError(error.cause)
    : new HopperCancelledError();
};

const hopperLaunchFailure = (
  cause: unknown,
  signal: AbortSignal | undefined,
): HopperCancelledError | HopperStartError =>
  signal?.aborted === true
    ? new HopperCancelledError(signal.reason)
    : new HopperStartError({ cause });

/**
 * Shut down a launched Hopper session, asking the Linux demo helper to stop
 * orderly before the process-group kill.
 *
 * The helper treats stdin EOF as its shutdown signal (OwnerLifetime): its
 * run_launch finally block then stops Hopper and Xvfb with SIGTERM, and Xvfb
 * removes its /tmp/.X<n>-lock on that clean exit. SIGKILLing the group first
 * orphans the lock, and later startups count each orphan as an
 * address_collision. Anything still alive after the grace period is reaped by
 * the token-verified group cleanup, so a stuck helper cannot hang teardown.
 */
const cleanupHopperLauncherSession = async (input: {
  readonly helper: ProviderProcessHandle | undefined;
  readonly ownership: OwnedProcessGroup;
  readonly orderlyShutdownGraceMs: number;
}): Promise<ProcessCleanupResult> => {
  const helper = input.helper;
  if (
    helper !== undefined &&
    helper.exitCode === null &&
    helper.signalCode === null
  ) {
    try {
      helper.stdin?.end();
    } catch {
      // Already gone; the group cleanup below covers the remainder.
    }
    await waitForHelperExit(helper, input.orderlyShutdownGraceMs);
  }
  return cleanupOwnedProcessGroup(input.ownership);
};

/** Wait for the helper's exit, giving up after the grace period. */
const waitForHelperExit = (
  helper: ProviderProcessHandle,
  timeoutMs: number,
): Promise<void> =>
  new Promise((resolve) => {
    if (helper.exitCode !== null || helper.signalCode !== null)
      return resolve();
    const timer = setTimeout(
      () => {
        helper.off("exit", onExit);
        resolve();
      },
      Math.max(0, timeoutMs),
    );
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    helper.once("exit", onExit);
  });

/** Select the publisher-verified demo adapter from the caller's explicit launch mode. */
export const usesLinuxDemo = (
  options: HopperApplicationLauncherOptions,
): options is HopperApplicationLauncherOptions & {
  readonly launchMode: "verified_linux_demo";
  readonly demoHelperPath: string;
} => options.launchMode === "verified_linux_demo";

const prepareHopperApplication = async (
  launcherPath: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  signal?: AbortSignal,
): Promise<boolean> => {
  const appBundle = hopperApplicationBundle(launcherPath);
  if (appBundle === undefined) return signal?.aborted !== true;
  const executablePath = join(appBundle, "Contents/MacOS/Hopper Disassembler");
  if (await processIsRunning(executablePath, environment))
    return signal?.aborted !== true;
  // This reduces activation when Hopper is cold, but the vendor launcher that
  // follows may still activate its window. See HopperApplicationLauncher.
  await execFileAsync(
    "/usr/bin/open",
    ["--hide", "--background", "-a", appBundle],
    { env: environment },
  );
  return (
    (await waitForAbortableDelay(HOPPER_BACKGROUND_STARTUP_MS, signal)) ===
    "elapsed"
  );
};

const hopperApplicationBundle = (launcherPath: string): string | undefined => {
  if (basename(launcherPath) !== "hopper") return undefined;
  const candidate = dirname(dirname(dirname(launcherPath)));
  return extname(candidate) === ".app" ? candidate : undefined;
};

const processIsRunning = async (
  executablePath: string,
  environment: Readonly<NodeJS.ProcessEnv>,
): Promise<boolean> => {
  try {
    const processes = await execFileOutput(
      "/bin/ps",
      ["-ax", "-o", "command="],
      { env: environment },
    );
    return processes.stdout
      .split("\n")
      .some((command) => command.trim() === executablePath);
  } catch (cause: unknown) {
    // best-effort cleanup: optional process probing; failure means not running.
    void cause;
    return false;
  }
};
