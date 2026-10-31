import { constants } from "node:buffer";
import type { Writable } from "node:stream";

import { Filter } from "incur";
import { estimateTokenCount } from "tokenx";

import { analysisErrorProjectionSchema } from "../contracts/errorSchemas.js";
import type { ParsedCliOutputArguments } from "../cliOutput.js";
import {
  normalizeCliArguments,
  splitIncurBuiltinArguments,
} from "../cliBuiltinArguments.js";
import {
  cliOperationFailureIdentity,
  cliOperationFailurePayload,
} from "../cliLogging.js";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import { sliceTextByTokenWindow } from "./tokenWindow.js";
import {
  projectAnalysisError,
  type AnalysisErrorProjection,
} from "../domain/analysisErrorProjection.js";
import {
  formatDelimitedOutputParts,
  formatCliOutput,
  prepareDelimitedOutput,
  delimitedOutputInputError,
  containsUnpairedSurrogate,
  containsUnrepresentableMarkdown,
  hasUnpairedSurrogate,
} from "./cliOutputFormatter.js";
import {
  cliEvidencePublicationReceipt,
  retainCliPublicationOnError,
  withCliEvidencePublication,
} from "./cliEvidencePublication.js";
import { jsonLinesErrorRecord } from "./jsonLines.js";
import { writeCliJsonLines } from "./jsonLinesOutput.js";
import {
  jsonOutputParts,
  isTerminalOutput,
  writeJsonOutput,
  writeOutputParts,
  writeOutputText,
} from "./jsonOutput.js";
import type { CliInstance } from "./types.js";
import {
  visitRegisteredCommands,
  type RegisteredCommand,
} from "./visitRegisteredCommands.js";

/** Result metadata supplied by the command that actually ran. */
export interface CliResultOutputMetadata {
  readonly command: string;
  readonly duration: string;
  readonly format: string;
  readonly renderOutput?: boolean;
}

/** Optional executable-owned result surface for one CLI invocation. */
export interface CliResultOutput {
  readonly handled: boolean;
  readonly failed: boolean;
  readonly error: AnalysisErrorProjection | undefined;
  /** Start another completed invocation on a reusable command registry. */
  begin(options: ParsedCliOutputArguments): void;
  /** Preserve caller output controls while adapting SDK builtin flags. */
  sdkArguments(args: readonly string[]): string[];
  /** SDK generators retain their own streaming event protocol. */
  delegateStreaming(): void;
  /** Retain one-shot SDK output until the SDK supplies its authoritative status. */
  captureSdkOutput(text: string): boolean;
  finishSdkOutput(exitCode: number): Promise<void>;
  write(value: unknown, metadata: CliResultOutputMetadata): Promise<boolean>;
  /** Recover only before any delegated stdout has been written. */
  recoverFormattingFailure(cause: unknown): Promise<boolean>;
}

/** Install formatting once, after registration, for every ordinary CLI result. */
export const streamCliCommandResults = (
  cli: CliInstance,
  output: CliResultOutput,
): void => {
  visitRegisteredCommands(cli, (command, path, inheritedPolicy) =>
    wrapCommand(command, path, output, inheritedPolicy),
  );
  const serve = cli.serve.bind(cli);
  cli.serve = (args = process.argv.slice(2), serveOptions) =>
    serve(output.sdkArguments(args), serveOptions);
};

const wrapCommand = (
  command: Pick<RegisteredCommand, "run">,
  name: string,
  output: CliResultOutput,
  inheritedPolicy?: "all" | "agent-only",
): void => {
  const run = command.run;
  command.run = (context) =>
    withCliEvidencePublication(() => {
      const started = performance.now();
      const result: unknown = run(context);
      // Generator results and Incur's sentinel responses retain their own protocol.
      if (
        typeof result === "object" &&
        result !== null &&
        Symbol.asyncIterator in result
      ) {
        output.delegateStreaming();
        return result;
      }
      return Promise.resolve(result).then(async (value: unknown) => {
        if (
          typeof value === "object" &&
          value !== null &&
          Symbol.for("incur.sentinel") in value
        )
          return value;
        if (
          !(await output.write(value, {
            command: name,
            format: context.format,
            renderOutput: context.agent || inheritedPolicy !== "agent-only",
            duration: `${Math.round(performance.now() - started)}ms`,
          }))
        )
          return value;
        if (output.error !== undefined)
          return context.error({
            code: output.error.code,
            message: output.error.message,
          });
        return undefined;
      });
    });
};

