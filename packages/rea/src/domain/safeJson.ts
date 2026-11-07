/** JSON parsing without throws at an input boundary. */
export type SafeJsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string; readonly cause: unknown };

/** Decode complete UTF-8 JSON without replacing malformed bytes or stripping a BOM. */
export const safeParseUtf8Json = (bytes: Uint8Array): SafeJsonParseResult => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (cause: unknown) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
      cause,
    };
  }
  return safeParseJson(text);
};

/** Parse JSON text, returning the failure reason instead of throwing. */
export const safeParseJson = (
  value: string,
  reviver?: (
    key: string,
    value: unknown,
    context?: { readonly source?: string },
  ) => unknown,
): SafeJsonParseResult => {
  try {
    return { ok: true, value: JSON.parse(value, reviver) as unknown };
  } catch (cause: unknown) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
      cause,
    };
  }
};
