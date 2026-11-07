import {
  readCdpResponseReceived,
  scopeCdpResponse,
  readCdpLoadingFinished,
  type CdpRequestWillBeSentFacts,
} from "./CdpNetworkEventFacts.js";
import {
  readCdpExecutionContextCreated,
  readCdpExecutionContextDestroyed,
  readCdpScriptParsed,
  selectCdpScriptFrame,
} from "./CdpScriptContextFacts.js";
import {
  selectCdpFrameIdentity,
  cdpFrameEventFacts,
} from "./CdpFrameIdentity.js";
import type { WebPageInspection } from "../domain/browserObservationSchemas.js";
import { sanitizeBrowserUrl } from "../domain/browserObservation.js";
import {
  inferJsonShape,
  type JsonShapeCapacityFailure,
} from "../domain/jsonShape.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import { err, ok, type Result } from "../domain/result.js";
import { paddedBase64ByteLength } from "../domain/paddedBase64.js";
import { WEB_RUNTIME_LIMITS } from "../domain/webRuntime.js";
import { safeResponseMetadata } from "./CdpSafeMetadata.js";
import {
  allowedSanitizedUrl,
  isHttpUrl,
  numberValue,
  admitRecords,
  recordValue,
  cdpStringValue,
  type UnknownRecord,
} from "./CdpCaptureValues.js";
import {
  requestBodyShape,
  releaseBodyShapes,
  updateResponseBodyShape,
} from "./CdpCaptureEventBodyShapes.js";
import {
  consolePrimitive,
  cdpSourceCoordinates,
  exclusionReasonForUrl,
  initiatorLocation,
  isJsonMediaType,
  topCallFrame,
} from "./CdpCaptureEventHelpers.js";
import type { CdpCaptureEventsState } from "./CdpCaptureEventState.js";
import {
  CDP_CAPTURE_SCRIPT_METADATA_LIMITS,
  type CapturedScript,
  type NetworkState,
} from "./CdpCaptureEventTypes.js";

export const handleExecutionContextCreated = (
  state: CdpCaptureEventsState,
  params: UnknownRecord,
): void => {
  const facts = readCdpExecutionContextCreated(params);
  if (facts.contextKey === null) return;
  // Every reuse replaces future authority, including missing or malformed claims.
  state.executionContextFrames.set(facts.contextKey, facts.frameClaim);
};

export const handleExecutionContextDestroyed = (
  state: CdpCaptureEventsState,
  params: UnknownRecord,
): void => {
  const key = readCdpExecutionContextDestroyed(params).contextKey;
  if (key !== null) state.executionContextFrames.delete(key);
};

