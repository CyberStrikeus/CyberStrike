import type { InspectWebPageInput } from "../domain/browserObservation.js";
import type { WebPageInspection } from "../domain/browserObservationSchemas.js";
import type { ProgressReporter } from "../application/ProgressReporter.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";
import { stableWebResources } from "../domain/webInventory.js";
import type { CdpEndpointDiscovery, CdpEndpointTarget } from "./CdpEndpoint.js";
import { CdpConnection } from "./CdpConnection.js";
import { CdpCaptureEvents } from "./CdpCaptureEvents.js";
import { authorizedMainFrame } from "./CdpAuthorizedMainFrame.js";
import { cdpOriginScopeRefusal } from "./CdpOriginScopeError.js";
import { captureStorage } from "./CdpCaptureStorage.js";
import { optionalCdpCommand } from "./CdpOptionalCommand.js";
import { CdpCommandRejection } from "./CdpCommandRejection.js";
import {
  captureAccessibility,
  captureDom,
  captureFrames,
  captureResources,
  type CapturedResource,
  type DomCapture,
  mainFrameUrl,
} from "./CdpCaptureDocuments.js";
import { capturedSvgNodeKind } from "./CdpCaptureDomNamespaces.js";
import {
  allowedSanitizedUrl,
  delayWithCancellation,
} from "./CdpCaptureValues.js";
import {
  captureScripts,
  finalizeScriptInventory,
} from "./CdpPageCaptureScripts.js";
import { captureWorkers } from "./CdpPageCaptureWorkers.js";
import type { WebSourceMapRequest } from "./WebSourceMapFetcher.js";

export interface CaptureContext {
  readonly connection: CdpConnection;
  readonly sessionId: string | undefined;
  readonly operation: Extract<
    BrowserObservationOperation,
    "inspect_web_page" | "analyze_web_bundle"
  >;
  readonly discovery: CdpEndpointDiscovery;
  readonly target: CdpEndpointTarget;
  readonly input: InspectWebPageInput;
  readonly signal?: AbortSignal;
  readonly progress?: ProgressReporter;
}

interface CaptureState {
  readonly context: CaptureContext;
  readonly events: CdpCaptureEvents;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly limitations: string[];
  readonly startedAt: string;
}

interface CapturedSections {
  readonly attachedUrl: string;
  readonly frames: WebPageInspection["frames"];
  readonly dom: DomCapture;
  readonly accessibility: ReturnType<typeof captureAccessibility>;
  readonly scripts: WebPageInspection["scripts"];
  readonly resources: WebPageInspection["resources"];
  readonly workers: WebPageInspection["workers"];
  readonly storage: WebPageInspection["storage"];
}

export interface CapturedPage {
  readonly inspection: WebPageInspection;
  readonly sourceMapRequests: readonly WebSourceMapRequest[];
}

/** Capture and normalize one attached page without evaluating page JavaScript. */
export const capturePage = async (
  context: CaptureContext,
): Promise<CapturedPage> => {
  const allowedOrigins = new Set(context.input.allowed_origins);
  const events = new CdpCaptureEvents(context.input, allowedOrigins);
  const removeListener = context.connection.onEvent((event) => {
    if (event.sessionId !== context.sessionId) return;
    events.ingest(event);
  });
  const state: CaptureState = {
    context,
    events,
    allowedOrigins,
    limitations: [
      ...(context.discovery.limitations ?? []),
      "Observation starts when REA attaches; prior network and console activity is unavailable.",
      "Worker targets are a final inventory snapshot, not worker-session observation. Their attached flag describes any debugging client; this page-session collector does not observe worker network, console, or script events, and short-lived workers may be absent from the snapshot.",
      "Raw network headers, bodies, cookies, storage values, console objects, and WebSocket payloads are never retained; explicitly requested primitive console text is retained verbatim, while payload captures retain value-free shapes.",
      "Source maps are reported only as declarative URLs and are not fetched.",
      "URL-less scripts and console events without an allowed source URL are excluded because their origin cannot be proven.",
      ...(context.target.attached === null
        ? [
            "CDP discovery could not establish the target's debugger attachment state.",
          ]
        : []),
    ],
    startedAt: new Date().toISOString(),
  };
  try {
    return await captureAuthorizedPage(state);
  } catch (cause: unknown) {
    // A navigation can invalidate an in-flight script ID or another document
    // read. Report the observed capture invalidation before its stale-read
    // symptom, while preserving caller cancellation.
    if (
      context.signal?.aborted !== true &&
      !(cause instanceof AnalysisCancelledError) &&
      !(cause instanceof AnalysisError && cause.userCategory === "cancelled")
    )
      assertObservedCaptureValid(state, cause);
    throw cause;
  } finally {
    removeListener();
  }
};

