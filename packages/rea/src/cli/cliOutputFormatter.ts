/*
 * Markdown output layout is adapted from Incur's Formatter.
 * Copyright (c) 2025-present weth, LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */
import { Formatter } from "incur";

import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { err, ok, type Result } from "../domain/result.js";

export interface CliDelimitedOutputOptions {
  readonly fields: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

type DelimitedScalar = string | number | boolean | null | undefined;

/** UTF-8 cannot encode a lone UTF-16 surrogate without replacing it. */
export const hasUnpairedSurrogate = (value: string): boolean =>
  /[\ud800-\udfff]/u.test(value);

/** Check selected output, including keys, before using a non-JSON text format. */
export const containsUnpairedSurrogate = (value: unknown): boolean => {
  return containsText(value, hasUnpairedSurrogate);
};

/** Markdown renderers replace NUL as well as UTF-8-invalid code units. */
export const containsUnrepresentableMarkdown = (value: unknown): boolean =>
  containsText(
    value,
    (text) => text.includes("\u0000") || hasUnpairedSurrogate(text),
  );

const containsText = (
  value: unknown,
  predicate: (text: string) => boolean,
): boolean => {
  const pending: Iterator<unknown>[] = [[value][Symbol.iterator]()];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const next = pending.at(-1)!.next();
    if (next.done === true) {
      pending.pop();
      continue;
    }
    const current: unknown = next.value;
    if (typeof current === "string") {
      if (predicate(current)) return true;
      continue;
    }
    if (typeof current !== "object" || current === null || seen.has(current))
      continue;
    seen.add(current);
    pending.push(outputValues(current));
  }
  return false;
};

function* outputValues(value: object): Generator<unknown> {
  if (Array.isArray(value)) {
    yield* value;
    return;
  }
  for (const key of Object.keys(value)) {
    yield key;
    yield (value as Record<string, unknown>)[key];
  }
}

export interface PreparedDelimitedOutput {
  readonly encodedHeaders: readonly string[];
  readonly rows: readonly (readonly DelimitedScalar[])[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly delimiter: string;
  readonly lineEnding: string;
  readonly format: "csv" | "tsv";
}

/** Keep REA's Markdown layout compatible with Incur while owning table safety. */
export const formatCliOutput = (
  value: unknown,
  format: Formatter.Format | "csv" | "tsv",
  delimited?: CliDelimitedOutputOptions,
): string => {
  if (format === "csv" || format === "tsv") {
    const prepared = prepareDelimitedOutput(
      value,
      format,
      delimited ?? {
        fields: [],
        metadata: {},
      },
    );
    return prepared.ok
      ? [...formatDelimitedOutputParts(prepared.value)].join("")
      : Formatter.format(projectAnalysisError(prepared.error), "json");
  }
  return format === "md"
    ? formatMarkdown(value)
    : Formatter.format(value, format);
};

/** Validate a complete row page before the caller writes any output. */
export const prepareDelimitedOutput = (
  rows: unknown,
  format: "csv" | "tsv",
  { fields, metadata }: CliDelimitedOutputOptions,
): Result<PreparedDelimitedOutput, AnalysisInputError> => {
  const operation =
    typeof metadata.command === "string"
      ? metadata.command
      : "render-cli-delimited-output";
  if (!isPlainObjectArray(rows))
    return err(
      delimitedOutputInputError(
        ["--filter-output"],
        Array.isArray(rows)
          ? "CSV/TSV output requires every selected row to be a plain object."
          : "The selected output path does not contain a row array.",
        operation,
      ),
    );
  if (fields.length === 0)
    return err(
      delimitedOutputInputError(
        ["--columns"],
        "CSV/TSV output requires at least one explicitly selected field.",
        operation,
      ),
    );

  const encodedHeaders: string[] = [];
  for (const field of fields) {
    if (hasUnpairedSurrogate(field))
      return err(
        delimitedOutputInputError(
          ["--columns"],
          "CSV/TSV cannot preserve unpaired UTF-16 surrogates in UTF-8 output; use JSON.",
          operation,
        ),
      );
    if (isSpreadsheetFormula(field))
      return err(
        delimitedOutputInputError(
          ["--columns", field],
          "CSV/TSV output refuses spreadsheet formula-leading text; JSON retains the exact value.",
          operation,
        ),
      );
    encodedHeaders.push(encodeDelimitedText(field, format));
  }

  const preparedRows: DelimitedScalar[][] = [];
  for (const record of rows) {
    const preparedRow: DelimitedScalar[] = [];
    for (const field of fields) {
      const value = Object.hasOwn(record, field) ? record[field] : undefined;
      if (
        value !== null &&
        value !== undefined &&
        typeof value !== "string" &&
        typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isFinite(value))
      )
        return err(
          delimitedOutputInputError(
            ["--columns", field],
            "CSV/TSV cells must be scalar values; nested objects and arrays are not flattened.",
            operation,
          ),
        );
      if (typeof value === "string" && isSpreadsheetFormula(value))
        return err(
          delimitedOutputInputError(
            ["--columns", field],
            "CSV/TSV output refuses spreadsheet formula-leading text; JSON retains the exact value.",
            operation,
          ),
        );
      if (typeof value === "string" && hasUnpairedSurrogate(value))
        return err(
          delimitedOutputInputError(
            ["--columns", field],
            "CSV/TSV cannot preserve unpaired UTF-16 surrogates in UTF-8 output; use JSON.",
            operation,
          ),
        );
      preparedRow.push(value);
    }
    preparedRows.push(preparedRow);
  }