export const handleScriptParsed = (
  state: CdpCaptureEventsState,
  params: UnknownRecord,
): void => {
  const facts = readCdpScriptParsed(params);
  const scriptId = facts.scriptId;
  const rawUrl = facts.url ?? "";
  const sanitized = allowedSanitizedUrl(rawUrl, state.allowedOrigins);
  if (scriptId === undefined || scriptId === "") {
    state.completeness.exclude("scripts", "invalid_protocol_value");
    return;
  }
  const replacedBytes = state.scriptMetadataBytesById.get(scriptId) ?? 0;
  state.scriptMetadataBudgetOmissionsById.delete(scriptId);
  if (replacedBytes > 0) {
    state.scripts.delete(scriptId);
    state.scriptMetadataBytesById.delete(scriptId);
    state.retainedScriptMetadataBytes -= replacedBytes;
  }
  if (sanitized === undefined) {
    state.completeness.exclude("scripts", exclusionReasonForUrl(rawUrl));
    return;
  }
  const executionContext = facts.contextKey;
  const attribution = selectCdpScriptFrame(
    facts.frameClaim,
    executionContext === null
      ? undefined
      : state.executionContextFrames.get(executionContext),
  );
  if (attribution.invalid || attribution.conflicting)
    state.completeness.exclude("scripts", "invalid_protocol_value");
  const baseScript = {
    scriptId,
    rawUrl,
    url: sanitized.url,
    origin: sanitized.origin,
    ...facts.metadata,
    executionContextKey: executionContext,
    frameId: attribution.frameId,
  };
  const baseBytes = scriptMetadataStringBytes(baseScript);
  const sourceMapDeclared =
    typeof facts.sourceMapUrl === "string" && facts.sourceMapUrl.length > 0;
  if (
    state.scripts.size >= CDP_CAPTURE_SCRIPT_METADATA_LIMITS.scripts ||
    baseBytes >
      CDP_CAPTURE_SCRIPT_METADATA_LIMITS.retainedBytes -
        state.retainedScriptMetadataBytes
  ) {
    state.rejectedScriptMetadataBudgetCount += 1;
    if (sourceMapDeclared) state.rejectedSourceMapMetadataBudgetCount += 1;
    return;
  }
  const sourceMap = sourceMapForScript(
    facts.sourceMapUrl,
    rawUrl,
    state,
    CDP_CAPTURE_SCRIPT_METADATA_LIMITS.retainedBytes -
      state.retainedScriptMetadataBytes -
      baseBytes,
  );
  const { budgetExhausted, ...sourceMapFields } = sourceMap;
  const script: CapturedScript = { ...baseScript, ...sourceMapFields };
  if (budgetExhausted)
    state.scriptMetadataBudgetOmissionsById.set(scriptId, true);
  const retainedBytes =
    baseBytes +
    stringByteLength(sourceMap.sourceMapUrl) +
    stringByteLength(sourceMap.sourceMapRawUrl);
  state.retainedScriptMetadataBytes += retainedBytes;
  state.scriptMetadataBytesById.set(scriptId, retainedBytes);
  state.scripts.set(scriptId, script);
};

const scriptMetadataStringBytes = (script: {
  readonly scriptId: string;
  readonly rawUrl: string;
  readonly url: string;
  readonly origin: string | null;
  readonly hash: string | null;
  readonly language: string | null;
  readonly executionContextKey: string | null;
  readonly frameId: string | null;
}): number =>
  stringByteLength(script.scriptId) +
  stringByteLength(script.rawUrl) +
  stringByteLength(script.url) +
  stringByteLength(script.origin) +
  stringByteLength(script.hash) +
  stringByteLength(script.language) +
  stringByteLength(script.executionContextKey) +
  stringByteLength(script.frameId);

const stringByteLength = (value: string | null): number =>
  value === null ? 0 : Buffer.byteLength(value, "utf8");

/** Approximate fixed bytes of one retained console entry or frame object, so a
 * stream of minimal entries cannot admit millions of objects into the budget. */
const RETAINED_EVENT_ENTRY_OVERHEAD_BYTES = 64;
/** Approximate fixed bytes of one captured console text value wrapper beyond
 * its retained text. */
const RETAINED_EVENT_TEXT_VALUE_BYTES = 32;

const sourceMapForScript = (
  value: unknown,
  scriptUrl: string,
  state: CdpCaptureEventsState,
  remainingBytes: number,
): {
  readonly sourceMapUrl: string | null;
  readonly sourceMapRawUrl: string | null;
  readonly budgetExhausted: boolean;
} => {
  const declaredUrl = cdpStringValue(value);
  if (value !== undefined && declaredUrl === undefined)
    state.completeness.exclude("source_maps", "invalid_protocol_value");
  if (declaredUrl === undefined || declaredUrl === "")
    return {
      sourceMapUrl: null,
      sourceMapRawUrl: null,
      budgetExhausted: false,
    };
  let rawUrl: string;
  try {
    rawUrl = new URL(declaredUrl, scriptUrl).href;
  } catch (cause: unknown) {
    // Unparseable URLs are recorded as unsupported, not as failures.
    void cause;
    state.completeness.exclude("source_maps", "unsupported_url");
    return {
      sourceMapUrl: null,
      sourceMapRawUrl: null,
      budgetExhausted: false,
    };
  }
  const sanitized = allowedSanitizedUrl(rawUrl, state.allowedOrigins);
  if (sanitized !== undefined) {
    if (
      stringByteLength(rawUrl) + stringByteLength(sanitized.url) >
      remainingBytes
    ) {
      return {
        sourceMapUrl: null,
        sourceMapRawUrl: null,
        budgetExhausted: true,
      };
    }
    return {
      sourceMapUrl: sanitized.url,
      sourceMapRawUrl: rawUrl,
      budgetExhausted: false,
    };
  }
  state.completeness.exclude("source_maps", exclusionReasonForUrl(rawUrl));
  return {
    sourceMapUrl: null,
    sourceMapRawUrl: null,
    budgetExhausted: false,
  };
};

