import { bridgeResponseOversizeError } from "../config/bridgeMaxRequestBytes.js";
import type { BridgeMaxRequestBytes } from "../config/bridgeMaxRequestBytes.js";

/**
 * Decode one authenticated Cutter response frame.
 *
 * The wire frame is `{"response":"<escaped JSON>","proof":"<64 hex>"}\n`.
 * Socket chunks are unescaped into one payload buffer and then one string.
 * The paged wire bytes, a concatenated copy, and an outer `JSON.parse` string
 * are not retained. The caller checks the proof and parses that one string.
 */

const PREFIX = Buffer.from('{"response":"');
const PROOF_MARK = Buffer.from(',"proof":"');
const CLOSE = Buffer.from('"}');
const PROOF_HEX_LENGTH = 64;
const CHALLENGE_FRAME_BYTES = 2048;
const INITIAL_RESPONSE_BYTES = 256;

const HEX = new Int8Array(256).fill(-1);
for (let digit = 0; digit < 10; digit += 1) HEX[0x30 + digit] = digit;
for (let digit = 0; digit < 6; digit += 1) {
  HEX[0x41 + digit] = 10 + digit;
  HEX[0x61 + digit] = 10 + digit;
}

const SIMPLE_ESCAPE = new Int16Array(256).fill(-1);
SIMPLE_ESCAPE[0x22] = 0x22;
SIMPLE_ESCAPE[0x5c] = 0x5c;
SIMPLE_ESCAPE[0x2f] = 0x2f;
SIMPLE_ESCAPE[0x62] = 0x08;
SIMPLE_ESCAPE[0x66] = 0x0c;
SIMPLE_ESCAPE[0x6e] = 0x0a;
SIMPLE_ESCAPE[0x72] = 0x0d;
SIMPLE_ESCAPE[0x74] = 0x09;

type Stage = "prefix" | "body" | "mark" | "proof" | "close" | "done";
type Escape = "none" | "slash" | "hex" | "low-slash" | "low-u" | "low-hex";

const invalid = (): Error => new Error("invalid authenticated response");

export interface DecodedCutterResponse {
  readonly response: string;
  readonly proof: string;
}

export class CutterAuthenticatedResponseDecoder {
  readonly #limit: BridgeMaxRequestBytes;
  #wire = 0;
  #stage: Stage = "prefix";
  #literal = 0;
  #escape: Escape = "none";
  #hex = 0;
  #hexCount = 0;
  #high = 0;
  #proof = "";
  #out = Buffer.allocUnsafe(INITIAL_RESPONSE_BYTES);
  #outLength = 0;

