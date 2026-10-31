import {
  assertRegularFileActive,
  RegularFileOperationCancelled,
} from "../filesystem/RegularFile.js";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { access, realpath, stat } from "node:fs/promises";
import { appendCallerPath } from "../filesystem/callerPath.js";

import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import {
  hashStableFile,
  observeStableFile,
  stableFileHashCause,
} from "../filesystem/StableFileHash.js";
import type { RetainedResourceScope } from "../application/AnalysisProvider.js";
import {
  RegularFileCleanupFailure,
  RegularFileCancelled,
  regularFileCancellation,
} from "../filesystem/OwnedRegularFile.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../process/OwnedCommand.js";
import { retainOwnedCommandCleanup } from "../providers/OwnedCommandCleanup.js";
import { assertArtifactCommandPath } from "../process/ArtifactCommandPath.js";
import type {
  OwnedProviderProcessSpawnOptions,
  ProviderProcessSnapshot,
  SpawnedOwnedProviderProcess,
} from "../process/ProviderProcess.js";
import {
  readKunaConfiguration,
  type KunaConfiguration,
  type KunaConfigurationFailure,
} from "./KunaConfiguration.js";
import {
  KUNA_COMMAND_REMEDIATION,
  KUNA_VERIFIED_VERSION,
  KUNA_VERSION_PROBE_REMEDIATION,
} from "./KunaRelease.js";

/** `kuna --version` exits before loading specs or an input; it needs no budget beyond this. */
const VERSION_PROBE_TIMEOUT_MS = 10_000;
const VERSION_PROBE_MAX_OUTPUT_BYTES = 64 * 1024;

/** Release CI prints exactly `kuna <MAJOR.MINOR>`; source builds print the Cargo version. */
const VERSION_LINE = /^kuna (\d+\.\d+(?:\.\d+)?)\r?\n?$/u;

const versionProbeOutput = (snapshot: ProviderProcessSnapshot | null) => ({
  stdout: snapshot?.stdout.text ?? "",
  stderr: snapshot?.stderr.text ?? "",
  exitCode: snapshot?.exitCode ?? null,
  signal: snapshot?.signal ?? null,
  stdoutBytes: snapshot?.stdout.bytes ?? 0,
  stdoutObservedBytes: snapshot?.stdout.observedBytes ?? 0,
  stderrBytes: snapshot?.stderr.bytes ?? 0,
  stderrObservedBytes: snapshot?.stderr.observedBytes ?? 0,
  stdoutInvalidUtf8: snapshot?.stdout.invalidUtf8 === true,
  stderrInvalidUtf8: snapshot?.stderr.invalidUtf8 === true,
  diagnosticTruncated: snapshot?.diagnosticTruncated === true,
  outputIncomplete: snapshot?.outputIncomplete === true,
  truncated:
    snapshot?.diagnosticTruncated === true ||
    snapshot?.outputIncomplete === true ||
    (snapshot !== null &&
      snapshot !== undefined &&
      snapshot.stdout.bytes < snapshot.stdout.observedBytes),
});

const versionProbeOutputDiagnostics = (
  output: ReturnType<typeof versionProbeOutput>,
) => ({
  stdout: output.stdout,
  stderr: output.stderr,
  exit_code: output.exitCode,
  signal: output.signal,
  stdout_bytes: output.stdoutBytes,
  stdout_observed_bytes: output.stdoutObservedBytes,
  stderr_bytes: output.stderrBytes,
  stderr_observed_bytes: output.stderrObservedBytes,
  ...(output.stdoutInvalidUtf8 ? { stdout_invalid_utf8: true } : {}),
  ...(output.stderrInvalidUtf8 ? { stderr_invalid_utf8: true } : {}),
  diagnostic_truncated: output.diagnosticTruncated,
  output_incomplete: output.outputIncomplete,
  output_truncated: output.truncated,
});

/** One observed Kuna executable, identified by its bytes as well as its version. */
export interface KunaInstallation {
  readonly configuration: KunaConfiguration;
  /** Canonical path of the probed executable. */
  readonly executable: string;
  readonly version: string;
  /** Whether this release is the one REA verified. */
  readonly verified: boolean;
  readonly sha256: string;
  readonly bytes: number;
  /**
   * Whether the executable is a `#!` script, such as a package-manager shim.
   * Its process then reports the interpreter as its command, so ownership
   * checks cannot match the configured path by argv prefix.
   */
  readonly script: boolean;
}