export const handleRequestWillBeSent = (
  state: CdpCaptureEventsState,
  facts: CdpRequestWillBeSentFacts,
): void => {
  const requestId = facts.requestId;
  const request = facts.request;
  if (requestId === null) {
    state.completeness.exclude("network_requests", "invalid_protocol_value");
    return;
  }
  if (state.malformedRedirectRequestIds.has(requestId)) return;
  const previous = state.network.get(requestId);
  if (
    facts.redirect.kind === "missing" &&
    previous !== undefined &&
    preserveMalformedRedirectEvidence(state, requestId, previous)
  )
    return;
  const method = request?.method;
  const initiator = facts.initiator;
  const initiatorType = initiator?.type;
  if (
    request === undefined ||
    method === undefined ||
    method.length === 0 ||
    initiatorType === undefined ||
    initiatorType.length === 0
  ) {
    preserveMalformedRedirectEvidence(state, requestId, previous);
    return;
  }
  const sanitized = allowedSanitizedUrl(request.url, state.allowedOrigins);
  if (sanitized === undefined) {
    state.completeness.exclude(
      "network_requests",
      exclusionReasonForUrl(request.url),
    );
    releaseBodyShapes(state, requestId);
    state.network.delete(requestId);
    state.networkRequestTimestamps.delete(requestId);
    return;
  }
  const redirectResponse =
    facts.redirect.kind === "response" ? facts.redirect.response : undefined;
  if (
    facts.redirect.kind === "malformed" &&
    preserveMalformedRedirectEvidence(state, requestId, previous)
  )
    return;
  const redirects = [...(previous?.redirects ?? [])];
  if (redirectResponse !== undefined) {
    const responseUrl = scopeCdpResponse(
      redirectResponse,
      state.allowedOrigins,
    );
    if (responseUrl.scope === "approved" && !redirectResponse.status.ok)
      state.completeness.exclude("network_requests", "invalid_protocol_value");
    if (previous === undefined) {
      if (responseUrl.scope !== "approved")
        state.completeness.exclude("network_requests", responseUrl.reason);
      else
        // CDP may deliver the continuation after its predecessor was excluded
        // by origin policy or before capture began. Keep the final request but
        // report missing prior coverage without calling it malformed protocol.
        state.completeness.attachLimited("network_requests");
    } else if (responseUrl.scope !== "approved") {
      // redirectResponse belongs to the same request ID and can contain an
      // excluded origin. Drop the entire chain before retaining any details.
      state.completeness.exclude("network_requests", responseUrl.reason);
      releaseBodyShapes(state, requestId);
      state.network.delete(requestId);
      state.networkRequestTimestamps.delete(requestId);
      return;
    } else {
      const encodedDataLength = redirectResponse.encodedDataLength;
      if (encodedDataLength === undefined || encodedDataLength < 0)
        state.completeness.exclude(
          "network_requests",
          "invalid_protocol_value",
        );
      redirects.push({
        url: previous.url,
        response_url: responseUrl.url.url,
        method: previous.method,
        resource_type: previous.resource_type,
        status: redirectResponse.status.ok
          ? redirectResponse.status.value
          : null,
        mime_type: redirectResponse.mimeType ?? null,
        encoded_data_length:
          encodedDataLength === undefined || encodedDataLength < 0
            ? null
            : encodedDataLength,
        request_timestamp:
          state.networkRequestTimestamps.get(requestId) ?? null,
        // CDP reports redirectResponse on the next requestWillBeSent event.
        // This is the event boundary, not a separately observed response time.
        redirect_event_timestamp: facts.timestamp ?? null,
      });
    }
  }
  const location = initiatorLocation(initiator?.source);
  if (!location.ok)
    state.completeness.exclude("network_initiators", "invalid_protocol_value");
  const initiatorFrame = location.ok ? location.value : undefined;
  const coordinates = cdpSourceCoordinates(initiatorFrame);
  if (coordinates.invalid)
    state.completeness.exclude("network_initiators", "invalid_protocol_value");
  const rawInitiatorUrl = cdpStringValue(initiatorFrame?.url);
  const initiatorUrl = allowedSanitizedUrl(
    rawInitiatorUrl,
    state.allowedOrigins,
  );
  if (rawInitiatorUrl !== undefined && initiatorUrl === undefined)
    state.completeness.exclude(
      "network_initiators",
      exclusionReasonForUrl(rawInitiatorUrl),
    );
  state.network.set(requestId, {
    request_id: requestId,
    url: sanitized.url,
    origin: sanitized.origin ?? "",
    method,
    resource_type: facts.resourceType ?? null,
    status: null,
    mime_type: null,
    encoded_data_length: null,
    redirects,
    initiator: {
      type: initiatorType,
      url: initiatorUrl?.url ?? null,
      line: coordinates.line,
      column: coordinates.column,
    },
    body_shapes: requestBodyShape(state, requestId, request.source),
  });
  const timestamp = facts.timestamp;
  if (timestamp === undefined) state.networkRequestTimestamps.delete(requestId);
  else state.networkRequestTimestamps.set(requestId, timestamp);
};

