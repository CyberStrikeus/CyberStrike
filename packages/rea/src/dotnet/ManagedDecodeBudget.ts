import { createHash } from "node:crypto";

import { jsonStringByteLength } from "../domain/jsonStringByteLength.js";

import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import { ManagedReaderFailure } from "./ManagedReaderFailure.js";

/** Per-inspection capacity for eagerly retained metadata and its JSON projection. */
const MAX_METADATA_REPRESENTATION_BYTES = 64 * 1024 * 1024;

/** The capacity owner's diagnostic, also used to admit a recovery envelope. */
export class ManagedRepresentationFailure extends ManagedReaderFailure {
  constructor(offset: number | null) {
    super({
      code: "resource-limit",
      scope: "metadata.representation",
      detail: `Managed metadata exceeds the ${String(MAX_METADATA_REPRESENTATION_BYTES)} byte representation budget`,
      offset,
    });
  }
}

interface CachedString {
  readonly value: string;
  readonly encodedBytes: number;
}

/** The layout owns decoding capacity and heap identity for all of its consumers. */
export class ManagedDecodeBudget {
  #remaining = MAX_METADATA_REPRESENTATION_BYTES;
  #transient = 0;
  readonly #rows = new Map<number, Set<number>>();
  readonly #strings = new Map<number, CachedString>();
  readonly #digests = new WeakMap<ArrayBufferLike, Map<string, string>>();
  readonly #prepaid = new WeakSet<object>();

  reserve(bytes: number, offset: number | null): void {
    this.#admit(bytes, offset);
    this.#remaining -= bytes;
  }

  /** Retain one bookkeeping reservation per physical row, independently of lookup replay. */
  reserveRow(table: number, row: number, offset: number): void {
    let rows = this.#rows.get(table);
    if (rows?.has(row) === true) return;
    this.reserve(256, offset);
    if (rows === undefined) {
      rows = new Set<number>();
      this.#rows.set(table, rows);
    }
    rows.add(row);
  }

  /** Bound a decoding allocation that stays live until `releaseTransient`; only retained output is reserved. */
  admitTransient(bytes: number, offset: number | null): void {
    this.#admit(bytes, offset);
    this.#transient += bytes;
  }

  /** End the current item's decoding; its bookkeeping is unreachable and only reserved output remains. */
  releaseTransient(): void {
    this.#transient = 0;
  }

  #admit(bytes: number, offset: number | null): void {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > this.#remaining - this.#transient
    )
      throw new ManagedRepresentationFailure(offset);
  }

  /** UTF-8 cannot decode to more UTF-16 units than bytes; JSON uses at most six bytes per unit. */
  reserveString(encodedBytes: number, offset: number | null): void {
    this.reserve(encodedBytes * 6 + 2, offset);
  }

  /** Snapshot buffers are immutable within a layout; cache exact backing-buffer ranges. */
  digest(bytes: Buffer, algorithm: "sha256" | "sha1"): string {
    let ranges = this.#digests.get(bytes.buffer);
    if (ranges === undefined) {
      ranges = new Map();
      this.#digests.set(bytes.buffer, ranges);
    }
    const key = `${algorithm}:${String(bytes.byteOffset)}:${String(bytes.byteLength)}`;
    const cached = ranges.get(key);
    if (cached !== undefined) return cached;
    this.reserve(256, null);
    const digest = createHash(algorithm).update(bytes).digest("hex");
    ranges.set(key, digest);
    return digest;
  }

  /** Record an admitted projection; its next serialized occurrence is already charged. */
  prepay(value: object): void {
    this.#prepaid.add(value);
  }

  /** Spend an admitted projection's charge once; repeated occurrences pay again. */
  consumePrepaid(value: object): boolean {
    return this.#prepaid.delete(value);
  }

  cachedString(index: number): CachedString | undefined {
    return this.#strings.get(index);
  }

  cacheString(index: number, value: string, encodedBytes: number): void {
    this.#strings.set(index, { value, encodedBytes });
  }
}

const budgets = new WeakMap<ManagedMetadataLayout, ManagedDecodeBudget>();

/** Transfer metadata-root admission capacity to its completed immutable layout. */
export const attachManagedDecodeBudget = (
  layout: ManagedMetadataLayout,
  budget: ManagedDecodeBudget,
): void => {
  budgets.set(layout, budget);
};

/** Share one owner for the lifetime of the admitted layout, including all inspection facets. */
export const managedDecodeBudget = (
  layout: ManagedMetadataLayout,
): ManagedDecodeBudget => {
  let budget = budgets.get(layout);
  if (budget === undefined) {
    budget = new ManagedDecodeBudget();
    budgets.set(layout, budget);
  }
  return budget;
};

/** Exact UTF-8 JSON bytes of a decoded scalar or key, including escapes. */
const jsonBytes = (item: unknown): number =>
  typeof item === "string"
    ? jsonStringByteLength(item)
    : Buffer.byteLength(JSON.stringify(item) ?? "null");

/**
 * Admit repeated values too: shared heap strings still expand at the JSON
 * boundary. An object admitted earlier was charged for one occurrence, so a
 * containing projection spends that charge instead of counting it again.
 * Admitted values must stay unmodified.
 */
export const admitManagedProjection = <Value>(
  value: Value,
  budget: ManagedDecodeBudget = new ManagedDecodeBudget(),
): Value => {
  const visit = (item: unknown): void => {
    if (
      item !== null &&
      typeof item === "object" &&
      budget.consumePrepaid(item)
    )
      return;
    if (Array.isArray(item)) {
      budget.reserve(item.length + 2, null);
      for (const child of item) visit(child);
    } else if (item !== null && typeof item === "object") {
      budget.reserve(2, null);
      for (const key of Object.keys(item)) {
        budget.reserve(jsonBytes(key) + 2, null);
        visit(Reflect.get(item, key));
      }
    } else {
      budget.reserve(jsonBytes(item), null);
    }
  };
  visit(value);
  if (value !== null && typeof value === "object") budget.prepay(value);
  return value;
};
