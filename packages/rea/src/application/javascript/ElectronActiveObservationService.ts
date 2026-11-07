import { dirname } from "node:path";
import { constants, type Stats } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";

import type { ExecutionOptions } from "../AnalysisProvider.js";
import type {
  CanonicalElectronActiveObservationInput,
  ElectronActiveObservationPort,
} from "./ElectronActiveObservationPort.js";
import {
  AnalysisAccessDeniedError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  type AnalysisInputIssue,
} from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Evidence } from "../../domain/evidence.js";
import type { ElectronActiveObservationInput } from "../../domain/javascript/electronActiveObservation.js";
import { err, ok, type Result } from "../../domain/result.js";
import { createElectronActiveEvidence } from "./ElectronActiveEvidence.js";

const OPERATION = "capture_electron_scenario" as const;
const PROVIDER_ID = "rea-playwright-electron-active";

type ElectronPathField =
  | "executable_path"
  | "application_path"
  | "application_root";

/**
 * Why a selected path was not admitted. Host permission denial is not
 * malformed caller input: the path may be correct, but REA cannot read it.
 */
type PathAdmissionFailure =
  | {
      readonly kind: "invalid";
      readonly issue: AnalysisInputIssue;
      readonly cause: unknown;
    }
  | { readonly kind: "denied"; readonly error: AnalysisAccessDeniedError };

const hostAccessDenial = (
  selected: string,
  cause: unknown,
): PathAdmissionFailure | undefined => {
  const code: unknown =
    cause instanceof Error ? Reflect.get(cause, "code") : undefined;
  return code === "EACCES" || code === "EPERM"
    ? {
        kind: "denied",
        error: new AnalysisAccessDeniedError(OPERATION, selected, code, {
          cause,
        }),
      }
    : undefined;
};

const resolveInputPath = async (
  field: ElectronPathField,
  selected: string,
): Promise<Result<string, PathAdmissionFailure>> => {
  try {
    // Darwin realpath can collapse file/.. even though native lookup rejects
    // that traversal. Admit the selected path before canonicalizing it.
    await stat(selected);
    return ok(await realpath(selected));
  } catch (cause: unknown) {
    return err(
      hostAccessDenial(selected, cause) ?? {
        kind: "invalid",
        issue: {
          path: [field],
          reason: "invalid_value",
          message: `Cannot resolve ${field} ${selected}: ${cause instanceof Error ? cause.message : String(cause)}`,
        },
        cause,
      },
    );
  }
};

/**
 * Resolve the executable and require a launchable regular file before any
 * spawn. Denied resolution or metadata reads are host access failures; a
 * readable file without execute permission is an invalid selection.
 */
const resolveExecutablePath = async (
  selected: string,
): ReturnType<typeof resolveInputPath> => {
  const resolved = await resolveInputPath("executable_path", selected);
  if (!resolved.ok) return resolved;
  let metadata: Stats;
  try {
    metadata = await stat(resolved.value);
  } catch (cause: unknown) {
    return err(
      hostAccessDenial(selected, cause) ?? notExecutable(selected, cause),
    );
  }
  if (!metadata.isFile())
    return err(notExecutable(selected, new Error("not a regular file")));
  if (process.platform !== "win32")
    try {
      await access(resolved.value, constants.X_OK);
    } catch (cause: unknown) {
      return err(notExecutable(selected, cause));
    }
  return resolved;
};

const notExecutable = (
  selected: string,
  cause: unknown,
): PathAdmissionFailure => ({
  kind: "invalid",
  issue: {
    path: ["executable_path"],
    reason: "invalid_value",
    message: `executable_path ${selected} is not an executable file: ${cause instanceof Error ? cause.message : String(cause)}`,
  },
  cause,
});

/**
 * Admit every selected path before any provider work. Invalid selections are
 * reported together as input issues; a host access denial is reported only
 * when no selection is invalid, because correcting the request comes first.
 */
const canonicalizeInput = async (
  input: ElectronActiveObservationInput,
): Promise<Result<CanonicalElectronActiveObservationInput, AnalysisError>> => {
  const [executable, application, root] = await Promise.all([
    resolveExecutablePath(input.executable_path),
    resolveInputPath("application_path", input.application_path),
    input.application_root === undefined
      ? Promise.resolve(ok(undefined))
      : resolveInputPath("application_root", input.application_root),
  ]);
  if (!executable.ok || !application.ok || !root.ok) {
    const failures = [executable, application, root].flatMap((result) =>
      result.ok ? [] : [result.error],
    );
    const issues = failures.flatMap((failure) =>
      failure.kind === "invalid" ? [failure.issue] : [],
    );
    const denial = failures.find((failure) => failure.kind === "denied");
    if (issues.length === 0 && denial !== undefined) return err(denial.error);
    return err(
      new AnalysisInputError(
        OPERATION,
        {
          cause: new AggregateError(
            failures.map((failure) =>
              failure.kind === "invalid" ? failure.cause : failure.error,
            ),
            "Electron paths could not be resolved",
          ),
        },
        issues,
      ),
    );
  }
  return ok({
    ...input,
    executable_path: executable.value,
    application_path: application.value,
    application_root: root.value ?? dirname(application.value),
  });
};

/** Canonicalize request paths and execute one provider-owned Electron run. */
export const captureElectronScenario = async (
  provider: ElectronActiveObservationPort | undefined,
  input: ElectronActiveObservationInput,
  options: ExecutionOptions = {},
): Promise<Result<Evidence, AnalysisError>> => {
  const canonical = await canonicalizeInput(input);
  if (!canonical.ok) return canonical;
  if (provider === undefined)
    return err(
      new AnalysisCapabilityUnavailableError(
        PROVIDER_ID,
        OPERATION,
        "active Electron observation provider is not configured",
      ),
    );
  const captured = await provider.capture(canonical.value, options);
  return captured.ok
    ? {
        ok: true,
        value: createElectronActiveEvidence(
          input,
          captured.value,
          provider.identity(),
          canonical.value,
        ),
      }
    : captured;
};