/** Preserve Incur output controls and stream JSON while framing failures. */
export const createCliResultOutput = (
  initialOptions: ParsedCliOutputArguments,
  destination: Writable,
): CliResultOutput | undefined => {
  let options = initialOptions;
  if (!options.validation.ok) return undefined;
  let format = options.format as
    | "json"
    | "jsonl"
    | "yaml"
    | "toon"
    | "md"
    | "csv"
    | "tsv";
  let handled = false;
  let failed = false;
  let error: AnalysisErrorProjection | undefined;
  let streaming = false;
  let sdkDocumentControls = false;
  const sdkParts: string[] = [];
  let sdkCompletion: Promise<void> | undefined;
  let completed:
    | {
        readonly metadata: CliResultOutputMetadata;
        readonly receipt: ReturnType<typeof cliEvidencePublicationReceipt>;
        readonly originalFailure: ReturnType<
          typeof cliOperationFailureIdentity
        >;
      }
    | undefined;
  const recoverFormattingFailure = async (cause: unknown): Promise<boolean> => {
    // A rejected command never reaches write(). Destination failures retain
    // handled ownership. Only a completed, unwritten result can be replaced.
    if (
      completed === undefined ||
      handled ||
      !(cause instanceof RangeError) ||
      cause.message !== "Invalid string length"
    )
      return false;
    const { originalFailure } = completed;
    error = projectAnalysisError(
      retainCliPublicationOnError(
        new AnalysisResourceConstraintError(
          completed.metadata.command,
          "memory",
          `The ${format} result could not fit in a runtime string. The original result was not written.`,
          {
            format,
            formatted_characters: null,
            max_string_characters: constants.MAX_STRING_LENGTH,
            ...(originalFailure === undefined
              ? {}
              : { original_failure: originalFailure }),
          },
          {
            cause,
            retryable: false,
            remediationAction:
              "Use --format json to stream the complete result, or narrow it with --filter-output. Token limits are applied after formatting and cannot avoid this constraint.",
          },
        ),
        completed.receipt,
      ),
    );
    const document = options.fullOutput
      ? {
          ok: false,
          error,
          meta: {
            command: completed.metadata.command,
            duration: completed.metadata.duration,
          },
        }
      : error;
    // Recovery must remain actionable even when a token window/count was
    // requested. Do not apply those controls to this small typed failure.
    const recoveryFormat =
      format === "csv" || format === "tsv" ? "json" : format;
    const text = formatCliOutput(
      format === "jsonl" ? jsonLinesErrorRecord(document) : document,
      recoveryFormat,
    );
    handled = true;
    try {
      await writeOutputText(destination, `${text}\n`);
    } catch (writeFailure: unknown) {
      failed = true;
      throw writeFailure;
    }
    return true;
  };
  const write = async (
    value: unknown,
    metadata: CliResultOutputMetadata,
  ): Promise<boolean> => {
    completed = undefined;
    if (
      metadata.format !== format &&
      !((format === "csv" || format === "tsv") && metadata.format === "json")
    )
      return false;
    try {
      return await writeResult(value, metadata);
    } catch (cause: unknown) {
      if (await recoverFormattingFailure(cause)) return true;
      throw cause;
    }
  };
  return {
    get handled() {
      return handled;
    },
    get failed() {
      return failed;
    },
    get error() {
      return error;
    },
    begin(nextOptions) {
      options = nextOptions;
      format = options.format as typeof format;
      handled = false;
      failed = false;
      error = undefined;
      completed = undefined;
      streaming = false;
      sdkDocumentControls = false;
      sdkParts.length = 0;
      sdkCompletion = undefined;
    },
    sdkArguments(args) {
      const normalized = normalizeCliArguments(args);
      const split = splitIncurBuiltinArguments(normalized);
      const values = new Set(split.outputValues.map(({ index }) => index));
      const hasFlag = (flag: string) =>
        normalized.some((token, index) => token === flag && !values.has(index));
      // Incur emits these documents outside command result handlers. Manifest
      // flags precede help; schema follows help and version in its dispatcher.
      sdkDocumentControls =
        (options.tokenCount || options.tokenWindow) &&
        (hasFlag("--llms") ||
          hasFlag("--llms-full") ||
          (hasFlag("--schema") &&
            !["completions", "mcp", "skills"].includes(
              split.command[0] ?? "",
            ) &&
            !hasFlag("--help") &&
            !hasFlag("-h") &&
            !hasFlag("--version")));
      // The caller's parsed controls remain authoritative: the CLI may adapt
      // CSV/TSV to JSON for Incur without changing the requested presentation.
      if (format !== "jsonl" || !options.tokenCount) return normalized;
      // Incur counts errors before REA can retain their diagnostic payload.
      // Preserve operands using the shared builtin consumption rules.
      return normalized.filter(
        (token, index) => token !== "--token-count" || values.has(index),
      );
    },
    delegateStreaming() {
      streaming = true;
    },
    captureSdkOutput(text) {
      if ((format !== "jsonl" && !sdkDocumentControls) || streaming || handled)
        return false;
      // Incur already materializes one-shot documents. Retain references only;
      // generator events bypass this buffer and remain incremental.
      if (text.length > 0) sdkParts.push(text);
      return true;
    },
    finishSdkOutput(exitCode) {
      return (sdkCompletion ??= (async () => {
        const parts = sdkParts.splice(0);
        try {
          if (parts.length === 0) {
            // SDK writes outside the JSONL buffer still share this destination.
            // A write callback runs after earlier queued writes have completed,
            // so the launcher's explicit exit cannot discard a pending pipe tail.
            await writeOutputText(destination, "");
            return;
          }
          if (exitCode === 0) {
            if (options.tokenCount)
              await writeOutputText(
                destination,
                `${estimateTokenCount(parts.join(""))}\n`,
              );
            else if (sdkDocumentControls && options.tokenWindow) {
              const text = parts.join("");
              const window = sliceTextByTokenWindow(
                text,
                options.tokenOffset ?? 0,
                options.tokenLimit,
              );
              await writeOutputText(
                destination,
                window.truncated
                  ? `${window.text}\n[truncated: showing tokens ${window.start}–${window.end} of ${window.total}]\n`
                  : text,
              );
            } else
              for (const part of parts)
                await writeOutputText(destination, part);
          } else {
            const text = parts.join("");
            if (format !== "jsonl") {
              await writeOutputText(destination, text);
              return;
            }
            let result: unknown = text;
            try {
              result = JSON.parse(text);
            } catch {
              /* Preserve non-JSON SDK diagnostics verbatim. */
            }
            await writeJsonOutput(
              jsonLinesErrorRecord(result),
              destination,
              "jsonl",
            );
          }
        } catch (cause: unknown) {
          handled = true;
          failed = true;
          throw cause;
        }
      })());
    },
    write,
    recoverFormattingFailure,
  };

  async function writeResult(
    value: unknown,
    metadata: CliResultOutputMetadata,
  ): Promise<boolean> {
    completed = {
      metadata,
      receipt: cliEvidencePublicationReceipt(),
      originalFailure: cliOperationFailureIdentity(value),
    };
    const filterPaths = options.filterOutput
      ? Filter.parse(options.filterOutput)
      : undefined;
    const operationFailure =
      format === "jsonl" || options.fullOutput || filterPaths !== undefined
        ? cliOperationFailurePayload(value)
        : undefined;
    const failure = options.fullOutput ? operationFailure : undefined;
    const ownsFilteredOutput =
      operationFailure === undefined &&
      filterPaths !== undefined &&
      filterPaths.length > 0;
    // Incur owns suppressed human presentation, but a filter must never erase
    // the typed failure that this boundary already owns.
    if (
      operationFailure === undefined &&
      metadata.renderOutput === false &&
      format !== "jsonl" &&
      !options.fullOutput &&
      !options.tokenCount
    )
      return false;
    if (format === "csv" || format === "tsv") {
      const meta = {
        command: metadata.command,
        duration: metadata.duration,
      };
      if (operationFailure !== undefined) {
        const parsedFailure =
          analysisErrorProjectionSchema.safeParse(operationFailure);
        error = parsedFailure.success
          ? parsedFailure.data
          : projectAnalysisError(
              delimitedOutputInputError(
                ["--format"],
                "CSV/TSV output was not produced because the command did not return a successful row collection.",
                metadata.command,
              ),
            );
        handled = true;
        try {
          await writeJsonOutput(
            options.fullOutput
              ? { ok: false, error: operationFailure, meta }
              : operationFailure,
            destination,
          );
        } catch (cause: unknown) {
          failed = true;
          throw cause;
        }
        return true;
      }
      const selection = resolveDelimitedRows(
        value,
        filterPaths,
        metadata.command,
      );
      const prepared = selection.ok
        ? prepareDelimitedOutput(selection.value.rows, format, {
            fields: options.columns ?? [],
            metadata: delimitedMetadata(selection.value, format, metadata),
          })
        : selection;
      if (!prepared.ok) {
        error = projectAnalysisError(
          retainCliPublicationOnError(prepared.error),
        );
        handled = true;
        try {
          await writeJsonOutput(
            options.fullOutput ? { ok: false, error, meta } : error,
            destination,
          );
        } catch (writeFailure: unknown) {
          failed = true;
          throw writeFailure;
        }
      } else {
        handled = true;
        try {
          await writeOutputParts(
            destination,
            formatDelimitedOutputParts(prepared.value),
          );
        } catch (cause: unknown) {
          failed = true;
          throw cause;
        }
      }
      return true;
    }
    const selection =
      operationFailure !== undefined || filterPaths === undefined
        ? ok(operationFailure ?? value)
        : applyCliOutputFilter(value, filterPaths);
    if (!selection.ok) {
      error = projectAnalysisError(
        retainCliPublicationOnError(
          new AnalysisInputError(
            metadata.command,
            {
              userMessage: selection.error,
              remediationAction:
                "Select array indices with slices, or request array properties in a separate --filter-output invocation.",
            },
            [
              {
                path: ["filter-output"],
                reason: "invalid_value",
                message: selection.error,
              },
            ],
          ),
        ),
      );
      const document = options.fullOutput
        ? {
            ok: false,
            error,
            meta: { command: metadata.command, duration: metadata.duration },
          }
        : error;
      handled = true;
      await writeOutputText(
        destination,
        `${formatCliOutput(format === "jsonl" ? jsonLinesErrorRecord(document) : document, format)}\n`,
      );
      return true;
    }
    const selected = selection.value;
    const refuseUnrepresentableText = async (): Promise<true> => {
      error = projectAnalysisError(
        new AnalysisInputError(
          metadata.command,
          {
            userMessage:
              format === "md"
                ? "Markdown cannot preserve NUL or unpaired UTF-16 surrogates in rendered output."
                : "TOON cannot preserve unpaired UTF-16 surrogates in UTF-8 output.",
            remediationAction:
              "Use --format json or --format yaml to retain the exact code units.",
            ...(completed?.originalFailure === undefined
              ? {}
              : {
                  diagnostics: { original_failure: completed.originalFailure },
                }),
          },
          [
            {
              path: ["--format"],
              reason: "invalid_value",
              message: "The selected format cannot preserve this value.",
            },
          ],
        ),
      );
      const document = options.fullOutput
        ? {
            ok: false,
            error,
            meta: { command: metadata.command, duration: metadata.duration },
          }
        : error;
      handled = true;
      try {
        await writeOutputText(
          destination,
          `${formatCliOutput(document, format)}\n`,
        );
      } catch (cause: unknown) {
        failed = true;
        throw cause;
      }
      return true;
    };
    if (
      (format === "toon" || format === "md") &&
      !options.tokenCount &&
      (!options.tokenWindow ||
        format === "md" ||
        operationFailure !== undefined) &&
      (format === "md"
        ? containsUnrepresentableMarkdown(selected)
        : containsUnpairedSurrogate(selected))
    )
      return refuseUnrepresentableText();
    const filtered =
      (format === "json" || format === "jsonl") &&
      ownsFilteredOutput &&
      Array.isArray(selected)
        ? normalizeJsonArrayValues(selected)
        : selected;
    const ownsSuccessfulTokenWindow =
      operationFailure === undefined &&
      options.tokenWindow &&
      !options.tokenCount &&
      format !== "json" &&
      format !== "jsonl";
    // Delegate other human formats to Incur. Markdown stays here so admission
    // and emitted table text use the same safe formatter.
    if (
      format !== "md" &&
      format !== "json" &&
      format !== "jsonl" &&
      operationFailure === undefined &&
      !ownsFilteredOutput &&
      !ownsSuccessfulTokenWindow
    )
      return false;
    if (format === "jsonl") {
      handled = true;
      try {
        error = await writeCliJsonLines(
          {
            ...options,
            source: value,
            selected: filtered,
            filterPaths,
            operationFailure,
            command: metadata.command,
            duration: metadata.duration,
          },
          destination,
        );
      } catch (cause: unknown) {
        failed = true;
        throw cause;
      }
      return true;
    }
    const meta = {
      command: metadata.command,
      duration: metadata.duration,
    };
    const errorDocument =
      options.fullOutput && failure !== undefined
        ? fullFailureEnvelope(
            failure,
            meta,
            format,
            options.tokenLimit,
            options.tokenOffset,
          )
        : undefined;
    const document = options.fullOutput
      ? failure !== undefined
        ? errorDocument
        : filtered === undefined
          ? { ok: true, meta }
          : { ok: true, data: filtered, meta }
      : // A selected null is a value; only a selection with no JSON value
        // falls back to the empty document.
        filtered === undefined ||
          typeof filtered === "function" ||
          typeof filtered === "symbol"
        ? {}
        : filtered;
    if (options.tokenCount) {
      // Incur/tokenx materialize JSON. Measure its UTF-16 expansion before
      // allowing that allocation, independently of UTF-8 bytes. Other formats
      // retain Incur's materializing behavior.
      const tokenValue = document;
      let characters = 0;
      if (
        tokenValue !== undefined &&
        tokenValue !== null &&
        typeof tokenValue !== "function" &&
        typeof tokenValue !== "symbol"
      ) {
        if (format === "json") {
          for (const part of jsonOutputParts(
            tokenValue,
            format,
            isTerminalOutput(destination),
          ))
            characters += part.length;
        }
      }
      if (characters <= constants.MAX_STRING_LENGTH) {
        let formatted: string;
        if (format === "json") {
          // Reuse the writer's exact representation after its capacity admission.
          // tokenx requires one string; retain only this bounded formatted value.
          formatted = "";
          for (const part of jsonOutputParts(
            tokenValue,
            format,
            isTerminalOutput(destination),
          ))
            formatted += part;
        } else formatted = formatCliOutput(tokenValue, format);
        const count = estimateTokenCount(formatted);
        handled = true;
        try {
          await writeOutputText(destination, `${count}\n`);
          return true;
        } catch (cause: unknown) {
          failed = true;
          throw cause;
        }
      }
      error = projectAnalysisError(
        retainCliPublicationOnError(
          new AnalysisResourceConstraintError(
            metadata.command,
            "memory",
            "Token counting requires a formatted string larger than the runtime permits.",
            {
              formatted_characters: characters,
              max_string_characters: constants.MAX_STRING_LENGTH,
            },
            {
              remediationAction:
                "Remove --token-count to stream the complete JSON result, or narrow it with --filter-output.",
            },
          ),
        ),
      );
    }
    if (ownsSuccessfulTokenWindow) {
      // Ordinary Markdown windows share rendering/counting's document, including
      // its missing-selection fallback. Full output windows budget the data
      // separately from their envelope and retain that policy.
      const formatted = formatCliOutput(
        format === "md" && !options.fullOutput ? document : filtered,
        format,
      );
      const window = sliceTextByTokenWindow(
        formatted,
        options.tokenOffset ?? 0,
        options.tokenLimit,
      );
      // Keep Incur's empty human/agent presentation semantics. Nonempty text
      // already belongs to this formatter, even when the whole result fits.
      if (!window.truncated && !options.fullOutput && formatted === "")
        return false;

      const sliced = window.truncated
        ? `${window.text}\n[truncated: showing tokens ${window.start}–${window.end} of ${window.total}]`
        : formatted;
      const outputDocument = options.fullOutput
        ? formatCliOutput(
            window.truncated
              ? {
                  ok: true,
                  data: sliced,
                  meta: {
                    command: metadata.command,
                    duration: metadata.duration,
                    ...(window.end < window.total
                      ? { nextOffset: window.end }
                      : {}),
                  },
                }
              : { ok: true, data: filtered, meta },
            format,
          )
        : sliced;
      if (format === "toon" && hasUnpairedSurrogate(outputDocument))
        return refuseUnrepresentableText();
      handled = true;
      try {
        await writeOutputText(
          destination,
          outputDocument.endsWith("\n")
            ? outputDocument
            : `${outputDocument}\n`,
        );
      } catch (cause: unknown) {
        failed = true;
        throw cause;
      }
      return true;
    }
    // Once writing starts, a failed destination must not receive a second
    // document from Incur's error formatter.
    const formattedText =
      format === "md" ||
      ((operationFailure !== undefined || ownsFilteredOutput) &&
        format !== "json")
        ? formatCliOutput(document, format)
        : undefined;
    if (
      format === "md" &&
      formattedText === "" &&
      !options.fullOutput &&
      !ownsFilteredOutput &&
      operationFailure === undefined
    )
      return false;
    handled = true;
    try {
      if (formattedText !== undefined) {
        // Incur's error sentinel only carries code/message/retryable. Render
        // the owned projection or caller-visible failure at this boundary.
        await writeOutputText(destination, `${formattedText}\n`);
      } else {
        await writeJsonOutput(
          error === undefined
            ? document
            : options.fullOutput
              ? { ok: false, error, meta }
              : error,
          destination,
          format as "json" | "jsonl",
        );
      }
    } catch (cause: unknown) {
      failed = true;
      throw cause;
    }
    return true;
  }
};