const assertObservedCaptureValid = (
  state: CaptureState,
  cause?: unknown,
): void => {
  const reason = state.events.unknownRootIdentity
    ? "protocol_error"
    : state.events.originViolation
      ? "target_not_allowed"
      : state.events.navigationDuringCapture
        ? "target_changed"
        : undefined;
  if (reason === "target_not_allowed")
    throw cdpOriginScopeRefusal(state.context.operation, { cause });
  if (reason !== undefined) {
    if (cause instanceof BrowserObservationError && cause.reason === reason)
      throw cause;
    throw new BrowserObservationError(state.context.operation, reason, {
      cause,
    });
  }
};

const captureAuthorizedPage = async (
  state: CaptureState,
): Promise<CapturedPage> => {
  const { context, allowedOrigins, limitations } = state;
  const { connection, sessionId, input, signal } = context;
  await authorizeObservationWindow(state);
  await captureJsonResponseBodies(state);
  const frameResult = await authorizedMainFrame({
    connection: context.connection,
    sessionId: context.sessionId,
    signal: context.signal,
    allowedOrigins,
    operation: context.operation,
  });
  const attachedUrl = mainFrameUrl(frameResult) ?? "";
  const frameCapture = captureFrames(
    frameResult,
    allowedOrigins,
    undefined,
    state.events.completeness,
  );
  const frames = frameCapture.items;
  const captureFrame = frameCapture.root;
  if (captureFrame === undefined)
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  state.events.beginFinalCapture(captureFrame.frame_id);
  const resourceCapture = captureResources(
    await connection.send("Page.getResourceTree", {}, sessionId, signal),
    allowedOrigins,
    state.events.completeness,
  );
  const resources = stableWebResources(
    resourceCapture.items.map(publicResource),
  );
  const dom = await capturePageDom(state);
  const accessibility = await accessibilityForFrames(state, frames);
  const scripts = await captureScripts({
    context,
    events: state.events,
    rawResources: resourceCapture.items,
    resources,
    frameIds: new Set(frames.map((frame) => frame.frame_id)),
  });
  const workers = await captureWorkers(
    { context, allowedOrigins, limitations, events: state.events },
    new Set(frames.map((frame) => frame.frame_id)),
  );
  const storageCapture = await captureStorage(
    context,
    attachedUrl,
    limitations,
  );
  if (!input.include_storage_keys)
    state.events.completeness.exclude("storage_keys", "not_approved", null);
  else if (storageCapture.keysExclusion !== undefined)
    state.events.completeness.exclude(
      "storage_keys",
      storageCapture.keysExclusion,
      null,
    );
  await report(context.progress, 3, "Normalizing browser evidence");
  const completedFrameResult = await authorizedMainFrame({
    connection: context.connection,
    sessionId: context.sessionId,
    signal: context.signal,
    allowedOrigins,
    operation: context.operation,
  });
  const completedUrl = mainFrameUrl(completedFrameResult) ?? "";
  assertObservedCaptureValid(state);
  if (completedUrl !== attachedUrl)
    throw new BrowserObservationError("inspect_web_page", "target_changed");
  // Body IDs were enumerated before asynchronous CDP reads. Events remain
  // enabled through the final capture, so account for eligible responses that
  // arrived while those reads were pending.
  state.events.settleUnexaminedResponseBodies();
  const scriptInventory = finalizeScriptInventory(scripts, state.events);
  state.events.recordScriptMetadataBudgetExclusions();
  return {
    inspection: normalizedInspection(state, {
      attachedUrl,
      frames,
      dom,
      accessibility,
      scripts: scriptInventory,
      resources,
      workers,
      storage: storageCapture.value,
    }),
    sourceMapRequests: scripts.sourceMapRequests,
  };
};