  return ok({
    encodedHeaders,
    rows: preparedRows,
    metadata,
    delimiter: format === "csv" ? "," : "\t",
    lineEnding: format === "csv" ? "\r\n" : "\n",
    format,
  });
};

export const delimitedOutputInputError = (
  path: readonly (string | number)[],
  message: string,
  operation = "render-cli-delimited-output",
): AnalysisInputError =>
  new AnalysisInputError(operation, { userMessage: message }, [
    { path, reason: "invalid_value", message },
  ]);

/** Render a validated row page, preceded by a versioned metadata record. */
export const formatDelimitedRows = (
  rows: unknown,
  format: "csv" | "tsv",
  options: CliDelimitedOutputOptions,
): Result<string, AnalysisInputError> => {
  const prepared = prepareDelimitedOutput(rows, format, options);
  return prepared.ok
    ? ok([...formatDelimitedOutputParts(prepared.value)].join(""))
    : prepared;
};

/** Stream a page after its rows and cells have been validated and snapshotted. */
export function* formatDelimitedOutputParts({
  encodedHeaders,
  rows,
  metadata,
  delimiter,
  lineEnding,
  format,
}: PreparedDelimitedOutput): Generator<string> {
  yield `# rea-delimited-v1 ${JSON.stringify(metadata)}${lineEnding}`;
  yield `${encodedHeaders.join(delimiter)}${lineEnding}`;
  for (const row of rows)
    yield `${row
      .map((value) => encodeDelimitedScalar(value, format))
      .join(delimiter)}${lineEnding}`;
}

const encodeDelimitedScalar = (
  value: DelimitedScalar,
  format: "csv" | "tsv",
): string => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return encodeDelimitedText(text, format);
};

const encodeDelimitedText = (text: string, format: "csv" | "tsv"): string => {
  const needsQuotes =
    format === "csv" ? /[",\r\n]/u.test(text) : /["\t\r\n]/u.test(text);
  return needsQuotes ? `"${text.replace(/"/gu, '""')}"` : text;
};

const isSpreadsheetFormula = (value: string): boolean =>
  /^[\u0000-\u0020]*[=+\-@]/u.test(value) || /^[\t\r]/u.test(value);

const isPlainObjectArray = (
  value: unknown,
): value is readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value) &&
  value.every(
    (row: unknown) =>
      typeof row === "object" &&
      row !== null &&
      !Array.isArray(row) &&
      (Object.getPrototypeOf(row) === Object.prototype ||
        Object.getPrototypeOf(row) === null),
  );

const isScalar = (value: unknown): boolean =>
  value === null || value === undefined || typeof value !== "object";

const isFlatObject = (value: Record<string, unknown>): boolean =>
  Object.values(value).every(isScalar);

const isObjectArray = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (item) => typeof item === "object" && item !== null && !Array.isArray(item),
  ) &&
  value.some((item) => Object.keys(item).length > 0);

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

/** Underscore runs between word characters cannot open or close emphasis. */
const escapeInlineSyntax = (
  match: string,
  offset: number,
  text: string,
): string =>
  match.startsWith("_") &&
  isWordCharacter(text[offset - 1]) &&
  isWordCharacter(text[offset + match.length])
    ? match
    : match.replace(/./g, "\\$&");