const fullFailureEnvelope = (
  failure: unknown,
  meta: Readonly<Record<string, unknown>>,
  format: "json" | "jsonl" | "yaml" | "toon" | "md",
  tokenLimit: number | undefined,
  tokenOffset: number | undefined,
): Readonly<Record<string, unknown>> => {
  if (tokenLimit === undefined && tokenOffset === undefined)
    return { ok: false, error: failure, meta };
  const formatted = formatCliOutput(failure, format);
  const offset = tokenOffset ?? 0;
  const window = sliceTextByTokenWindow(formatted, offset, tokenLimit);
  if (!window.truncated) return { ok: false, error: failure, meta };
  const nextOffset = window.end < window.total ? window.end : undefined;
  return {
    ok: false,
    error: `${window.text}\n[truncated: showing tokens ${window.start}–${window.end} of ${window.total}]`,
    meta: { ...meta, ...(nextOffset === undefined ? {} : { nextOffset }) },
  };
};

type FilterPaths = ReturnType<typeof Filter.parse>;
type FilterPath = FilterPaths[number];

interface DelimitedRowsSelection {
  readonly rows: readonly unknown[];
  readonly path: readonly string[];
  readonly ancestors: readonly Readonly<Record<string, unknown>>[];
}

const resolveDelimitedRows = (
  source: unknown,
  paths: FilterPaths | undefined,
  operation: string,
): Result<DelimitedRowsSelection, AnalysisInputError> => {
  const invalidSelection = (): Result<never, AnalysisInputError> =>
    err(
      delimitedOutputInputError(
        ["--filter-output"],
        "--filter-output must select exactly one row-array path using object-field segments only.",
        operation,
      ),
    );
  if (paths === undefined || paths.length !== 1) return invalidSelection();
  const path: string[] = [];
  for (const segment of paths[0] ?? []) {
    if (!("key" in segment)) return invalidSelection();
    path.push(segment.key);
  }
  if (path.length === 0) return invalidSelection();
  let current: unknown = source;
  const ancestors: Readonly<Record<string, unknown>>[] = [];
  for (const key of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !Object.hasOwn(current, key)
    )
      return invalidSelection();
    const owner = current as Readonly<Record<string, unknown>>;
    ancestors.push(owner);
    current = owner[key];
  }
  return Array.isArray(current)
    ? ok({ rows: current, path, ancestors })
    : invalidSelection();
};