const captureJsonResponseBodies = async (
  state: CaptureState,
): Promise<void> => {
  const requests = state.events.responseBodyRequests();
  for (let index = 0; index < requests.length; index += 1) {
    const candidate = requests[index];
    if (candidate === undefined) continue;
    const current = state.events.currentResponseBodyRequest(candidate);
    if (current === undefined) continue;
    if (current.encoded_data_length === null) {
      state.events.responseBodyUnavailable(candidate);
      continue;
    }
    let result: unknown;
    try {
      result = await optionalCdpCommand(
        state.context,
        "Network.getResponseBody",
        { requestId: candidate.requestId },
        state.limitations,
      );
    } catch (cause: unknown) {
      if (
        !(cause instanceof CdpCommandRejection) ||
        cause.command !== "Network.getResponseBody" ||
        cause.code !== -32_000 ||
        cause.reportedMessage === null
      )
        throw cause;
      state.events.responseBodyUnavailable(candidate);
      state.limitations.push(
        `Response body unavailable for request ${candidate.requestId}: ${cause.userMessage}`,
      );
      continue;
    }
    if (result !== undefined) {
      state.events.ingestResponseBody(candidate, result);
      continue;
    }
    for (const remaining of requests.slice(index))
      state.events.responseBodyUnavailable(remaining);
    return;
  }
};

const authorizeObservationWindow = async (
  state: CaptureState,
): Promise<void> => {
  const { context, allowedOrigins, events } = state;
  const { connection, sessionId, signal } = context;
  await report(context.progress, 1, "Enabling passive CDP domains");
  await connection.send("Page.enable", {}, sessionId, signal);
  const initialFrameResult = await authorizedMainFrame({
    connection: context.connection,
    sessionId: context.sessionId,
    signal: context.signal,
    allowedOrigins,
    operation: context.operation,
  });
  const mainFrame = captureFrames(initialFrameResult, allowedOrigins).root;
  if (mainFrame === undefined)
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  events.beginAuthorizedFrame(mainFrame.frame_id);
  await enableObservationDomains(state);
  await report(context.progress, 2, "Observing page events");
  await delayWithCancellation(
    context.input.observation_ms,
    context.operation,
    signal,
  );
  if (events.unknownRootIdentity)
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  if (events.originViolation) throw cdpOriginScopeRefusal(context.operation);
};

const capturePageDom = async (state: CaptureState): Promise<DomCapture> => {
  const { context, allowedOrigins } = state;
  const result = await context.connection.send(
    "DOMSnapshot.captureSnapshot",
    {
      computedStyles: [],
      includePaintOrder: false,
      includeDOMRects: false,
    },
    context.sessionId,
    context.signal,
  );
  const capture = captureDom(
    result,
    allowedOrigins,
    context.input,
    state.events.completeness,
  );
  let step = capture.next();
  let descriptionUnavailable = false;
  const pendingController = new AbortController();
  const signal =
    context.signal === undefined
      ? pendingController.signal
      : AbortSignal.any([context.signal, pendingController.signal]);
  while (!step.done) {
    const pending = step.value.map(async (query) => {
      if (descriptionUnavailable) return undefined;
      try {
        return capturedSvgNodeKind(
          query,
          await context.connection.send(
            "DOM.describeNode",
            { backendNodeId: query.backendNodeId, depth: 0 },
            context.sessionId,
            signal,
          ),
        );
      } catch (cause: unknown) {
        // A detached node can disappear between snapshot and description.
        // Preserve partial metadata, but propagate transport/cancellation errors.
        if (!(cause instanceof CdpCommandRejection)) throw cause;
        if (cause.code === -32_601) descriptionUnavailable = true;
        else if (cause.code !== -32_000) throw cause;
        return undefined;
      }
    });
    try {
      // Promise.all preserves snapshot order even when CDP replies out of order.
      step = capture.next(await Promise.all(pending));
    } catch (cause: unknown) {
      // Stop and settle this bounded batch before the session can be detached.
      pendingController.abort();
      await Promise.allSettled(pending);
      throw cause;
    }
  }
  if (step.value.unresolvedSvgNodes > 0)
    state.limitations.push(
      `SVG identity was unavailable for ${String(step.value.unresolvedSvgNodes)} snapshotted XLink candidate nodes; their URL destinations remain unknown.`,
    );
  return step.value;
};

