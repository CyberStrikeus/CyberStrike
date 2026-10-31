import { z } from "zod";
import type { WebNetworkCaptureRecord } from "../webNetworkCapture.js";

/** One record's retained response text, as replay and state extraction both read it. */
export interface RecordedResponseBody {
  /** Decoded response text, or null when absent, redacted or unsupported. */
  readonly bodyText: string | null;
  /** Set when the retained bytes are not UTF-8, so `bodyText` holds their base64 rather than a lossy decoding. */
  readonly bodyEncoding?: "base64";
  /** Set when only a prefix of a large base64 body was decoded. */
  readonly bodyCut?: true;
}

const responseDeclarationSchema = z.object({
  response: z.object({
    status: z.unknown().optional(),
    content: z.unknown().optional(),
  }),
});
const responseContentDeclarationSchema = z.object({
  text: z.unknown().optional(),
  encoding: z.unknown().optional(),
  size: z.unknown().optional(),
  mimeType: z.unknown().optional(),
});

/** Retain response facts independently: malformed content does not erase a reported status. */
export const readRecordedResponseDeclaration = (reported: unknown) => {
  const parsed = responseDeclarationSchema.safeParse(reported);
  if (!parsed.success) return undefined;
  const { status, content } = parsed.data.response;
  const parsedContent = responseContentDeclarationSchema.safeParse(content);
  return {
    status,
    content: parsedContent.success
      ? parsedContent.data
      : content === null
        ? null
        : undefined,
  };
};

export type RecordedResponseDeclaration = ReturnType<
  typeof readRecordedResponseDeclaration
>;

/** Strict, and keeping a leading byte-order mark, so callers see the recorded text unchanged. */
const strictUtf8 = (): TextDecoder =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Base64 characters that decode to just over `limitBytes`, so a cut prefix still fills it. */
export const base64PrefixChars = (limitBytes: number): number =>
  Math.ceil((limitBytes + 4) / 3) * 4;

/** Decode retained base64 as strict UTF-8, only as far as `limitBytes`; bytes that are not UTF-8 stay base64. */
export const decodeRetainedBase64 = (
  encoded: string,
  limitBytes: number,
): RecordedResponseBody => {
  const prefixChars = base64PrefixChars(limitBytes);
  const cut = encoded.length > prefixChars;
  const prefix = cut ? encoded.slice(0, prefixChars) : encoded;
  const flags = cut ? { bodyCut: true as const } : {};
  try {
    // A cut prefix may end inside a character; streaming leaves that tail undecoded.
    const text = strictUtf8().decode(Buffer.from(prefix, "base64"), {
      stream: cut,
    });
    return { bodyText: text, ...flags };
  } catch {
    // Binary or non-UTF-8 bytes: keep them exactly, as base64, instead of inventing replacement characters.
    return { bodyText: prefix, bodyEncoding: "base64", ...flags };
  }
};

/** Read producer-decoded text or supported HAR base64; unknown encoding declarations stay opaque. Base64 beyond `limitBytes` is decoded only that far. */
export const readRecordedResponseBody = (
  record: WebNetworkCaptureRecord,
  limitBytes: number,
  declaration: RecordedResponseDeclaration = readRecordedResponseDeclaration(
    record.reported,
  ),
): RecordedResponseBody => {
  const content = declaration?.content;
  if (content == null) return { bodyText: null };
  const { text, encoding } = content;
  if (typeof text !== "string") return { bodyText: null };
  if (encoding === undefined) {
    // A hidden content property could have been the encoding declaration;
    // omission after redaction does not establish producer-decoded text.
    const hiddenNames = record.redactions.some(
      (redaction) =>
        "scope" in redaction && redaction.pointer === "/response/content",
    );
    return { bodyText: hiddenNames ? null : text };
  }
  if (encoding !== "base64") return { bodyText: null };
  const binary = record.binary_fields.find(
    (field) =>
      field.pointer === "/response/content/text" && field.state === "retained",
  );
  if (binary === undefined || binary.content_base64 === null)
    return { bodyText: null };
  return decodeRetainedBase64(binary.content_base64, limitBytes);
};

/** Prove decoded emptiness with a bounded prefix, preserving encoding and cut uncertainty. */
export const recordedResponseBodyIsEmpty = (
  record: WebNetworkCaptureRecord,
  declaration: RecordedResponseDeclaration = readRecordedResponseDeclaration(
    record.reported,
  ),
): boolean => {
  const body = readRecordedResponseBody(record, 0, declaration);
  return (
    body.bodyText === "" &&
    body.bodyEncoding === undefined &&
    body.bodyCut !== true
  );
};