/** Why the selected Kuna installation cannot be used. */
export interface KunaReadinessFailure {
  readonly code:
    | KunaConfigurationFailure["code"]
    | "executable_missing"
    | "version_unresolved";
  readonly reason: string;
  readonly diagnostics: Readonly<Record<string, JsonValue>>;
  readonly remediation?: string;
}

export interface KunaInstallationOptions {
  readonly platform?: NodeJS.Platform;
  readonly signal?: AbortSignal;
  /** Probe deadline; tests shorten it. */
  readonly probeTimeoutMs?: number;
  readonly resourceScope: RetainedResourceScope;
  /** Test seam for the owned command launcher; production uses the verified default. */
  readonly processLauncher?: (
    options: OwnedProviderProcessSpawnOptions,
  ) => Promise<SpawnedOwnedProviderProcess>;
}

/** Cancellation facts normalized by the installation inspection that observed them. */
interface KunaInstallationCancellation {
  readonly reason: unknown;
  readonly diagnostics?: Readonly<Record<string, JsonValue>>;
}

// Annotations follow the exact failure's lifetime. Descriptor ownership stays
// with the supplied resource scope, independently of this weak metadata.
const installationFailureDiagnostics = new WeakMap<
  Error,
  Readonly<Record<string, JsonValue>>
>();

export const kunaInstallationFailureDiagnostics = (
  cause: unknown,
): Readonly<Record<string, JsonValue>> | undefined =>
  cause instanceof Error
    ? installationFailureDiagnostics.get(cause)
    : undefined;

