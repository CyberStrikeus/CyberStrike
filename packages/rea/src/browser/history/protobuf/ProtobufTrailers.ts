import { err, ok, type Result } from "../../../domain/result.js";
import type { ProtobufBudget } from "./ProtobufWire.js";

interface TrailerFacts {
  readonly trailers: { name: string; value: string }[];
  readonly examined_bytes: number;
}

type TrailerFailure = TrailerFacts & {
  readonly kind: "invalid-utf8-value" | "invalid-name" | "invalid-value";
  readonly reason: string;
};

/** Parse the gRPC-Web HTTP/1 field block without discarding its valid prefix. */
export const parseGrpcWebTrailers = (
  bytes: Uint8Array,
  budget: ProtobufBudget,
): Result<TrailerFacts, TrailerFailure> => {
  let decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const trailers: TrailerFacts["trailers"] = [];
  let examinedBytes = 0;
  const facts = (): TrailerFacts => ({
    trailers,
    examined_bytes: examinedBytes,
  });
  let opaqueValueFailure: TrailerFailure | undefined;
  for (let start = 0; start <= bytes.length;) {
    let end = start;
    while (
      end + 1 < bytes.length &&
      !(bytes[end] === 13 && bytes[end + 1] === 10)
    )
      end += 1;
    const hasSeparator = end + 1 < bytes.length;
    const lineEnd = hasSeparator ? end : bytes.length;
    const lineExaminedBytes = hasSeparator ? end + 2 : lineEnd;
    if (lineEnd === start) {
      if (!hasSeparator) break;
      examinedBytes = lineExaminedBytes;
      start = end + 2;
      continue;
    }
    let colon = start;
    while (colon < lineEnd && bytes[colon] !== 58) colon += 1;
    if (colon === start || colon === lineEnd)
      return err({
        ...facts(),
        examined_bytes: lineExaminedBytes,
        kind: "invalid-name",
        reason:
          "gRPC-web trailer header names must be lower-case HTTP field names",
      });
    let name = "";
    let validName = true;
    for (let index = start; index < colon; index += 1) {
      const byte = bytes[index]!;
      if (!isTrailerNameByte(byte)) {
        validName = false;
        break;
      }
      name += String.fromCharCode(byte);
    }
    // Unlike ordinary HTTP/1 headers, in-body gRPC-Web names must be lower-case.
    if (!validName)
      return err({
        ...facts(),
        examined_bytes: lineExaminedBytes,
        kind: "invalid-name",
        reason:
          "gRPC-web trailer header names must be lower-case HTTP field names",
      });
    let valueStart = colon + 1;
    while (valueStart < lineEnd && [9, 32].includes(bytes[valueStart]!))
      valueStart += 1;
    // RFC 9110 permits HTAB but excludes other C0 controls and DEL.
    for (let index = valueStart; index < lineEnd; index += 1) {
      const byte = bytes[index]!;
      if (byte <= 8 || (byte >= 10 && byte <= 31) || byte === 127)
        return err({
          ...facts(),
          examined_bytes: lineExaminedBytes,
          kind: "invalid-value",
          reason:
            "gRPC-web trailer field value contains a forbidden control character",
        });
    }
    // RFC 9110 section 5.5: a field value excludes surrounding whitespace.
    let valueEnd = lineEnd;
    while (valueEnd > valueStart && [9, 32].includes(bytes[valueEnd - 1]!))
      valueEnd -= 1;
    let value: string;
    try {
      value = decoder.decode(bytes.subarray(valueStart, valueEnd));
    } catch (cause) {
      if (!(cause instanceof TypeError)) throw cause;
      decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      opaqueValueFailure ??= {
        ...facts(),
        kind: "invalid-utf8-value",
        reason:
          "gRPC-web trailer field contains opaque non-UTF-8 bytes; that field was omitted",
      };
      examinedBytes = lineExaminedBytes;
      if (!hasSeparator) break;
      start = end + 2;
      continue;
    }
    budget.charge(512);
    trailers.push({ name, value });
    examinedBytes = lineExaminedBytes;
    if (!hasSeparator) break;
    start = end + 2;
  }
  if (opaqueValueFailure !== undefined)
    return err({
      ...opaqueValueFailure,
      trailers,
      examined_bytes: bytes.length,
    });
  return ok({ trailers, examined_bytes: bytes.length });
};

const isTrailerNameByte = (byte: number): boolean =>
  (byte >= 97 && byte <= 122) ||
  (byte >= 48 && byte <= 57) ||
  byte === 33 ||
  (byte >= 35 && byte <= 39) ||
  byte === 42 ||
  byte === 43 ||
  (byte >= 45 && byte <= 46) ||
  byte === 94 ||
  byte === 95 ||
  byte === 96 ||
  byte === 124 ||
  byte === 126;
