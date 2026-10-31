import { z } from "zod";

import {
  fixedAllowanceRemediation,
  type FixedAllowanceKind,
} from "../fixedAllowanceRemediation.js";

/** Largest delay Node honors as a timer rather than clamping to 1 ms. */
export const MAX_NATIVE_TIMER_MS = 2_147_483_647;

/**
 * Omitted `native_command_timeout_ms`. This is the macOS Xcode-tool wall
 * clock, not objdump/rizin `command_timeout_ms` (default 120000).
 */
export const DEFAULT_NATIVE_COMMAND_TIMEOUT_MS = 60_000;

/** Omitted `native_ui_deadline_ms` for one UI observation or scenario. */
export const DEFAULT_NATIVE_UI_DEADLINE_MS = 180_000;

/** Omitted `pwntools_timeout_ms` for one owned pwntools command. */
export const DEFAULT_PWNTOOLS_TIMEOUT_MS = 30_000;

/**
 * One scenario wait step. The operation deadline is separate and adjustable;
 * this step cap stays fixed.
 */
export const NATIVE_UI_WAIT_STEP_MAX_MS = 180_000;

/** Integer millisecond deadline shared by the native command, UI, and pwntools settings. */
export const nativeDeadlineMsSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_NATIVE_TIMER_MS);

const deadlineField = (description: string) =>
  nativeDeadlineMsSchema.optional().describe(description);

/** Per-call macOS native command deadline. Omitted means 60000 ms. */
export const nativeCommandTimeoutField = deadlineField(
  "Wall-clock budget in milliseconds for each macOS native command in this call (lipo, codesign, plutil, swift-demangle, and the other allowlisted Xcode tools). Omitted means 60000. Integer from 1 to 2147483647. Applies on the next call. Does not raise the fixed 67108864-byte output allowance or the 65536-byte failure-diagnostic excerpt. Named native_command_timeout_ms rather than command_timeout_ms because command_timeout_ms is the separate one-shot objdump and rizin deadline (default 120000).",
);

/** Per-call native UI observation deadline. Omitted means 180000 ms. */
export const nativeUiDeadlineField = deadlineField(
  "Deadline in milliseconds for this UI observation or scenario, including helper preparation and captures. Omitted means 180000. Integer from 1 to 2147483647. Applies on the next call. Does not raise the fixed 67108864-byte scenario output allowance or the 180000 ms cap on one wait step. A partial observation may already be retained when this deadline expires.",
);

/** Per-call pwntools command deadline. Omitted means 30000 ms. */
export const pwntoolsTimeoutField = deadlineField(
  "Deadline in milliseconds for each owned pwntools command in this call. Omitted means 30000. Integer from 1 to 2147483647. Applies on the next call. Does not raise cpuSeconds 30 or the output (67108864 bytes), diagnostic (1048576 bytes), or address-space (3221225472 bytes) allowances. Artifact admission stays REA_PWNTOOLS_MAX_INPUT_BYTES (default 33554432 bytes).",
);

export type NativeDeadlineRead =
  | { readonly ok: true; readonly timeoutMs: number }
  | {
      readonly ok: false;
      readonly reason: "invalid_type" | "out_of_range";
      readonly message: string;
    };

/** Accept an omitted deadline as the shipped default. */
export const readNativeDeadline = (
  value: unknown,
  defaultMs: number,
): NativeDeadlineRead => {
  if (value === undefined) return { ok: true, timeoutMs: defaultMs };
  const parsed = nativeDeadlineMsSchema.safeParse(value);
  if (parsed.success) return { ok: true, timeoutMs: parsed.data };
  const invalidType = parsed.error.issues.some(
    (issue) => issue.code === "invalid_type",
  );
  return {
    ok: false,
    reason: invalidType ? "invalid_type" : "out_of_range",
    message: `Expected an integer from 1 to ${String(MAX_NATIVE_TIMER_MS)} milliseconds; received ${JSON.stringify(value)}. Omitted means ${String(defaultMs)}.`,
  };
};

/** Agent recovery for a caller-selected native deadline at today's default. */
export const nativeDeadlineRecovery = (input: {
  readonly timeoutMs: number;
  readonly setting: string;
  readonly cliFlag: string;
  readonly defaultMs: number;
  readonly phase: string;
  readonly unchanged: string;
  readonly detail?: string;
}): { readonly userMessage: string; readonly remediationAction: string } => {
  const atMaximum = input.timeoutMs >= MAX_NATIVE_TIMER_MS;
  const adjustment = atMaximum
    ? `${input.setting} (${input.cliFlag} on the CLI) is already at the maximum ${String(MAX_NATIVE_TIMER_MS)} ms; do not increase it.`
    : `Increase ${input.setting} above ${String(input.timeoutMs)} (integer milliseconds from 1 to ${String(MAX_NATIVE_TIMER_MS)}; omitted means ${String(input.defaultMs)}), or pass ${input.cliFlag} on the CLI. A change applies on the next call.`;
  return {
    userMessage: `This request reached REA's ${input.phase} of ${String(input.timeoutMs)} ms (${input.setting}). This is a server/provider deadline, not the MCP client deadline.${input.detail ?? ""}`,
    remediationAction: `${adjustment} ${input.unchanged} Allow execution, cleanup, and delivery headroom in the outer MCP client deadline. Confirm outstanding work and cleanup before retrying.`,
  };
};

/** Fixed native allowance the agent can see, with the value and no override. */
export const fixedNativeAllowance = (
  allowance: string,
  kind: FixedAllowanceKind,
  valueWithUnits: string,
): { readonly retryable: false; readonly remediationAction: string } => ({
  retryable: false,
  remediationAction: `${fixedAllowanceRemediation(allowance, kind)} This release has no runtime override. The allowance is ${valueWithUnits}.`,
});