/** Consumers project the owner's facts without reinterpreting generic file outcomes. */
export const kunaInstallationCancellation = (
  cause: unknown,
): KunaInstallationCancellation | undefined => {
  const cancellation = regularFileCancellation(cause);
  if (cancellation === undefined) return undefined;
  const diagnostics = kunaInstallationFailureDiagnostics(cause);
  return {
    reason: cancellation.reason,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
};

/** One installation inspection's retained owners and originating errors. */
export interface KunaResourceScope {
  readonly owner: RetainedResourceScope;
  readonly cleanupResources: readonly string[] | undefined;
  readonly hasPending: boolean;
  installationCancellationError(
    cause: unknown,
    operation: string,
  ): AnalysisCancelledError | undefined;
  bindFailure(failure: RegularFileCleanupFailure, error: AnalysisError): void;
  bindRetainedFailure(error: AnalysisError): void;
}

/** Adapt retained resource owners into leases and bind errors to exact owners. */
export const createKunaResourceScope = (
  parent: RetainedResourceScope,
): KunaResourceScope => {
  const leases = new Map<
    Parameters<RetainedResourceScope["retain"]>[0],
    { readonly lease: AnalysisCleanupLease }
  >();
  const pendingLeases = () =>
    [...leases.values()]
      .map(({ lease }) => lease)
      .filter((lease) => !lease.released);
  const bindPendingFailure = (error: AnalysisError) => {
    const retained = pendingLeases();
    if (retained.length > 0) new AnalysisCleanupLeaseGroup(error, retained);
  };
  const cleanupResources = (
    pending = pendingLeases(),
  ): readonly string[] | undefined => {
    if (pending.some((lease) => lease.cleanupResources === undefined))
      return undefined;
    return [
      ...new Set(pending.flatMap((lease) => lease.cleanupResources ?? [])),
    ];
  };
  return {
    get hasPending() {
      return pendingLeases().length > 0;
    },
    get cleanupResources() {
      return cleanupResources();
    },
    installationCancellationError: (cause, operation) => {
      const cancellation = kunaInstallationCancellation(cause);
      if (cancellation === undefined) return undefined;
      const pending = pendingLeases();
      const error = new AnalysisCancelledError(operation, {
        cause: cancellation.reason,
        diagnostics: cancellation.diagnostics,
        ...(pending.length === 0
          ? {}
          : {
              cleanup: {
                reason: "Kuna version-probe process cleanup is unconfirmed.",
                resources: cleanupResources(pending) ?? [],
              },
            }),
      });
      bindPendingFailure(error);
      return error;
    },
    owner: {
      retain: (owner, resource) => {
        const lease = AnalysisCleanupLease.forCloseOwner(owner, resource);
        leases.set(owner, { lease });
        parent.retain(
          {
            close: () => lease.release(),
            get cleanupResources() {
              return lease.cleanupResources;
            },
          },
          resource,
        );
      },
      run: (operation) => parent.run(operation),
    },
    bindFailure: (failure, error) => {
      if (leases.has(failure.owner)) bindPendingFailure(error);
    },
    bindRetainedFailure: bindPendingFailure,
  };
};

/**
 * Environment for every Kuna child. Kuna unpacks its built-in SLEIGH tree into
 * the per-user cache under HOME (macOS) or XDG_CACHE_HOME (Linux), so both
 * point inside REA's own cache root instead of the user's.
 */
export const kunaChildEnvironment = (
  configuration: KunaConfiguration,
): NodeJS.ProcessEnv => {
  const home = appendCallerPath(configuration.cacheRoot, "home");
  return {
    HOME: home,
    XDG_CACHE_HOME: appendCallerPath(home, ".cache"),
    NO_COLOR: "1",
  };
};

const failure = (
  code: KunaReadinessFailure["code"],
  reason: string,
  diagnostics: Readonly<Record<string, JsonValue>>,
): Result<never, KunaReadinessFailure> => err({ code, reason, diagnostics });

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

interface InstallationFileObservation {
  readonly phase: "fingerprint" | "identity";
  readonly completedHash?: { readonly sha256: string; readonly bytes: number };
  readonly script?: boolean;
  readonly beforeProbeFingerprint?: {
    readonly sha256: string;
    readonly bytes: number;
  };
  readonly probe?: {
    readonly deadlineMs: number;
    readonly output: ReturnType<typeof versionProbeOutput>;
  };
}

/** Keep completed file facts attached when cancellation or close failure interrupts inspection. */
const recordPartialInstallationFileOperation = (
  cause: unknown,
  facts: {
    readonly command: string;
    readonly executable: string;
    readonly version?: string;
    readonly observed: InstallationFileObservation;
  },
): boolean => {
  const cancellation = regularFileCancellation(cause);
  if (
    !(cause instanceof Error) ||
    (!(cause instanceof RegularFileCleanupFailure) &&
      cancellation === undefined)
  )
    return false;

  const outcome =
    cause instanceof RegularFileCancelled ||
    cause instanceof RegularFileCleanupFailure
      ? cause.outcome
      : undefined;
  const completed = outcome?.kind === "completed" ? outcome.value : undefined;
  const completedRecord =
    completed !== null &&
    typeof completed === "object" &&
    !Array.isArray(completed)
      ? (completed as Record<string, unknown>)
      : undefined;
  const completedFingerprint =
    facts.observed.phase === "fingerprint"
      ? completed
      : completedRecord === undefined
        ? undefined
        : {
            sha256: completedRecord["sha256"],
            bytes: completedRecord["bytes"],
          };
  const completedHash =
    facts.observed.completedHash ??
    (outcome?.kind === "completed" && completedFingerprint !== undefined
      ? jsonValueSchema.parse(completedFingerprint)
      : undefined);
  const completedScript =
    facts.observed.script ??
    (facts.observed.phase === "identity" &&
    Buffer.isBuffer(completedRecord?.["prefix"])
      ? completedRecord["prefix"].toString("latin1") === "#!"
      : undefined);
  installationFailureDiagnostics.set(cause, {
    kuna_installation: {
      status: "partial",
      command: facts.command,
      executable: facts.executable,
      ...(facts.version === undefined
        ? {}
        : {
            version: facts.version,
            verified: facts.version === KUNA_VERIFIED_VERSION,
          }),
      ...(completedHash === undefined ? {} : { completed_hash: completedHash }),
      ...(completedScript === undefined ? {} : { script: completedScript }),
      ...(facts.observed.beforeProbeFingerprint === undefined
        ? {}
        : {
            before_probe_sha256: facts.observed.beforeProbeFingerprint.sha256,
            before_probe_bytes: facts.observed.beforeProbeFingerprint.bytes,
          }),
    },
    ...(facts.observed.probe === undefined
      ? {}
      : {
          kuna_version_probe: {
            status: "completed",
            deadline_ms: facts.observed.probe.deadlineMs,
            ...versionProbeOutputDiagnostics(facts.observed.probe.output),
          },
        }),
  });
  return true;
};

/** Resolve, version-probe and fingerprint the configured executable. */
export const inspectKunaInstallation = async (
  environment: Readonly<NodeJS.ProcessEnv>,
  options: KunaInstallationOptions,
): Promise<Result<KunaInstallation, KunaReadinessFailure>> => {
  const configuration = readKunaConfiguration(environment, options.platform);
  if (!configuration.ok)
    return err({
      code: configuration.error.code,
      reason: configuration.error.reason,
      remediation: configuration.error.remediation,
      diagnostics: {
        configured: configuration.error.code !== "not_configured",
        ...(configuration.error.setting === null
          ? {}
          : { setting: configuration.error.setting }),
      },
    });
  const { command } = configuration.value;
  assertRegularFileActive(options.signal);

  let executable: string;
  try {
    executable = await realpath(command);
    await access(executable, constants.X_OK);
    if (!(await stat(executable)).isFile())
      return failure(
        "executable_missing",
        `REA_KUNA_COMMAND is not a regular file: ${command}. ${KUNA_COMMAND_REMEDIATION}`,
        { command },
      );
  } catch (cause: unknown) {
    return failure(
      "executable_missing",
      `Cannot execute REA_KUNA_COMMAND ${command}: ${message(cause)}. ${KUNA_COMMAND_REMEDIATION}`,
      { command },
    );
  }

  assertRegularFileActive(options.signal);

  let beforeProbeFingerprint: {
    readonly sha256: string;
    readonly bytes: number;
  };
  const beforeProbeObservation: InstallationFileObservation = {
    phase: "fingerprint",
  };
  try {
    await assertArtifactCommandPath(
      { invocationPath: command, resolvedPath: executable },
      "kuna:installation",
    );
    beforeProbeFingerprint = await options.resourceScope.run(() =>
      hashStableFile(command, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        retainFailedClose: (owner) =>
          options.resourceScope.retain(owner, command),
      }),
    );
  } catch (cause: unknown) {
    if (cause instanceof ArtifactReaderFailure) throw cause;
    if (
      recordPartialInstallationFileOperation(cause, {
        command,
        executable,
        observed: beforeProbeObservation,
      })
    )
      throw cause;
    return failure(
      "executable_missing",
      `Cannot fingerprint ${executable}: ${message(stableFileHashCause(cause))}`,
      { command, executable },
    );
  }

  const deadline = options.probeTimeoutMs ?? VERSION_PROBE_TIMEOUT_MS;
  let snapshot: ProviderProcessSnapshot;
  try {
    snapshot = await options.resourceScope.run(() =>
      runOwnedCommand(
        {
          command,
          arguments: ["--version"],
          runId: `rea-kuna-version-${randomUUID()}`,
          // The configured command may be an interpreter-driven shim.
          expectedCommand: null,
          hostEnvironment: kunaChildEnvironment(configuration.value),
        },
        {
          timeoutMs: deadline,
          diagnosticBytes: VERSION_PROBE_MAX_OUTPUT_BYTES,
        },
        {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.processLauncher === undefined
            ? {}
            : { launcher: options.processLauncher }),
        },
      ),
    );
  } catch (cause: unknown) {
    if (cause instanceof ArtifactReaderFailure) throw cause;
    const retainedCleanup = retainOwnedCommandCleanup(
      cause,
      options.resourceScope,
      "kuna",
      "kuna:installation",
    );
    const cleanupIncomplete = retainedCleanup.length > 0;
    if (cause instanceof OwnedCommandFailure) {
      const output = versionProbeOutput(cause.snapshot);
      if (cause.reason === "cancelled") {
        const cancellation = new RegularFileOperationCancelled(
          cause.cancellation?.reason,
        );
        installationFailureDiagnostics.set(cancellation, {
          kuna_version_probe: {
            status: "partial",
            command,
            executable,
            deadline_ms: deadline,
            ...versionProbeOutputDiagnostics(output),
            probe_failure_reason: cause.reason,
            cleanup_incomplete: cleanupIncomplete,
          },
        });
        throw cancellation;
      }
      return failure(
        "version_unresolved",
        `${executable} --version failed: ${output.stderr.trim() || cause.message}. ${KUNA_VERSION_PROBE_REMEDIATION}`,
        {
          command,
          executable,
          probe_failure_reason: cause.reason,
          cleanup_incomplete: cleanupIncomplete,
          deadline_ms: deadline,
          ...versionProbeOutputDiagnostics(output),
        },
      );
    }
    return failure(
      "version_unresolved",
      `${executable} --version failed: ${message(cause)}. ${KUNA_VERSION_PROBE_REMEDIATION}`,
      {
        command,
        executable,
        exit_code: null,
        signal: null,
        cleanup_incomplete: cleanupIncomplete,
        deadline_ms: deadline,
      },
    );
  }
  const probeOutput = versionProbeOutput(snapshot);
  if (probeOutput.truncated)
    return failure(
      "version_unresolved",
      `${executable} --version output was incomplete. ${KUNA_VERSION_PROBE_REMEDIATION}`,
      {
        command,
        executable,
        deadline_ms: deadline,
        output_truncated: true,
        stdout: probeOutput.stdout.slice(0, 256),
      },
    );
  const version = VERSION_LINE.exec(probeOutput.stdout)?.[1];
  if (version === undefined)
    return failure(
      "version_unresolved",
      `${executable} --version printed no recognizable Kuna version. ${KUNA_VERSION_PROBE_REMEDIATION}`,
      { command, executable, stdout: probeOutput.stdout.slice(0, 256) },
    );

  let fingerprint: { readonly sha256: string; readonly bytes: number };
  let script: boolean;
  const observed: {
    phase: "fingerprint" | "identity";
    completedHash?: { readonly sha256: string; readonly bytes: number };
    script?: boolean;
    beforeProbeFingerprint?: {
      readonly sha256: string;
      readonly bytes: number;
    };
    probe?: {
      readonly deadlineMs: number;
      readonly output: ReturnType<typeof versionProbeOutput>;
    };
  } = {
    phase: "fingerprint",
    beforeProbeFingerprint,
    probe: { deadlineMs: deadline, output: probeOutput },
  };
  try {
    ({ fingerprint, script } = await options.resourceScope.run(async () => {
      observed.phase = "identity";
      await assertArtifactCommandPath(
        { invocationPath: command, resolvedPath: executable },
        "kuna:installation",
      );
      const observation = await observeStableFile(command, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        retainFailedClose: (owner) =>
          options.resourceScope.retain(owner, command),
      });
      const fingerprint = {
        sha256: observation.sha256,
        bytes: observation.bytes,
      };
      const script =
        observation.prefix.length === 2 &&
        observation.prefix.toString("latin1") === "#!";
      observed.completedHash = fingerprint;
      observed.script = script;
      assertRegularFileActive(options.signal);
      return { fingerprint, script };
    }));
  } catch (cause: unknown) {
    if (cause instanceof ArtifactReaderFailure) throw cause;
    if (
      recordPartialInstallationFileOperation(cause, {
        command,
        executable,
        version,
        observed,
      })
    ) {
      throw cause;
    }
    return failure(
      "executable_missing",
      `Cannot observe ${executable} after its --version probe: ${message(stableFileHashCause(cause))}`,
      {
        command,
        executable,
        version,
        verified: version === KUNA_VERIFIED_VERSION,
        identity_observation_phase: "post_probe",
        identity_observation_failure: message(stableFileHashCause(cause)),
        before_probe_sha256: beforeProbeFingerprint.sha256,
        before_probe_bytes: beforeProbeFingerprint.bytes,
        deadline_ms: deadline,
        ...versionProbeOutputDiagnostics(probeOutput),
      },
    );
  }

  if (
    beforeProbeFingerprint.sha256 !== fingerprint.sha256 ||
    beforeProbeFingerprint.bytes !== fingerprint.bytes
  )
    return failure(
      "version_unresolved",
      `${executable} changed during the --version probe. ${KUNA_VERSION_PROBE_REMEDIATION}`,
      {
        command,
        executable,
        version,
        verified: version === KUNA_VERIFIED_VERSION,
        installation_identity_changed: true,
        before_sha256: beforeProbeFingerprint.sha256,
        before_bytes: beforeProbeFingerprint.bytes,
        after_sha256: fingerprint.sha256,
        after_bytes: fingerprint.bytes,
        deadline_ms: deadline,
        ...versionProbeOutputDiagnostics(probeOutput),
      },
    );

  return ok({
    configuration: configuration.value,
    executable,
    version,
    verified: version === KUNA_VERIFIED_VERSION,
    ...fingerprint,
    script,
  });
};
