import { isAbsolute } from "node:path";

import { defaultKunaCacheDirectory } from "../config/kunaCacheDirectory.js";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import { providerStartupTimeoutSchema } from "../config/providerStartupTimeout.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  KUNA_COMMAND_REMEDIATION,
  KUNA_UNSUPPORTED_HOST_REMEDIATION,
} from "./KunaRelease.js";

/** Kuna caps its own decode lanes and worker pool at 32. */
const MAX_KUNA_JOBS = 32;

/**
 * A 1.4 MB sqlite3 shell exported serially in 66-108 s on Apple M-series and
 * Linux hosts; thirty minutes admits images an order of magnitude larger
 * without an unbounded run. Larger images need a raised deadline or more jobs.
 */
const DEFAULT_PROJECT_TIMEOUT_MS = 30 * 60 * 1000;

/** One function decompiles in well under a second; sqlite3VdbeExec (42 KB) took 15-25 s. */
const DEFAULT_FUNCTION_TIMEOUT_MS = 120_000;

/**
 * A serial (`--jobs 1`) export is Kuna's reference answer: it decompiles
 * callees before callers, which recovers prototypes that parallel workers
 * cannot. Measured on coreutils sort, 40-60% of functions differ otherwise.
 */
const DEFAULT_JOBS = 1;

/** Measured sqlite3 exports occupy ~25 MiB; four GiB retains many projects. */
const DEFAULT_CACHE_MAX_BYTES = 4 * 1024 ** 3;

/** One project needs its .c, .h, .asm, inventory and manifest; refuse smaller caps. */
const MIN_CACHE_MAX_BYTES = 1024 ** 2;

/** Caller-selected Kuna installation and REA-owned project cache policy. */
export interface KunaConfiguration {
  /** Caller-selected executable path, preserved exactly as configured. */
  readonly command: string;
  /** REA-owned cache root; Kuna's own spec cache lives beneath it too. */
  readonly cacheRoot: string;
  readonly cacheMaxBytes: number;
  readonly projectTimeoutMs: number;
  /** Deadline for one single-function `kuna decompile` run. */
  readonly functionTimeoutMs: number;
  readonly jobs: number;
}

/** One configured deadline and the setting that owns it. */
export interface KunaDeadline {
  readonly setting: "REA_KUNA_TIMEOUT_MS" | "REA_KUNA_PROJECT_TIMEOUT_MS";
  readonly ms: number;
}

/** Single-function decompiles and the standalone inventory. */
export const kunaFunctionDeadline = (
  configuration: KunaConfiguration,
): KunaDeadline => ({
  setting: "REA_KUNA_TIMEOUT_MS",
  ms: configuration.functionTimeoutMs,
});

/** The project export and whole-program string, graph and xref scans. */
export const kunaProjectDeadline = (
  configuration: KunaConfiguration,
): KunaDeadline => ({
  setting: "REA_KUNA_PROJECT_TIMEOUT_MS",
  ms: configuration.projectTimeoutMs,
});

/** Why the configured environment cannot select a Kuna installation. */
export interface KunaConfigurationFailure {
  readonly code: "not_configured" | "open_options_invalid" | "unsupported_host";
  readonly reason: string;
  readonly setting: string | null;
  readonly remediation: string;
}

const failure = (
  code: KunaConfigurationFailure["code"],
  reason: string,
  setting: string | null = null,
): Result<never, KunaConfigurationFailure> =>
  err({
    code,
    reason,
    setting,
    remediation:
      code === "unsupported_host"
        ? KUNA_UNSUPPORTED_HOST_REMEDIATION
        : setting === null || setting === "REA_KUNA_COMMAND"
          ? KUNA_COMMAND_REMEDIATION
          : `Correct ${setting} to meet the reported constraint, or unset it to use its default. Restart REA after changing the environment.`,
  });

const positiveInteger = (value: string): number | undefined =>
  /^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : undefined;

