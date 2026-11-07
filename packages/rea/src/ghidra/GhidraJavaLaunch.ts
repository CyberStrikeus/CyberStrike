import { GhidraAdmissionError } from "./GhidraAdmissionError.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { appendCallerPath } from "../filesystem/callerPath.js";
import { dirname } from "node:path";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  jvmEnvironmentArguments,
  prepareJdkJavaOptions,
  rejectJvmPlatformOverrides,
} from "./GhidraJavaOptions.js";
import {
  execFileOutput,
  ExecFileOutputCancelledError,
  execFileOutputFailure,
  type ExecFileOutputFailure,
} from "../process/ExecFileOutput.js";

export const GHIDRA_LAUNCH_SUPPORT_CAPTURE_BYTES = 64 * 1024;
type LaunchSupportPhase = "-envvars" | "-vmargs" | "JDK_JAVA_OPTIONS";
type LaunchSupportOutcome = Omit<
  ExecFileOutputFailure,
  "killed" | "outputTruncated"
> & {
  readonly killed: boolean | null;
  readonly outputTruncated: boolean | null;
};

export class GhidraLaunchSupportError extends Error {
  readonly outcome: LaunchSupportOutcome | undefined;
  readonly cancellation: { readonly reason: unknown } | undefined;

  constructor(phase: LaunchSupportPhase, cause: unknown) {
    super(`Ghidra LaunchSupport ${phase} failed`, { cause });
    this.name = "GhidraLaunchSupportError";
    this.cancellation =
      cause instanceof ExecFileOutputCancelledError
        ? { reason: cause.cause }
        : cause instanceof ArtifactReaderFailure
          ? cause.cancellation
          : undefined;
    const outcome = execFileOutputFailure(cause);
    this.outcome =
      outcome === undefined
        ? undefined
        : {
            ...outcome,
            killed: this.cancellation === undefined ? outcome.killed : null,
            outputTruncated:
              this.cancellation === undefined ? outcome.outputTruncated : null,
          };
  }
}

