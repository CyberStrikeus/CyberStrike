import { err, ok, type Result } from "../domain/result.js";
import { mediaTypeEssence } from "../domain/analysisView/recordedMediaType.js";
import {
  admitRecords,
  isHttpUrl,
  recordValue,
  cdpStringValue,
  type UnknownRecord,
} from "./CdpCaptureValues.js";

export interface MalformedCdpCallFrame {
  readonly _tag: "MalformedCdpCallFrame";
}

const malformedCallFrame: MalformedCdpCallFrame = {
  _tag: "MalformedCdpCallFrame",
};

/**
 * The call site is the frame at position zero. An omitted stack has no call
 * site; a malformed stack or top frame stays unknown rather than promoting a
 * caller to the call site.
 */
export const topCallFrame = (
  value: unknown,
): Result<UnknownRecord | undefined, MalformedCdpCallFrame> => {
  if (value === undefined) return ok(undefined);
  const stack = recordValue(value);
  if (stack === undefined) return err(malformedCallFrame);
  const frames = admitRecords(stack.callFrames);
  if (frames === undefined) return err(malformedCallFrame);
  if (frames.length === 0) return ok(undefined);
  const frame = recordValue(frames[0]);
  return frame === undefined ? err(malformedCallFrame) : ok(frame);
};

export const initiatorLocation = (
  initiator: UnknownRecord | undefined,
): Result<UnknownRecord | undefined, MalformedCdpCallFrame> => {
  let stack = initiator?.stack;
  for (let depth = 0; depth < 32 && stack !== undefined; depth += 1) {
    const frame = topCallFrame(stack);
    if (!frame.ok || frame.value !== undefined) return frame;
    stack = recordValue(stack)?.parent;
  }
  return ok(
    cdpStringValue(initiator?.url) === undefined ? undefined : initiator,
  );
};

export const exclusionReasonForUrl = (
  value: string | undefined,
): "disallowed_origin" | "unsupported_url" | "unattributed_origin" =>
  value === undefined || value === ""
    ? "unattributed_origin"
    : isHttpUrl(value)
      ? "disallowed_origin"
      : "unsupported_url";

/** Preserve omitted and invalid protocol offsets as unknown, never invented coordinates. */
export const cdpSourceCoordinates = (frame: UnknownRecord | undefined) => {
  const valid = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const line = frame?.lineNumber;
  const column = frame?.columnNumber;
  return {
    line: valid(line) ? line : null,
    column: valid(column) ? column : null,
    invalid:
      (line !== undefined && !valid(line)) ||
      (column !== undefined && !valid(column)),
  };
};

export const isJsonContentType = (
  headers: UnknownRecord | undefined,
): boolean => {
  if (headers === undefined) return false;
  for (const [name, value] of Object.entries(headers))
    if (
      name.toLowerCase() === "content-type" &&
      isJsonMediaType(cdpStringValue(value))
    )
      return true;
  return false;
};

export const isJsonMediaType = (value: string | null | undefined): boolean => {
  const mediaType =
    value === null || value === undefined ? null : mediaTypeEssence(value);
  // CDP shape collection accepts structured JSON suffixes on any media type;
  // replay's application-only JSON policy is a separate consumer decision.
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
};

export const consolePrimitive = (
  value: UnknownRecord,
): { readonly type: string; readonly text: string } | undefined => {
  const type = cdpStringValue(value.type);
  switch (type) {
    case "string":
      return typeof value.value === "string"
        ? { type, text: value.value }
        : undefined;
    case "boolean":
      return typeof value.value === "boolean"
        ? { type, text: String(value.value) }
        : undefined;
    case "number":
      return typeof value.value === "number"
        ? { type, text: String(value.value) }
        : typeof value.unserializableValue === "string"
          ? { type, text: value.unserializableValue }
          : undefined;
    case "bigint":
      return typeof value.unserializableValue === "string"
        ? { type, text: value.unserializableValue }
        : undefined;
    case "undefined":
      return { type, text: "undefined" };
    case "object":
      // The protocol delivers `null` as an object with a `null` subtype. Its
      // sentinel is already in the event, unlike an unexpanded remote object.
      return cdpStringValue(value.subtype) === "null"
        ? { type, text: "null" }
        : undefined;
    default:
      return undefined;
  }
};
