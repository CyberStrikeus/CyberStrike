import { constants } from "node:buffer";
import type { Writable } from "node:stream";
import type { Filter } from "incur";
import { estimateTokenCount } from "tokenx";

import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import {
  projectAnalysisError,
  type AnalysisErrorProjection,
} from "../domain/analysisErrorProjection.js";
import {
  jsonLineParts,
  jsonLinesErrorRecord,
  jsonLinesParts,
  jsonLinesRecords,
  prepareJsonLines,
} from "./jsonLines.js";
import {
  writeJsonOutput,
  writeOutputParts,
  writeOutputText,
} from "./jsonOutput.js";
import { retainCliPublicationOnError } from "./cliEvidencePublication.js";

interface CliJsonLinesInput {
  readonly source: unknown;
  readonly selected: unknown;
  readonly operationFailure: unknown;
  readonly command: string;
  readonly duration: string;
  readonly fullOutput: boolean;
  readonly tokenCount: boolean;
  readonly filterOutput: string | undefined;
  readonly filterPaths: ReturnType<typeof Filter.parse> | undefined;
}

/** Render one already classified result, sharing a plan for output and counting. */
export const writeCliJsonLines = async (
  options: CliJsonLinesInput,
  destination: Writable,
): Promise<AnalysisErrorProjection | undefined> => {
  const { source, selected, operationFailure } = options;
  let error: AnalysisErrorProjection | undefined;
  const meta = { command: options.command, duration: options.duration };
  const envelope = (data: unknown) =>
    options.fullOutput ? { ok: true, data, meta } : data;
  let failureRecord =
    operationFailure === undefined
      ? undefined
      : jsonLinesErrorRecord(
          options.fullOutput
            ? { ok: false, error: operationFailure, meta }
            : operationFailure,
        );
  const plan =
    failureRecord === undefined
      ? prepareJsonLines(envelope(selected), {
          command: options.command,
          source: envelope(source),
          ...(options.filterOutput === undefined
            ? {}
            : { filter: options.filterOutput }),
          ...(options.filterPaths === undefined
            ? {}
            : { filterPaths: options.filterPaths }),
          fullOutput: options.fullOutput,
        })
      : undefined;
  if (plan?.ok === false) {
    error = projectAnalysisError(retainCliPublicationOnError(plan.error));
    failureRecord = jsonLinesErrorRecord(
      options.fullOutput ? { ok: false, error, meta } : error,
    );
  }
  if (failureRecord !== undefined) {
    await writeJsonOutput(failureRecord, destination, "jsonl");
  } else if (plan?.ok === true) {
    if (options.tokenCount) {
      let count = 0;
      for (const record of jsonLinesRecords(plan.value)) {
        let characters = 0;
        for (const part of jsonLineParts(record)) characters += part.length;
        if (characters > constants.MAX_STRING_LENGTH) {
          error = projectAnalysisError(
            retainCliPublicationOnError(
              new AnalysisResourceConstraintError(
                options.command,
                "memory",
                "A JSON Lines record exceeds the token estimator's runtime string limit.",
                {
                  formatted_characters: characters,
                  max_string_characters: constants.MAX_STRING_LENGTH,
                },
                {
                  remediationAction:
                    "Remove --token-count to stream the records, or select smaller fields with --filter-output.",
                },
              ),
            ),
          );
          break;
        }
        // Newlines split tokenx segments, so summing complete lines is
        // identical to estimating the emitted stream, with one-line memory.
        count += estimateTokenCount([...jsonLineParts(record)].join(""));
      }
      if (error !== undefined)
        await writeJsonOutput(
          jsonLinesErrorRecord(
            options.fullOutput ? { ok: false, error, meta } : error,
          ),
          destination,
          "jsonl",
        );
      else await writeOutputText(destination, `${count}\n`);
    } else await writeOutputParts(destination, jsonLinesParts(plan.value));
  }
  return error;
};
