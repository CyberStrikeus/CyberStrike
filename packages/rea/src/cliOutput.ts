import {
  declaredSensitiveValues,
  splitIncurBuiltinArguments,
} from "./cliBuiltinArguments.js";
import { redactExplicitText } from "./domain/explicitSensitiveValues.js";
import { formatCliOutput } from "./cli/cliOutputFormatter.js";

import { jsonOutputParts } from "./cli/jsonOutput.js";
import { jsonLinesErrorRecord } from "./cli/jsonLines.js";
import {
  versionReport,
  type VersionReportHost,
} from "./domain/versionReport.js";

// The launcher and compiled CLI drivers share this lightweight entrypoint.
export { cliConfigurationError } from "./cliConfiguration.js";

const UNSUPPORTED_OUTPUT_COMBINATION_MESSAGE =
  "Token windows cannot preserve structured output. Remove --token-limit/--token-offset and use --filter-output or command pagination.";

type StructuredOutputFormat = "json" | "jsonl" | "yaml";
/** Formats that render a complete document, including target-free commands. */
export const CLI_DOCUMENT_OUTPUT_FORMATS = [
  "toon",
  "json",
  "yaml",
  "md",
  "jsonl",
] as const;
/** Delimited formats require an explicitly selected row collection. */
export const CLI_OUTPUT_FORMATS = [
  ...CLI_DOCUMENT_OUTPUT_FORMATS,
  "csv",
  "tsv",
] as const;
export type CliOutputFormat = (typeof CLI_OUTPUT_FORMATS)[number];
const CLI_OUTPUT_FORMAT_SET: ReadonlySet<string> = new Set(CLI_OUTPUT_FORMATS);

const isCliOutputFormat = (value: string): value is CliOutputFormat =>
  CLI_OUTPUT_FORMAT_SET.has(value);

/**
 * Render a document REA writes outside Incur's command pipeline. JSON follows
 * the CLI contract: indented for a terminal, compact when piped or redirected.
 */
export const renderCliDocument = (
  value: unknown,
  format: CliOutputFormat,
  stdoutIsTerminal: boolean,
): string =>
  format === "json" || format === "jsonl"
    ? [...jsonOutputParts(value, format, stdoutIsTerminal)].join("")
    : `${formatCliOutput(value, format)}\n`;
/**
 * Validate a spaced output-flag value before Incur dispatch. REA narrows token
 * coordinates to nonnegative safe integers so slice metadata remains coherent.
 */
export const cliOutputValueRejection = (
  flag: string,
  value: string,
): string | undefined => {
  if (flag === "--format")
    return CLI_OUTPUT_FORMAT_SET.has(value)
      ? undefined
      : `Invalid format: "${value}". Expected one of: ${[...CLI_OUTPUT_FORMAT_SET].join(", ")}`;
  if (flag === "--columns") {
    const columns = value.split(",").map((column) => column.trim());
    return columns.length > 0 &&
      columns.every((column) => column.length > 0) &&
      new Set(columns).size === columns.length
      ? undefined
      : `Invalid value for --columns: "${value}". Expected unique, nonempty comma-separated column names.`;
  }
  if (
    (flag === "--token-limit" || flag === "--token-offset") &&
    (!Number.isSafeInteger(Number(value)) ||
      Number(value) < 0 ||
      value.trim() === "")
  )
    return `Invalid value for ${flag}: "${value}". Expected a nonnegative safe integer.`;
  return undefined;
};

export type CliOutputArgumentValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly format: StructuredOutputFormat;
      readonly code:
        | "UNSUPPORTED_OUTPUT_COMBINATION"
        | "INVALID_OUTPUT_FILTER"
        | "INVALID_OUTPUT_VALUE"
        | "MISSING_OUTPUT_VALUE";
      readonly message: string;
    };

interface CliOutputControls {
  readonly filterOutput: string | undefined;
  readonly columns: readonly string[] | undefined;
  readonly format: CliOutputFormat;
  /** Whether `--json` or `--format` selected the format, rather than the default. */
  readonly formatExplicit: boolean;
  readonly fullOutput: boolean;
  /** First valued output flag that Incur skips because it has no value. */
  readonly missingValue: string | undefined;
  readonly invalidValue: string | undefined;
  readonly tokenCount: boolean;
  readonly tokenWindow: boolean;
  readonly tokenLimit: number | undefined;
  readonly tokenOffset: number | undefined;
}

/** Parsed output controls and the decisions shared by every executable consumer. */
export interface ParsedCliOutputArguments extends CliOutputControls {
  readonly validation: CliOutputArgumentValidation;
  readonly versionReportFormat: CliOutputFormat | undefined;
}

