import type { BrowserScenario } from "../domain/browserScenario.js";
import { PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION } from "../domain/browserNetworkEvidence.js";
import type {
  BrowserScenarioCaptureData,
  BrowserScenarioPartialObservation,
} from "../domain/browserScenarioCapture.js";
import type {
  BrowserScenarioEvent,
  BrowserScenarioStep,
} from "../domain/browserScenarioCaptureValues.js";
import type { BrowserScenarioSessionPort } from "./BrowserScenarioSessionPort.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { browserCleanupObservation } from "../domain/browserObservationError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY } from "./providerIdentities.js";

const OPERATION = "capture_browser_scenario" as const;

const browserScenarioLimitations = (
  session: BrowserScenarioSessionPort,
  scenario: BrowserScenario,
  events: readonly BrowserScenarioEvent[],
): string[] => {
  const capturedResponseBody =
    scenario.capture.network.response_body &&
    events.some(
      (event) =>
        event.kind === "network-content" &&
        event.phase === "response" &&
        event.body.state === "captured" &&
        (event.body.representation === "playwright-response-body-bytes" ||
          event.body.representation === "browser-decoded-response-bytes"),
    );
  return [
    "Event sequence records provider receipt order; simultaneous browser causality is not inferred.",
    "Network content is retained only when selected; Playwright response-body bytes are API results and are not guaranteed to match wire bytes.",
    "Request bytes are limited to what Playwright exposes; not_exposed does not establish body absence or multipart file coverage.",
    "Network content reads settle within 5 seconds each and the observer does not request bodies from unfinished responses.",
    ...(capturedResponseBody
      ? [PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION]
      : []),
    "Playwright scenario events do not expose request initiator stacks; receipt order does not prove causality.",
    "Storage values are hashed only after declared-secret redaction.",
    ...(scenario.actions.some(({ action }) => action === "request")
      ? [
          "Request steps sent their declared requests through the page's own fetch with its cookies and session, following no redirects; they are REA-initiated, not user-interface activity, and header values of at least 8 characters they read from page cookies or local storage are redacted like declared secrets from records made after they were read.",
        ]
      : []),
    ...(scenario.storage.local_storage.length === 0 &&
    scenario.storage.session_storage.length === 0
      ? []
      : [
          "Non-cookie storage seeds use CDP pre-script instrumentation; only pauses in the scenario's private seed script are resumed by this observer.",
        ]),
    ...(session.eventLimitations?.() ?? []),
    ...(session.storageLimitations?.() ?? []),
    ...(session.mode === "connect"
      ? [
          "CDP attachment cannot recover pre-attach events or guarantee launch-time context options.",
          `Attached locale ${scenario.environment.locale} applies to Intl formatting only; navigator.language(s) and Accept-Language remain caller-controlled. Use launch mode for matching page and request languages.`,
          "Detaching a CDP page session may clear caller-owned navigator.platform emulation. REA cannot snapshot the caller's complete user-agent/client-hint state before attachment; use launch mode to avoid mutating that external browser.",
        ]
      : []),
  ];
};

/** Project one session into the common capture fields used by success and failure. */
export const browserScenarioCaptureData = (input: {
  readonly session: BrowserScenarioSessionPort;
  readonly scenario: BrowserScenario;
  readonly startedAt: number;
  readonly steps: readonly BrowserScenarioStep[];
  readonly cleanup:
    | "terminated-owned-process"
    | "disconnected-external"
    | "incomplete";
  readonly limitations?: readonly string[];
}): BrowserScenarioCaptureData => {
  const events = input.session.events();
  return {
    browser: {
      mode: input.session.mode,
      process_ownership: input.session.processOwnership,
      cleanup: input.cleanup,
      product: input.session.product,
      version: input.session.version,
    },
    scenario: {
      start_origin: new URL(input.scenario.start_url.url).origin,
      action_count: input.scenario.actions.length,
      secret_references: input.scenario.secrets
        .map(({ secret_id: id }) => id)
        .sort(),
      network_content: input.scenario.capture.network,
      event_families: [...new Set(input.scenario.capture.events)].sort(),
      limits: input.scenario.capture.limits,
    },
    duration_ms: Math.max(0, Math.round(performance.now() - input.startedAt)),
    steps: [...input.steps],
    events,
    limitations: [
      ...browserScenarioLimitations(
        input.session,
        input.scenario,
        events.items,
      ),
      ...(input.limitations ?? []),
    ],
  };
};

/** Retain operation diagnostics and capture data after cleanup settles. */
export const browserScenarioOperationFailure = (
  cause: unknown,
  partialObservation: BrowserScenarioPartialObservation,
  cleanupFailure?: { readonly cause: unknown },
): AnalysisError => {
  const primary =
    cause instanceof AnalysisError
      ? cause
      : new ProviderAdapterError(
          PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY.id,
          OPERATION,
          { cause },
        );
  primary.retainPartialObservation(partialObservation);
  if (cleanupFailure === undefined) return primary;
  const observation = browserCleanupObservation(cleanupFailure.cause);
  const cleanup =
    cleanupFailure.cause instanceof AnalysisError &&
    cleanupFailure.cause.cleanupIncomplete
      ? cleanupFailure.cause
      : new ProviderCleanupError(
          PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY.id,
          observation.resources,
          { reason: observation.reason },
          { operation: "close_browser_scenario", cause: cleanupFailure.cause },
        );
  return analysisErrorWithCleanupFailure(
    primary,
    cleanup,
    OPERATION,
  ).bindCleanupDependencies([primary, cleanup]);
};
