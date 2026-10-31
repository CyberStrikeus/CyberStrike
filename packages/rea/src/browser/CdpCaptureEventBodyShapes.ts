import { inferJsonShape, type AdmittedJsonShape } from "../domain/jsonShape.js";
import { WEB_RUNTIME_LIMITS } from "../domain/webRuntime.js";
import { decodePaddedBase64 } from "../domain/paddedBase64.js";
import {
  recordValue,
  cdpStringValue,
  type UnknownRecord,
} from "./CdpCaptureValues.js";
import { isJsonContentType } from "./CdpCaptureEventHelpers.js";
import type { CdpCaptureEventsState } from "./CdpCaptureEventState.js";
import type { NetworkState } from "./CdpCaptureEventTypes.js";

export const ingestResponseBodyShape = (
  state: CdpCaptureEventsState,
  requestId: string,
  value: unknown,
): void => {
  if (!state.network.has(requestId)) return;
  const result = recordValue(value);
  const body = cdpStringValue(result?.body);
  const base64Encoded = result?.base64Encoded;
  if (body === undefined || typeof base64Encoded !== "boolean") {
    invalidResponseBodyShape(state, requestId);
    return;
  }
  const decoded = base64Encoded ? decodePaddedBase64(body) : body;
  if (decoded === undefined) {
    invalidResponseBodyShape(state, requestId);
    return;
  }
  const previousBytes =
    state.bodyShapeBytesByRequestId.get(requestId)?.response ?? 0;
  const parsed = inferJsonShape(
    decoded,
    WEB_RUNTIME_LIMITS.retainedEventBytes -
      state.retainedEventBytes +
      previousBytes,
  );
  if (!parsed.ok) {
    if (parsed.error.kind === "capacity")
      state.completeness.exclude(
        "json_body_shapes",
        "resource_budget_exhausted",
      );
    else state.completeness.unavailable("json_body_shapes");
  }
  updateResponseBodyShape(state, requestId, parsed.ok ? parsed.value : null);
};

export const requestBodyShape = (
  state: CdpCaptureEventsState,
  requestId: string,
  request: UnknownRecord,
): NetworkState["body_shapes"] => {
  releaseBodyShapes(state, requestId);
  if (!state.input.include_json_body_shapes)
    return { status: "not_approved", request: null, response: null };
  const headers = recordValue(request.headers);
  const json = isJsonContentType(headers);
  const body = cdpStringValue(request.postData);
  // CDP may omit a long body from postData while reporting hasPostData.
  const parsed =
    json && body !== undefined
      ? inferJsonShape(
          body,
          WEB_RUNTIME_LIMITS.retainedEventBytes - state.retainedEventBytes,
        )
      : undefined;
  const shape = parsed?.ok ? parsed.value.shape : null;
  const expected = json && (body !== undefined || request.hasPostData === true);
  if (expected && shape === null) {
    state.missingRequestBodyShapeIds.add(requestId);
    if (parsed !== undefined && !parsed.ok && parsed.error.kind === "capacity")
      state.completeness.exclude(
        "json_body_shapes",
        "resource_budget_exhausted",
      );
    else state.completeness.unavailable("json_body_shapes");
  }
  if (parsed?.ok) {
    state.bodyShapeBytesByRequestId.set(requestId, {
      request: parsed.value.serializedBytes,
      response: 0,
    });
    state.retainedEventBytes += parsed.value.serializedBytes;
  }
  return {
    status: shape === null ? "unavailable" : "included",
    request: shape,
    response: null,
  };
};

export const updateResponseBodyShape = (
  state: CdpCaptureEventsState,
  requestId: string,
  response: AdmittedJsonShape | null,
): void => {
  const current = state.network.get(requestId);
  if (current === undefined) return;
  const previous = state.bodyShapeBytesByRequestId.get(requestId);
  const responseBytes = response?.serializedBytes ?? 0;
  const requestBytes = previous?.request ?? 0;
  state.retainedEventBytes += responseBytes - (previous?.response ?? 0);
  if (requestBytes + responseBytes === 0)
    state.bodyShapeBytesByRequestId.delete(requestId);
  else
    state.bodyShapeBytesByRequestId.set(requestId, {
      request: requestBytes,
      response: responseBytes,
    });
  const request = current.body_shapes.request;
  const status =
    response !== null
      ? state.missingRequestBodyShapeIds.has(requestId)
        ? "partial"
        : "included"
      : request !== null
        ? "partial"
        : "unavailable";
  state.network.set(requestId, {
    ...current,
    body_shapes: { status, request, response: response?.shape ?? null },
  });
};

/** Replacing or excluding a network record retires exactly the shapes it retained. */
export const releaseBodyShapes = (
  state: CdpCaptureEventsState,
  requestId: string,
): void => {
  state.missingRequestBodyShapeIds.delete(requestId);
  const previous = state.bodyShapeBytesByRequestId.get(requestId);
  if (previous === undefined) return;
  state.retainedEventBytes -= previous.request + previous.response;
  state.bodyShapeBytesByRequestId.delete(requestId);
};

const invalidResponseBodyShape = (
  state: CdpCaptureEventsState,
  requestId: string,
): void => {
  updateResponseBodyShape(state, requestId, null);
  state.completeness.exclude("json_body_shapes", "invalid_protocol_value");
};