/** Read effective Incur output controls at the executable boundary. */
export const parseCliOutputArguments = (
  arguments_: readonly string[],
): ParsedCliOutputArguments => {
  let format: CliOutputFormat = "toon";
  let rootVersion = false;
  let versionEligible = true;
  let formatExplicit = false;
  let filterOutput: string | undefined;
  let columns: readonly string[] | undefined;
  let fullOutput = false;
  let missingValue: string | undefined;
  let invalidValue: string | undefined;
  let tokenCount = false;
  let tokenLimit: number | undefined;
  let tokenOffset: number | undefined;
  const parsed = (): ParsedCliOutputArguments => {
    const parseError = invalidValue !== undefined;
    const controls: CliOutputControls = {
      filterOutput,
      columns,
      format,
      formatExplicit,
      fullOutput,
      missingValue,
      invalidValue:
        invalidValue === undefined
          ? undefined
          : redactExplicitText(
              invalidValue,
              declaredSensitiveValues(
                splitIncurBuiltinArguments(arguments_).command,
              ),
            ),
      tokenCount,
      tokenWindow:
        !parseError && (tokenLimit !== undefined || tokenOffset !== undefined),
      tokenLimit: parseError ? undefined : tokenLimit,
      tokenOffset: parseError ? undefined : tokenOffset,
    };
    return {
      ...controls,
      validation: validateCliOutputControls(controls, rootVersion),
      versionReportFormat:
        rootVersion &&
        versionEligible &&
        formatExplicit &&
        !parseError &&
        missingValue === undefined &&
        format !== "csv" &&
        format !== "tsv" &&
        isCliOutputFormat(format)
          ? format
          : undefined,
    };
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    // Only these flags can accompany a formatted root version request.
    // Valued output flags consume their data below before the next iteration.
    if (argument === "--version") {
      const next = arguments_[index + 1];
      if (next === undefined || next.startsWith("-")) rootVersion = true;
      else versionEligible = false;
    } else if (
      argument !== "--json" &&
      argument !== "--format" &&
      argument !== "--timings"
    )
      versionEligible = false;
    // Incur scans builtins across `--` and reads spaced value forms, which
    // normalizeCliArguments has produced. Mirror those effective values.
    if (argument === "--json") {
      format = "json";
      formatExplicit = true;
      continue;
    }
    if (argument === "--format") {
      const value = arguments_[index + 1];
      if (value) {
        const rejection = cliOutputValueRejection(argument, value);
        if (rejection !== undefined) invalidValue ??= rejection;
        else if (isCliOutputFormat(value)) {
          format = value;
          formatExplicit = true;
        }
        index += 1;
      } else missingValue ??= argument;
      continue;
    }
    if (argument === "--filter-output") {
      if (arguments_[index + 1]) {
        filterOutput = arguments_[index + 1];
        index += 1;
      } else missingValue ??= argument;
      continue;
    }
    if (argument === "--columns") {
      const value = arguments_[index + 1];
      if (value) {
        const rejection = cliOutputValueRejection(argument, value);
        if (rejection !== undefined) invalidValue ??= rejection;
        else columns = value.split(",").map((column) => column.trim());
        index += 1;
      } else missingValue ??= argument;
      continue;
    }
    if (argument === "--token-limit" || argument === "--token-offset") {
      const value = arguments_[index + 1];
      if (value) {
        const rejection = cliOutputValueRejection(argument, value);
        if (rejection !== undefined) invalidValue ??= rejection;
        else if (argument === "--token-limit") tokenLimit = Number(value);
        else tokenOffset = Number(value);
        index += 1;
      } else missingValue ??= argument;
      continue;
    }
    if (argument === "--full-output") fullOutput = true;
    if (argument === "--token-count") tokenCount = true;
  }
  return parsed();
};

/** Reject slices that cannot advance within Incur's comma-delimited paths. */
const hasUnclosedFilterSlice = (expression: string): boolean => {
  let depth = 0;
  let unclosed = false;
  for (const character of expression) {
    if (character === "[") {
      depth += 1;
      unclosed = true;
    } else if (character === "]") {
      depth -= 1;
      // Incur consumes everything through the next closing bracket, including
      // nested opening brackets. Do not impose a different filter grammar.
      unclosed = false;
    } else if (character === "," && depth === 0 && unclosed) return true;
  }
  return unclosed;
};

/** Name a valued output flag that was given without a value. */
export const missingCliOutputValueMessage = (flag: string): string =>
  `${flag} requires a value, as in ${flag} <value> or ${flag}=<value>.`;

