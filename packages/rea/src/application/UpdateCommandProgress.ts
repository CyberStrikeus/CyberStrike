import { Writable, type Readable } from "node:stream";
import { finished } from "node:stream/promises";

/** Borrow a progress destination while owning backpressure and write acknowledgements. */
export class UpdateCommandProgress {
  readonly #streams: Readable[] = [];
  readonly #sink: Writable;
  readonly #finished: Promise<Error | undefined>;
  #closing: Promise<Error | undefined> | undefined;
  #failed = false;
  #pendingWrites = 0;
  #closed = false;
  readonly #onDestinationError = (cause: Error): void => {
    this.#sink.destroy(cause);
  };

  constructor(private readonly destination: Writable) {
    this.#sink = new Writable({
      write: (chunk: Buffer, encoding, callback) => {
        this.#pendingWrites++;
        destination.write(chunk, encoding, (cause) => {
          this.#pendingWrites--;
          callback(cause);
          // A destination can emit its write error after invoking the callback.
          setImmediate(() => this.#releaseDestination());
        });
      },
    });
    this.#finished = finished(this.#sink, { cleanup: true }).then(
      () => undefined,
      (cause: unknown) => {
        this.#failed = true;
        for (const stream of this.#streams) {
          stream.unpipe(this.#sink);
          stream.resume();
        }
        return cause instanceof Error ? cause : new Error(String(cause));
      },
    );
    destination.on("error", this.#onDestinationError);
  }

  pipe(stream: Readable): void {
    this.#streams.push(stream);
    if (this.#failed) stream.resume();
    else stream.pipe(this.#sink, { end: false });
  }

  close(): Promise<Error | undefined> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<Error | undefined> {
    for (const stream of this.#streams) stream.unpipe(this.#sink);
    this.#sink.end();
    try {
      return await this.#finished;
    } finally {
      this.#closed = true;
      setImmediate(() => this.#releaseDestination());
    }
  }
  #releaseDestination(): void {
    if (this.#closed && this.#pendingWrites === 0)
      this.destination.off("error", this.#onDestinationError);
  }
}
