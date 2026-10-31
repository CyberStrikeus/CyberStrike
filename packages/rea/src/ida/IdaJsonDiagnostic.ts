import { jsonStringSourceSpans } from "../domain/jsonStringSourceSpans.js";
import { constants } from "node:buffer";
import { createScanner, type ScanError, type SyntaxKind } from "jsonc-parser";
import {
  IDA_REDACTION_MARKER,
  IdaDiagnosticResourceError,
  writeIdaDiagnostic,
  type IdaDiagnosticMatch,
} from "./IdaDiagnosticWriter.js";

// jsonc-parser declares ambient const enums, which cannot be imported as values
// under verbatimModuleSyntax. Keep its scanner codes local and type-checked.
const JSON_STRING_LITERAL = 10 satisfies SyntaxKind;
const JSON_EOF = 17 satisfies SyntaxKind;
const JSON_NO_ERROR = 0 satisfies ScanError;

/** Matches are non-overlapping and ordered by their UTF-16 source offsets. */
type Matches = (value: string) => Iterable<IdaDiagnosticMatch>;

// Complete JSON character runs remain meaningful even in an unfinished or
// malformed string. Invalid units separate runs instead of joining their text.
const JSON_CHARACTER_RUN =
  /(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\dA-Fa-f]{4}))+/gu;

function* characterRunMatches(
  encoded: string,
  offset: number,
  matches: Matches,
  inputCodeUnits: number,
): Generator<IdaDiagnosticMatch> {
  for (const run of encoded.matchAll(JSON_CHARACTER_RUN)) {
    // The run grammar admits only complete JSON characters. JSON.parse owns
    // their decoded meaning; malformed units remain verbatim between runs.
    const decodingCodeUnits = run[0].length + 2;
    if (decodingCodeUnits > constants.MAX_STRING_LENGTH)
      throw new IdaDiagnosticResourceError(
        inputCodeUnits,
        decodingCodeUnits,
        "json-character-run",
      );
    const decoded: unknown = JSON.parse('"' + run[0] + '"');
    if (typeof decoded !== "string")
      throw new TypeError("A JSON character run did not decode to a string.");
    yield* jsonStringSourceSpans(run[0], offset + run.index, matches(decoded));
  }
}

function* decodedMatches(
  text: string,
  matches: Matches,
): Generator<IdaDiagnosticMatch> {
  let scannedEnd = 0;
  const scanner = createScanner(text);
  while (scanner.scan() !== JSON_EOF) {
    if (scanner.getToken() !== JSON_STRING_LITERAL) continue;
    const start = scanner.getTokenOffset();
    const end = start + scanner.getTokenLength();
    if (scannedEnd < start)
      yield* characterRunMatches(
        text.slice(scannedEnd, start),
        scannedEnd,
        matches,
        text.length,
      );
    if (scanner.getTokenError() === JSON_NO_ERROR)
      yield* jsonStringSourceSpans(
        text.slice(start + 1, end - 1),
        start + 1,
        matches(scanner.getTokenValue()),
      );
    else
      yield* characterRunMatches(
        text.slice(start + 1, end),
        start + 1,
        matches,
        text.length,
      );
    scannedEnd = end;
  }
  yield* characterRunMatches(
    text.slice(scannedEnd),
    scannedEnd,
    matches,
    text.length,
  );
}

function* literalMatches(
  text: string,
  matches: Matches,
  validDocument: boolean,
): Generator<IdaDiagnosticMatch> {
  if (!validDocument) {
    // Recovery cannot establish a unique meaning for a malformed document.
    yield* matches(text);
    return;
  }
  const scanner = createScanner(text);
  let complete: IdaDiagnosticMatch | undefined;
  let ended = false;
  for (const match of matches(text)) {
    while (!ended && (complete === undefined || complete.end <= match.start)) {
      complete = undefined;
      while (scanner.scan() !== JSON_EOF) {
        if (scanner.getToken() !== JSON_STRING_LITERAL) continue;
        const start = scanner.getTokenOffset();
        complete = { start, end: start + scanner.getTokenLength() };
        break;
      }
      if (complete === undefined) ended = true;
    }
    // Only a complete string in a valid document owns decoded-only semantics.
    // Raw matches crossing tokens remain visible to the credential boundary.
    if (
      complete === undefined ||
      match.start < complete.start ||
      match.end > complete.end
    )
      yield match;
  }
}

function* mergeMatches(
  left: Iterable<IdaDiagnosticMatch>,
  right: Iterable<IdaDiagnosticMatch>,
): Generator<IdaDiagnosticMatch> {
  const leftIterator = left[Symbol.iterator]();
  const rightIterator = right[Symbol.iterator]();
  try {
    let leftMatch = leftIterator.next();
    let rightMatch = rightIterator.next();
    while (!leftMatch.done || !rightMatch.done) {
      if (
        rightMatch.done ||
        (!leftMatch.done && leftMatch.value.start <= rightMatch.value.start)
      ) {
        if (leftMatch.done) break;
        yield leftMatch.value;
        leftMatch = leftIterator.next();
      } else {
        yield rightMatch.value;
        rightMatch = rightIterator.next();
      }
    }
  } finally {
    try {
      leftIterator.return?.();
    } finally {
      rightIterator.return?.();
    }
  }
}

/** Redact complete or malformed JSON diagnostics without rewriting unrelated source. */
export const redactIdaJsonDiagnostic = (
  text: string,
  matches: Matches,
  replacement: string = IDA_REDACTION_MARKER,
): string => {
  let validDocument = false;
  try {
    JSON.parse(text);
    validDocument = true;
  } catch {
    // Keep both raw and decoded interpretations when the document is incomplete.
  }
  return writeIdaDiagnostic(
    text,
    mergeMatches(
      literalMatches(text, matches, validDocument),
      decodedMatches(text, matches),
    ),
    replacement,
  );
};

/** Untyped producer text retains both literal and JSON character interpretations. */
export const redactIdaUnclassifiedDiagnostic = (
  text: string,
  matches: Matches,
  replacement: string = IDA_REDACTION_MARKER,
): string =>
  writeIdaDiagnostic(
    text,
    mergeMatches(matches(text), decodedMatches(text, matches)),
    replacement,
  );
