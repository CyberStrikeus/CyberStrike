import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import type { JsonValue } from "../../domain/jsonValue.js";
import {
  WEB_NETWORK_CAPTURE_LIMITS,
  type WebNetworkCaptureRecord,
} from "../../domain/webNetworkCapture.js";
import { CaptureRedaction, capturePointer } from "./CaptureRedaction.js";
import { CaptureFormatError } from "./CaptureFormatError.js";

export type SazValue =
  | JsonValue
  | Buffer
  | { readonly [key: string]: SazValue }
  | readonly SazValue[];

/** Project native byte fields with the same credential and explicit-literal exclusions as HAR. */
export const projectSazRecord = (
  source: SazValue,
  sensitiveValues: readonly string[],
) => {
  const redactor = new CaptureRedaction(sensitiveValues, source);
  const binary_fields: WebNetworkCaptureRecord["binary_fields"] = [];
  const visit = (
    value: SazValue,
    pointer: string,
    depth: number,
    parent?: Readonly<Record<string, SazValue>>,
  ): JsonValue => {
    if (depth > WEB_NETWORK_CAPTURE_LIMITS.depth)
      throw new CaptureFormatError(
        "input-limit",
        "SAZ projection exceeds the complete-evidence nesting budget. This release has no runtime override.",
        pointer,
      );
    if (parent !== undefined && redactor.harCredential(pointer, parent))
      return redactor.credential(pointer);
    if (Buffer.isBuffer(value)) {
      const base64 = value.toString("base64");
      const sha256 = createHash("sha256").update(value).digest("hex");
      const hidden =
        redactor.sensitiveBytes(value) ||
        sensitiveValues.some(
          (literal) =>
            base64.includes(literal) ||
            sha256.includes(literal) ||
            String(value.length).includes(literal),
        );
      if (hidden) {
        binary_fields.push({
          pointer,
          representation: "producer-bytes",
          state: "redacted",
          content_base64: null,
          bytes: null,
          sha256: null,
        });
        redactor.redactions.push({
          pointer,
          reason: "explicit-sensitive-value",
        });
        return null;
      }
      binary_fields.push({
        pointer,
        representation: "producer-bytes",
        state: "retained",
        content_base64: base64,
        bytes: value.length,
        sha256,
      });
      return isUtf8(value) ? value.toString("utf8") : null;
    }
    if (typeof value === "string") {
      // HTTP fields are Latin-1 views of bytes. A UTF-8 declaration must also
      // exclude its byte spelling, even when its display is mojibake.
      if (
        /^\/(request|response)\//.test(pointer) &&
        !pointer.endsWith("/member") &&
        redactor.sensitiveBytes(Buffer.from(value, "latin1"))
      ) {
        redactor.redactions.push({
          pointer,
          reason: "explicit-sensitive-value",
        });
        return null;
      }
      return redactor.text(
        value,
        pointer,
        redactor.harTransportUrl(pointer, parent),
      );
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number")
      return redactor.text(String(value), pointer) === null ? null : value;
    if (Array.isArray(value))
      return value.map((child: SazValue, i: number) =>
        visit(child, capturePointer(pointer, String(i)), depth + 1),
      );
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) => {
        if (sensitiveValues.some((literal) => key.includes(literal))) {
          redactor.redactions.push({
            pointer,
            reason: "explicit-sensitive-value",
            scope: "property-name",
          });
          return [];
        }
        return [
          [
            key,
            visit(
              child,
              capturePointer(pointer, key),
              depth + 1,
              value as Readonly<Record<string, SazValue>>,
            ),
          ],
        ];
      }),
    );
  };
  return {
    reported: visit(source, "", 0),
    binary_fields,
    numeric_literals: [],
    redactions: redactor.redactions,
  };
};
