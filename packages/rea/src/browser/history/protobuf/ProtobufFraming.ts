import { err, ok } from "../../../domain/result.js";
import type { ProtobufDecoding } from "../../../domain/protobufWire.js";
import { WEB_NETWORK_CAPTURE_LIMITS } from "../../../domain/webNetworkCapture.js";
import { CaptureFormatError } from "../CaptureFormatError.js";
import { ProtobufBudget } from "./ProtobufWire.js";

/** One owner for frame boundaries used by exclusion and field interpretation. */
export const readGrpcFrame = (
  data: Uint8Array,
  at: number,
  framing: Exclude<ProtobufDecoding["framing"], "raw">,
) => {
  if (data.length - at < 5)
    return err({ offset: at, reason: "Truncated gRPC frame header" });
  const flags = data[at]!;
  if (
    (framing === "grpc" && flags !== 0 && flags !== 1) ||
    (flags & ~0x81) !== 0
  )
    return err({
      offset: at,
      reason: "Invalid flags for the selected gRPC framing",
    });
  const length =
    data[at + 1]! * 2 ** 24 +
    data[at + 2]! * 2 ** 16 +
    data[at + 3]! * 256 +
    data[at + 4]!;
  if (length > data.length - at - 5)
    return err({ offset: at, reason: "gRPC frame exceeds the retained body" });
  return ok({
    flags,
    bytes: length,
    payload_offset: at + 5,
    end: at + 5 + length,
  });
};

/** Decode padded stream chunks into one source-bounded buffer, never a chunk inventory. */
const decodeText = async (
  body: Uint8Array,
  work: ProtobufBudget,
): Promise<Uint8Array | undefined> => {
  const text = Buffer.from(body.buffer, body.byteOffset, body.byteLength)
    .toString("latin1")
    .replace(/[ \r\n\t]/g, "");
  if (/[^A-Za-z0-9+/=]/.test(text)) return undefined;
  const output = Buffer.alloc(Math.floor((text.length * 3) / 4));
  let at = 0;
  let written = 0;
  while (at < text.length) {
    await work.checkpoint();
    let end = text.indexOf("=", at);
    if (end < 0) end = text.length;
    else {
      end++;
      if (text[end] === "=") end++;
    }
    const chunk = text.slice(at, end);
    if (
      chunk.length % 4 === 1 ||
      (chunk.includes("=") && chunk.length % 4 !== 0)
    )
      return undefined;
    const bytes = Buffer.from(chunk, "base64");
    if (
      bytes.toString("base64").replace(/=+$/, "") !== chunk.replace(/=+$/, "")
    )
      return undefined;
    output.set(bytes, written);
    written += bytes.length;
    at = end;
  }
  return output.subarray(0, written);
};

export interface PreparedProtobufBody {
  readonly data: Uint8Array | undefined;
  readonly credentialsChecked: boolean;
  readonly excluded?: "explicit-sensitive-value" | "transport-credential";
}

/** Complete credential inspection before schema I/O, fact budgets or recoverable errors.
 * Its temporary storage is bounded by admitted source bytes, independently of field expansion.
 */
export const prepareProtobufBody = async (
  body: Uint8Array,
  framing: ProtobufDecoding["framing"],
  exclusions: {
    decoded(bytes: Uint8Array): boolean;
    header(bytes: Uint8Array, start: number, end: number): boolean;
  },
  signal?: AbortSignal,
): Promise<PreparedProtobufBody> => {
  if (body.length > WEB_NETWORK_CAPTURE_LIMITS.inputBytes)
    throw new CaptureFormatError(
      "limit",
      "Protobuf body exceeds the admitted 32 MiB source bound",
    );
  const work = new ProtobufBudget(signal);
  await work.checkpoint();
  const data =
    framing === "grpc-web-text" ? await decodeText(body, work) : body;
  if (data === undefined) return { data, credentialsChecked: false };
  if (exclusions.decoded(data))
    return {
      data,
      credentialsChecked: true,
      excluded: "explicit-sensitive-value",
    };
  if (framing === "raw" || framing === "grpc")
    return { data, credentialsChecked: true };
  let at = 0;
  let credentialsChecked = true;
  while (at < data.length) {
    await work.checkpoint();
    const parsed = readGrpcFrame(data, at, framing);
    if (!parsed.ok) {
      credentialsChecked = false;
      break;
    }
    const frame = parsed.value;
    if (frame.flags === 129) credentialsChecked = false;
    if (frame.flags === 128) {
      let start = frame.payload_offset;
      for (let index = start; index <= frame.end; index++) {
        // Large/malformed lines remain source-bounded and cancellation stays cooperative.
        if ((index - start) % 256 === 0) await work.checkpoint();
        if (index !== frame.end && data[index] !== 10) continue;
        let colon = start;
        while (colon < index && data[colon] !== 58) colon++;
        if (colon < index && exclusions.header(data, start, colon))
          return {
            data,
            credentialsChecked: true,
            excluded: "transport-credential",
          };
        start = index + 1;
      }
    }
    at = frame.end;
  }
  return { data, credentialsChecked };
};
