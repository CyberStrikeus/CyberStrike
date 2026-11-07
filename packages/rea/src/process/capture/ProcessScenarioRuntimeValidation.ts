import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, sep } from "node:path";

import {
  absoluteCallerPath,
  appendCallerPath,
} from "../../filesystem/callerPath.js";

import type { ProcessScenario } from "../../domain/process/processScenario.js";
import {
  AnalysisAccessDeniedError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { snapshotEnvironment } from "../snapshotEnvironment.js";
import { processCaptureCancelled } from "./ProcessCaptureError.js";

/** Resolve caller-selected executable and observation paths for this execution. */
export const resolveProcessScenarioRuntimePaths = async (
  scenario: ProcessScenario,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ProcessScenario> => {
  const selectedWorkingDirectory = absoluteCallerPath(
    scenario.working_directory,
  );
  let workingDirectory: string;
  try {
    workingDirectory = await realpath(selectedWorkingDirectory);
  } catch (cause: unknown) {
    throw (
      hostAccessDenial(selectedWorkingDirectory, cause) ??
      invalidScenarioPath(
        "working_directory",
        `working directory could not be resolved: ${selectedWorkingDirectory}${osFailure(cause)}`,
        cause,
      )
    );
  }
  let workingDirectoryStat;
  try {
    workingDirectoryStat = await stat(workingDirectory);
  } catch (cause: unknown) {
    throw (
      hostAccessDenial(selectedWorkingDirectory, cause) ??
      invalidScenarioPath(
        "working_directory",
        `working directory could not be inspected: ${selectedWorkingDirectory}${osFailure(cause)}`,
        cause,
      )
    );
  }
  if (!workingDirectoryStat.isDirectory())
    throw invalidScenarioPath(
      "working_directory",
      `working directory is not a directory: ${selectedWorkingDirectory}`,
    );
  const executable = await resolveExecutable(
    scenario.executable,
    workingDirectory,
    snapshotEnvironment(scenario.environment, platform).PATH ??
      snapshotEnvironment(environment, platform).PATH,
  );
  const observationPaths = scenario.filesystem_observation_paths.map((path) =>
    absoluteCallerPath(path, { cwd: workingDirectory }),
  );
  return {
    ...scenario,
    executable,
    working_directory: workingDirectory,
    filesystem_observation_paths: observationPaths,
  };
};

/**
 * Resolve a selected executable through the caller's effective PATH. A denied
 * lookup of an explicitly selected path is a host access failure; PATH search
 * continues past denied directories, and an existing file without execute
 * permission remains an invalid selection.
 */
export const resolveExecutable = async (
  command: string,
  workingDirectory: string,
  searchPath: string | undefined,
): Promise<string> => {
  // Match Node's Unix default search path when PATH is absent. An empty
  // PATH is different: its empty component selects the working directory.
  const directories = (searchPath ?? "/usr/bin:/bin")
    .split(delimiter)
    .map((directory) =>
      directory === ""
        ? workingDirectory
        : absoluteCallerPath(directory, { cwd: workingDirectory }),
    );
  const explicit =
    isAbsolute(command) ||
    command.includes("/") ||
    (sep === "\\" && command.includes("\\"));
  const candidates = explicit
    ? [absoluteCallerPath(command, { cwd: workingDirectory })]
    : directories.map((directory) => appendCallerPath(directory, command));
  const failures: string[] = [];
  for (const candidate of candidates) {
    let metadata;
    try {
      metadata = await stat(candidate);
    } catch (cause: unknown) {
      const denial = explicit ? hostAccessDenial(candidate, cause) : undefined;
      if (denial !== undefined) throw denial;
      failures.push(`${candidate}${osFailure(cause)}`);
      continue;
    }
    if (!metadata.isFile()) {
      failures.push(`${candidate} (not a regular file)`);
      continue;
    }
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch (cause: unknown) {
      failures.push(`${candidate}${osFailure(cause)}`);
    }
  }
  throw invalidScenarioPath(
    "executable",
    `executable could not be resolved: ${command}; checked ${failures.join("; ")}`,
  );
};

const invalidScenarioPath = (
  field: "executable" | "working_directory",
  message: string,
  cause?: unknown,
): AnalysisInputError =>
  new AnalysisInputError(
    "capture_process_scenario",
    cause === undefined ? undefined : { cause },
    [{ path: [field], reason: "invalid_value", message }],
  );

/** Host permissions denied resolving a selected path; not malformed input. */
const hostAccessDenial = (
  selected: string,
  cause: unknown,
): AnalysisAccessDeniedError | undefined => {
  const code = osErrorCode(cause);
  return code === "EACCES" || code === "EPERM"
    ? new AnalysisAccessDeniedError(
        "capture_process_scenario",
        selected,
        code,
        {
          cause,
        },
      )
    : undefined;
};

const osErrorCode = (cause: unknown): string | undefined =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  typeof cause.code === "string"
    ? cause.code
    : undefined;

const osFailure = (cause: unknown): string => {
  const code = osErrorCode(cause);
  return code === undefined ? "" : ` (${code})`;
};

/** Reject cancellation before a process capture operation begins. */
export const assertNotCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw processCaptureCancelled(signal.reason);
};
