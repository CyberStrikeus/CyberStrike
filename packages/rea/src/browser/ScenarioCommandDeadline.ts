import { createRequire } from "node:module";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import {
  browserDeadlineRetry,
  cdpCommandDeadlineRecovery,
  CDP_CLEANUP_GRACE_MS,
  CDP_DISCOVERY_RESPONSE_TIMEOUT_MS,
  DEFAULT_CDP_COMMAND_TIMEOUT_MS,
  MAX_BROWSER_DEADLINE_MS,
  selectedCdpCommandTimeoutMs,
  type CdpCommandDeadlinePhase,
} from "../domain/browserDeadline.js";
import type { BrowserScenario } from "../domain/browserScenario.js";

const OPERATION = "capture_browser_scenario" as const;
type ScenarioCommandDeadlinePhase =
  | Extract<CdpCommandDeadlinePhase, "handshake" | "command">
  | "launch";

const pendingScenarioCommands = new WeakMap<
  BrowserObservationError,
  Promise<unknown>
>();

/** Selected scenario CDP deadline, or today's 20000 ms default when omitted. */
export const scenarioCommandTimeoutMs = (
  scenario: Pick<BrowserScenario, "command_timeout_ms">,
): number => selectedCdpCommandTimeoutMs(scenario.command_timeout_ms);

const playwrightTimedOut = (cause: unknown): cause is Error => {
  if (!(cause instanceof Error) || cause.name !== "TimeoutError") return false;
  // Check the public producer type without loading Playwright at MCP startup.
  const { errors } = createRequire(import.meta.url)(
    "playwright-core",
  ) as typeof import("playwright-core");
  return cause instanceof errors.TimeoutError;
};

/**
 * `capture-browser-scenario` accepts only scenario JSON, so recovery names
 * `command_timeout_ms` there and does not advertise a CLI flag.
 */
const scenarioCommandDeadlineRecovery = (
  timeoutMs: number,
  phase: ScenarioCommandDeadlinePhase,
  method?: string,
): { readonly userMessage: string; readonly remediationAction: string } => {
  const userMessage =
    phase === "launch"
      ? `Browser launch and persistent-context startup exceeded its ${String(timeoutMs)} ms command_timeout_ms deadline (deadlineExpired). This is not the caller observation window, the ${String(CDP_DISCOVERY_RESPONSE_TIMEOUT_MS)} ms CDP discovery deadline, or the ${String(CDP_CLEANUP_GRACE_MS)} ms cleanup grace.`
      : cdpCommandDeadlineRecovery(timeoutMs, phase, method).userMessage;
  const increase =
    timeoutMs < MAX_BROWSER_DEADLINE_MS
      ? `Set command_timeout_ms in the capture-browser-scenario JSON above ${String(timeoutMs)} (integer milliseconds from 1 to ${String(MAX_BROWSER_DEADLINE_MS)}; omitted means ${String(DEFAULT_CDP_COMMAND_TIMEOUT_MS)}).`
      : `command_timeout_ms is already at the maximum ${String(MAX_BROWSER_DEADLINE_MS)} ms; do not increase it further.`;
  return {
    userMessage,
    remediationAction: `${increase} ${browserDeadlineRetry} command_timeout_ms does not raise the fixed protocol, retained-event, or source byte budgets, the ${String(CDP_DISCOVERY_RESPONSE_TIMEOUT_MS)} ms CDP discovery response deadline, or the ${String(CDP_CLEANUP_GRACE_MS)} ms cleanup grace. Those have no runtime override.`,
  };
};

/** The scenario command still running after this deadline rejection, if any. */
export const scenarioCommandPending = (
  cause: unknown,
): Promise<unknown> | undefined =>
  cause instanceof BrowserObservationError
    ? pendingScenarioCommands.get(cause)
    : undefined;

/**
 * Observe a timed-out scenario command through completion.
 * The result stays with its caller; this does not close or detach it.
 */
export const settleScenarioCommand = async (cause: unknown): Promise<void> => {
  await scenarioCommandPending(cause)?.catch(() => undefined);
};

const releasableCommandResult = (
  value: unknown,
): value is {
  readonly close?: () => Promise<unknown>;
  readonly detach?: () => Promise<unknown>;
} => typeof value === "object" && value !== null;

/** Close or detach a browser, context, or session that arrives after its deadline. */
export const releaseLateScenarioCommand = async (
  cause: unknown,
): Promise<void> => {
  const pending = scenarioCommandPending(cause);
  if (pending === undefined) return;
  let value: unknown;
  try {
    value = await pending;
  } catch {
    return;
  }
  if (!releasableCommandResult(value)) return;
  if (typeof value.detach === "function") {
    await value.detach();
    return;
  }
  if (typeof value.close === "function") await value.close();
};

/**
 * Bound browser startup, a CDP handshake or a command by the scenario deadline.
 * The underlying operation stays reachable after a timeout so its owner can
 * close the returned handle or restore a mutation that lands late.
 * Playwright's own timeout, when it rejects first, is reported as that deadline.
 */
export const withScenarioCommandDeadline = async <T>(
  work: () => Promise<T>,
  timeoutMs: number,
  phase: ScenarioCommandDeadlinePhase,
  method?: string,
  launchExecutablePath?: string,
): Promise<T> => {
  let operation: Promise<T>;
  try {
    operation = work();
  } catch (cause: unknown) {
    operation = Promise.reject(cause);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const deadlineFailure = (cause?: Error): BrowserObservationError => {
    const deadline = scenarioCommandDeadlineRecovery(timeoutMs, phase, method);
    return new BrowserObservationError(OPERATION, "timeout", {
      detail: deadline.userMessage,
      remediationAction: deadline.remediationAction,
      cause,
      diagnostics: {
        phase,
        command_timeout_ms: timeoutMs,
        ...(launchExecutablePath === undefined
          ? {}
          : { executable_path: launchExecutablePath }),
        ...(method === undefined ? {} : { method }),
        // Discovered CDP URLs can carry transport userinfo in Playwright's
        // native message. Preserve that cause without projecting it here.
        ...(cause === undefined || phase !== "launch"
          ? {}
          : { producer_message: cause.message }),
      },
    });
  };
  try {
    return await new Promise<T>((resolve, reject) => {
      const fail = (cause: unknown): void => {
        if (settled) return;
        settled = true;
        reject(cause);
      };
      timer = setTimeout(() => {
        const timeout = deadlineFailure();
        pendingScenarioCommands.set(timeout, operation);
        fail(timeout);
      }, timeoutMs);
      operation.then(
        (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        },
        (cause: unknown) => {
          if (playwrightTimedOut(cause)) {
            fail(deadlineFailure(cause));
            return;
          }
          fail(cause);
        },
      );
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
