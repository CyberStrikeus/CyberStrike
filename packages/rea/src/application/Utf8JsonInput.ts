import { constants } from "node:buffer";

import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { safeParseJson, type SafeJsonParseResult } from "../domain/safeJson.js";

/** Recovery that preserves complete, authenticated Evidence workflow inputs. */
export const JSON_INPUT_RESOURCE_REMEDIATION =
  "Provide a smaller valid JSON value. For Evidence workflows, re-analyze a smaller selection of the original target and use its complete Evidence; splitting JSON text or trimming Evidence fields does not produce valid workflow input.";

/**
 * Strict JSON input keeps rejecting a leading byte-order mark, but names it:
 * the parser's own message quotes the invisible U+FEFF as the bad token.
 */
export const JSON_BYTE_ORDER_MARK_MESSAGE =
  "JSON input begins with a UTF-8 byte-order mark (EF BB BF), which strict JSON input does not accept. Save the file as UTF-8 without a byte-order mark.";

/** Decode JSON bytes without confusing a runtime string limit with malformed input. */
export const parseUtf8Json = (
  bytes: Uint8Array,
  operation: string,
  path: string,
  boundary = "json-input",
): SafeJsonParseResult & { readonly userMessage?: string } => {
  const stringLimitFailure = (
    cause?: unknown,
    decodedUnits?: number,
  ): AnalysisResourceConstraintError =>
    new AnalysisResourceConstraintError(
      operation,
      "memory",
      "JSON input exceeds the runtime's maximum decoded string length",
      {
        boundary,
        input_path: path,
        input_bytes: bytes.byteLength,
        max_string_code_units: constants.MAX_STRING_LENGTH,
        ...(decodedUnits === undefined
          ? {}
          : { decoded_string_code_units_at_least: decodedUnits }),
      },
      {
        ...(cause === undefined ? {} : { cause }),
        remediationAction: JSON_INPUT_RESOURCE_REMEDIATION,
      },
    );
  let text: string;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    if (bytes.byteLength <= constants.MAX_STRING_LENGTH) {
      text = decoder.decode(bytes);
    } else {
      // Node 22's UTF-8 fast path bounds encoded bytes before decoding. Decode
      // large inputs in chunks so valid multibyte text is bounded by its actual
      // UTF-16 length. Streaming also preserves characters spanning chunks.
      const parts: string[] = [];
      let decodedUnits = 0;
      const append = (part: string): void => {
        decodedUnits += part.length;
        if (decodedUnits > constants.MAX_STRING_LENGTH)
          throw stringLimitFailure(undefined, decodedUnits);
        parts.push(part);
      };
      const chunkBytes = 1024 * 1024;
      for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes)
        append(
          decoder.decode(bytes.subarray(offset, offset + chunkBytes), {
            stream: true,
          }),
        );
      append(decoder.decode());
      text = parts.join("");
    }
  } catch (cause: unknown) {
    if (cause instanceof AnalysisResourceConstraintError) throw cause;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? cause.code
        : undefined;
    if (code === "ERR_STRING_TOO_LONG") throw stringLimitFailure(cause);
    if (code !== "ERR_ENCODING_INVALID_ENCODED_DATA") throw cause;
    return {
      ok: false,
      error: "JSON input is not valid UTF-8",
      userMessage: "JSON input is not valid UTF-8",
      cause,
    };
  }
  if (text.startsWith("\uFEFF"))
    return {
      ok: false,
      error: JSON_BYTE_ORDER_MARK_MESSAGE,
      cause: undefined,
      userMessage: JSON_BYTE_ORDER_MARK_MESSAGE,
    };
  return safeParseJson(text);
};
