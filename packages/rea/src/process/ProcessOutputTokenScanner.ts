import { isUtf8 } from "node:buffer";

/** One confirmed token with bounded context from its raw output stream. */
export interface ProviderProcessOutputToken {
  /** Byte offset since construction or reset of the owning supervisor. */
  readonly offset: number;
  readonly line: string;
  readonly truncated: boolean;
  readonly invalidUtf8?: true;
  /** True when the line's right edge is cut or its end has not been observed. */
  readonly trailingContextIncomplete?: true;
}
export const PROCESS_OUTPUT_TOKEN_CONTEXT_BYTES = 1024;
const NEWLINE = 0x0a;
const isWordByte = (byte: number): boolean =>
  (byte >= 0x30 && byte <= 0x39) ||
  (byte >= 0x41 && byte <= 0x5a) ||
  (byte >= 0x61 && byte <= 0x7a) ||
  byte === 0x5f;
interface Match {
  readonly offset: number;
  readonly prefix: Buffer;
  readonly prefixCut: boolean;
  suffix: Buffer;
  open: boolean;
  suffixCut: boolean;
}
/** Bounded literal token capture, delimited on the right by a non-ASCII-word byte or actual EOF. */
export class ProcessOutputTokenScanner {
  readonly #marker: Buffer;
  #lineTail: Buffer = Buffer.alloc(0);
  #lineTailCut = false;
  #latest: Match | undefined;
  #pending: Match | undefined;
  constructor(marker: string) {
    if (marker.length === 0 || marker.includes("\n"))
      throw new RangeError("Output token must be non-empty single-line text");
    this.#marker = Buffer.from(marker, "utf8");
    if (!isWordByte(this.#marker[this.#marker.length - 1]!))
      throw new RangeError("Output token must end in an ASCII word byte");
  }

  scan(chunk: Buffer, start: number): void {
    if (chunk.length === 0) return;
    // The next byte can invalidate a pending prefix without erasing the last
    // confirmed token from an earlier line.

    if (this.#pending !== undefined) {
      if (!isWordByte(chunk[0]!)) this.#latest = this.#pending;
      this.#pending = undefined;
    }
    this.#extendOpenLine(chunk);
    const carried = this.#lineTail.byteLength;
    const searched =
      carried === 0 ? chunk : Buffer.concat([this.#lineTail, chunk]);
    // A later identifier may share the literal prefix. Search past rejected
    // candidates to retain the latest confirmed token in this same chunk.
    let index = searched.lastIndexOf(this.#marker);
    while (index >= 0 && index + this.#marker.byteLength > carried) {
      const end = index + this.#marker.byteLength;
      if (end === searched.length)
        this.#pending = this.#record(searched, index, start - carried);
      else if (!isWordByte(searched[end]!)) {
        this.#latest = this.#record(searched, index, start - carried);
        break;
      }
      index = index === 0 ? -1 : searched.lastIndexOf(this.#marker, index - 1);
    }
    this.#retainLineTail(searched);
  }
  /** Only a true stream end proves the boundary of a trailing bare token. */
  finish(): void {
    if (this.#pending !== undefined) this.#latest = this.#pending;
    this.#pending = undefined;
    if (this.#latest !== undefined) this.#latest.open = false;
  }
  latestWithin(
    start: number,
    end: number,
  ): ProviderProcessOutputToken | undefined {
    const latest = this.#latest;
    if (latest === undefined || latest.offset < start || latest.offset >= end)
      return undefined;
    // Omit a prefix crossing the checkpoint in full: neither its old cause
    // text nor a credential fragment cut on the left belongs to this scope.
    const prefixInRange = latest.offset - latest.prefix.length >= start;
    const bytes = Buffer.concat([
      ...(prefixInRange ? [latest.prefix] : []),
      latest.suffix,
    ]);
    return {
      offset: latest.offset,
      line: bytes.toString("utf8"),
      ...(!isUtf8(bytes) ? { invalidUtf8: true as const } : {}),
      truncated: latest.prefixCut || latest.suffixCut || !prefixInRange,
      ...(latest.suffixCut || latest.open
        ? { trailingContextIncomplete: true as const }
        : {}),
    };
  }
  #record(searched: Buffer, index: number, searchedStart: number): Match {
    const lineStart =
      index === 0 ? 0 : searched.lastIndexOf(NEWLINE, index - 1) + 1;
    const prefixFits =
      index - lineStart <= PROCESS_OUTPUT_TOKEN_CONTEXT_BYTES &&
      (lineStart > 0 || !this.#lineTailCut);
    const lineEnd = searched.indexOf(NEWLINE, index);
    const available = lineEnd < 0 ? searched.byteLength : lineEnd;
    const suffixEnd = Math.min(
      available,
      index + this.#marker.byteLength + PROCESS_OUTPUT_TOKEN_CONTEXT_BYTES,
    );
    return {
      offset: searchedStart + index,
      prefix: prefixFits
        ? Buffer.from(searched.subarray(lineStart, index))
        : Buffer.alloc(0),
      prefixCut: !prefixFits,
      suffix: Buffer.from(searched.subarray(index, suffixEnd)),
      open: lineEnd < 0 && suffixEnd === available,
      suffixCut: suffixEnd < available,
    };
  }
  #extendOpenLine(chunk: Buffer): void {
    const latest = this.#latest;
    if (latest?.open !== true) return;
    const lineEnd = chunk.indexOf(NEWLINE);
    const available = lineEnd < 0 ? chunk.byteLength : lineEnd;
    const room =
      this.#marker.byteLength +
      PROCESS_OUTPUT_TOKEN_CONTEXT_BYTES -
      latest.suffix.byteLength;
    const taken = Math.min(available, Math.max(0, room));
    if (taken > 0)
      latest.suffix = Buffer.concat([latest.suffix, chunk.subarray(0, taken)]);
    latest.suffixCut = taken < available;
    latest.open = lineEnd < 0 && taken === available;
  }
  #retainLineTail(searched: Buffer): void {
    const lineStart = searched.lastIndexOf(NEWLINE) + 1;
    const limit =
      PROCESS_OUTPUT_TOKEN_CONTEXT_BYTES + this.#marker.byteLength - 1;
    this.#lineTailCut =
      searched.byteLength - lineStart > limit ||
      (lineStart === 0 && this.#lineTailCut);
    this.#lineTail = Buffer.from(
      searched.subarray(Math.max(lineStart, searched.byteLength - limit)),
    );
  }
}