const preserveMalformedRedirectEvidence = (
  state: CdpCaptureEventsState,
  requestId: string,
  previous: NetworkState | undefined,
): boolean => {
  state.completeness.exclude("network_requests", "invalid_protocol_value");
  if (previous === undefined) return false;
  state.malformedRedirectRequestIds.add(requestId);
  if (
    state.input.include_json_body_shapes &&
    isJsonMediaType(previous.mime_type) &&
    previous.body_shapes.response === null
  ) {
    updateResponseBodyShape(state, requestId, null);
    state.completeness.exclude("json_body_shapes", "invalid_protocol_value");
  }
  return true;
};

export const handleResponseReceived = (
  state: CdpCaptureEventsState,
  params: UnknownRecord,
): void => {
  const facts = readCdpResponseReceived(params);
  const requestId = facts.requestId;
  if (requestId === null) {
    state.completeness.exclude("network_requests", "invalid_protocol_value");
    return;
  }
  if (state.malformedRedirectRequestIds.has(requestId)) return;
  const current = state.network.get(requestId);
  if (current === undefined) return;
  const scoped = scopeCdpResponse(
    facts.response,
    state.allowedOrigins,
    "unattributed_origin",
  );
  if (scoped.scope !== "approved") {
    state.completeness.exclude("network_requests", scoped.reason);
    releaseBodyShapes(state, requestId);
    state.network.delete(requestId);
    state.networkRequestTimestamps.delete(requestId);
    return;
  }
  const { url: sanitized, response } = scoped;
  if (!response.status.ok)
    state.completeness.exclude("network_requests", "invalid_protocol_value");
  state.network.set(requestId, {
    ...current,
    status: response.status.ok ? response.status.value : null,
    mime_type: response.mimeType ?? null,
  });
  const metadata = safeResponseMetadata(
    requestId,
    sanitized.url,
    response,
    state.allowedOrigins,
  );
  state.responseMetadata.push(metadata.response);
  state.agentHints.push(...metadata.agentHints);
};

