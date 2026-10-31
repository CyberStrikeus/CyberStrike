import type { Writable } from "node:stream";

import { bufferedJsonParts, jsonParts } from "../domain/jsonSerialization.js";

type JsonOutputFormat = "json" | "jsonl";

/**
 * Write ordinary JSON without constructing a document-sized string.
 *
 * `json` is indented for a terminal reader. Piped or redirected output, which
 * agents and scripts consume, is compact: indentation adds no information and
 * measured 16-45% more model tokens on real results. The value is identical.
 */
export const writeJsonOutput = async (
  value: unknown,
  destination: Writable,
  format: JsonOutputFormat = "json",
): Promise<void> => {
  await writeOutputParts(
    destination,
    jsonOutputParts(value, format, isTerminalOutput(destination)),
  );
};

/** Share bounded writes and destination ownership across structured formats. */
export const writeOutputParts = async (
  destination: Writable,
  parts: Iterable<string>,
): Promise<void> => {
  for (const part of bufferedJsonParts(parts))
    await writeOutputText(destination, part);
};

export const isTerminalOutput = (destination: Writable): boolean =>
  "isTTY" in destination && destination.isTTY === true;

export const writeOutputText = (
  destination: Writable,
  part: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = (cause: unknown): void => reject(cause);
    destination.once("error", onError);
    try {
      destination.write(part, (cause) => {
        if (cause) {
          // A Writable can emit its error after invoking the write callback.
          setImmediate(() => destination.off("error", onError));
          reject(cause);
        } else {
          destination.off("error", onError);
          resolve();
        }
      });
    } catch (cause: unknown) {
      destination.off("error", onError);
      reject(cause);
    }
  });

/** The exact formatted document, including its final newline. */
export function* jsonOutputParts(
  value: unknown,
  format: JsonOutputFormat,
  pretty = true,
): Generator<string> {
  if (format === "jsonl" && Array.isArray(value)) {
    for (const item of value) {
      yield* jsonParts(item);
      yield "\n";
    }
    return;
  }
  yield* jsonParts(value, pretty && format === "json");
  yield "\n";
}
