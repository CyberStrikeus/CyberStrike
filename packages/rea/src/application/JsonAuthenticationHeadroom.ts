import { jsonStringCodeUnits } from "../domain/jsonSerialization.js";
import { getHeapStatistics } from "node:v8";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";

/** Authentication clones parsed JSON and hashes its canonical commitment. */
const AUTHENTICATION_COPIES = 2;

/** Parsed working copies and conservative UTF-16 storage for escaped JSON. */
const estimateJsonStorage = (
  value: unknown,
): { valueBytes: number; serializedUtf16Bytes: number } => {
  let valueBytes = 0;
  let serializedCharacters = 0;
  const stack: Iterator<unknown>[] = [[value][Symbol.iterator]()];
  while (stack.length > 0) {
    const next = stack[stack.length - 1]!.next();
    if (next.done) {
      stack.pop();
      continue;
    }
    const item = next.value;
    if (typeof item === "string") {
      valueBytes += 64 + item.length * 2;
      serializedCharacters += jsonStringCodeUnits(item);
    } else if (Array.isArray(item)) {
      valueBytes += 128 + item.length * 16;
      serializedCharacters += 2 + Math.max(0, item.length - 1);
      stack.push(item.values());
    } else if (typeof item === "object" && item !== null) {
      valueBytes += 128;
      serializedCharacters += 2;
      stack.push(
        (function* () {
          let count = 0;
          for (const key in item) {
            if (!Object.hasOwn(item, key)) continue;
            valueBytes += 64 + key.length * 2;
            serializedCharacters +=
              jsonStringCodeUnits(key) + 1 + (count++ === 0 ? 0 : 1);
            yield (item as Record<string, unknown>)[key];
          }
        })(),
      );
    } else {
      valueBytes += 16;
      serializedCharacters +=
        typeof item === "number"
          ? String(item).length
          : item === true
            ? 4
            : item === false
              ? 5
              : 4;
    }
  }
  return { valueBytes, serializedUtf16Bytes: serializedCharacters * 2 };
};

/** Refuse before authentication when live heap headroom cannot hold its validation and commitment working copies. */
export const requireAuthenticationHeadroom = (
  value: unknown,
  options: {
    readonly operation: string;
    readonly path: string;
    readonly description: string;
    readonly availableBytes?: number;
  },
): Result<void, AnalysisResourceConstraintError> => {
  const availableBytes =
    options.availableBytes ?? getHeapStatistics().total_available_size;
  const { valueBytes, serializedUtf16Bytes } = estimateJsonStorage(value);
  // Canonical hashing and manifest normalization can still encode scalars or
  // metadata; account for their escaped representations before allocating them.
  const requiredBytes =
    (valueBytes + serializedUtf16Bytes) * AUTHENTICATION_COPIES;
  if (requiredBytes <= availableBytes) return ok(undefined);
  return err(
    new AnalysisResourceConstraintError(
      options.operation,
      "memory",
      options.description,
      {
        input_path: options.path,
        projected_value_bytes: valueBytes,
        serialized_json_utf16_bytes: serializedUtf16Bytes,
        authentication_bytes: requiredBytes,
        available_heap_bytes: availableBytes,
      },
    ),
  );
};