export const handleLoadingFinished = (
  state: CdpCaptureEventsState,
  params: UnknownRecord,
): void => {
  const facts = readCdpLoadingFinished(params);
  const requestId = facts.requestId;
  if (requestId === null) return;
  if (state.malformedRedirectRequestIds.has(requestId)) return;
  const current = state.network.get(requestId);
  if (current === undefined) return;
  const encodedDataLength = facts.encodedDataLength;
  if (encodedDataLength === undefined || encodedDataLength < 0) {
    state.completeness.exclude("network_requests", "invalid_protocol_value");
    return;
  }
  state.network.set(requestId, {
    ...current,
    encoded_data_length: encodedDataLength,
  });
};

export const handleConsoleAPICalled = (
  state: CdpCaptureEventsState,
  params: UnknownRecord,
): void => {
  const topFrame = topCallFrame(params.stackTrace);
  if (!topFrame.ok) {
    state.completeness.exclude("console_events", "invalid_protocol_value");
    return;
  }
  const frame = topFrame.value;
  if (frame === undefined) {
    state.completeness.exclude("console_events", "unattributed_origin");
    return;
  }
  const coordinates = cdpSourceCoordinates(frame);
  if (coordinates.invalid)
    state.completeness.exclude("console_events", "invalid_protocol_value");
  const source = allowedSanitizedUrl(frame.url, state.allowedOrigins);
  if (source === undefined) {
    state.completeness.exclude(
      "console_events",
      exclusionReasonForUrl(cdpStringValue(frame.url)),
    );
    return;
  }
  // Malformed elements keep their position so retained siblings keep their
  // CDP argument indices; a missing inventory is unknown, not empty.
  const arguments_ = admitRecords(params.args)?.map((argument) =>
    recordValue(argument),
  );
  const argumentTypes = arguments_?.map((argument) =>
    cdpStringValue(argument?.type),
  );
  const timestamp = numberValue(params.timestamp);
  if (
    timestamp === undefined ||
    argumentTypes === undefined ||
    argumentTypes.includes(undefined)
  )
    state.completeness.exclude("console_events", "invalid_protocol_value");
  const type = cdpStringValue(params.type) ?? "unknown";
  const textCapture = captureConsoleText(state, arguments_);
  // The shared retained-event budget bounds the whole console inventory, so a
  // page cannot grow the capture without limit; a refused entry stays counted
  // as a dropped event instead of vanishing.
  const entryBytes =
    RETAINED_EVENT_ENTRY_OVERHEAD_BYTES +
    stringByteLength(type) +
    stringByteLength(source.url) +
    (argumentTypes ?? []).reduce(
      (sum, argumentType) => sum + stringByteLength(argumentType ?? "unknown"),
      0,
    ) +
    textCapture.retained_bytes +
    textCapture.values.length * RETAINED_EVENT_TEXT_VALUE_BYTES;
  if (
    entryBytes >
    WEB_RUNTIME_LIMITS.retainedEventBytes - state.retainedEventBytes
  ) {
    state.completeness.drop("console_events");
    return;
  }
  state.retainedEventBytes += entryBytes;
  state.console.push({
    type,
    timestamp: timestamp ?? null,
    argument_types:
      argumentTypes?.map((argumentType) => argumentType ?? "unknown") ?? null,
    url: source.url,
    line: coordinates.line,
    column: coordinates.column,
    text_capture: textCapture,
  });
};

