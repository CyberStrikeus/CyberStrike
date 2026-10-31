import type { Dir } from "node:fs";

type CloseState =
  | { readonly kind: "open" }
  | { readonly kind: "closing"; readonly attempt: Promise<void> }
  | { readonly kind: "closed" }
  | { readonly kind: "failed"; readonly cause: unknown };

/** Dir.close invalidates Node's private handle before its native close settles. */
export class OwnedDirectoryHandle {
  #state: CloseState = { kind: "open" };

  constructor(readonly handle: Dir) {}

  close(): Promise<void> {
    if (this.#state.kind === "closed") return Promise.resolve();
    if (this.#state.kind === "closing") return this.#state.attempt;
    if (this.#state.kind === "failed") return Promise.reject(this.#state.cause);
    const attempt = Promise.resolve().then(async () => {
      try {
        await this.handle.close();
        this.#state = { kind: "closed" };
      } catch (cause: unknown) {
        // Dir has no public validity signal with which to authorize a retry.
        this.#state = { kind: "failed", cause };
        throw cause;
      }
    });
    this.#state = { kind: "closing", attempt };
    return attempt;
  }
}
