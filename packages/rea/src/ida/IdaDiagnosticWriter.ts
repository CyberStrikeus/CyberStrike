import { constants } from "node:buffer";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { bufferedJsonParts } from "../domain/jsonSerialization.js";

export const IDA_REDACTION_MARKER = "[redacted transport credential]";
export type IdaDiagnosticMatch = Readonly<{ start: number; end: number }>;

type DiagnosticRepresentation = "redacted-output" | "json-character-run";

/** An owned diagnostic cannot be represented as one runtime string. */
export class IdaDiagnosticResourceError extends AnalysisResourceConstraintError {
  constructor(
    inputCodeUnits: number,
    representedCodeUnits: number,
    representation: DiagnosticRepresentation = "redacted-output",
  ) {
    super(
      "ida_diagnostic_redaction",
      "memory",
      representation === "redacted-output"
        ? "Redacted IDA diagnostics exceed the runtime's maximum string length."
        : "Temporary IDA diagnostic JSON character decoding exceeds the runtime's maximum string length.",
      {
        boundary: "ida-diagnostic-redaction",
        representation,
        input_code_units: inputCodeUnits,
        ...(representation === "redacted-output"
          ? { output_code_units_at_least: representedCodeUnits }
          : { json_decoding_code_units_at_least: representedCodeUnits }),
        max_string_code_units: constants.MAX_STRING_LENGTH,
      },
    );
  }
}

/** Account for the complete representation before allocating its final string. */
export const joinIdaDiagnosticParts = (
  parts: Iterable<string>,
  inputCodeUnits: number,
): string => {
  function* checkedParts(): Generator<string> {
    let outputCodeUnits = 0;
    for (const part of parts) {
      outputCodeUnits += part.length;
      if (outputCodeUnits > constants.MAX_STRING_LENGTH)
        throw new IdaDiagnosticResourceError(inputCodeUnits, outputCodeUnits);
      yield part;
    }
  }
  return [...bufferedJsonParts(checkedParts())].join("");
};

/** Write ordered source spans without retaining a per-match collection. */
export const writeIdaDiagnostic = (
  text: string,
  matches: Iterable<IdaDiagnosticMatch>,
  replacement: string = IDA_REDACTION_MARKER,
): string => {
  function* parts(): Generator<string> {
    let cursor = 0;
    let pending: IdaDiagnosticMatch | undefined;
    for (const match of matches) {
      if (pending !== undefined && match.start < pending.end) {
        pending = {
          start: pending.start,
          end: Math.max(pending.end, match.end),
        };
        continue;
      }
      if (pending !== undefined) {
        yield text.slice(cursor, pending.start);
        yield replacement;
        cursor = pending.end;
      }
      pending = match;
    }
    if (pending !== undefined) {
      yield text.slice(cursor, pending.start);
      yield replacement;
      cursor = pending.end;
    }
    yield text.slice(cursor);
  }
  return joinIdaDiagnosticParts(parts(), text.length);
};