const delimitedMetadata = (
  selection: DelimitedRowsSelection,
  format: "csv" | "tsv",
  metadata: CliResultOutputMetadata,
): Readonly<Record<string, unknown>> => {
  const valueFromOwner = (
    key: string,
  ): { readonly found: boolean; readonly value: unknown } => {
    for (let index = selection.ancestors.length - 1; index >= 0; index -= 1) {
      const owner = selection.ancestors[index]!;
      if (Object.hasOwn(owner, key)) return { found: true, value: owner[key] };
    }
    return { found: false, value: undefined };
  };
  const projectOwnFields = (
    keys: readonly string[],
  ): Readonly<Record<string, unknown>> =>
    Object.fromEntries(
      keys.flatMap((key) => {
        const found = valueFromOwner(key);
        return found.found ? [[key, found.value]] : [];
      }),
    );
  const metadataValue = (key: string): unknown => valueFromOwner(key).value;
  return {
    version: 1,
    format,
    command: metadata.command,
    duration: metadata.duration,
    selected_path: selection.path,
    coverage: metadataValue("coverage") ?? null,
    source_coverage: metadataValue("source_coverage") ?? null,
    source_complete: metadataValue("source_complete") ?? null,
    view: metadataValue("view") ?? null,
    limitations: metadataValue("limitations") ?? null,
    unknowns: metadataValue("unknowns") ?? null,
    provenance: projectOwnFields([
      "parent_evidence_id",
      "parent_operation",
      "parent_digest",
      "inventory_evidence_ids",
    ]),
    pagination: projectOwnFields([
      "offset",
      "limit",
      "total",
      "next_offset",
      "truncated",
      "pagination",
    ]),
  };
};