const captureConsoleText = (
  state: CdpCaptureEventsState,
  arguments_: readonly (UnknownRecord | undefined)[] | undefined,
): WebPageInspection["console"]["events"][number]["text_capture"] => {
  if (!state.input.include_console_text)
    return {
      status: "not_approved",
      values: [],
      retained_bytes: 0,
    };
  if (arguments_ === undefined)
    return {
      status: "unavailable",
      values: [],
      retained_bytes: 0,
    };
  const values: WebPageInspection["console"]["events"][number]["text_capture"]["values"] =
    [];
  let retainedBytes = 0;
  for (const [argumentIndex, argument] of arguments_.entries()) {
    if (argument === undefined) continue;
    const primitive = consolePrimitive(argument);
    if (primitive === undefined) continue;
    const text = primitive.text;
    values.push({
      argument_index: argumentIndex,
      type: primitive.type,
      text,
    });
    retainedBytes += Buffer.byteLength(text);
  }
  return {
    status: "included",
    values,
    retained_bytes: retainedBytes,
  };
};

export const handleWebSocketFrame = (
  state: CdpCaptureEventsState,
  params: UnknownRecord,
  direction: "sent" | "received",
): void => {
  const requestId = cdpStringValue(params.requestId);
  if (requestId === undefined) return;
  const connection = state.webSocketConnectionsById.get(requestId);
  if (connection === undefined) return;
  const response = recordValue(params.response);
  const opcodeValue = numberValue(response?.opcode);
  // RFC 6455 encodes opcodes in four bits; keep reserved values as observed data.
  const opcode =
    opcodeValue !== undefined &&
    Number.isInteger(opcodeValue) &&
    opcodeValue >= 0 &&
    opcodeValue <= 15
      ? opcodeValue
      : null;
  const payload = cdpStringValue(response?.payloadData);
  const payloadBytes =
    opcode === null || payload === undefined
      ? null
      : opcode === 1
        ? Buffer.byteLength(payload)
        : (paddedBase64ByteLength(payload) ?? null);
  if (opcode === null || payloadBytes === null)
    state.completeness.exclude("websocket_frames", "invalid_protocol_value");
  const availableBytes =
    WEB_RUNTIME_LIMITS.retainedEventBytes - state.retainedEventBytes;
  const baseBytes =
    RETAINED_EVENT_ENTRY_OVERHEAD_BYTES + stringByteLength(direction);
  if (baseBytes > availableBytes) {
    state.completeness.drop("websocket_frames");
    return;
  }
  const captured = captureWebSocketShape(
    state,
    payload,
    opcode,
    availableBytes - baseBytes,
  );
  if (!captured.ok) {
    state.completeness.drop("websocket_frames");
    state.completeness.exclude("websocket_shapes", "resource_budget_exhausted");
    return;
  }
  const entryBytes = baseBytes + captured.value.serializedBytes;
  if (entryBytes > availableBytes) {
    state.completeness.drop("websocket_frames");
    return;
  }
  state.retainedEventBytes += entryBytes;
  connection.events.push({
    direction,
    opcode,
    payload_bytes: payloadBytes,
    payload_shape: captured.value.payloadShape,
  });
};

type WebSocketShape =
  WebPageInspection["network"]["websocket_connections"][number]["events"][number]["payload_shape"];
const jsonShapeEnvelopeBytes =
  jsonValueByteLength({ format: "json", json_shape: null }) -
  jsonValueByteLength(null);

const captureWebSocketShape = (
  state: CdpCaptureEventsState,
  payload: string | undefined,
  opcode: number | null,
  maximumBytes: number,
): Result<
  { readonly payloadShape: WebSocketShape; readonly serializedBytes: number },
  JsonShapeCapacityFailure
> => {
  if (!state.input.include_websocket_shapes || opcode === null)
    return ok({ payloadShape: null, serializedBytes: 0 });
  if (opcode !== 1) {
    const payloadShape: WebSocketShape = { format: "binary", json_shape: null };
    return ok({
      payloadShape,
      serializedBytes: jsonValueByteLength(payloadShape),
    });
  }
  if (payload === undefined)
    return ok({ payloadShape: null, serializedBytes: 0 });
  const parsed = inferJsonShape(
    payload,
    Math.max(0, maximumBytes - jsonShapeEnvelopeBytes),
  );
  if (!parsed.ok) {
    if (parsed.error.kind === "capacity") return err(parsed.error);
    const payloadShape: WebSocketShape = { format: "text", json_shape: null };
    return ok({
      payloadShape,
      serializedBytes: jsonValueByteLength(payloadShape),
    });
  }
  const payloadShape: WebSocketShape = {
    format: "json",
    json_shape: parsed.value.shape,
  };
  return ok({
    payloadShape,
    serializedBytes: jsonShapeEnvelopeBytes + parsed.value.serializedBytes,
  });
};