/** Reject output controls that cannot safely produce a complete result. */
const validateCliOutputControls = (
  {
    filterOutput,
    columns,
    format,
    missingValue,
    invalidValue,
    tokenWindow,
    tokenCount,
  }: CliOutputControls,
  rootVersion: boolean,
): CliOutputArgumentValidation => {
  if (invalidValue !== undefined)
    return {
      ok: false,
      format: format === "yaml" || format === "jsonl" ? format : "json",
      code: "INVALID_OUTPUT_VALUE",
      message: invalidValue,
    };
  if (filterOutput !== undefined && hasUnclosedFilterSlice(filterOutput))
    return {
      ok: false,
      format: format === "yaml" || format === "jsonl" ? format : "json",
      code: "INVALID_OUTPUT_FILTER",
      message:
        "The --filter-output expression has a slice without a closing ]. Close the slice or remove --filter-output.",
    };
  const delimited = format === "csv" || format === "tsv";
  // Name missing delimited controls before their combination checks; preserve
  // existing precedence for Incur's other output flags.
  if (missingValue !== undefined && (delimited || missingValue === "--columns"))
    return {
      ok: false,
      format: format === "yaml" || format === "jsonl" ? format : "json",
      code: "MISSING_OUTPUT_VALUE",
      message: missingCliOutputValueMessage(missingValue),
    };
  if (delimited && rootVersion)
    return {
      ok: false,
      format: "json",
      code: "UNSUPPORTED_OUTPUT_COMBINATION",
      message:
        "CSV/TSV output is available only for selected row collections, not --version.",
    };
  if (delimited && (filterOutput === undefined || columns === undefined))
    return {
      ok: false,
      format: "json",
      code: "UNSUPPORTED_OUTPUT_COMBINATION",
      message:
        "CSV/TSV output requires --filter-output <row-array-path> and --columns <column,...>; nested Evidence is not flattened.",
    };
  if (!delimited && columns !== undefined)
    return {
      ok: false,
      format: format === "yaml" || format === "jsonl" ? format : "json",
      code: "UNSUPPORTED_OUTPUT_COMBINATION",
      message: "--columns is available only with --format csv or --format tsv.",
    };
  if (delimited && (tokenWindow || tokenCount))
    return {
      ok: false,
      format: "json",
      code: "UNSUPPORTED_OUTPUT_COMBINATION",
      message:
        "Token counting and token windows cannot preserve CSV/TSV records or metadata. Remove --token-count/--token-limit/--token-offset.",
    };
  if (
    tokenWindow &&
    (format === "json" || format === "jsonl" || format === "yaml")
  )
    return {
      ok: false,
      format,
      code: "UNSUPPORTED_OUTPUT_COMBINATION",
      message: UNSUPPORTED_OUTPUT_COMBINATION_MESSAGE,
    };
  // Incur skips a valued flag without a value and then reports the flag
  // itself as unknown. Name the missing value instead.
  if (missingValue !== undefined)
    return {
      ok: false,
      format: format === "yaml" || format === "jsonl" ? format : "json",
      code: "MISSING_OUTPUT_VALUE",
      message: missingCliOutputValueMessage(missingValue),
    };
  return { ok: true };
};

/** Preserve a complete document when Incur filters the entire result away. */
export const renderEmptyFilteredCliOutput = ({
  filterOutput,
  format,
  validation,
}: ParsedCliOutputArguments): string | undefined => {
  if (!validation.ok) return undefined;
  if (
    filterOutput &&
    (format === "json" || format === "jsonl" || format === "yaml")
  )
    return "{}\n";
  return undefined;
};

/** Render one complete structured error before command execution. */
export const renderCliOutputArgumentError = (
  error: Exclude<CliOutputArgumentValidation, { readonly ok: true }>,
): string => {
  const value = {
    ok: false,
    error: { code: error.code, message: error.message },
  };
  if (error.format === "yaml")
    return `ok: false\nerror:\n  code: ${error.code}\n  message: ${JSON.stringify(error.message)}\n`;
  return `${JSON.stringify(error.format === "jsonl" ? jsonLinesErrorRecord(value) : value)}\n`;
};

/**
 * Render the version report for a formatted root `--version` request, or
 * return undefined so Incur prints the bare version or handles the request.
 */
export const renderVersionReport = (
  { versionReportFormat: format }: ParsedCliOutputArguments,
  host: VersionReportHost,
  stdoutIsTerminal: boolean,
): string | undefined => {
  return format === undefined
    ? undefined
    : renderCliDocument(versionReport(host), format, stdoutIsTerminal);
};
