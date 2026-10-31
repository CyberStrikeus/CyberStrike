/** Lifetime of one task's prerequisite observations, distinct from resource ownership. */
export class ProviderInspectionScope {
  #active = true;
  get active(): boolean {
    return this.#active;
  }
  close(): void {
    this.#active = false;
  }
}
