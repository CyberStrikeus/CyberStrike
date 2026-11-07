const BINARY_PLIST_MAGIC = [0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30];
const NIB_ARCHIVE_MAGIC = [
  0x4e, 0x49, 0x42, 0x41, 0x72, 0x63, 0x68, 0x69, 0x76, 0x65,
];

/** Shared format-probe bound; this does not bound the plist document itself. */
export const MAX_XML_PLIST_PROBE_BYTES = 1024 * 1024;

/** Recognize the binary plist version supported by the decoder, without validating its body. */
export const hasBinaryPlistSignature = (bytes: Uint8Array): boolean =>
  BINARY_PLIST_MAGIC.every((byte, index) => bytes[index] === byte);

export type XmlPlistProbeState = "pending" | "matched" | "rejected";

/** Incremental, bounded XML signature scanner. Consumed prolog text is discarded. */
export const createXmlPlistSignatureProbe = (): {
  write(bytes: Uint8Array): XmlPlistProbeState;
  readonly state: XmlPlistProbeState;
} => {
  let state: XmlPlistProbeState = "pending";
  let preview: TextDecoder | undefined;
  let validator: TextDecoder | undefined;
  let utf16 = false;
  let bomBytes = 0;
  let fedBytes = 0;
  let decodedBytes = 0;
  let preamble: Uint8Array = new Uint8Array();
  const scanner = createXmlPlistPrologScanner();
  const encodedLength = (text: string): number =>
    utf16 ? text.length * 2 : new TextEncoder().encode(text).length;
  return {
    get state() {
      return state;
    },
    write(bytes) {
      if (state !== "pending" || bytes.length === 0) return state;
      let selected = bytes.subarray(
        0,
        MAX_XML_PLIST_PROBE_BYTES - fedBytes - preamble.length,
      );
      if (preview === undefined) {
        if (preamble.length !== 0 || selected.length < 4) {
          const joined = new Uint8Array(preamble.length + selected.length);
          joined.set(preamble);
          joined.set(selected, preamble.length);
          selected = joined;
          if (selected.length < 4) {
            preamble = selected;
            return state;
          }
          preamble = new Uint8Array();
        }
        const little = selected[0] === 0xff && selected[1] === 0xfe;
        const big = selected[0] === 0xfe && selected[1] === 0xff;
        utf16 = little || big;
        bomBytes = utf16
          ? 2
          : selected[0] === 0xef && selected[1] === 0xbb && selected[2] === 0xbf
            ? 3
            : 0;
        const encoding = little ? "utf-16le" : big ? "utf-16be" : "utf-8";
        preview = new TextDecoder(encoding);
        validator = new TextDecoder(encoding, { fatal: true });
      }
      const text = preview.decode(selected, { stream: true });
      const result = scanner(text);
      // Validate only through the observed signature. Invalid document bytes
      // after that signature cannot undo the format observation.
      const through =
        result.state === "matched"
          ? bomBytes +
            decodedBytes +
            encodedLength(text.slice(0, result.consumed)) -
            fedBytes
          : selected.length;
      try {
        validator!.decode(selected.subarray(0, through), { stream: true });
        state = result.state;
      } catch {
        state = "rejected";
      }
      decodedBytes += encodedLength(text);
      fedBytes += selected.length;
      if (fedBytes === MAX_XML_PLIST_PROBE_BYTES && state === "pending")
        state = "rejected";
      return state;
    },
  };
};

/** Recognize a plist prolog without claiming that its XML document is valid. */
export const hasXmlPlistSignature = (bytes: Uint8Array): boolean =>
  createXmlPlistSignatureProbe().write(bytes) === "matched";

const createXmlPlistPrologScanner = (): ((chunk: string) => {
  state: XmlPlistProbeState;
  consumed: number;
}) => {
  let text = "";
  let totalCharacters = 0;
  let pending: "?>" | "-->" | undefined;
  let doctypeName = false;
  return (chunk) => {
    const before = totalCharacters;
    totalCharacters += chunk.length;
    text += chunk;
    let cursor = 0;
    const result = (state: XmlPlistProbeState, through = cursor) => ({
      state,
      consumed: totalCharacters - text.length + through - before,
    });
    while (true) {
      if (pending !== undefined) {
        const end = text.indexOf(pending, cursor);
        if (end < 0) {
          text = text.slice(Math.max(cursor, text.length - pending.length + 1));
          return result("pending");
        }
        cursor = end + pending.length;
        pending = undefined;
      }
      while (cursor < text.length && isXmlWhitespace(text[cursor]!)) cursor++;
      if (cursor === text.length) {
        text = "";
        return result("pending");
      }
      if (doctypeName) {
        const token = tokenAt(text, cursor, "plist");
        if (
          token === "partial" ||
          (token === "match" && cursor + 5 === text.length)
        ) {
          text = text.slice(cursor);
          return result("pending");
        }
        const delimiter = text[cursor + 5];
        return result(
          token === "match" &&
            (delimiter === ">" ||
              delimiter === "[" ||
              (delimiter !== undefined && isXmlWhitespace(delimiter)))
            ? "matched"
            : "rejected",
          cursor + 6,
        );
      }
      for (const [token, terminator] of [
        ["<!--", "-->"],
        ["<?", "?>"],
      ] as const) {
        const match = tokenAt(text, cursor, token);
        if (match === "partial") {
          text = text.slice(cursor);
          return result("pending");
        }
        if (match === "match") {
          pending = terminator;
          cursor += token.length;
          break;
        }
      }
      if (pending !== undefined) continue;
      const doctype = tokenAt(text, cursor, "<!DOCTYPE");
      if (
        doctype === "partial" ||
        (doctype === "match" && cursor + 9 === text.length)
      ) {
        text = text.slice(cursor);
        return result("pending");
      }
      if (doctype === "match") {
        if (!isXmlWhitespace(text[cursor + 9]!)) return result("rejected");
        cursor += 10;
        doctypeName = true;
        continue;
      }
      const root = tokenAt(text, cursor, "<plist");
      if (
        root === "partial" ||
        (root === "match" && cursor + 6 === text.length)
      ) {
        text = text.slice(cursor);
        return result("pending");
      }
      const delimiter = text[cursor + 6];
      return result(
        root === "match" &&
          (delimiter === "/" ||
            delimiter === ">" ||
            (delimiter !== undefined && isXmlWhitespace(delimiter)))
          ? "matched"
          : "rejected",
        cursor + 7,
      );
    }
  };
};

type TokenMatch = "match" | "partial" | "none";
const tokenAt = (text: string, offset: number, token: string): TokenMatch => {
  const available = text.slice(offset, offset + token.length);
  return available === token
    ? "match"
    : token.startsWith(available)
      ? "partial"
      : "none";
};
const isXmlWhitespace = (character: string): boolean =>
  character === " " ||
  character === "\t" ||
  character === "\r" ||
  character === "\n";

/** Recognize the serialized signature without claiming a valid NIB object table. */
export const hasNibArchiveSignature = (bytes: Uint8Array): boolean =>
  NIB_ARCHIVE_MAGIC.every((byte, index) => bytes[index] === byte);