const normalizedInspection = (
  state: CaptureState,
  captured: CapturedSections,
): WebPageInspection => ({
  browser: state.context.discovery.version,
  target: normalizedTarget(
    state.context.target,
    captured.attachedUrl,
    state.allowedOrigins,
  ),
  capture_window: {
    started_at: state.startedAt,
    ended_at: new Date().toISOString(),
    observation_ms: state.context.input.observation_ms,
  },
  completeness: state.events.completeness.snapshot(),
  frames: [...captured.frames],
  dom: {
    total_nodes: captured.dom.total,
    node_value_length_unit: captured.dom.nodeValueLengthUnit,
    nodes: [...captured.dom.nodes],
  },
  accessibility: {
    total_nodes: captured.accessibility.total,
    text_capture: captured.accessibility.textCapture,
    nodes: [...captured.accessibility.nodes],
  },
  scripts: captured.scripts,
  resources: [...captured.resources],
  network: {
    requests: [...state.events.network.values()],
    websocket_connections: [...state.events.webSocketConnectionsById.values()],
    coverage_started_at: state.events.coverageStartedAt("Network"),
    prior_activity_available: false,
  },
  console: {
    events: [...state.events.console],
    coverage_started_at: state.events.coverageStartedAt("Runtime"),
    prior_activity_available: false,
  },
  workers: [...captured.workers],
  metadata: {
    responses: [...state.events.responseMetadata],
    dom_urls: [...captured.dom.urls],
    agent_hints: deduplicatedAgentHints([
      ...state.events.agentHints,
      ...captured.dom.agentHints,
    ]),
    excluded_dom_urls: captured.dom.excludedUrls,
    headers_allowlisted: true,
  },
  storage: captured.storage,
  limitations: state.limitations,
});

const enableObservationDomains = async (state: CaptureState): Promise<void> => {
  const { connection, sessionId, signal } = state.context;
  await connection.send("Runtime.enable", {}, sessionId, signal);
  state.events.markDomainEnabled("Runtime");
  await connection.send("Debugger.enable", {}, sessionId, signal);
  await connection.send("Network.enable", {}, sessionId, signal);
  state.events.markDomainEnabled("Network");
};

const accessibilityForFrames = async (
  state: CaptureState,
  frames: readonly { readonly frame_id: string }[],
): Promise<ReturnType<typeof captureAccessibility>> => {
  const { context, limitations, events } = state;
  const results: unknown[] = [];
  let unavailable = false;
  for (const frame of frames) {
    const result = await optionalCdpCommand(
      context,
      "Accessibility.getFullAXTree",
      { frameId: frame.frame_id },
      limitations,
    );
    if (result === undefined) unavailable = true;
    else results.push(result);
  }
  if (unavailable) events.completeness.unavailable("accessibility");
  const capture = captureAccessibility(results, {
    includeText: context.input.include_accessibility_text,
    ...(results.length === 0 && unavailable ? { unavailable: true } : {}),
    completeness: events.completeness,
  });
  if (!context.input.include_accessibility_text)
    events.completeness.exclude(
      "accessibility",
      "not_approved",
      capture.textCapture.excluded_fields,
    );
  if (capture.hasUnobservedChildren)
    events.completeness.truncate("accessibility");
  return capture;
};

const publicResource = ({ rawUrl: _rawUrl, ...resource }: CapturedResource) =>
  resource;

const deduplicatedAgentHints = (
  hints: WebPageInspection["metadata"]["agent_hints"],
): WebPageInspection["metadata"]["agent_hints"] => {
  const seen = new Set<string>();
  return hints.filter((hint) => {
    const key = `${hint.mechanism}\0${hint.declaration}\0${hint.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizedTarget = (
  target: CdpEndpointTarget,
  currentUrl: string,
  allowedOrigins: ReadonlySet<string>,
): WebPageInspection["target"] => {
  const url = allowedSanitizedUrl(currentUrl, allowedOrigins);
  return {
    target_id: target.id,
    type: target.type,
    title: target.title,
    url: url?.url ?? "[unsupported-url]",
    origin: url?.origin ?? "",
    attached: target.attached,
  };
};

const report = async (
  progress: ProgressReporter | undefined,
  completed: number,
  message: string,
): Promise<void> =>
  await progress?.report({
    phase: "browser_observation",
    completed,
    total: 3,
    message,
    ...(completed === 3 ? { terminal: true } : {}),
  });
