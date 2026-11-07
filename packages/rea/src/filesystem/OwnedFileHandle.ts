import type { FileHandle } from "node:fs/promises";

/** Close admission for one owned file handle. `code` is the stable identity. */
export class OwnedFileHandleError extends Error {
  readonly _tag = "OwnedFileHandleError";

  constructor(readonly code: "handle_invalidated") {
    super(code);
    this.name = "OwnedFileHandleError";
  }
}

type CloseState =
  | { readonly kind: "open" }
  | { readonly kind: "closing"; readonly attempt: Promise<void> }
  | { readonly kind: "closed" }
  | { readonly kind: "failed"; readonly cause: unknown };

/** One file handle whose close result must remain truthful across retries. */
export class OwnedFileHandle<
  Handle extends Pick<FileHandle, "fd" | "close"> = FileHandle,
> {
  #state: CloseState = { kind: "open" };

  constructor(readonly handle: Handle) {}

  /** Close the owned handle, retaining an unconfirmed close as a sticky failure. */
  close(): Promise<void> {
    if (this.#state.kind === "closed") return Promise.resolve();
    if (this.#state.kind === "closing") return this.#state.attempt;
    if (this.#state.kind === "failed") return Promise.reject(this.#state.cause);
    if (this.handle.fd < 0) {
      const cause = new OwnedFileHandleError("handle_invalidated");
      this.#state = { kind: "failed", cause };
      return Promise.reject(cause);
    }

    const attempt = Promise.resolve().then(() => this.#attemptClose());
    this.#state = { kind: "closing", attempt };
    return attempt;
  }

  async #attemptClose(): Promise<void> {
    try {
      await this.handle.close();
      this.#state = { kind: "closed" };
    } catch (cause: unknown) {
      this.#state =
        this.handle.fd < 0 ? { kind: "failed", cause } : { kind: "open" };
      throw cause;
    }
  }
}
