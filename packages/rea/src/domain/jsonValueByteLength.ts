import type { JsonValue } from "./jsonValue.js";
import { jsonStringByteLength } from "./jsonStringByteLength.js";

/**
 * UTF-8 JSON size of producer-owned JSON, without allocating its serialization.
 * Above budget, the result only establishes that the value exceeds that budget.
 */
export const jsonValueByteLength = (
  value: JsonValue,
  budget = Number.POSITIVE_INFINITY,
): number => {
  if (typeof value === "string") return jsonStringByteLength(value, budget);
  if (Array.isArray(value)) {
    let bytes = 2 + Math.max(0, value.length - 1);
    for (const child of value) {
      if (bytes > budget) break;
      bytes += jsonValueByteLength(child, budget - bytes);
    }
    return bytes;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    let bytes = 2 + Math.max(0, keys.length - 1);
    for (const key of keys) {
      if (bytes > budget) break;
      bytes += jsonStringByteLength(key, budget - bytes) + 1;
      if (bytes <= budget)
        bytes += jsonValueByteLength(value[key]!, budget - bytes);
    }
    return bytes;
  }
  return typeof value === "number" && !Number.isFinite(value)
    ? 4
    : String(value).length;
};