/** Parse the Kuna settings without touching the filesystem or the executable. */
export const readKunaConfiguration = (
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform,
): Result<KunaConfiguration, KunaConfigurationFailure> => {
  const command = environment.REA_KUNA_COMMAND;
  if (command === undefined || command.length === 0)
    return failure("not_configured", KUNA_COMMAND_REMEDIATION);
  if (!isAbsolute(command))
    return failure(
      "open_options_invalid",
      `REA_KUNA_COMMAND must be an absolute path; received ${command}. ${KUNA_COMMAND_REMEDIATION}`,
      "REA_KUNA_COMMAND",
    );
  if (platform !== "darwin" && platform !== "linux")
    return failure("unsupported_host", KUNA_UNSUPPORTED_HOST_REMEDIATION);

  const cacheRoot = environment.REA_KUNA_CACHE_DIR;
  if (cacheRoot !== undefined && !isAbsolute(cacheRoot))
    return failure(
      "open_options_invalid",
      `REA_KUNA_CACHE_DIR must be an absolute directory; received ${cacheRoot}.`,
      "REA_KUNA_CACHE_DIR",
    );

  const rawMaxBytes = environment.REA_KUNA_CACHE_MAX_BYTES;
  const cacheMaxBytes =
    rawMaxBytes === undefined
      ? DEFAULT_CACHE_MAX_BYTES
      : positiveInteger(rawMaxBytes);
  if (cacheMaxBytes === undefined || cacheMaxBytes < MIN_CACHE_MAX_BYTES)
    return failure(
      "open_options_invalid",
      `REA_KUNA_CACHE_MAX_BYTES must be a decimal byte count of at least ${String(MIN_CACHE_MAX_BYTES)}; received ${String(rawMaxBytes)}.`,
      "REA_KUNA_CACHE_MAX_BYTES",
    );

  const rawTimeout = environment.REA_KUNA_PROJECT_TIMEOUT_MS;
  const timeout =
    rawTimeout === undefined
      ? undefined
      : providerStartupTimeoutSchema.safeParse(rawTimeout);
  if (timeout !== undefined && !timeout.success)
    return failure(
      "open_options_invalid",
      `REA_KUNA_PROJECT_TIMEOUT_MS must be a decimal millisecond count from 1 to 2147483647; received ${String(rawTimeout)}.`,
      "REA_KUNA_PROJECT_TIMEOUT_MS",
    );

  const rawFunctionTimeout = environment.REA_KUNA_TIMEOUT_MS;
  const functionTimeout =
    rawFunctionTimeout === undefined
      ? undefined
      : providerStartupTimeoutSchema.safeParse(rawFunctionTimeout);
  if (functionTimeout !== undefined && !functionTimeout.success)
    return failure(
      "open_options_invalid",
      `REA_KUNA_TIMEOUT_MS must be a decimal millisecond count from 1 to 2147483647; received ${String(rawFunctionTimeout)}.`,
      "REA_KUNA_TIMEOUT_MS",
    );

  const rawJobs = environment.REA_KUNA_JOBS;
  const jobs = rawJobs === undefined ? DEFAULT_JOBS : positiveInteger(rawJobs);
  if (jobs === undefined || jobs > MAX_KUNA_JOBS)
    return failure(
      "open_options_invalid",
      `REA_KUNA_JOBS must be an integer from 1 to ${String(MAX_KUNA_JOBS)}; received ${String(rawJobs)}.`,
      "REA_KUNA_JOBS",
    );

  return ok({
    command,
    cacheRoot:
      cacheRoot ??
      defaultKunaCacheDirectory(
        homeDirectoryFromEnvironment(environment, platform),
        environment,
        platform,
      ),
    cacheMaxBytes,
    projectTimeoutMs: timeout?.data ?? DEFAULT_PROJECT_TIMEOUT_MS,
    functionTimeoutMs: functionTimeout?.data ?? DEFAULT_FUNCTION_TIMEOUT_MS,
    jobs,
  });
};
