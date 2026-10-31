import {
  hopperStartupFailure,
  type HopperStartupFailureDiagnostic,
} from "../domain/hopperStartupFailure.js";
import type { ProviderProcessDiagnostic } from "../process/ProviderProcess.js";
import { parseLinuxPrivateDisplayDiagnostic } from "./LinuxPrivateDisplayDiagnostic.js";
import type { HopperLauncherOutcome } from "../domain/hopperErrors.js";

/** Recognize launcher stderr signatures only with complete, empty stdout. */
const hasCompleteLauncherOutput = (outcome: HopperLauncherOutcome): boolean =>
  outcome.output_closed &&
  !outcome.diagnostic_truncated &&
  outcome.stdout.text === "" &&
  outcome.stdout.bytes === 0 &&
  outcome.stdout.retained_bytes === 0;

/**
 * Hopper's native helper sends activate before its open-document Apple event.
 * Recognize its explicit authorization rejection. The launcher must separately
 * establish that caller arguments could not alter the generated AppleScript.
 * Other script errors, signals, and incomplete output leave ownership unknown.
 */
export const nativeHopperLaunchWasDenied = (
  outcome: HopperLauncherOutcome | undefined,
): outcome is HopperLauncherOutcome =>
  outcome !== undefined &&
  outcome.exit_code === 2 &&
  outcome.signal === null &&
  hasCompleteLauncherOutput(outcome) &&
  /^Cannot launch Hopper!\r?\nNot authorized to send Apple events to [^\r\n]+\.\r?\n?$/u.test(
    outcome.stderr.text,
  );

/**
 * Recognize the launcher's complete Spotlight diagnostic for actionable setup
 * guidance. Custom launchers may forward this report after a handoff, so the
 * report does not establish whether a document exists or release ownership.
 */
export const hopperLauncherReportedApplicationNotFound = (
  outcome: HopperLauncherOutcome | undefined,
): outcome is HopperLauncherOutcome =>
  outcome !== undefined &&
  outcome.exit_code === 3 &&
  outcome.signal === null &&
  hasCompleteLauncherOutput(outcome) &&
  /^Hopper has not been found\.\r?\nPlease make sure that Spotlight is active in order for this tool to find Hopper's executable\.\r?\n?$/u.test(
    outcome.stderr.text,
  );

/** Extract only a matching Linux adapter failure record. */
export const hopperLauncherFailureDiagnostic = (
  event: Extract<ProviderProcessDiagnostic, { readonly type: "exit" }>,
): HopperStartupFailureDiagnostic | undefined => {
  const parsed = parseLinuxPrivateDisplayDiagnostic(event.snapshot.stderr.text);
  if (!parsed.ok) return undefined;
  const expected = hopperStartupFailure(event.code)?.code;
  return parsed.value.operation === "launch" &&
    parsed.value.status === "error" &&
    parsed.value.failure_code === expected
    ? parsed.value
    : undefined;
};
