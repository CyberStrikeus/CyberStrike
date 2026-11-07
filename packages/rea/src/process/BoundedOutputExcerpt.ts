/** Byte-bounded head and tail diagnostics, decoded after stream chunks are joined. */
export class BoundedOutputExcerpt {
  #head: Buffer = Buffer.alloc(0);
  #tail: Buffer = Buffer.alloc(0);
  #total = 0;
  readonly #headLimit: number;
  readonly #tailLimit: number;

  constructor(readonly limit: number) {
    this.#headLimit = Math.ceil(limit / 2);
    this.#tailLimit = limit - this.#headLimit;
  }

  append(chunk: Buffer): void {
    this.#total += chunk.byteLength;
    const headCount = Math.min(
      chunk.byteLength,
      this.#headLimit - this.#head.byteLength,
    );
    if (headCount > 0)
      this.#head = Buffer.concat([this.#head, chunk.subarray(0, headCount)]);
    const rest = chunk.subarray(headCount);
    if (rest.byteLength > 0 && this.#tailLimit > 0) {
      const retained = rest.subarray(-this.#tailLimit);
      this.#tail = Buffer.concat([
        this.#tail.subarray(
          Math.max(
            0,
            this.#tail.byteLength + retained.byteLength - this.#tailLimit,
          ),
        ),
        retained,
      ]);
    }
  }

  get truncated(): boolean {
    return this.#total > this.limit;
  }

  get text(): string {
    return this.truncated
      ? `${this.#head.toString("utf8")} … [output omitted] … ${this.#tail.toString("utf8")}`
      : Buffer.concat([this.#head, this.#tail]).toString("utf8");
  }
}