/** Apply Incur's parsed path grammar while merging sibling array selections. */
type FilterProjection = Result<unknown, string>;

const applyCliOutputFilter = (
  value: unknown,
  paths: FilterPaths,
): FilterProjection => {
  if (paths.length === 0) return ok(value);
  if (Array.isArray(value)) {
    if (paths.some((path) => path[0] !== undefined && "start" in path[0]))
      return projectArraySlices(
        value,
        paths.flatMap((path) => {
          const first = path[0];
          if (first === undefined || "start" in first) return [path];
          // Root keys retain Incur's implicit per-record traversal, including
          // numeric keys. Only nested array keys address array positions.
          return expandImplicitArrayPath(value, path);
        }),
      );
    const selected: unknown[] = [];
    for (const item of value) {
      const projection = applyCliOutputFilter(item, paths);
      if (!projection.ok) return projection;
      selected.push(projection.value);
    }
    return ok(selected);
  }
  if (
    paths.length === 1 &&
    paths[0]?.length === 1 &&
    paths[0][0] !== undefined &&
    "key" in paths[0][0]
  ) {
    const key = paths[0][0].key;
    if (
      typeof value !== "object" ||
      value === null ||
      !Object.hasOwn(value, key)
    )
      return ok(undefined);
    const selected = (value as Record<string, unknown>)[key];
    return ok(
      typeof selected !== "object" || selected === null
        ? selected
        : { [key]: selected },
    );
  }
  return projectObjectPaths(value, paths);
};