/** Launch coordinates obtained from Ghidra's own release configuration helper. */
export const ghidraJavaLaunch = async (options: {
  readonly platform: NodeJS.Platform;
  readonly analyzeHeadlessPath: string;
  readonly javaHome?: string;
  readonly javaVmName?: string;
  readonly homeRoot: string;
  readonly tempRoot: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly resourceScope?: ArtifactResourceScope;
  readonly argumentFileRoot?: string;
  readonly onStderr: (mode: "-envvars" | "-vmargs", stderr: string) => void;
}): Promise<{
  readonly command: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  /** REA-configured -Xmx value, not effective or observed JVM memory. */
  readonly configuredMaxHeap?: string;
  /** Frozen argfile references for wrappers which launch their own JVM. */
  readonly preparedJdkJavaOptions?: string;
}> => {
  const supportRoot = dirname(options.analyzeHeadlessPath);
  const installRoot = dirname(supportRoot);
  const selectedJavaHome = options.javaHome ?? options.environment.JAVA_HOME;
  const command =
    selectedJavaHome === undefined
      ? options.platform === "win32"
        ? "java.exe"
        : "java"
      : appendCallerPath(
          selectedJavaHome,
          `bin/${options.platform === "win32" ? "java.exe" : "java"}`,
          options.platform,
        );
  const isolatedProperties = [
    `-Duser.home=${options.homeRoot}`,
    `-Djava.io.tmpdir=${options.tempRoot}`,
  ];
  const supportArguments = [
    ...isolatedProperties,
    // Only identified HotSpot VMs have these unified-logging semantics. OpenJ9
    // uses different -Xlog behavior; missing VM identity must stay unknown.
    ...(/^(?:OpenJDK|Java HotSpot\(TM\)) (?:64-Bit )?(?:Server|Client|Zero) VM$/u.test(
      options.javaVmName ?? "",
    )
      ? ["-Xlog:disable", "-Xlog:all=warning:stderr"]
      : []),
    "-cp",
    appendCallerPath(supportRoot, "LaunchSupport.jar", options.platform),
    "LaunchSupport",
    installRoot,
  ];
  const environment = {
    ...snapshotEnvironment(options.environment, options.platform),
  };
  const supportOutput = async (phase: "-envvars" | "-vmargs") => {
    try {
      return await execFileOutput(command, [...supportArguments, phase], {
        env: environment,
        maxBuffer: GHIDRA_LAUNCH_SUPPORT_CAPTURE_BYTES,
        // Wait for the helper's exit on abort so no probe outlives its owner.
        stopSignal: "SIGTERM",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (cause: unknown) {
      throw new GhidraLaunchSupportError(phase, cause);
    }
  };
  const configuredEnvironment = await supportOutput("-envvars");
  options.onStderr("-envvars", configuredEnvironment.stderr);
  for (const line of configuredEnvironment.stdout.split(/\r?\n/u)) {
    if (line === "") continue;
    const separator = line.indexOf("=");
    const sourceKey = line.slice(0, separator);
    const key =
      options.platform === "win32" ? sourceKey.toUpperCase() : sourceKey;
    if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key))
      throw new GhidraAdmissionError("invalid_environment_entry", {
        check: separator < 1 ? "separator" : "key",
        line: line.length <= 1024 ? line : line.slice(0, 1024),
        ...(line.length <= 1024 ? {} : { line_truncated: 1 }),
      });
    if ((environment[key] ?? "") === "")
      environment[key] = line.slice(separator + 1);
  }
  const configuredMaxHeap =
    environment.GHIDRA_HEADLESS_MAXMEM || environment.GHIDRA_MAXMEM || "2G";
  // The merged environment becomes the analysis JVM's environment, and the
  // JVM applies these options variables automatically. An injected
  // -Dos.arch/-Dos.name there selects an unvalidated native directory without
  // appearing in vmArguments, so reject the effective values as well.
  // JDK_JAVA_OPTIONS is the only helper variable the launched JVM expands as
  // argument files. Inspect those effective tokens with the same
  // platform-override policy. JAVA_TOOL_OPTIONS and _JAVA_OPTIONS treat @file
  // as an unrecognized option rather than expanding it.
  for (const key of ["JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS"] as const)
    rejectJvmPlatformOverrides(jvmEnvironmentArguments(environment[key] ?? ""));
  const preparedJdkJavaOptions = await prepareJdkJavaOptions(
    environment.JDK_JAVA_OPTIONS ?? "",
    {
      ...(options.resourceScope === undefined
        ? {}
        : { resources: options.resourceScope }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.argumentFileRoot === undefined
        ? {}
        : { directory: options.argumentFileRoot }),
      platform: options.platform,
    },
  ).catch((cause: unknown) => {
    if (cause instanceof ArtifactReaderFailure)
      throw new GhidraLaunchSupportError("JDK_JAVA_OPTIONS", cause);
    throw cause;
  });
  if (preparedJdkJavaOptions !== undefined)
    environment.JDK_JAVA_OPTIONS = preparedJdkJavaOptions;
  const configuredArguments = await supportOutput("-vmargs");
  options.onStderr("-vmargs", configuredArguments.stderr);
  const vmArguments = configuredArguments.stdout
    .split(/\r?\n/u)
    .filter((line) => line !== "");
  const invalidArgument = vmArguments.find(
    (argument) => !argument.startsWith("-") || argument.includes("\0"),
  );
  if (invalidArgument !== undefined)
    throw new GhidraAdmissionError("invalid_jvm_argument", {
      check: invalidArgument.includes("\0") ? "nul" : "prefix",
    });
  rejectJvmPlatformOverrides(vmArguments);
  return {
    command,
    environment,
    configuredMaxHeap,
    ...(preparedJdkJavaOptions === undefined ? {} : { preparedJdkJavaOptions }),
    arguments: [
      ...vmArguments,
      ...(options.platform === "darwin" ? ["-Xdock:name=Ghidra-Headless"] : []),
      `-Xmx${configuredMaxHeap}`,
      "-XX:ParallelGCThreads=2",
      "-XX:CICompilerCount=2",
      "-Djava.awt.headless=true",
      ...isolatedProperties,
      "-showversion",
      "-cp",
      appendCallerPath(
        installRoot,
        "Ghidra/Framework/Utility/lib/Utility.jar",
        options.platform,
      ),
      "ghidra.Ghidra",
      "ghidra.app.util.headless.AnalyzeHeadless",
      ...options.arguments,
    ],
  };
};
