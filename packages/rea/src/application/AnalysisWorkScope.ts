/** In-memory, provider-owned intermediate facts confined to one composed task. */
export class AnalysisWorkScope {
  readonly #entries = new Map<object, unknown>();
  #closed = false;

  get<T>(owner: object): T | undefined {
    return this.#entries.get(owner) as T | undefined;
  }

  set<T>(owner: object, value: T): void {
    if (!this.#closed) this.#entries.set(owner, value);
  }

  clear(): void {
    this.#closed = true;
    this.#entries.clear();
  }
}
