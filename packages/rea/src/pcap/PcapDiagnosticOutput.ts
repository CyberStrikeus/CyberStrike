import { visit } from "jsonc-parser";
import {
  PCAP_HTTP_URI_FIELDS,
  parsePcapHttpUri,
  type PcapHttpUriRole,
} from "./PcapHttpUri.js";
import { jsonStringSourceSpans } from "../domain/jsonStringSourceSpans.js";
import type { AnalysisCapturedOutput } from "../domain/analysisErrorBase.js";

// These are protocol facts, not a heuristic for names or arbitrary text.
const HTTP_URI_FIELDS = new Map<string, PcapHttpUriRole>(
  Object.entries(PCAP_HTTP_URI_FIELDS),
);

interface ProjectedJsonDiagnostic {
  readonly text: string;
  /** Unclassified data was withheld; format validity is a separate fact. */
  readonly partial: boolean;
}

/** Preserve the source JSON spelling except for transport userinfo spans.
 * An invalid/unfinished token and its suffix are withheld, never guessed.
 * No object tree is assembled; input is already bounded by the command owner.
 */
const projectHttpJsonDiagnostic = (text: string): ProjectedJsonDiagnostic => {
  if (text.length === 0) return { text, partial: false };
  const invalidJson = {};
  let cutoff = text.length;
  let cursor = 0;
  let partial = false;
  let pending = "";
  const chunks: string[] = [];
  const append = (part: string): void => {
    pending += part;
    if (pending.length >= 16 * 1024) {
      chunks.push(pending);
      pending = "";
    }
  };
  const redact = (
    value: unknown,
    offset: number,
    length: number,
    path: readonly (string | number)[],
  ): void => {
    if (typeof value !== "string") return;
    let role: PcapHttpUriRole | undefined;
    for (const part of path)
      if (typeof part === "string") role = HTTP_URI_FIELDS.get(part) ?? role;
    if (role === undefined) return;
    const { credentials } = parsePcapHttpUri(value, role);
    if (credentials === null) return;
    const encoded = text.slice(offset + 1, offset + length - 1);
    const spans =
      credentials === "ambiguous"
        ? [{ start: offset + 1, end: offset + length - 1 }]
        : jsonStringSourceSpans(encoded, offset + 1, [credentials]);
    for (const span of spans) {
      append(text.slice(cursor, span.start));
      cursor = span.end;
    }
    if (credentials === "ambiguous") partial = true;
  };
  try {
    visit(
      text,
      {
        onLiteralValue: (
          value: unknown,
          offset,
          length,
          _line,
          _column,
          path,
        ) => redact(value, offset, length, path()),
        onObjectProperty: (value, offset, length, _line, _column, path) =>
          redact(value, offset, length, path()),
        onError: (_error, offset) => {
          partial ||= offset < text.length;
          cutoff = offset;
          throw invalidJson;
        },
      },
      {
        disallowComments: true,
        allowTrailingComma: false,
        allowEmptyContent: false,
      },
    );
  } catch (cause) {
    // Unexpected decoder/resource failures must not replace the command's
    // primary failure or expose an unclassified raw diagnostic.
    if (cause !== invalidJson || cutoff < cursor)
      return { text: "", partial: true };
  }
  append(text.slice(cursor, cutoff));
  if (chunks.length === 0) return { text: pending, partial };
  chunks.push(pending);
  return { text: chunks.join(""), partial };
};

/** One command's lazy, single-entry diagnostic cache; no cross-capture state. */
export const createPcapDiagnosticProjection = (httpJson: boolean) => {
  let cachedSource: string | undefined;
  let cached: ProjectedJsonDiagnostic | undefined;
  return (output: AnalysisCapturedOutput): AnalysisCapturedOutput => {
    if (!httpJson) return output;
    if (cached === undefined || cachedSource !== output.stdout) {
      cached = projectHttpJsonDiagnostic(output.stdout);
      cachedSource = output.stdout;
    }
    return {
      ...output,
      stdout: cached.text,
      truncated: output.truncated || cached.partial,
    };
  };
};
