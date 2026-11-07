import { selectArtifactCommandPath } from "../../process/ArtifactCommandPath.js";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { prlimitArgumentVector } from "../../process/LinuxResourceLimits.js";
import { cleanupOwnedProcessGroup } from "../../process/ProcessOwnership.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
  type OwnedProviderProcessSpawnOptions,
  type SpawnedOwnedProviderProcess,
} from "../../process/ProviderProcess.js";
import {
  checkRecoveryDeadline,
  inventoryRecoveryFiles,
  fingerprintRecoveryFile,
  recoveryFailureMessage,
} from "./RecoveryFiles.js";
import { RECOVERY_LIMITS, wakaruFixedLimitRecovery } from "./WakaruRelease.js";

const OPERATION = "recover_javascript_sources";
const WAKARU_REQUIREMENT =
  "Provide an absolute REA_WAKARU_COMMAND pointing to a Wakaru ^1.13.0 Linux x64 binary (verified with 1.14.0); no tool is installed by REA. See docs/javascript-recovery.md#install-wakaru.";

/** Wakaru recovery runs only on Linux x64; discovery and execution share this check. */
export const wakaruHostSupported = (
  platform: NodeJS.Platform,
  arch: string,
): boolean => platform === "linux" && arch === "x64";

/** Inject the owned process launcher while retaining production protocol parsing. */
export type WakaruLauncher = (
  options: OwnedProviderProcessSpawnOptions,
) => Promise<SpawnedOwnedProviderProcess>;

/** Cleanup failure carrying the live supervisor so the provider can retry it. */
export class WakaruCleanupFailure extends ProviderCleanupError {
  constructor(
    readonly cleanupOwner: ProviderProcessSupervisor,
    readonly runId: string,
    readonly cwd: string,
    reason: string,
    previousError: unknown,
    snapshot: ReturnType<ProviderProcessSupervisor["snapshot"]>,
  ) {
    super(
      "wakaru",
      [runId, cwd],
      {
        reason,
        previous_error:
          previousError instanceof Error ? previousError.message : null,
        exit_code: snapshot.exitCode ?? null,
        signal: snapshot.signal ?? null,
      },
      { operation: OPERATION, cause: previousError },
    );
  }
}

/** Resolve and fingerprint explicitly configured tools; acquire nothing at startup. */
export const resolveWakaruCommand = async (
  environment: Readonly<Record<string, string | undefined>>,
  resources?: ArtifactResourceScope,
  signal?: AbortSignal,
) => {
  const configured = environment.REA_WAKARU_COMMAND;
  if (
    !wakaruHostSupported(process.platform, process.arch) ||
    configured === undefined ||
    !isAbsolute(configured)
  )
    throw new AnalysisCapabilityUnavailableError(
      "wakaru",
      OPERATION,
      WAKARU_REQUIREMENT,
      { userMessage: WAKARU_REQUIREMENT },
    );
  try {
    const selection = await selectArtifactCommandPath(configured, signal);
    await access(selection.resolvedPath, constants.R_OK | constants.X_OK);
    const fingerprint = await fingerprintRecoveryFile(
      selection.resolvedPath,
      RECOVERY_LIMITS.outputBytes,
      signal,
      resources,
    );
    const limiter =
      environment.REA_JAVASCRIPT_PRLIMIT_COMMAND ?? "/usr/bin/prlimit";
    if (!isAbsolute(limiter))
      throw new TypeError("REA_JAVASCRIPT_PRLIMIT_COMMAND must be absolute");
    const limiterSelection = await selectArtifactCommandPath(limiter, signal);
    await access(limiterSelection.resolvedPath, constants.X_OK);
    if (!(await stat(limiter)).isFile())
      throw new TypeError(`Resource limiter is not a regular file: ${limiter}`);
    return { command: selection, limiter: limiterSelection, ...fingerprint };
  } catch (cause: unknown) {
    if (
      cause instanceof AnalysisCancelledError ||
      cause instanceof AnalysisArtifactChangedError ||
      (cause instanceof ArtifactReaderFailure &&
        (cause.cleanup !== undefined || cause.reason === "cancelled"))
    )
      throw cause;
    const reason = `Configured Wakaru or util-linux prlimit is unavailable: ${recoveryFailureMessage(cause)}`;
    throw new AnalysisCapabilityUnavailableError("wakaru", OPERATION, reason, {
      cause,
      userMessage: reason,
    });
  }
};

