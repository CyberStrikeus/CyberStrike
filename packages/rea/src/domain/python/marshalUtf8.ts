import { err, ok, type Result } from "../result.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface DecodedMarshalUtf8 {
  readonly text: string;
  /** UTF-16 prefix endpoint between source code points, before JS merges surrogates. */
  readonly prefixEnd: number;
}

/** This span contains valid scalars, or one separately encoded surrogate. */
const spanPrefixEnd = (text: string, limit: number): number => {
  const end = Math.min(text.length, limit);
  return end > 0 &&
    end < text.length &&
    text.charCodeAt(end - 1) >= 0xd800 &&
    text.charCodeAt(end - 1) <= 0xdbff &&
    text.charCodeAt(end) >= 0xdc00 &&
    text.charCodeAt(end) <= 0xdfff
    ? end - 1
    : end;
};

/** CPython marshal uses UTF-8 surrogatepass; all other malformed bytes fail. */
export const decodeMarshalUtf8 = (
  bytes: Buffer,
  maximumPrefixUnits = Infinity,
): Result<DecodedMarshalUtf8, { readonly kind: "invalid-marshal-utf8" }> => {
  if (
    maximumPrefixUnits !== Infinity &&
    (!Number.isSafeInteger(maximumPrefixUnits) || maximumPrefixUnits < 0)
  )
    throw new RangeError(
      "Marshal prefix limit must be a nonnegative safe integer.",
    );
  const chunks: string[] = [];
  let start = 0;
  let prefixEnd = 0;
  let prefixOpen = true;
  const append = (text: string): void => {
    if (text.length !== 0) chunks.push(text);
    if (!prefixOpen) return;
    const end = spanPrefixEnd(text, maximumPrefixUnits - prefixEnd);
    prefixEnd += end;
    prefixOpen = end === text.length && prefixEnd < maximumPrefixUnits;
  };
  try {
    for (
      let offset = bytes.indexOf(0xed);
      offset !== -1;
      offset = bytes.indexOf(0xed, offset + 1)
    ) {
      const second = bytes[offset + 1];
      const third = bytes[offset + 2];
      if (
        second === undefined ||
        second < 0xa0 ||
        second > 0xbf ||
        third === undefined ||
        third < 0x80 ||
        third > 0xbf
      )
        continue;
      // Only ED A0..BF 80..BF encodes a surrogate. The fatal decoder owns
      // every unchanged span, including incomplete scalars on either side.
      append(UTF8.decode(bytes.subarray(start, offset)));
      append(
        String.fromCharCode(0xd000 | ((second & 0x3f) << 6) | (third & 0x3f)),
      );
      start = offset + 3;
      offset += 2;
    }
    if (start === 0) {
      const text = UTF8.decode(bytes);
      return ok({ text, prefixEnd: spanPrefixEnd(text, maximumPrefixUnits) });
    }
    append(UTF8.decode(bytes.subarray(start)));
    return ok({ text: chunks.join(""), prefixEnd });
  } catch (cause: unknown) {
    if (cause instanceof TypeError)
      return err({ kind: "invalid-marshal-utf8" });
    throw cause;
  }
};
