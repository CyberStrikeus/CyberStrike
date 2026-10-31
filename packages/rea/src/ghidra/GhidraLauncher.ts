import { GhidraAdmissionError } from "./GhidraAdmissionError.js";
import { copyExistingGhidraProject } from "./GhidraProjectSnapshot.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { GHIDRA_BRIDGE_SOURCES } from "./GhidraBridgeSources.js";
import {
  snapshotGhidraAnalysisSeeds,
  type GhidraSeedCommitment,
} from "./GhidraAnalysisSeeds.js";
import type { GhidraLanguageOverride } from "../config/ghidraLanguageOverride.js";
import type { GhidraRiscvCallingConvention } from "./GhidraRiscvProfile.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, posix, win32 } from "node:path";

import { writeGhidraRuntimeFile } from "./GhidraRuntimeFile.js";

import { windowsPrivateRuntime } from "../windows/WindowsPrivateRuntime.js";
import {
  quoteWindowsBatchToken,
  windowsBatchCommand,
  WindowsBatchCommandError,
} from "../process/WindowsBatchCommand.js";

import { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { DarwinProcessOwnershipInspectionError } from "../process/DarwinProcessRunTokenReader.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import type { AnalysisCapturedOutput } from "../domain/analysisErrorBase.js";
import {
  execFileOutputFailure,
  execFileFailureCapturedOutput,
} from "../process/ExecFileOutput.js";
import { boundedUtf8Text } from "../process/boundedUtf8Text.js";
import { redactCapturedTransportCredential } from "../process/ProviderDiagnosticRedaction.js";
import {
  cleanupOwnedProcessGroup,
  type ProcessCleanupResult,
  type ProcessCleanupFailure,
} from "../process/ProcessOwnership.js";
import {
  type ProviderProcessLaunch,
  type SpawnedOwnedProviderProcess,
  spawnOwnedProviderProcess,
} from "../process/ProviderProcess.js";
import { ghidraJavaEnvironment } from "./GhidraInstallation.js";
import {
  ghidraJavaLaunch,
  GhidraLaunchSupportError,
} from "./GhidraJavaLaunch.js";
import type { GhidraTransportKind } from "./GhidraTransport.js";
import {
  snapshotGhidraExtensions,
  type GhidraExtension,
} from "./extensions/GhidraExtensions.js";

import {
  inspectGhidraPspExtension,
  type GhidraPspExtension,
} from "./GhidraPspExtension.js";

export interface GhidraLaunchSession {
  readonly runtimeRoot: string;
  readonly transport: GhidraTransportKind;
  readonly endpointPath: string;
  readonly token: string;
  readonly runId: string;
  readonly targetPath: string;
  readonly targetSha256: string;
  readonly providerVersion: string;
  readonly profileDigest: string;
}

/** Process plus private log coordinates returned by a Ghidra launcher. */
export type GhidraLaunch = ProviderProcessLaunch & {
  readonly projectRoot: string;
  readonly ghidraLogPath: string;
  readonly scriptLogPath: string;
  /** Value supplied to the JVM as -Xmx, not a measurement of effective memory. */
  readonly configuredMaxHeap?: string;
  readonly launchSupport?: readonly GhidraLaunchSupportDiagnostic[];
};

/** Same per-stream projection budget for helper warnings and failed commands. */
export const GHIDRA_LAUNCH_COMMAND_OUTPUT_BYTES = 8 * 1024;

/** Successful helper stderr, retained independently of the analysis JVM output. */
export type GhidraLaunchSupportDiagnostic = {
  readonly mode: "-envvars" | "-vmargs";
  readonly stderr: string;
  readonly stderr_bytes: number;
  readonly stderr_truncated: boolean;
};

/** Provider-owned capability that starts one isolated headless analysis. */
export interface GhidraLauncher {
  launch(
    session: GhidraLaunchSession,
    options?: {
      readonly signal?: AbortSignal;
      readonly resourceScope?: ArtifactResourceScope;
    },
  ): Promise<Result<GhidraLaunch, GhidraLaunchError | AnalysisCancelledError>>;
}

/** A rollback attempt failed without releasing its process owner. */
export type GhidraLaunchRollbackFailure =
  | { readonly kind: "incomplete"; readonly result: ProcessCleanupFailure }
  | { readonly kind: "rejected"; readonly cause: unknown };

/** Local launch failure retained as the cause of a provider-neutral error. */
export class GhidraLaunchError extends Error {
  readonly #partialLaunch: GhidraLaunch | undefined;
  readonly #capturedOutput: AnalysisCapturedOutput | undefined;
  readonly launchSupport: readonly GhidraLaunchSupportDiagnostic[];
  readonly rollbackFailure: GhidraLaunchRollbackFailure | undefined;
  readonly cleanupFailure: AnalysisError | undefined;
  /** Known producer outcome, independent of a signal that changes during finalization. */
  readonly primaryFailure: AnalysisError | undefined;

  constructor(
    message: string,
    options?: ErrorOptions & {
      readonly partialLaunch?: GhidraLaunch;
      readonly rollbackFailure?: GhidraLaunchRollbackFailure;
      readonly cleanupFailure?: AnalysisError;
      readonly primaryFailure?: AnalysisError;
      readonly capturedOutput?: AnalysisCapturedOutput;
      readonly launchSupport?: readonly GhidraLaunchSupportDiagnostic[];
    },
  ) {
    const {
      partialLaunch,
      capturedOutput,
      launchSupport,
      rollbackFailure,
      cleanupFailure,
      primaryFailure,
      ...errorOptions
    } = options ?? {};
    super(message, errorOptions);
    this.name = "GhidraLaunchError";
    this.#partialLaunch = partialLaunch;
    this.rollbackFailure = rollbackFailure;
    this.primaryFailure =
      primaryFailure ??
      (errorOptions.cause instanceof AnalysisError
        ? errorOptions.cause
        : errorOptions.cause instanceof GhidraLaunchError
          ? errorOptions.cause.primaryFailure
          : undefined);
    const inherited =
      errorOptions.cause instanceof DarwinProcessOwnershipInspectionError ||
      errorOptions.cause instanceof GhidraLaunchError
        ? errorOptions.cause.cleanupFailure
        : errorOptions.cause instanceof AnalysisError &&
            errorOptions.cause.cleanupIncomplete
          ? errorOptions.cause
          : undefined;
    this.cleanupFailure =
      cleanupFailure === undefined
        ? inherited
        : inherited === undefined || inherited === cleanupFailure
          ? cleanupFailure
          : analysisErrorWithCleanupFailure(
              inherited,
              cleanupFailure,
            ).bindCleanupDependencies([inherited, cleanupFailure]);
    const output =
      capturedOutput ??
      (errorOptions.cause instanceof DarwinProcessOwnershipInspectionError ||
      errorOptions.cause instanceof GhidraLaunchError
        ? errorOptions.cause.capturedOutput
        : undefined);
    this.#capturedOutput = output === undefined ? undefined : { ...output };
    this.launchSupport = (launchSupport ?? []).map((output) => ({ ...output }));
  }

  /** Process ownership retained for the client to retry an incomplete rollback. */
  get partialLaunch(): GhidraLaunch | undefined {
    return this.#partialLaunch;
  }

  /** Launcher command outcome retained when a launch command reported one. */
  get capturedOutput(): AnalysisCapturedOutput | undefined {
    return this.#capturedOutput === undefined
      ? undefined
      : { ...this.#capturedOutput };
  }
}

/**
 * Retain a failed launcher command's exit/signal and output in the shared
 * captured-output envelope. Bounds apply at projection; truncation there stays
 * explicit, matching the compiler-outcome diagnostics.
 */
const ghidraLaunchCommandOutput = (
  cause: unknown,
): AnalysisCapturedOutput | undefined => {
  if (cause instanceof DarwinProcessOwnershipInspectionError)
    return cause.capturedOutput;
  const failure = execFileOutputFailure(cause);
  if (failure === undefined) return undefined;
  return execFileFailureCapturedOutput(failure);
};

/** An expanded caller project opened only through an owned private copy. */
export interface GhidraExistingProject {
  /** Directory holding the selected .gpr marker and .rep data directory. */
  readonly projectPath: string;
  readonly projectName?: string;
  readonly sha256?: string;
  /** Imported program name selected with -process. */
  readonly programName: string;
}

/** Static coordinates for an extracted Ghidra release and packaged script. */
export interface GhidraHeadlessLauncherOptions {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly analyzeHeadlessPath: string;
  /** Release coordinate owned by installation inspection; null must not be guessed. */
  readonly configurationDirectoryName: string | null;
  readonly javaHome?: string;
  readonly javaVmName?: string;
  readonly bridgeScriptPath: string;
  readonly platform?: NodeJS.Platform;
  /** Open a pre-imported project copy instead of importing the target again. */
  readonly existingProject?: GhidraExistingProject;
  readonly comSpec?: string;
  /** Select the admitted 16-bit real-mode MZ import instead of auto-detection. */
  readonly dosMz?: true;
  readonly dosCom?: true;
  readonly rawBinary?: {
    readonly languageId: string;
    readonly compilerSpecId: string;
    readonly baseAddr: string;
  };
  /** GameCube DOL import: committed language and the canonical section table text. */
  readonly gamecubeDol?: {
    readonly languageId: string;
    readonly compilerSpecId?: string;
    readonly sectionFile: string;
  };
  /** Explicit import language committed by the analysis profile. */
  readonly languageOverride?: GhidraLanguageOverride;
  /** Auto-analyzers disabled before default auto-analysis, as configured. */
  readonly disabledAnalyzers?: readonly string[];
  /** Per-function native decompiler limit passed to the bridge; absent is unbounded. */
  readonly decompileTimeoutSeconds?: number;
  /** Caller seeds committed by the analysis profile, applied before analysis. */
  readonly analysisSeeds?: GhidraSeedCommitment;
  readonly analysisExtensions?: readonly GhidraExtension[];
  readonly pspExtension?: GhidraPspExtension;
  /** Remap typed float storage for the soft-float o32 ABI after analysis. */
  readonly mipsSoftFloat?: true;
  /** Apply this committed RISC-V calling-convention policy after analysis. */
  readonly riscvCallingConvention?: GhidraRiscvCallingConvention;
  /** Spawn seam for provider-boundary lifecycle tests. */
  readonly spawnProcess?: typeof spawnOwnedProviderProcess;
  /** LaunchSupport probe seam for Java-free launcher fixtures. */
  readonly javaLaunch?: typeof ghidraJavaLaunch;
}

/** Launch Ghidra without copying scripts into or modifying its installation. */
export class GhidraHeadlessLauncher implements GhidraLauncher {
  readonly options: GhidraHeadlessLauncherOptions;
  constructor(options: GhidraHeadlessLauncherOptions) {
    this.options = {
      ...options,
      environment: snapshotEnvironment(options.environment, options.platform),
    };
  }

  async launch(
    session: GhidraLaunchSession,
    options: {
      readonly signal?: AbortSignal;
      readonly resourceScope?: ArtifactResourceScope;
    } = {},
  ): Promise<Result<GhidraLaunch, GhidraLaunchError | AnalysisCancelledError>> {
    if (isAborted(options.signal))
      return err(
        new AnalysisCancelledError("open_binary", {
          cause: options.signal?.reason,
        }),
      );
    const paths = ghidraRuntimePaths(session.runtimeRoot);
    const platform = this.options.platform ?? process.platform;
    const existingProject = this.options.existingProject;
    let started: SpawnedOwnedProviderProcess | undefined;
    let configuredMaxHeap: string | undefined;
    const launchSupport: GhidraLaunchSupportDiagnostic[] = [];
    try {
      if (this.options.configurationDirectoryName === null)
        throw new GhidraLaunchError(
          "Ghidra configuration directory identity is unresolved; restore application.version and application.release.name in the selected installation's application.properties.",
        );
      const psp = this.options.pspExtension;
      validateExistingProjectOptions({
        ...this.options,
        platform,
        ...(psp === undefined ? {} : { psp: true as const }),
      });
      if (psp !== undefined) {
        const installedRoot = await realpath(
          join(
            dirname(this.options.analyzeHeadlessPath),
            "..",
            "Ghidra",
            "Extensions",
            "ghidra-allegrex",
          ),
        );
        if (installedRoot !== psp.root)
          throw new GhidraLaunchError(
            "Allegrex profile does not belong to the selected Ghidra installation.",
          );
        if (options.resourceScope === undefined)
          throw new GhidraLaunchError(
            "PSP inspection requires a caller-owned resource scope.",
          );
        const inspected = await inspectGhidraPspExtension(
          psp.root,
          psp.ghidra_version,
          options.resourceScope,
          options.signal,
        );
        if (inspected.sha256 !== psp.sha256)
          throw new GhidraLaunchError(
            "Installed Allegrex content changed since profile resolution; reopen the target to resolve a fresh profile.",
          );
      }
      await createGhidraRuntimeDirectories(
        paths,
        platform,
        this.options.configurationDirectoryName,
      );
      // Copy-first: open the caller's project only through the owned copy so
      // Ghidra never touches the original project files.
      if (existingProject !== undefined)
        await copyExistingGhidraProject(
          existingProject.projectPath,
          paths.projectRoot,
          {
            signal: options.signal,
            projectName: existingProject.projectName,
            expectedSha256: existingProject.sha256,
            resources: options.resourceScope,
          },
        );
      let seedPath: string | undefined;
      let gamecubeDolSectionPath: string | undefined;
      let extensions: readonly GhidraExtension[] = [];
      if (
        this.options.analysisSeeds !== undefined ||
        (this.options.analysisExtensions?.length ?? 0) > 0
      ) {
        if (options.resourceScope === undefined)
          throw new GhidraLaunchError(
            "Configured Ghidra artifacts require a caller-owned resource scope.",
          );
        if (this.options.analysisSeeds !== undefined)
          seedPath = await snapshotGhidraAnalysisSeeds(
            this.options.analysisSeeds,
            session.runtimeRoot,
            options.resourceScope,
            options.signal,
          );
        extensions = await snapshotGhidraExtensions(
          this.options.analysisExtensions ?? [],
          session.runtimeRoot,
          options.resourceScope,
          options.signal,
        );
      }
      await writeGhidraRuntimeFile(
        paths.descriptorPath,
        `${JSON.stringify({
          transport: session.transport,
          endpoint_path: session.endpointPath,
          token: session.token,
          run_id: session.runId,
          target_sha256: session.targetSha256,
          provider_version: session.providerVersion,
          profile_digest: session.profileDigest,
          ...(existingProject === undefined ? {} : { existing_project: true }),
          ...(this.options.decompileTimeoutSeconds === undefined
            ? {}
            : {
                decompile_timeout_seconds: this.options.decompileTimeoutSeconds,
              }),
          ...(extensions.length === 0
            ? {}
            : { analysis_extensions: extensions }),
        })}\n`,
        platform,
      );
      if (this.options.gamecubeDol !== undefined) {
        gamecubeDolSectionPath = join(
          dirname(paths.descriptorPath),
          "gamecube-dol-sections.txt",
        );
        await writeGhidraRuntimeFile(
          gamecubeDolSectionPath,
          this.options.gamecubeDol.sectionFile,
          platform,
        );
      }
      if (isAborted(options.signal))
        return err(
          new AnalysisCancelledError("open_binary", {
            cause: options.signal?.reason,
          }),
        );
      const headlessArguments = ghidraHeadlessArguments({
        platform,
        ...(psp === undefined ? {} : { psp: true as const }),
        ...(this.options.mipsSoftFloat === undefined
          ? {}
          : { mipsSoftFloat: this.options.mipsSoftFloat }),
        ...(this.options.riscvCallingConvention === undefined
          ? {}
          : {
              riscvCallingConvention: this.options.riscvCallingConvention,
            }),
        projectRoot: paths.projectRoot,
        targetPath: session.targetPath,
        ...(existingProject === undefined ? {} : { existingProject }),
        bridgeScriptPath: this.options.bridgeScriptPath,
        descriptorPath: paths.descriptorPath,
        ghidraLogPath: paths.ghidraLogPath,
        scriptLogPath: paths.scriptLogPath,
        ...(this.options.dosCom === undefined
          ? {}
          : { dosCom: this.options.dosCom }),
        ...(this.options.dosMz === undefined
          ? {}
          : { dosMz: this.options.dosMz }),
        ...(this.options.rawBinary === undefined
          ? {}
          : { rawBinary: this.options.rawBinary }),
        ...(this.options.gamecubeDol === undefined ||
        gamecubeDolSectionPath === undefined
          ? {}
          : {
              gamecubeDol: {
                languageId: this.options.gamecubeDol.languageId,
                ...(this.options.gamecubeDol.compilerSpecId === undefined
                  ? {}
                  : {
                      compilerSpecId: this.options.gamecubeDol.compilerSpecId,
                    }),
                sectionFilePath: gamecubeDolSectionPath,
              },
            }),
        ...(this.options.languageOverride === undefined
          ? {}
          : { languageOverride: this.options.languageOverride }),
        ...(seedPath === undefined ? {} : { seedPath }),
        ...(this.options.disabledAnalyzers === undefined
          ? {}
          : { disabledAnalyzers: this.options.disabledAnalyzers }),
      });
      const scriptCommand = ghidraHeadlessCommand({
        environment: this.options.environment,
        platform,
        analyzeHeadlessPath: this.options.analyzeHeadlessPath,
        arguments: headlessArguments,
        ...(this.options.comSpec === undefined
          ? {}
          : { comSpec: this.options.comSpec }),
      });
      const environment = ghidraLaunchEnvironment(
        paths,
        this.options.javaHome,
        platform,
        scriptCommand.command,
        this.options.environment,
      );
      if (platform !== "win32" && this.options.javaHome === undefined)
        throw new GhidraLaunchError(
          "POSIX Ghidra requires its inspected JDK home",
        );
      const inspectedJavaLaunch = await (
        this.options.javaLaunch ?? ghidraJavaLaunch
      )({
        platform,
        analyzeHeadlessPath: this.options.analyzeHeadlessPath,
        ...(this.options.javaHome === undefined
          ? {}
          : { javaHome: this.options.javaHome }),
        ...(this.options.javaVmName === undefined
          ? {}
          : { javaVmName: this.options.javaVmName }),
        homeRoot: paths.homeRoot,
        tempRoot: paths.tempRoot,
        argumentFileRoot: session.runtimeRoot,
        ...(options.resourceScope === undefined
          ? {}
          : { resourceScope: options.resourceScope }),
        arguments: headlessArguments,
        environment,
        onStderr: (mode, stderr) => {
          if (stderr === "") return;
          const bytes = Buffer.byteLength(stderr);
          const redacted = redactCapturedTransportCredential(
            { text: stderr, bytes, observedBytes: bytes },
            session.token,
            "[REDACTED]",
          );
          const bounded = boundedUtf8Text(
            redacted,
            GHIDRA_LAUNCH_COMMAND_OUTPUT_BYTES,
          );
          launchSupport.push({
            mode,
            stderr: bounded.text,
            stderr_bytes: bytes,
            stderr_truncated: bounded.truncated,
          });
        },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      // Windows starts the script wrapper rather than this inspected JVM command.
      configuredMaxHeap =
        platform === "win32"
          ? undefined
          : inspectedJavaLaunch.configuredMaxHeap;
      const command =
        platform === "win32"
          ? {
              ...scriptCommand,
              environment: {
                ...environment,
                ...(inspectedJavaLaunch.preparedJdkJavaOptions === undefined
                  ? {}
                  : {
                      JDK_JAVA_OPTIONS:
                        inspectedJavaLaunch.preparedJdkJavaOptions,
                    }),
              },
            }
          : inspectedJavaLaunch;
      started = await (this.options.spawnProcess ?? spawnOwnedProviderProcess)({
        command: command.command,
        arguments: command.arguments,
        runId: session.runId,
        // POSIX launches the inspected JVM directly; script wrappers cannot
        // preserve JVM property paths containing spaces as single arguments.
        expectedCommand: platform !== "win32" ? command.command : null,
        windowsVerbatimArguments: platform === "win32",
        platform,
        env: command.environment,
        hostEnvironment: {},
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }).catch((cause: unknown) => {
        // The spawn boundary throws the exact opaque reason at preparation
        // checkpoints. Wrap it before interpreting any typed provider facts.
        if (options.signal?.aborted === true && cause === options.signal.reason)
          throw new AnalysisCancelledError("open_binary", { cause });
        throw cause;
      });
      const partialLaunch = ownedGhidraLaunch(
        started,
        paths,
        platform,
        launchSupport,
        configuredMaxHeap,
      );
      await writeGhidraRuntimeFile(
        paths.ownershipPath,
        `${JSON.stringify({
          run_id: session.runId,
          transport: session.transport,
          endpoint_path: session.endpointPath,
          pid: started.ownership.leaderPid,
          process_group_id: started.ownership.processGroupId,
          parent_pid: process.pid,
          ownership_kind:
            platform === "win32" ? "windows-job-object" : "posix-process-group",
          launcher: command.command,
          headless_script: this.options.analyzeHeadlessPath,
          created_at: new Date().toISOString(),
        })}\n`,
        platform,
      );
      if (isAborted(options.signal)) {
        throw new AnalysisCancelledError("open_binary", {
          cause: options.signal?.reason,
        });
      }
      return ok(partialLaunch);
    } catch (cause: unknown) {
      const cancellation =
        cause instanceof AnalysisCancelledError
          ? cause
          : (cause instanceof GhidraLaunchSupportError ||
                cause instanceof DarwinProcessOwnershipInspectionError) &&
              cause.cancellation !== undefined
            ? new AnalysisCancelledError("open_binary", {
                cause: cause.cancellation.reason,
              })
            : undefined;
      const capturedOutput = ghidraLaunchCommandOutput(cause);
      const launchFailure = new GhidraLaunchError(
        "Ghidra headless launch failed",
        {
          cause,
          ...(cancellation === undefined
            ? {}
            : { primaryFailure: cancellation }),
          launchSupport,
          ...(capturedOutput === undefined ? {} : { capturedOutput }),
        },
      );
      if (started === undefined) return err(launchFailure);

      const cleanupOwner = started;
      const rollback = await Promise.resolve()
        .then(() => cleanupStartedProcess(cleanupOwner, platform))
        .then(
          (result): Result<null, GhidraLaunchRollbackFailure> =>
            result.cleaned ? ok(null) : err({ kind: "incomplete", result }),
          (cause: unknown): Result<null, GhidraLaunchRollbackFailure> =>
            err({ kind: "rejected", cause }),
        );
      if (!rollback.ok) {
        const partialLaunch = ownedGhidraLaunch(
          started,
          paths,
          platform,
          launchSupport,
          configuredMaxHeap,
        );
        const primaryMessage =
          cancellation !== undefined
            ? cancellation.message
            : `Ghidra headless launch failed: ${cause instanceof Error ? cause.message : String(cause)}`;
        return err(
          new GhidraLaunchError(
            `${primaryMessage}; process cleanup remains incomplete`,
            {
              cause: new AggregateError(
                [
                  launchFailure,
                  rollback.error.kind === "rejected"
                    ? rollback.error.cause
                    : rollback.error.result,
                ],
                "Ghidra launch rollback did not release its process",
                { cause: launchFailure },
              ),
              partialLaunch,
              ...(launchFailure.primaryFailure === undefined
                ? {}
                : { primaryFailure: launchFailure.primaryFailure }),
              rollbackFailure: rollback.error,
              ...(launchFailure.cleanupFailure === undefined
                ? {}
                : { cleanupFailure: launchFailure.cleanupFailure }),
              launchSupport,
              ...(capturedOutput === undefined ? {} : { capturedOutput }),
            },
          ),
        );
      }
      return err(launchFailure);
    }
  }
}

const ownedGhidraLaunch = (
  spawned: SpawnedOwnedProviderProcess,
  paths: ReturnType<typeof ghidraRuntimePaths>,
  platform: NodeJS.Platform,
  launchSupport: readonly GhidraLaunchSupportDiagnostic[],
  configuredMaxHeap?: string,
): GhidraLaunch => ({
  ...ownedGhidraProcess(spawned, platform),
  projectRoot: paths.projectRoot,
  ghidraLogPath: paths.ghidraLogPath,
  scriptLogPath: paths.scriptLogPath,
  ...(configuredMaxHeap === undefined ? {} : { configuredMaxHeap }),
  ...(launchSupport.length === 0 ? {} : { launchSupport: [...launchSupport] }),
});

const ownedGhidraProcess = (
  spawned: SpawnedOwnedProviderProcess,
  platform: NodeJS.Platform,
): Pick<
  Extract<ProviderProcessLaunch, { readonly ownsProcessLifetime: true }>,
  "process" | "ownsProcessLifetime" | "ownership" | "cleanup"
> => ({
  process: spawned.process,
  ownsProcessLifetime: true,
  ownership: spawned.ownership,
  cleanup: () => cleanupStartedProcess(spawned, platform),
});

/** Exact executable and argv passed to shell-free process creation. */
export interface GhidraHeadlessCommand {
  readonly command: string;
  readonly arguments: readonly string[];
}

/** Build a direct POSIX launch or a conservatively quoted Windows batch call. */
export const ghidraHeadlessCommand = (options: {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly platform: NodeJS.Platform;
  readonly analyzeHeadlessPath: string;
  readonly arguments: readonly string[];
  readonly comSpec?: string;
}): GhidraHeadlessCommand => {
  if (options.platform !== "win32")
    return {
      command: options.analyzeHeadlessPath,
      arguments: [...options.arguments],
    };
  const command = ghidraBatchStep(() =>
    windowsBatchCommand({
      environment: options.environment,
      batchPath: options.analyzeHeadlessPath,
      arguments: options.arguments,
      ...(options.comSpec === undefined ? {} : { comSpec: options.comSpec }),
    }),
  );
  if ((command.arguments.at(-1)?.length ?? 0) > 30_000)
    throw new GhidraLaunchError(
      "Windows Ghidra command exceeds the P0 length limit",
    );
  return command;
};

/** Keep Ghidra's launch error type and P0 wording for shared batch checks. */
const ghidraBatchStep = <T>(step: () => T): T => {
  try {
    return step();
  } catch (cause: unknown) {
    if (!(cause instanceof WindowsBatchCommandError)) throw cause;
    throw new GhidraLaunchError(
      cause.reason === "metacharacter"
        ? "Windows Ghidra P0 paths cannot contain command-interpreter metacharacters"
        : cause.message,
      { cause },
    );
  }
};

const cleanupStartedProcess = (
  started: SpawnedOwnedProviderProcess,
  platform: NodeJS.Platform,
): Promise<ProcessCleanupResult> =>
  started.cleanup !== undefined
    ? started.cleanup()
    : platform === "win32"
      ? Promise.resolve({
          cleaned: false,
          reason: "Windows Ghidra process has no owned cleanup capability",
        })
      : cleanupOwnedProcessGroup(started.ownership);

/** Paths encoded into one bounded analyzeHeadless invocation. */
export interface GhidraHeadlessArgumentOptions {
  readonly platform?: NodeJS.Platform;
  readonly projectRoot: string;
  readonly targetPath: string;
  /** Open this pre-imported program with -process instead of importing. */
  readonly existingProject?: Pick<
    GhidraExistingProject,
    "programName" | "projectName"
  >;
  readonly bridgeScriptPath: string;
  readonly descriptorPath: string;
  readonly ghidraLogPath: string;
  readonly scriptLogPath: string;
  readonly psp?: true;
  readonly mipsSoftFloat?: true;
  readonly riscvCallingConvention?: GhidraRiscvCallingConvention;
  readonly dosMz?: true;
  readonly dosCom?: true;
  readonly rawBinary?: {
    readonly languageId: string;
    readonly compilerSpecId: string;
    readonly baseAddr: string;
  };
  readonly gamecubeDol?: {
    readonly languageId: string;
    readonly compilerSpecId?: string;
    readonly sectionFilePath: string;
  };
  readonly languageOverride?: GhidraLanguageOverride;
  /** Auto-analyzers disabled by the pre-analysis options script. */
  readonly disabledAnalyzers?: readonly string[];
  /** Canonical seed snapshot passed to the pre-analysis seed script. */
  readonly seedPath?: string;
}

type ExistingProjectOptions = Pick<
  GhidraHeadlessArgumentOptions,
  | "platform"
  | "existingProject"
  | "psp"
  | "dosMz"
  | "dosCom"
  | "rawBinary"
  | "languageOverride"
  | "mipsSoftFloat"
  | "riscvCallingConvention"
  | "seedPath"
  | "disabledAnalyzers"
> & { readonly analysisSeeds?: GhidraSeedCommitment };

/** Admit existing-project compatibility before any runtime writes. */
const validateExistingProjectOptions = (
  options: ExistingProjectOptions,
): void => {
  const existing = options.existingProject;
  const rawBinary = options.rawBinary;
  const override = options.languageOverride;
  if (existing !== undefined) {
    // The pre-imported project carries its own analysis; every import-time
    // selection is therefore rejected instead of silently ignored.
    if ((options.platform ?? process.platform) === "win32")
      throw new GhidraAdmissionError("existing_project_windows");
    if (existing.programName.trim() === "")
      throw new GhidraAdmissionError("existing_project_program_name");
    if (options.psp === true)
      throw new GhidraAdmissionError("existing_project_psp");
    if (options.dosMz === true || options.dosCom === true)
      throw new GhidraAdmissionError("existing_project_dos");
    if (rawBinary !== undefined)
      throw new GhidraAdmissionError("existing_project_raw_binary");
    if (override !== undefined)
      throw new GhidraAdmissionError("existing_project_language_override");
    if (options.mipsSoftFloat === true)
      throw new GhidraAdmissionError("existing_project_mips_soft_float");
    if (options.riscvCallingConvention !== undefined)
      throw new GhidraAdmissionError(
        "existing_project_riscv_calling_convention",
      );
    if (
      options.seedPath !== undefined ||
      options.analysisSeeds !== undefined ||
      (options.disabledAnalyzers?.length ?? 0) > 0
    )
      throw new GhidraAdmissionError("existing_project_analysis");
  }
};

/** Build the complete read-only headless invocation in deterministic order. */
export const ghidraHeadlessArguments = (
  options: GhidraHeadlessArgumentOptions,
): readonly string[] => {
  // Bridge script paths use the target platform's syntax, which differs from
  // the host when building a cross-platform invocation.
  const scriptPath =
    (options.platform ?? process.platform) === "win32" ? win32 : posix;
  const bridgeDirectory = scriptPath.dirname(options.bridgeScriptPath);
  const override = options.languageOverride;
  const rawBinary = options.rawBinary;
  const existing = options.existingProject;
  const gamecubeDol = options.gamecubeDol;
  validateExistingProjectOptions(options);
  if (
    gamecubeDol !== undefined &&
    (options.psp === true ||
      options.dosMz === true ||
      options.dosCom === true ||
      options.mipsSoftFloat === true ||
      options.riscvCallingConvention !== undefined ||
      rawBinary !== undefined ||
      override !== undefined)
  )
    throw new GhidraAdmissionError("gamecube_dol_combined");
  if (
    options.psp === true &&
    (options.dosMz === true ||
      options.dosCom === true ||
      override !== undefined)
  )
    throw new GhidraAdmissionError("psp_combined");
  if (options.psp === true && rawBinary !== undefined)
    throw new GhidraAdmissionError("psp_raw_binary");
  if (
    options.mipsSoftFloat === true &&
    (options.psp === true ||
      options.dosMz === true ||
      options.dosCom === true ||
      rawBinary !== undefined)
  )
    throw new GhidraAdmissionError("mips_soft_float_scope");
  if (
    options.riscvCallingConvention !== undefined &&
    (options.psp === true ||
      options.mipsSoftFloat === true ||
      options.dosMz === true ||
      options.dosCom === true ||
      rawBinary !== undefined)
  )
    throw new GhidraAdmissionError("riscv_calling_convention_scope");
  if (
    override !== undefined &&
    (options.dosMz === true || options.dosCom === true)
  )
    throw new GhidraAdmissionError("language_override_dos");
  if (override !== undefined && rawBinary !== undefined)
    throw new GhidraAdmissionError("language_override_raw_binary");
  if (
    rawBinary !== undefined &&
    (options.dosMz === true || options.dosCom === true)
  )
    throw new GhidraAdmissionError("raw_binary_dos");
  return [
    options.projectRoot,
    existing?.projectName ?? "rea-project",
    ...(existing === undefined
      ? [
          "-import",
          options.targetPath,
          ...(gamecubeDol !== undefined
            ? [
                // One BinaryLoader block at file offset 0; the pre-script rebuilds the DOL section map.
                "-loader",
                "BinaryLoader",
                "-loader-baseAddr",
                "0x0",
                "-processor",
                gamecubeDol.languageId,
                ...(gamecubeDol.compilerSpecId === undefined
                  ? []
                  : ["-cspec", gamecubeDol.compilerSpecId]),
              ]
            : options.dosMz === true
              ? [
                  "-loader",
                  "MzLoader",
                  "-processor",
                  "x86:LE:16:Real Mode",
                  "-cspec",
                  "default",
                ]
              : options.dosCom === true
                ? [
                    "-loader",
                    "BinaryLoader",
                    "-loader-baseAddr",
                    "1000:0100",
                    "-processor",
                    "x86:LE:16:Real Mode",
                    "-cspec",
                    "default",
                  ]
                : rawBinary === undefined
                  ? options.psp === true
                    ? [
                        "-loader",
                        "PspElfLoader",
                        "-processor",
                        "Allegrex:LE:32:default",
                        "-cspec",
                        "default",
                      ]
                    : override !== undefined
                      ? [
                          "-processor",
                          override.languageId,
                          ...(override.compilerSpecId === undefined
                            ? []
                            : ["-cspec", override.compilerSpecId]),
                        ]
                      : []
                  : [
                      "-loader",
                      "BinaryLoader",
                      "-loader-baseAddr",
                      rawBinary.baseAddr,
                      "-processor",
                      rawBinary.languageId,
                      "-cspec",
                      rawBinary.compilerSpecId,
                    ]),
        ]
      : ["-process", existing.programName]),
    // An existing project opens with -noanalysis: its auto-analysis was paid
    // when the project was imported, outside this session's startup deadline.
    ...(existing === undefined
      ? ["-readOnly", "-deleteProject"]
      : ["-noanalysis", "-readOnly"]),
    "-log",
    options.ghidraLogPath,
    "-scriptlog",
    options.scriptLogPath,
    "-scriptPath",
    bridgeDirectory,
    ...(options.dosCom === true
      ? [
          "-preScript",
          scriptPath.join(bridgeDirectory, GHIDRA_BRIDGE_SOURCES.prepareCom),
        ]
      : []),
    ...(rawBinary === undefined
      ? []
      : [
          "-preScript",
          scriptPath.join(bridgeDirectory, GHIDRA_BRIDGE_SOURCES.prepareRaw),
          rawBinary.languageId,
          rawBinary.baseAddr,
        ]),
    ...(gamecubeDol === undefined
      ? []
      : [
          "-preScript",
          scriptPath.join(bridgeDirectory, GHIDRA_BRIDGE_SOURCES.prepareDol),
          gamecubeDol.sectionFilePath,
        ]),
    // Seeds follow any loader preparation and precede default auto-analysis.
    ...(options.seedPath === undefined
      ? []
      : [
          "-preScript",
          scriptPath.join(bridgeDirectory, GHIDRA_BRIDGE_SOURCES.applySeeds),
          options.seedPath,
        ]),
    // Analyzer options must apply before default auto-analysis and before the
    // post-analysis repair and bridge scripts start serving.
    ...(options.disabledAnalyzers === undefined ||
    options.disabledAnalyzers.length === 0
      ? []
      : [
          "-preScript",
          scriptPath.join(
            bridgeDirectory,
            GHIDRA_BRIDGE_SOURCES.analysisOptions,
          ),
          options.disabledAnalyzers.join(","),
        ]),
    ...(existing !== undefined ||
    (options.platform ?? process.platform) === "win32"
      ? []
      : [
          "-postScript",
          scriptPath.join(bridgeDirectory, GHIDRA_BRIDGE_SOURCES.noReturnFix),
        ]),
    // After analysis and the no-return refit, before the bridge serves results.
    ...(options.mipsSoftFloat === true
      ? [
          "-postScript",
          scriptPath.join(bridgeDirectory, GHIDRA_BRIDGE_SOURCES.mipsSoftFloat),
        ]
      : []),
    ...(options.riscvCallingConvention === undefined
      ? []
      : [
          "-postScript",
          scriptPath.join(
            bridgeDirectory,
            GHIDRA_BRIDGE_SOURCES.riscvCallingConvention,
          ),
          options.riscvCallingConvention,
        ]),
    "-postScript",
    // Ghidra checks the caller's cwd before scriptPath for a basename. Select
    // the packaged source explicitly so unrelated entries cannot shadow it.
    options.bridgeScriptPath,
    options.descriptorPath,
  ];
};

const ghidraRuntimePaths = (runtimeRoot: string) => ({
  projectRoot: join(runtimeRoot, "project"),
  homeRoot: join(runtimeRoot, "home"),
  tempRoot: join(runtimeRoot, "tmp"),
  cacheRoot: join(runtimeRoot, "cache"),
  configRoot: join(runtimeRoot, "config"),
  dataRoot: join(runtimeRoot, "data"),
  descriptorPath: join(runtimeRoot, "session.json"),
  ownershipPath: join(runtimeRoot, "ownership.json"),
  ghidraLogPath: join(runtimeRoot, "ghidra.log"),
  scriptLogPath: join(runtimeRoot, "script.log"),
});

/**
 * Ghidra's launch support resolves its JDK before the headless run and then
 * persists that choice under `<config>/ghidra/<release directory>`. Inside
 * REA's Windows private runtime a child JVM cannot create those directories
 * itself, so startup aborted with "Failed to create directory" and reported
 * that no supported JDK was found. Create the release directory while this
 * process still owns the runtime, leaving Ghidra only a file write inside it.
 */
const createGhidraRuntimeDirectories = async (
  paths: ReturnType<typeof ghidraRuntimePaths>,
  platform: NodeJS.Platform,
  configReleaseDirectory: string,
): Promise<void> => {
  if (platform === "win32") {
    const runtime = windowsPrivateRuntime(dirname(paths.projectRoot));
    for (const path of [
      paths.projectRoot,
      paths.homeRoot,
      paths.tempRoot,
      paths.cacheRoot,
      paths.configRoot,
      paths.dataRoot,
    ])
      runtime.mkdir(basename(path));
    // Each level needs its parent first: the native owner opens every existing
    // component and creates only the final one.
    const configRoot = basename(paths.configRoot);
    runtime.mkdir(win32.join(configRoot, "ghidra"));
    runtime.mkdir(win32.join(configRoot, "ghidra", configReleaseDirectory));
    return;
  }
  await Promise.all(
    [
      paths.projectRoot,
      paths.homeRoot,
      paths.tempRoot,
      paths.cacheRoot,
      paths.configRoot,
      paths.dataRoot,
      join(paths.configRoot, "ghidra", configReleaseDirectory),
    ].map((path) => mkdir(path, { recursive: true, mode: 0o700 })),
  );
};

const ghidraLaunchEnvironment = (
  paths: ReturnType<typeof ghidraRuntimePaths>,
  javaHome: string | undefined,
  platform: NodeJS.Platform,
  executable: string,
  selectedEnvironment: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv => {
  return {
    ...ghidraJavaEnvironment(javaHome, selectedEnvironment, platform),
    ...ghidraHeadlessJavaOptions(paths.homeRoot, paths.tempRoot, platform),
    HOME: paths.homeRoot,
    TMPDIR: paths.tempRoot,
    ...(platform === "win32"
      ? {
          // Batch FOR /F launches another command interpreter through ComSpec.
          // Use the same executable with the spelling consumed by cmd.exe.
          ComSpec: executable.replaceAll("/", "\\"),
          USERPROFILE: paths.homeRoot,
          APPDATA: paths.configRoot,
          LOCALAPPDATA: paths.cacheRoot,
          TEMP: paths.tempRoot,
          TMP: paths.tempRoot,
        }
      : {}),
    XDG_CACHE_HOME: paths.cacheRoot,
    XDG_CONFIG_HOME: paths.configRoot,
    XDG_DATA_HOME: paths.dataRoot,
  };
};

/** Encode provider-owned JVM paths for the platform launcher that consumes them. */
export const ghidraHeadlessJavaOptions = (
  homeRoot: string,
  tempRoot: string,
  platform: NodeJS.Platform,
): Pick<
  NodeJS.ProcessEnv,
  "JDK_JAVA_OPTIONS" | "GHIDRA_HEADLESS_JAVA_OPTIONS"
> => {
  const options = [`-Duser.home=${homeRoot}`, `-Djava.io.tmpdir=${tempRoot}`];
  if (platform === "win32")
    return {
      JDK_JAVA_OPTIONS: [...options, "-XX:-UsePerfData"]
        .map((option) => ghidraBatchStep(() => quoteWindowsBatchToken(option)))
        .join(" "),
      GHIDRA_HEADLESS_JAVA_OPTIONS: "",
    };
  // POSIX launches the JVM directly, so these properties travel as separate
  // argv items instead of the shell-split analyzeHeadless option list.
  return { JDK_JAVA_OPTIONS: "", GHIDRA_HEADLESS_JAVA_OPTIONS: "" };
};

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;
