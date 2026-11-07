import {
  redactIdaJsonDiagnostic,
  redactIdaUnclassifiedDiagnostic,
} from "./IdaJsonDiagnostic.js";
import {
  IDA_REDACTION_MARKER,
  joinIdaDiagnosticParts,
  writeIdaDiagnostic,
  type IdaDiagnosticMatch,
} from "./IdaDiagnosticWriter.js";
import {
  isIdaAuthenticationHeader,
  idaExplicitSensitiveValues,
} from "./IdaRegistrationIdentity.js";
import type { IdaConfiguration } from "./IdaConfiguration.js";
import { AnalysisProtocolError } from "../domain/analysisErrorCore.js";

// Diagnostic text is bounded before decoding or replacement expansion.
export const IDA_DIAGNOSTIC_SOURCE_BYTES = 64 * 1024;
const omittedDiagnostic = "[IDA diagnostic omitted: exceeds 65536 UTF-8 bytes]";

const boundedDiagnostic =
  (redact: (message: string) => string) =>
  (message: string): string =>
    Buffer.byteLength(message, "utf8") > IDA_DIAGNOSTIC_SOURCE_BYTES
      ? redact(omittedDiagnostic)
      : redact(message);

/** RFC 7617 user-pass candidates; the configured request carries no charset. */
const basicPayloads = (payload: string): readonly string[] => {
  if (!/^[A-Za-z\d+/]+={0,2}$/u.test(payload)) return [];
  const octets = Buffer.from(payload, "base64");
  const canonical = octets.toString("base64");
  // Match the supported padded/unpadded policy without accepting Buffer's
  // permissive alphabet or discarding nonzero pad bits.
  if (
    canonical.replace(/=+$/u, "") !== payload.replace(/=+$/u, "") ||
    octets.indexOf(0x3a) < 0
  )
    return [];
  // Basic user-id and password exclude ASCII control characters.
  if (octets.some((value) => value < 0x20 || value === 0x7f)) return [];
  const candidates = [octets.toString("latin1")];
  try {
    candidates.push(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(octets),
    );
  } catch {
    // Invalid UTF-8 has no decoded Unicode candidate. Exact Latin-1 preserves
    // each octet; do not invent a replacement-character credential.
  }
  // The default charset is unknown. Retain both supported interpretations
  // rather than selecting one or normalizing their configured source bytes.
  return [
    canonical,
    canonical.replace(/=+$/u, ""),
    ...candidates.flatMap((pair) => {
      const separator = pair.indexOf(":");
      // The complete pair and password are credentials; a bare user-id is not.
      return [pair, pair.slice(separator + 1)].filter(
        (value) => value.length > 0,
      );
    }),
  ];
};

