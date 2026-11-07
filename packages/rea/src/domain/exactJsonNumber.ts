import { isSafeNumber } from "lossless-json";
import { jsonValueSchema, type JsonValue } from "./jsonValue.js";
import { safeParseJson } from "./safeJson.js";

/**
 * Whether native JSON conversion and serialization preserve the recorded number. Both the recorded
 * spelling and the one serialization writes must be safe, so `1e20` and `100000000000000000000`
 * are judged alike and anything accepted is accepted again once written back.
 */
export const isExactJsonNumber = (
  value: number,
  source: string | undefined,
): boolean =>
  source !== undefined &&
  isSafeNumber(source) &&
  isSafeNumber(String(value)) &&
  !Object.is(value, -0);

/** Parse JSON text whose every number survives native conversion exactly; undefined otherwise. */
export const parseExactJson = (text: string): JsonValue | undefined => {
  const parsed = safeParseJson(text, (_key, value, context) => {
    // The native parser supplies each primitive's original spelling. Share
    // HAR's exact-number policy rather than accepting an already-rounded ID.
    if (typeof value === "number" && !isExactJsonNumber(value, context?.source))
      throw new RangeError("JSON numeric conversion would lose recorded data");
    return value;
  });
  if (!parsed.ok) return undefined;
  const value = jsonValueSchema.safeParse(parsed.value);
  return value.success ? value.data : undefined;
};
