import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { assertArtifactReadActive } from "../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  ModelFormatFailure,
  MODEL_HEADER_BYTES,
  rejectModel,
} from "./ModelFormat.js";

/** Sequential prefix reader. Read-ahead is permitted only inside a parser-proven header extent. */
export class ModelHeaderReader {
  position = 0;
  #end = 0;
  #guaranteedEnd = 0;
  #buffer = Buffer.alloc(0);
  #start = 0;
  #headerPrefixBytes = 0;
  readonly #hash = createHash("sha256");
  constructor(
    readonly file: FileHandle,
    readonly size: number,
    readonly signal?: AbortSignal,
  ) {}

  /** Safetensors declares JSON bytes separately from its fixed length prefix. */
  excludeSafetensorsLengthPrefix(): void {
    if (this.position !== 8)
      throw new TypeError(
        "Safetensors header budget must follow its eight-byte length prefix",
      );
    this.#headerPrefixBytes = 8;
  }

  /** Minimum bytes implied by the remaining declared header records, never tensor payload. */
  guarantee(bytes: number): void {
    const end = this.position + bytes;
    this.#validateEnd(end);
    this.#guaranteedEnd = Math.max(this.#guaranteedEnd, end);
  }

  #validateEnd(end: number): void {
    if (!Number.isSafeInteger(end) || end < 0 || end > this.size)
      rejectModel("Declared header extent is outside the file");
    if (end - this.#headerPrefixBytes > MODEL_HEADER_BYTES)
      throw new ModelFormatFailure(
        "capacity",
        "Model header exceeds 100,000,000 bytes. This release has no runtime override.",
        "header-bytes",
      );
  }

  async take(length: number): Promise<Buffer> {
    assertArtifactReadActive(this.signal);
    const end = this.position + length;
    this.#validateEnd(end);
    if (!Number.isSafeInteger(length) || length < 0)
      rejectModel("Invalid header field length");
    if (end > this.#end) {
      const readEnd = Math.max(
        end,
        Math.min(this.position + 65536, this.#guaranteedEnd),
      );
      const retained = this.#buffer.subarray(this.position - this.#start);
      const next = Buffer.allocUnsafe(readEnd - this.position);
      retained.copy(next);
      let offset = retained.length;
      while (offset < next.length) {
        assertArtifactReadActive(this.signal);
        const result = await this.file.read(
          next,
          offset,
          next.length - offset,
          this.position + offset,
        );
        if (result.bytesRead === 0)
          throw new ArtifactReaderFailure(
            "integrity",
            "Model header ended before its admitted file extent",
          );
        this.#hash.update(next.subarray(offset, offset + result.bytesRead));
        offset += result.bytesRead;
      }
      this.#start = this.position;
      this.#end = readEnd;
      this.#buffer = next;
    }
    const result = this.#buffer.subarray(
      this.position - this.#start,
      end - this.#start,
    );
    this.position = end;
    return result;
  }

  async consume(length: number): Promise<void> {
    while (length > 0) {
      const size = Math.min(length, 65536);
      await this.take(size);
      length -= size;
    }
  }

  /** Complete the exact prefix commitment, optionally streaming weights without retaining them. */
  async finish(full: boolean): Promise<{
    header_sha256: string;
    sha256: string | null;
    bytes_read: number;
  }> {
    if (this.position !== this.#end)
      rejectModel("Parser left unconsumed header bytes");
    const header_sha256 = this.#hash.copy().digest("hex");
    if (!full)
      return { header_sha256, sha256: null, bytes_read: this.position };
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = this.position;
    while (position < this.size) {
      assertArtifactReadActive(this.signal);
      const { bytesRead } = await this.file.read(
        buffer,
        0,
        Math.min(buffer.length, this.size - position),
        position,
      );
      if (bytesRead === 0)
        throw new ArtifactReaderFailure(
          "integrity",
          "Model ended before its admitted extent during full-file hashing",
        );
      this.#hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return {
      header_sha256,
      sha256: this.#hash.digest("hex"),
      bytes_read: position,
    };
  }
}