/** RFC 9110 credentials: any scheme, followed by opaque data or auth-params. */
const authorizationPayloads = (header: string): readonly string[] => {
  const credentials = header.match(
    /^([!#$%&'*+.^_`|~\dA-Za-z-]+)[ \t]+([\s\S]+)$/u,
  );
  const payload = credentials?.[2];
  if (payload === undefined) return [];
  if (credentials?.[1]?.toLowerCase() === "basic")
    return [payload, ...basicPayloads(payload)];
  const values = [payload];
  // A sticky parse cannot reinterpret commas inside an incomplete quoted value.
  // Keep complete parameters preceding malformed input; the opaque payload above
  // remains a known credential even when the parameter grammar is not satisfied.
  const parameter =
    /[ \t,]*[!#$%&'*+.^_`|~\dA-Za-z-]+[ \t]*=[ \t]*("(?:[^"\\\r\n]|\\[^\r\n])*"|[!#$%&'*+.^_`|~\dA-Za-z-]+)[ \t]*(?:,|$)/uy;
  let cursor = 0;
  while (cursor < payload.length) {
    parameter.lastIndex = cursor;
    const match = parameter.exec(payload);
    if (match === null) break;
    cursor = parameter.lastIndex;
    const value = match[1] ?? "";
    if (!value.startsWith('"')) {
      values.push(value);
      continue;
    }
    const quoted = value.slice(1, -1);
    if (quoted.length > 0)
      values.push(value, quoted, quoted.replace(/\\([^\r\n])/gu, "$1"));
  }
  return values;
};

/** RFC 6265 cookie-pairs: retain duplicates and '=' inside values. */
const cookiePayloads = (header: string): readonly string[] =>
  header.split(";").flatMap((pair) => {
    const value = pair.match(
      /^[ \t]*[!#$%&'*+.^_`|~\dA-Za-z-]+[ \t]*=[ \t]*(.*?)[ \t]*$/u,
    )?.[1];
    if (value === undefined) return [];
    const payload =
      value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    // Cookie quotes wrap cookie-octets; they do not introduce escape syntax.
    if (!/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/u.test(payload))
      return [];
    return [value, payload];
  });

/** Choose one marker for this credential owner, including replacement boundaries. */
const redactionMarker = (secrets: readonly string[]): string => {
  // Crossing either edge of the default marker requires a square bracket.
  // A credential wholly inside the marker must also be excluded.
  if (
    secrets.every(
      (secret) =>
        !secret.includes("[") &&
        !secret.includes("]") &&
        !IDA_REDACTION_MARKER.includes(secret),
    )
  )
    return IDA_REDACTION_MARKER;
  const characters = new Set<string>();
  for (const secret of secrets)
    for (const character of secret) characters.add(character);
  // A graphic scalar absent from every credential cannot contain or connect
  // a credential, and can be written verbatim inside a JSON string.
  const graphic = /[\p{L}\p{N}\p{P}\p{S}]/u;
  for (let point = 0x241f; point <= 0x10ffff; point++) {
    if (point >= 0xd800 && point <= 0xdfff) continue;
    const character = String.fromCodePoint(point);
    if (graphic.test(character) && !characters.has(character)) return character;
  }
  throw new AnalysisProtocolError(
    "Configured IDA credentials leave no available diagnostic redaction character.",
  );
};

/** Own configured credential interpretation for all IDA error diagnostics. */
export const createIdaDiagnosticRedactor = (
  config?: IdaConfiguration,
): Readonly<{
  text(message: string): string;
  url(message: string): string;
  json(message: string): string;
  blocks(messages: readonly string[]): string;
  message(prefix: string, ownedBody: string): string;
}> => {
  const headers =
    config !== undefined && "headers" in config
      ? Object.entries(config.headers)
      : [];
  const values = headers.flatMap(([name, value]) => {
    if (!isIdaAuthenticationHeader(name)) return [];
    // Fetch normalizes surrounding HTTP whitespace before sending headers.
    const normalized = value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, "");
    if (normalized.length === 0) return [];
    return [
      value,
      normalized,
      ...(name.toLowerCase() === "cookie"
        ? cookiePayloads(normalized)
        : authorizationPayloads(normalized)),
    ];
  });
  const secrets = [
    ...new Set(
      [...values, ...idaExplicitSensitiveValues(config)].filter(
        (value) => value.length > 0,
      ),
    ),
  ].sort((left, right) => right.length - left.length);
  const replacement =
    secrets.length === 0 ? IDA_REDACTION_MARKER : redactionMarker(secrets);
  const alternatives = secrets
    .map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
  // Look ahead at each source position; a global consuming match loses overlap.
  // Longest-first alternatives cover every shorter match at the same position.
  const pattern =
    alternatives.length === 0
      ? undefined
      : new RegExp("(?=(" + alternatives + "))", "gu");
  const matches = function* (value: string): Iterable<IdaDiagnosticMatch> {
    if (pattern === undefined) return;
    let pending: IdaDiagnosticMatch | undefined;
    for (const match of value.matchAll(pattern)) {
      const credential = match[1];
      if (credential === undefined || credential.length === 0)
        throw new AnalysisProtocolError(
          "IDA diagnostic matching omitted its credential span.",
        );
      const span = { start: match.index, end: match.index + credential.length };
      if (pending !== undefined && span.start < pending.end) {
        pending = {
          start: pending.start,
          end: Math.max(pending.end, span.end),
        };
      } else {
        if (pending !== undefined) yield pending;
        pending = span;
      }
    }
    if (pending !== undefined) yield pending;
  };
  const text = boundedDiagnostic((message) =>
    writeIdaDiagnostic(message, matches(message), replacement),
  );
  const json = boundedDiagnostic((message) =>
    secrets.length === 0
      ? message
      : redactIdaJsonDiagnostic(message, matches, replacement),
  );
  // A URL may carry the same known credential in percent-encoded form. Map
  // decoded characters back to their original spans so unrelated spelling is
  // preserved, including mixed encoded and literal characters.
  const url = boundedDiagnostic((message) => {
    let decoded = "";
    const spans: IdaDiagnosticMatch[] = [];
    const query = message.indexOf("?");
    const fragment = message.indexOf("#", query + 1);
    for (let index = 0; index < message.length;) {
      const first = message.slice(index, index + 3);
      const byte = /^%[\dA-Fa-f]{2}$/u.test(first)
        ? Number.parseInt(first.slice(1), 16)
        : undefined;
      const width =
        byte === undefined
          ? 0
          : byte < 0x80
            ? 1
            : byte >= 0xc2 && byte <= 0xdf
              ? 2
              : byte >= 0xe0 && byte <= 0xef
                ? 3
                : byte >= 0xf0 && byte <= 0xf4
                  ? 4
                  : 0;
      const encoded =
        width === 0 ? undefined : message.slice(index, index + width * 3);
      if (encoded !== undefined && /^(?:%[\dA-Fa-f]{2})+$/u.test(encoded)) {
        try {
          const value = decodeURIComponent(encoded);
          let offset = index;
          for (const scalar of value) {
            const end = offset + Buffer.byteLength(scalar, "utf8") * 3;
            decoded += scalar;
            for (let unit = 0; unit < scalar.length; unit++)
              spans.push({ start: offset, end });
            offset = end;
          }
          index += encoded.length;
          continue;
        } catch {
          // Invalid percent-encoded UTF-8 has no decoded Unicode identity.
        }
      }
      const scalar = String.fromCodePoint(message.codePointAt(index)!);
      const end = index + scalar.length;
      decoded +=
        scalar === "+" &&
        query >= 0 &&
        index > query &&
        (fragment < 0 || index < fragment)
          ? " "
          : scalar;
      for (let unit = 0; unit < scalar.length; unit++)
        spans.push({ start: index, end });
      index = end;
    }
    const decodedSpans = [...matches(decoded)].map((match) => ({
      start: spans[match.start]!.start,
      end: spans[match.end - 1]!.end,
    }));
    const all = [...matches(message), ...decodedSpans].sort(
      (left, right) => left.start - right.start || left.end - right.end,
    );
    return writeIdaDiagnostic(message, all, replacement);
  });
  return {
    text,
    url,
    json,
    blocks(messages) {
      let bytes = 0;
      let sourceUnits = 0;
      for (let index = 0; index < messages.length; index++) {
        const value = messages[index]!;
        bytes += Buffer.byteLength(value, "utf8") + (index === 0 ? 0 : 1);
        sourceUnits += value.length + (index === 0 ? 0 : 1);
        if (bytes > IDA_DIAGNOSTIC_SOURCE_BYTES) return text(omittedDiagnostic);
      }
      function* parts(): Generator<string> {
        for (let index = 0; index < messages.length; index++) {
          if (index > 0) yield "\n";
          const value = messages[index]!;
          yield secrets.length === 0 || value.length === 0
            ? value
            : redactIdaUnclassifiedDiagnostic(value, matches, replacement);
        }
      }
      return joinIdaDiagnosticParts(parts(), sourceUnits);
    },
    message(prefix, ownedBody) {
      // Normalized wire headers and supported decoded candidates have no LF.
      // Preserve the already-owned body without inspecting its replacement text.
      return joinIdaDiagnosticParts(
        [text(prefix), "\n", ownedBody],
        prefix.length + 1 + ownedBody.length,
      );
    },
  };
};