  constructor(limit: BridgeMaxRequestBytes) {
    this.#limit = limit;
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    if (this.#stage === "done") throw invalid();
    const next = this.#wire + chunk.length;
    if (next > this.#limit.maximumBytes)
      throw bridgeResponseOversizeError(this.#limit);
    this.#wire = next;
    let offset = 0;
    while (offset < chunk.length) offset = this.#take(chunk, offset);
  }

  /** Release the decode buffer and return the one response string. */
  finish(): DecodedCutterResponse {
    if (this.#stage !== "done") throw invalid();
    const response = this.#out.toString("utf8", 0, this.#outLength);
    this.#out = Buffer.alloc(0);
    this.#outLength = 0;
    return { response, proof: this.#proof };
  }

  #take(chunk: Buffer, offset: number): number {
    switch (this.#stage) {
      case "prefix":
        return this.#match(chunk, offset, PREFIX, "body");
      case "mark":
        return this.#match(chunk, offset, PROOF_MARK, "proof");
      case "close":
        return this.#match(chunk, offset, CLOSE, "done");
      case "proof":
        return this.#takeProof(chunk, offset);
      case "body":
        return this.#takeBody(chunk, offset);
      case "done":
        throw invalid();
    }
  }

  #match(chunk: Buffer, offset: number, literal: Buffer, next: Stage): number {
    const available = Math.min(
      literal.length - this.#literal,
      chunk.length - offset,
    );
    const actual = chunk.subarray(offset, offset + available);
    const expected = literal.subarray(this.#literal, this.#literal + available);
    if (!actual.equals(expected)) throw invalid();
    this.#literal += available;
    if (this.#literal === literal.length) {
      this.#stage = next;
      this.#literal = 0;
    }
    return offset + available;
  }

  #takeProof(chunk: Buffer, offset: number): number {
    const end = Math.min(
      chunk.length,
      offset + (PROOF_HEX_LENGTH - this.#proof.length),
    );
    for (let index = offset; index < end; index += 1) {
      const byte = chunk[index]!;
      const digit =
        byte >= 0x30 && byte <= 0x39
          ? byte - 0x30
          : byte >= 0x61 && byte <= 0x66
            ? byte - 0x57
            : -1;
      if (digit < 0) throw invalid();
      this.#proof += String.fromCharCode(byte);
    }
    if (this.#proof.length === PROOF_HEX_LENGTH) this.#stage = "close";
    return end;
  }

  #takeBody(chunk: Buffer, offset: number): number {
    if (this.#escape !== "none") return this.#takeEscape(chunk, offset);
    // Stop at the first quote or backslash. Searching the whole tail for a
    // quote after every escape repeats that scan for backslash-heavy replies.
    const slash = chunk.indexOf(0x5c, offset);
    let quote = -1;
    if (slash < 0) quote = chunk.indexOf(0x22, offset);
    else {
      const relative = chunk.subarray(offset, slash).indexOf(0x22);
      if (relative >= 0) quote = offset + relative;
    }
    let end = chunk.length;
    if (quote >= 0 && quote < end) end = quote;
    if (slash >= 0 && slash < end) end = slash;
    if (end > offset) this.#append(chunk.subarray(offset, end));
    if (end === chunk.length) return chunk.length;
    if (chunk[end] === 0x22) {
      this.#stage = "mark";
      this.#literal = 0;
      return end + 1;
    }
    this.#escape = "slash";
    return end + 1;
  }

  #takeEscape(chunk: Buffer, offset: number): number {
    const byte = chunk[offset]!;
    if (this.#escape === "slash") this.#escaped(byte);
    else if (this.#escape === "hex") this.#hexDigit(byte, false);
    else if (this.#escape === "low-slash") {
      if (byte !== 0x5c) throw invalid();
      this.#escape = "low-u";
    } else if (this.#escape === "low-u") {
      if (byte !== 0x75) throw invalid();
      this.#escape = "low-hex";
      this.#hex = 0;
      this.#hexCount = 0;
    } else this.#hexDigit(byte, true);
    return offset + 1;
  }

  #escaped(byte: number): void {
    if (byte === 0x75) {
      this.#escape = "hex";
      this.#hex = 0;
      this.#hexCount = 0;
      return;
    }
    const mapped = SIMPLE_ESCAPE[byte] ?? -1;
    if (mapped < 0) throw invalid();
    this.#appendByte(mapped);
    this.#escape = "none";
  }

  #hexDigit(byte: number, low: boolean): void {
    const digit = HEX[byte] ?? -1;
    if (digit < 0) throw invalid();
    this.#hex = (this.#hex << 4) | digit;
    this.#hexCount += 1;
    if (this.#hexCount < 4) return;
    const code = this.#hex;
    this.#hex = 0;
    this.#hexCount = 0;
    this.#escape = "none";
    if (low) {
      if (code < 0xdc00 || code > 0xdfff) throw invalid();
      this.#appendCodePoint(
        0x10000 + ((this.#high - 0xd800) << 10) + (code - 0xdc00),
      );
      return;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      this.#high = code;
      this.#escape = "low-slash";
      return;
    }
    if (code >= 0xdc00 && code <= 0xdfff) throw invalid();
    this.#appendCodePoint(code);
  }

  #appendCodePoint(code: number): void {
    if (code < 0x80) {
      this.#appendByte(code);
      return;
    }
    if (code < 0x800) {
      this.#appendByte(0xc0 | (code >> 6));
      this.#appendByte(0x80 | (code & 0x3f));
      return;
    }
    if (code < 0x10000) {
      this.#appendByte(0xe0 | (code >> 12));
      this.#appendByte(0x80 | ((code >> 6) & 0x3f));
      this.#appendByte(0x80 | (code & 0x3f));
      return;
    }
    this.#appendByte(0xf0 | (code >> 18));
    this.#appendByte(0x80 | ((code >> 12) & 0x3f));
    this.#appendByte(0x80 | ((code >> 6) & 0x3f));
    this.#appendByte(0x80 | (code & 0x3f));
  }

  #appendByte(value: number): void {
    this.#ensure(1);
    this.#out[this.#outLength] = value;
    this.#outLength += 1;
  }

  #append(bytes: Buffer): void {
    this.#ensure(bytes.length);
    bytes.copy(this.#out, this.#outLength);
    this.#outLength += bytes.length;
  }

  #ensure(extra: number): void {
    if (this.#outLength + extra <= this.#out.length) return;
    let next = this.#out.length;
    while (this.#outLength + extra > next) next *= 2;
    if (next > this.#limit.maximumBytes) next = this.#limit.maximumBytes;
    if (this.#outLength + extra > next) throw invalid();
    const grown = Buffer.allocUnsafe(next);
    this.#out.copy(grown, 0, 0, this.#outLength);
    this.#out = grown;
  }
}

export type CutterInboundFrame =
  | { readonly kind: "challenge"; readonly value: unknown }
  | {
      readonly kind: "response";
      readonly response: string;
      readonly proof: string;
    };

/** Read a Cutter challenge, then one authenticated response, from socket chunks. */
export class CutterBridgeResponseFrames {
  readonly #limit: BridgeMaxRequestBytes;
  #challenge: Buffer | undefined;
  #challengeLength = 0;
  #decoder: CutterAuthenticatedResponseDecoder | undefined;
  #frames = 0;

  constructor(limit: BridgeMaxRequestBytes) {
    this.#limit = limit;
  }

  push(chunk: Buffer, onFrame: (frame: CutterInboundFrame) => boolean): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.#frames >= 2)
        throw new Error("Cutter bridge sent more than two protocol frames");
      const step =
        this.#frames === 0
          ? this.#pushChallenge(chunk, offset, onFrame)
          : this.#pushResponse(chunk, offset, onFrame);
      if (step < 0) return;
      offset = step;
    }
  }

  #pushChallenge(
    chunk: Buffer,
    offset: number,
    onFrame: (frame: CutterInboundFrame) => boolean,
  ): number {
    const delimiter = chunk.indexOf(0x0a, offset);
    const end = delimiter < 0 ? chunk.length : delimiter;
    const length = end - offset;
    if (this.#challengeLength + length > CHALLENGE_FRAME_BYTES)
      throw new Error("invalid authentication challenge");
    this.#challenge ??= Buffer.allocUnsafe(CHALLENGE_FRAME_BYTES);
    chunk.copy(this.#challenge, this.#challengeLength, offset, end);
    this.#challengeLength += length;
    if (delimiter < 0) return chunk.length;
    let value: unknown;
    try {
      value = JSON.parse(
        this.#challenge.toString("utf8", 0, this.#challengeLength),
      ) as unknown;
    } catch {
      throw new Error("invalid authentication challenge");
    }
    this.#challenge = undefined;
    this.#challengeLength = 0;
    this.#frames = 1;
    return onFrame({ kind: "challenge", value }) ? delimiter + 1 : -1;
  }

  #pushResponse(
    chunk: Buffer,
    offset: number,
    onFrame: (frame: CutterInboundFrame) => boolean,
  ): number {
    const delimiter = chunk.indexOf(0x0a, offset);
    const end = delimiter < 0 ? chunk.length : delimiter;
    this.#decoder ??= new CutterAuthenticatedResponseDecoder(this.#limit);
    this.#decoder.push(chunk.subarray(offset, end));
    if (delimiter < 0) return chunk.length;
    const decoded = this.#decoder.finish();
    this.#decoder = undefined;
    this.#frames = 2;
    return onFrame({ kind: "response", ...decoded }) ? delimiter + 1 : -1;
  }
}