/** Preserve implicit traversal through every root-array layer before merging slices. */
const expandImplicitArrayPath = (
  value: unknown,
  path: FilterPath,
): FilterPaths => {
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      expandImplicitArrayPath(item, path).map((tail) => [
        { start: index, end: index + 1 },
        ...tail,
      ]),
    );
  const first = path[0];
  return typeof value === "object" &&
    value !== null &&
    first !== undefined &&
    "key" in first &&
    Object.hasOwn(value, first.key)
    ? [path]
    : [];
};

/** Build a fresh object projection; a path ending at a key selects its subtree. */
const projectObjectPaths = (
  value: unknown,
  paths: FilterPaths,
): FilterProjection => {
  if (typeof value !== "object" || value === null) return ok({});
  const byKey = new Map<string, FilterPath[]>();
  for (const path of paths) {
    const [segment, ...tail] = path;
    if (segment === undefined || !("key" in segment)) continue;
    const siblings = byKey.get(segment.key) ?? [];
    siblings.push(tail);
    byKey.set(segment.key, siblings);
  }
  const result = new Map<string, unknown>();
  for (const key of [...byKey.keys()].sort()) {
    const siblings = byKey.get(key)!;
    if (!Object.hasOwn(value, key)) continue;
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) continue;
    if (siblings.some((path) => path.length === 0)) {
      result.set(key, child);
      continue;
    }
    const projection = projectChildPaths(child, siblings);
    if (!projection.ok) return projection;
    if (projection.value !== undefined) result.set(key, projection.value);
  }
  return ok(Object.fromEntries(result));
};