export const handleWebSocketCreated = (
  state: CdpCaptureEventsState,
  params: UnknownRecord,
): void => {
  const requestId = cdpStringValue(params.requestId);
  const rawUrl = cdpStringValue(params.url);
  if (requestId === undefined) {
    state.completeness.exclude(
      "websocket_connections",
      "invalid_protocol_value",
    );
    return;
  }
  if (rawUrl === undefined) {
    state.completeness.exclude(
      "websocket_connections",
      "invalid_protocol_value",
    );
    return;
  }
  const sourceUrl = sanitizeBrowserUrl(rawUrl).url;
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch (cause: unknown) {
    // Unparseable URLs are recorded as unsupported, not as failures.
    void cause;
    state.completeness.exclude("websocket_connections", "unsupported_url");
    return;
  }
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  else if (parsed.protocol === "wss:") parsed.protocol = "https:";
  else {
    state.completeness.exclude("websocket_connections", "unsupported_url");
    return;
  }
  if (!state.allowedOrigins.has(parsed.origin)) {
    state.completeness.exclude("websocket_connections", "disallowed_origin");
    return;
  }
  if (state.webSocketConnectionsById.has(requestId)) {
    state.completeness.exclude(
      "websocket_connections",
      "invalid_protocol_value",
    );
    return;
  }
  state.webSocketConnectionsById.set(requestId, {
    request_id: requestId,
    url: sourceUrl,
    events: [],
  });
};

export const handleFrameNavigated = (
  state: CdpCaptureEventsState,
  params: unknown,
): void => {
  if (state.mainFrameId === undefined) return;
  const frameFacts = cdpFrameEventFacts({
    method: "Page.frameNavigated",
    params,
  });
  const identity = selectCdpFrameIdentity(frameFacts, state.mainFrameId);
  if (identity.identityIssue !== null || identity.parentIssue !== null) {
    state.completeness.exclude("frames", "invalid_protocol_value");
    if (
      identity.selection === "unknown" &&
      identity.parentRelation === "child" &&
      identity.identityIssue !== null
    )
      return;
    state.unknownRootIdentity = true;
    return;
  }
  if (identity.selection === "other" && identity.parentRelation === "child")
    return;
  if (identity.selection === "unknown") {
    state.completeness.exclude("frames", "invalid_protocol_value");
    state.unknownRootIdentity = true;
    return;
  }
  if (identity.selection === "other" && !identity.isRootReplacement) {
    state.completeness.exclude("frames", "invalid_protocol_value");
    state.unknownRootIdentity = true;
    return;
  }
  const rawUrl = cdpStringValue(frameFacts.source?.url);
  const loaderId = frameFacts.loaderId;
  // `frameNavigated` re-fires for a document already reported (same URL and
  // loader). Treating that as a navigation aborted a valid capture with
  // `target_changed`, which is a false claim that the target moved.
  const document = `${String(identity.frameId ?? "")}\0${String(loaderId ?? "")}\0${String(rawUrl ?? "")}`;
  if (state.committedDocument === document) return;
  state.committedDocument = document;
  if (identity.isRootReplacement)
    state.mainFrameId = identity.frameId ?? undefined;
  state.navigationDuringCapture = true;
  if (
    isHttpUrl(rawUrl) &&
    allowedSanitizedUrl(rawUrl, state.allowedOrigins) === undefined
  )
    state.originViolation = true;
};
