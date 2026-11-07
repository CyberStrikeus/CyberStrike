/** Expected carrier encoding failure, independent of the analysis engine. */
export class EvmCarrierFailure extends Error {}

/** Outer ASCII whitespace only; BOM and other Unicode spaces stay invalid. */
const asciiWhitespace = (code: number): boolean =>
  code === 0x20 || (code >= 0x09 && code <= 0x0d);

/** Decode only the explicitly selected representation; source carrier bytes are retained separately. */
export const decodeEvmBytecodeCarrier = (
  bytes: Uint8Array,
  encoding: "raw" | "hex",
): Uint8Array => {
  if (encoding === "raw") return Uint8Array.from(bytes);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (cause: unknown) {
    throw new EvmCarrierFailure("Hex carrier must be valid UTF-8.", { cause });
  }
  // Index scans keep trimming linear; a global start|end regex backtracks
  // through every interior whitespace run.
  let start = 0;
  let end = text.length;
  while (start < end && asciiWhitespace(text.charCodeAt(start))) start += 1;
  while (end > start && asciiWhitespace(text.charCodeAt(end - 1))) end -= 1;
  const code = text.slice(start, end).replace(/^0x/i, "");
  if (!/^(?:[a-fA-F0-9]{2})*$/.test(code))
    throw new EvmCarrierFailure(
      "Hex carrier requires complete hexadecimal byte pairs, an optional 0x prefix and outer ASCII whitespace; interior separators are invalid.",
    );
  return Uint8Array.from(Buffer.from(code, "hex"));
};