/** Keep key-only array projections compatible; mixed projections use source indices. */
const projectChildPaths = (
  value: unknown,
  paths: FilterPaths,
): FilterProjection => {
  if (typeof value !== "object" || value === null) return ok(undefined);
  return Array.isArray(value) &&
    paths.some((path) => path[0] !== undefined && "start" in path[0])
    ? projectArraySlices(value, paths)
    : projectObjectPaths(value, paths);
};

/** Union sliced rows and explicit array indices, then emit them in source order. */
const projectArraySlices = (
  source: readonly unknown[],
  paths: readonly FilterPath[],
): FilterProjection => {
  const selected = new Map<number, FilterPath[]>();
  const select = (index: number, tail: FilterPath): void => {
    const siblings = selected.get(index) ?? [];
    siblings.push(tail);
    selected.set(index, siblings);
  };
  for (const path of paths) {
    const [segment, ...tail] = path;
    if (segment === undefined) continue;
    if ("key" in segment) {
      // Canonical own array indices share the same identity as slice positions.
      // Missing properties contribute nothing, as in key-only projections.
      if (!Object.hasOwn(source, segment.key)) continue;
      const index = Number(segment.key);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= 0xffff_ffff ||
        String(index) !== segment.key
      )
        return err(
          `The --filter-output selection mixes array slices with the non-index property ${JSON.stringify(segment.key)}. These selections cannot share an array result.`,
        );
      select(index, tail);
      continue;
    }
    const start = normalizeSliceIndex(segment.start, source.length);
    const end = normalizeSliceIndex(segment.end, source.length);
    for (let index = start; index < end; index += 1) select(index, tail);
  }
  const result: unknown[] = [];
  for (const index of [...selected.keys()].sort(
    (left, right) => left - right,
  )) {
    const siblings = selected.get(index)!;
    const item = source[index];
    if (siblings.some((path) => path.length === 0)) {
      result.push(item === undefined ? null : item);
      continue;
    }
    const projection = projectChildPaths(item, siblings);
    if (!projection.ok) return projection;
    // Slices have historically retained selected scalar rows as empty objects.
    result.push(projection.value ?? {});
  }
  return ok(result);
};

const normalizeSliceIndex = (index: number, length: number): number => {
  const integer = Number.isNaN(index) ? 0 : Math.trunc(index);
  return integer < 0
    ? Math.max(length + integer, 0)
    : Math.min(integer, length);
};

/**
 * The streaming JSON writer requires JSON values in arrays. Copy only array
 * branches that need normalization so a parent selection never mutates its
 * source value.
 */
const normalizeJsonArrayValues = (source: unknown[]): unknown[] => {
  let result: unknown[] | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const value: unknown = source[index];
    const normalized =
      value === undefined ||
      typeof value === "function" ||
      typeof value === "symbol"
        ? null
        : Array.isArray(value)
          ? normalizeJsonArrayValues(value)
          : value;
    if (normalized !== value) {
      result ??= source.slice();
      result[index] = normalized;
    }
  }
  return result ?? source;
};
