import { z } from "zod";

import type { BrowserObservationOperation } from "./browserObservationErrors.js";

/** Largest delay supported without overflowing Node timers. */
export const MAX_BROWSER_DEADLINE_MS = 2_147_483_647;

/**
 * CDP command and WebSocket handshake deadline. Discovery and cleanup grace
 * are separate phases and stay fixed.
 */
export const DEFAULT_CDP_COMMAND_TIMEOUT_MS = 20_000;

/** Per-response deadline for loopback CDP discovery documents. */
export const CDP_DISCOVERY_RESPONSE_TIMEOUT_MS = 10_000;

/** Cleanup grace after a CDP runtime command. It does not extend the command deadline. */
export const CDP_CLEANUP_GRACE_MS = 5_000;

/** Optional caller deadline. An omitted field stays absent in Evidence. */
export const optionalBrowserDeadlineMs = (description: string) =>
  z
    .number()
    .int()
    .min(1)
    .max(MAX_BROWSER_DEADLINE_MS)
    .optional()
    .describe(description);

export const selectedBrowserDeadlineMs = (
  selected: number | undefined,
  defaultMs: number,
): number => selected ?? defaultMs;

export const browserDeadlineIncrease = (
  key: string,
  timeoutMs: number,
  defaultMs: number,
  cli: string,
): string =>
  timeoutMs < MAX_BROWSER_DEADLINE_MS
    ? `Increase ${key} above ${String(timeoutMs)} (integer milliseconds from 1 to ${String(MAX_BROWSER_DEADLINE_MS)}; omitted means ${String(defaultMs)}), or use ${cli} on the CLI.`
    : `${key} is already at the maximum ${String(MAX_BROWSER_DEADLINE_MS)} ms; do not increase it further.`;

export const browserDeadlineRetry =
  "Applies on the next call. Allow execution, cleanup and delivery headroom in the outer MCP client deadline. Confirm outstanding work and cleanup before retrying.";

/** Fixed allowance the caller cannot raise through a sibling deadline. */
export const noRuntimeOverrideSentence = (
  allowance: string,
  unrelatedControl?: string,
): string =>
  `${allowance} This release has no runtime override.${
    unrelatedControl === undefined
      ? ""
      : ` ${unrelatedControl} does not raise it.`
  }`;

/** Handshake and per-command deadline shared by CDP browser tools. */
export const webRuntimeCommandTimeoutSchema = optionalBrowserDeadlineMs(
  `CDP WebSocket handshake and per-command response deadline in milliseconds (default ${String(DEFAULT_CDP_COMMAND_TIMEOUT_MS)}). Omitted means ${String(DEFAULT_CDP_COMMAND_TIMEOUT_MS)} and applies on the next call. deadlineExpired for a handshake or command is not the caller observation window, not the ${String(CDP_DISCOVERY_RESPONSE_TIMEOUT_MS)} ms CDP discovery response deadline, and not the ${String(CDP_CLEANUP_GRACE_MS)} ms cleanup grace. It also bounds passive script-source collection and the inspection/source-join phase that share this deadline. Does not raise the fixed protocol, retained-event, or source byte budgets. CDP discovery and cleanup grace have no runtime override.`,
);

export type CdpCommandDeadlinePhase = "handshake" | "command" | "source-join";

/**
 * Operations whose public input accepts command_timeout_ms. Other CDP callers
 * keep the same numeric deadline and must not advertise a setting they lack.
 */
const COMMAND_TIMEOUT_OPERATIONS = new Set<BrowserObservationOperation>([
  "inspect_web_page",
  "analyze_web_bundle",
  "observe_web_session",
  "observe_web_execution",
  "inspect_web_event_listeners",
  "discover_webmcp_tools",
  "capture_web_screenshot",
  "inspect_electron_page",
  "capture_browser_scenario",
]);

export const cdpCommandTimeoutIsSelectable = (
  operation: BrowserObservationOperation,
): boolean => COMMAND_TIMEOUT_OPERATIONS.has(operation);

/** Name command_timeout_ms as an unrelated control only when that operation accepts it. */
export const cdpCommandTimeoutUnrelatedControl = (
  operation: BrowserObservationOperation,
): string | undefined =>
  cdpCommandTimeoutIsSelectable(operation) ? "command_timeout_ms" : undefined;

const cdpDeadlineSubject = (
  timeoutMs: number,
  phase: CdpCommandDeadlinePhase,
  method: string | undefined,
  selectable: boolean,
): string => {
  const budget = selectable
    ? `${String(timeoutMs)} ms command_timeout_ms`
    : `fixed ${String(timeoutMs)} ms`;
  if (phase === "handshake")
    return `CDP WebSocket handshake exceeded its ${budget} deadline (deadlineExpired).`;
  if (phase === "source-join")
    return `The inspection/source-join phase exceeded its ${budget} deadline (deadlineExpired).`;
  return `CDP command ${method ?? "request"} exceeded its ${budget} response deadline (deadlineExpired).`;
};

/** Name the CDP deadline, and name command_timeout_ms only when the operation accepts it. */
export const cdpCommandDeadlineRecovery = (
  timeoutMs: number,
  phase: CdpCommandDeadlinePhase,
  method?: string,
  selectable = true,
): { readonly userMessage: string; readonly remediationAction: string } => {
  const subject = cdpDeadlineSubject(timeoutMs, phase, method, selectable);
  if (!selectable) {
    const fixed = noRuntimeOverrideSentence(
      `${subject} This is not the caller observation window and not the ${String(CDP_DISCOVERY_RESPONSE_TIMEOUT_MS)} ms CDP discovery deadline.`,
    );
    return { userMessage: fixed, remediationAction: fixed };
  }
  return {
    userMessage: `${subject} This is not the caller observation window, not the ${String(CDP_DISCOVERY_RESPONSE_TIMEOUT_MS)} ms CDP discovery deadline, and not the ${String(CDP_CLEANUP_GRACE_MS)} ms cleanup grace.`,
    remediationAction: `${browserDeadlineIncrease("command_timeout_ms", timeoutMs, DEFAULT_CDP_COMMAND_TIMEOUT_MS, "--command-timeout-ms")} ${browserDeadlineRetry} command_timeout_ms does not raise the fixed protocol, retained-event, or source byte budgets, the ${String(CDP_DISCOVERY_RESPONSE_TIMEOUT_MS)} ms CDP discovery response deadline, or the ${String(CDP_CLEANUP_GRACE_MS)} ms cleanup grace. Those have no runtime override.`,
  };
};

/** Cleanup grace is a fixed phase after the command deadline. */
export const cdpCleanupGraceExpired = (): string =>
  noRuntimeOverrideSentence(
    `CDP runtime cleanup exceeded its ${String(CDP_CLEANUP_GRACE_MS)} ms cleanup grace.`,
    "command_timeout_ms",
  );

export const selectedCdpCommandTimeoutMs = (
  selected: number | undefined,
): number =>
  selectedBrowserDeadlineMs(selected, DEFAULT_CDP_COMMAND_TIMEOUT_MS);