const escapeTableCell = (value: string): string =>
  value
    .replace(
      /\u0000|[\ud800-\udfff]/gu,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    )
    .replace(/[\\|`*[\]~{}#]|_+/g, escapeInlineSyntax)
    // Encode renderer-extension introducers at the same boundary as HTML
    // characters. Generated entities must not themselves be re-escaped.
    .replace(/[&<>:]|;(?=-?[)(])/g, (character) => {
      switch (character) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case ":":
          return "&#58;";
        default:
          return "&#59;";
      }
    })
    .replace(/([xXB8]-)\)/g, "$1&#41;")
    .replace(/\r\n|\r|\n/g, "<br>");

const encodeMarkdownWhitespace = (whitespace: string): string =>
  whitespace.replace(/ /g, "&#32;").replace(/\t/g, "&#9;");

/** Heading and paragraph facts are literal data, including block syntax. */
const escapeMarkdownText = (value: string): string =>
  escapeTableCell(value)
    .replace(/^(\s*)([-+=])/, "$1\\$2")
    .replace(/^(\s*\d{1,9})([.)])(?=\s)/, "$1\\$2")
    .replace(/^[ \t]+/, encodeMarkdownWhitespace)
    .replace(/[ \t]+$/u, encodeMarkdownWhitespace);

const markdownHeading = (path: readonly string[]): string =>
  `## ${escapeMarkdownText(path.join("."))}\n\n`;

const renderTable = (
  headers: readonly string[],
  rows: readonly string[][],
): string => {
  if (headers.length === 0) return "";
  const encodeTableCell = (value: string): string =>
    escapeTableCell(value).replace(/^[ \t]+|[ \t]+$/g, (spaces) =>
      encodeMarkdownWhitespace(spaces),
    );
  const escapedHeaders = headers.map(encodeTableCell);
  const widths = escapedHeaders.map((header) => header.length);
  for (const row of rows) {
    for (let index = 0; index < escapedHeaders.length; index += 1) {
      const width = encodeTableCell(row[index] ?? "").length;
      if (width > widths[index]!) widths[index] = width;
    }
  }

  const pad = (value: string, index: number): string =>
    value.padEnd(widths[index]!);
  const lines = [
    `| ${escapedHeaders.map(pad).join(" | ")} |`,
    `|${widths.map((width) => "-".repeat(width + 2)).join("|")}|`,
  ];
  for (const row of rows) {
    lines.push(
      `| ${escapedHeaders
        .map((_, index) => pad(encodeTableCell(row[index] ?? ""), index))
        .join(" | ")} |`,
    );
  }
  return lines.join("\n");
};

/** Keep nested JSON facts inside their owning table cell. */
const markdownCell = (value: unknown): string =>
  value !== null && typeof value === "object"
    ? JSON.stringify(value)
    : value === undefined
      ? ""
      : String(value);

const formatKeyValueTable = (value: Record<string, unknown>): string =>
  renderTable(
    ["Key", "Value"],
    Object.entries(value).map(([key, child]) => [key, markdownCell(child)]),
  );

const formatObjectTable = (
  items: readonly Record<string, unknown>[],
): string => {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const item of items)
    for (const key of Object.keys(item))
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
  if (headers.length === 0) return markdownCell(items);
  return renderTable(
    headers,
    items.map((item) =>
      headers.map((key) =>
        markdownCell(Object.hasOwn(item, key) ? item[key] : undefined),
      ),
    ),
  );
};

const formatMarkdown = (
  value: unknown,
  path: readonly string[] = [],
): string => {
  if (value == null && path.length === 0) return "";
  if (isScalar(value)) {
    if (path.length === 0) return escapeMarkdownText(String(value));
    return `${markdownHeading(path)}${escapeMarkdownText(String(value))}`;
  }
  if (Array.isArray(value)) {
    if (isObjectArray(value)) {
      const table = formatObjectTable(value);
      return path.length === 0 ? table : `${markdownHeading(path)}${table}`;
    }
    return formatMarkdown(markdownCell(value), path);
  }

  const object = value as Record<string, unknown>;
  const entries = Object.entries(object);
  if (path.length === 0 && isFlatObject(object))
    return formatKeyValueTable(object);

  const needsHeadings =
    path.length > 0 ||
    entries.length > 1 ||
    entries.some(([, child]) => !isScalar(child));
  if (!needsHeadings) return formatKeyValueTable(object);

  return entries
    .map(([key, child]) => {
      const childPath = [...path, key];
      const heading = markdownHeading(childPath);
      if (isScalar(child))
        return `${heading}${escapeMarkdownText(String(child))}`;
      if (isObjectArray(child)) return `${heading}${formatObjectTable(child)}`;
      if (
        typeof child === "object" &&
        child !== null &&
        !Array.isArray(child)
      ) {
        const nested = child as Record<string, unknown>;
        return isFlatObject(nested)
          ? `${heading}${formatKeyValueTable(nested)}`
          : formatMarkdown(nested, childPath);
      }
      return `${heading}${escapeMarkdownText(markdownCell(child))}`;
    })
    .join("\n\n");
};
