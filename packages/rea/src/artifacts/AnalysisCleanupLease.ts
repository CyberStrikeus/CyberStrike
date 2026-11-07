import type {
  AnalysisError,
  AnalysisCleanupResourceOwner,
} from "../domain/analysisErrorBase.js";

/** Link one resource's confirmed release to its originating analysis error. */
export class AnalysisCleanupLease {
  #released = false;
  #releasePromise: Promise<void> | undefined;
  readonly #groups = new Set<AnalysisCleanupLeaseGroup>();

  /** Whether this exact owner has confirmed release. */
  get released(): boolean {
    return this.#released;
  }

  readonly #resourceOwner: AnalysisCleanupResourceOwner | undefined;
  readonly #resources: readonly string[] | undefined;

  get cleanupResources(): readonly string[] | undefined {
    return this.#resourceOwner === undefined
      ? this.#resources
      : this.#resourceOwner.cleanupResources;
  }

  /** Adopt exact close authority while retaining its live labels across retries. */
  static forCloseOwner(
    owner: {
      close(): Promise<void>;
      readonly cleanupResources?: readonly string[] | undefined;
    },
    resource: string,
  ): AnalysisCleanupLease {
    return new AnalysisCleanupLease(
      () => owner.close(),
      !("cleanupResources" in owner)
        ? [resource]
        : {
            get cleanupResources() {
              return owner.cleanupResources;
            },
          },
    );
  }

  constructor(
    private readonly cleanup: () => Promise<void>,
    resources?: readonly string[] | AnalysisCleanupResourceOwner,
  ) {
    if (resources !== undefined && "cleanupResources" in resources) {
      this.#resourceOwner = resources;
      this.#resources = undefined;
    } else {
      this.#resourceOwner = undefined;
      this.#resources = resources === undefined ? undefined : [...resources];
    }
  }

  release(): Promise<void> {
    if (this.#released) return Promise.resolve();
    if (this.#releasePromise !== undefined) return this.#releasePromise;
    const attempt = Promise.resolve()
      .then(async () => {
        await this.cleanup();
        this.#released = true;
        for (const group of this.#groups) group.ownerReleased(this);
        this.#groups.clear();
      })
      .finally(() => {
        if (this.#releasePromise === attempt) this.#releasePromise = undefined;
      });
    this.#releasePromise = attempt;
    return attempt;
  }

  /** Binding can follow a concurrent retry that already confirmed release. */
  bindCleanupError(error: AnalysisError): void {
    new AnalysisCleanupLeaseGroup(error, [this], {
      preserveResourceAttribution: true,
    });
  }

  /** Bind one aggregate error to every exact lease in a failed retry set. */
  bindCleanupGroup(group: AnalysisCleanupLeaseGroup): void {
    if (this.#released) {
      group.ownerReleased(this);
      return;
    }
    for (const retained of this.#groups)
      if (!retained.hasLiveError) this.#groups.delete(retained);
    this.#groups.add(group);
  }
}

/** Conjunctive cleanup binding for an error covering multiple exact owners. */
export class AnalysisCleanupLeaseGroup {
  readonly #error: WeakRef<AnalysisError>;
  readonly #pending: Set<AnalysisCleanupLease>;

  constructor(
    error: AnalysisError,
    owners: readonly AnalysisCleanupLease[],
    options: { readonly preserveResourceAttribution?: boolean } = {},
  ) {
    this.#error = new WeakRef(error);
    this.#pending = new Set(owners);
    if (this.#pending.size === 0) return;
    if (options.preserveResourceAttribution === true)
      error.bindCleanupCompletionOwner(this);
    else error.bindCleanupResourceOwner(this);
    for (const owner of this.#pending) owner.bindCleanupGroup(this);
  }

  /** Unlabelled owners keep attribution unknown; never match resources by text. */
  get cleanupResources(): readonly string[] | undefined {
    if (
      [...this.#pending].some((owner) => owner.cleanupResources === undefined)
    )
      return undefined;
    return [
      ...new Set(
        [...this.#pending].flatMap((owner) => owner.cleanupResources ?? []),
      ),
    ];
  }

  get hasLiveError(): boolean {
    return this.#error.deref() !== undefined;
  }

  ownerReleased(owner: AnalysisCleanupLease): void {
    if (!this.#pending.delete(owner) || this.#pending.size > 0) return;
    this.#error.deref()?.resolveCleanup();
    this.#pending.clear();
  }
}