type WakaruCommandContext = {
  command: string;
  limiter: string;
  arguments: readonly string[];
  cwd: string;
  deadline: number;
  environment: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
  launcher?: WakaruLauncher;
  staging?: string;
  resources?: ArtifactResourceScope;
};

/** Run one bounded command and verify cleanup before consuming its output. */
export const runWakaruCommand = async (context: WakaruCommandContext) => {
  checkRecoveryDeadline(context.deadline, context.signal);
  const runId = `rea-wakaru-${randomUUID()}`;
  const spawned = await (context.launcher ?? spawnOwnedProviderProcess)({
    command: context.limiter,
    arguments: [
      ...prlimitArgumentVector(
        {
          address_space_bytes: RECOVERY_LIMITS.addressSpaceBytes,
          file_bytes: RECOVERY_LIMITS.outputBytes,
          cpu_seconds: RECOVERY_LIMITS.cpuSeconds,
        },
        context.command,
      ),
      ...context.arguments,
    ],
    expectedCommand: null,
    runId,
    cwd: context.cwd,
    hostEnvironment: context.environment,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    env: { TMPDIR: context.cwd, RAYON_NUM_THREADS: "1", NO_COLOR: "1" },
  }).catch((cause: unknown) => {
    if (context.signal?.aborted === true)
      throw new AnalysisCancelledError(OPERATION, {
        cause: context.signal.reason,
      });
    throw new ProviderAdapterError("wakaru", OPERATION, {
      cause,
      diagnostics: {
        reason: "Failed to launch configured Wakaru through util-linux prlimit",
        command: context.command,
        detail: recoveryFailureMessage(cause),
      },
    });
  });
  let oversized = false;
  const supervisor = new ProviderProcessSupervisor(
    {
      ...spawned,
      ownsProcessLifetime: true,
      cleanup:
        spawned.cleanup ?? (() => cleanupOwnedProcessGroup(spawned.ownership)),
    },
    {
      onDiagnostic: (event) => {
        if (
          event.type === "output" &&
          event.totalBytes > RECOVERY_LIMITS.reportBytes
        )
          oversized = true;
      },
    },
  );
  let failure: unknown;
  try {
    while (!(await supervisor.waitForOutputClose(100))) {
      checkRecoveryDeadline(context.deadline, context.signal);
      if (oversized)
        throw new AnalysisOutputError(
          OPERATION,
          "Wakaru diagnostic stream exceeds 8 MiB",
          wakaruFixedLimitRecovery(
            `Wakaru diagnostic stream exceeds the ${String(RECOVERY_LIMITS.reportBytes)}-byte report allowance`,
          ),
        );
      if (context.staging !== undefined)
        await inventoryRecoveryFiles(
          context.staging,
          context.signal,
          context.resources,
        );
    }
    checkRecoveryDeadline(context.deadline, context.signal);
    if (oversized)
      throw new AnalysisOutputError(
        OPERATION,
        "Wakaru diagnostic stream exceeds 8 MiB",
        wakaruFixedLimitRecovery(
          `Wakaru diagnostic stream exceeds the ${String(RECOVERY_LIMITS.reportBytes)}-byte report allowance`,
        ),
      );
  } catch (cause: unknown) {
    failure = cause;
  }
  const stopped = await supervisor.stop();
  const snapshot = supervisor.snapshot();
  if (stopped.status === "incomplete")
    throw new WakaruCleanupFailure(
      supervisor,
      runId,
      context.cwd,
      stopped.reason,
      failure,
      snapshot,
    );
  if (failure !== undefined) throw failure;
  if (context.signal?.aborted === true)
    throw new AnalysisCancelledError(OPERATION, {
      cause: context.signal.reason,
    });
  return {
    exit_code: snapshot.exitCode ?? null,
    signal: snapshot.signal ?? null,
    stdout: snapshot.stdout.text,
    stderr: snapshot.stderr.text,
    command: context.command,
    arguments: [...context.arguments],
    resource_limiter: context.limiter,
  };
};
