import { isProxy } from "node:util/types";

import type { JsonValue } from "./jsonValue.js";

const immutableSnapshots = new WeakSet<object>();
interface SnapshotEntry {
  readonly value: unknown;
  readonly exiting: boolean;
}

/** Recognize an owned JSON snapshot sealed by this module, or an immutable scalar. */
export const isImmutableJsonSnapshot = (value: unknown): value is JsonValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  (typeof value === "object" && immutableSnapshots.has(value));

/** Borrow one own member of a completed snapshot, carrying its sealing proof. */
export const immutableJsonSnapshotMember = (
  snapshot: unknown,
  key: string,
): JsonValue | undefined => {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !immutableSnapshots.has(snapshot)
  )
    return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
    return undefined;
  // Completed sealing checked and froze every reachable member. Register only
  // the selected child; do not traverse it again or add per-node weak entries.
  const member = descriptor.value as JsonValue;
  if (typeof member === "object" && member !== null)
    immutableSnapshots.add(member);
  return member;
};

/** Match a completed snapshot to its parsed representation without recursion.
 * Parsed schemas may permit optional undefined members; only exact JSON matches borrow.
 */
export const canBorrowParsedJsonSnapshot = <Parsed>(
  source: unknown,
  parsed: Parsed,
): source is Parsed => {
  if (!isImmutableJsonSnapshot(source)) return false;
  if (Object.is(source, parsed)) return true;
  const pending: unknown[] = [source, parsed];
  const compared = new Map<object, object>();
  const sources = new Map<object, object>();
  while (pending.length > 0) {
    const right = pending.pop();
    const left = pending.pop();
    if (
      typeof left !== "object" ||
      left === null ||
      typeof right !== "object" ||
      right === null
    ) {
      if (!Object.is(left, right)) return false;
      continue;
    }
    if (
      isProxy(right) ||
      Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)
    )
      return false;
    const previous = compared.get(left);
    if (previous !== undefined) {
      if (previous !== right) return false;
      continue;
    }
    if (sources.has(right)) return false;
    // Preserve sharing in both directions, including descendants of an
    // identical subtree that may also appear in a separately parsed field.
    compared.set(left, right);
    sources.set(right, left);
    const keys = Reflect.ownKeys(left);
    if (keys.length !== Reflect.ownKeys(right).length) return false;
    for (const key of keys) {
      // A parser may drop hidden fields or normalize enumerability. Generic
      // deep equality omits these differences and can borrow unparsed data.
      if (typeof key !== "string") return false;
      const a = Object.getOwnPropertyDescriptor(left, key);
      const b = Object.getOwnPropertyDescriptor(right, key);
      if (
        a === undefined ||
        b === undefined ||
        !Object.hasOwn(a, "value") ||
        !Object.hasOwn(b, "value") ||
        a.enumerable !== b.enumerable
      )
        return false;
      pending.push(a.value as unknown, b.value as unknown);
    }
  }
  return true;
};

/** Seal an already parsed, owned JSON snapshot for immutable zero-copy reuse. */
export const freezeJsonSnapshot = <T extends JsonValue>(value: T): T => {
  const pending: SnapshotEntry[] = [{ value, exiting: false }];
  // These sets exist only during traversal, while the owned root already
  // retains every child. Strong sets avoid per-node ephemeron GC work.
  const visited = new Set<object>();
  const ancestors = new Set<object>();
  const objects: object[] = [];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    const item = entry.value;
    if (entry.exiting && typeof item === "object" && item !== null) {
      ancestors.delete(item);
      visited.add(item);
      objects.push(item);
      continue;
    }
    if (isImmutableJsonSnapshot(item)) continue;
    if (typeof item !== "object" || item === null)
      throw new TypeError("Immutable JSON snapshots require JSON values");
    if (ancestors.has(item))
      throw new TypeError(
        "Immutable JSON snapshots cannot contain circular references",
      );
    if (visited.has(item)) continue;
    ancestors.add(item);
    pending.push({ value: item, exiting: true });
    pushSnapshotChildren(item, pending);
  }
  // Register only after every value is checked and every object is frozen.
  // An arbitrary Object.freeze call cannot forge this snapshot identity.
  for (const item of objects) Object.freeze(item);
  // Register the requested root, rather than retaining weak entries for every
  // nested object. Sealing an Evidence or bundle skips previously sealed roots.
  if (typeof value === "object" && value !== null)
    immutableSnapshots.add(value);
  return value;
};

/**
 * Seal a freshly parsed, exclusively owned JSON tree. Its parser has removed
 * aliases, accessors and hidden properties; existing sealed subtrees may be shared.
 * Keep only the active ancestry rather than retaining every completed object.
 * Unlike general graph sealing, failure can leave this provisional tree frozen.
 */
export const freezeOwnedJsonTreeSnapshot = <T extends JsonValue>(
  value: T,
): T => {
  const frames: { value: object; children: Iterator<unknown> }[] = [];
  const ancestors = new Set<object>();
  const enter = (item: unknown): void => {
    if (isImmutableJsonSnapshot(item)) return;
    if (typeof item !== "object" || item === null)
      throw new TypeError("Immutable JSON snapshots require JSON values");
    if (isProxy(item))
      throw new TypeError("Immutable JSON snapshots cannot contain proxies");
    if (ancestors.has(item))
      throw new TypeError(
        "Immutable JSON snapshots cannot contain circular references",
      );
    const prototype: unknown = Object.getPrototypeOf(item);
    if (
      !Array.isArray(item) &&
      prototype !== Object.prototype &&
      prototype !== null
    )
      throw new TypeError("Immutable JSON snapshots require ordinary objects");
    ancestors.add(item);
    frames.push({ value: item, children: ownedTreeChildren(item) });
  };
  enter(value);
  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    const next = frame.children.next();
    if (!next.done) enter(next.value);
    else {
      Object.freeze(frame.value);
      ancestors.delete(frame.value);
      frames.pop();
    }
  }
  if (typeof value === "object" && value !== null)
    immutableSnapshots.add(value);
  return value;
};

function* ownedTreeChildren(value: object): Generator<unknown> {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
        throw new TypeError("Owned JSON trees require dense data arrays");
      yield descriptor.value;
    }
  } else {
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
        throw new TypeError(
          "Immutable JSON snapshots cannot contain accessors",
        );
      yield descriptor.value;
    }
  }
}

/**
 * Seal exclusively owned JSON in bounded steps, authenticating only completion.
 * Abandonment or failure can leave the provisional input partly frozen.
 */
export function* freezeOwnedJsonSnapshotSteps<T extends JsonValue>(
  value: T,
): Generator<void, T> {
  const pending: SnapshotEntry[] = [{ value, exiting: false }];
  const visited = new Set<object>();
  const ancestors = new Set<object>();
  let examined = 0;
  try {
    while (pending.length > 0) {
      if (examined++ === 4096) {
        examined = 0;
        yield;
      }
      const entry = pending.pop();
      if (entry === undefined) break;
      const item = entry.value;
      if (entry.exiting && typeof item === "object" && item !== null) {
        ancestors.delete(item);
        visited.add(item);
        continue;
      }
      if (isImmutableJsonSnapshot(item)) continue;
      if (typeof item !== "object" || item === null)
        throw new TypeError("Immutable JSON snapshots require JSON values");
      if (ancestors.has(item))
        throw new TypeError(
          "Immutable JSON snapshots cannot contain circular references",
        );
      if (visited.has(item)) continue;
      ancestors.add(item);
      pending.push({ value: item, exiting: true });
      pushSnapshotChildren(item, pending);
      // Lock every inspected edge before the scheduler can release control.
      Object.freeze(item);
    }
    if (typeof value === "object" && value !== null)
      immutableSnapshots.add(value);
    return value;
  } finally {
    pending.length = 0;
    visited.clear();
    ancestors.clear();
  }
}

const pushSnapshotChildren = (item: object, pending: SnapshotEntry[]): void => {
  if (isProxy(item))
    throw new TypeError("Immutable JSON snapshots cannot contain proxies");
  const prototype: unknown = Object.getPrototypeOf(item);
  if (
    !Array.isArray(item) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    throw new TypeError("Immutable JSON snapshots require ordinary objects");
  if (Array.isArray(item))
    for (let index = 0; index < item.length; index += 1)
      if (!Object.hasOwn(item, index))
        throw new TypeError(
          "Immutable JSON snapshots cannot contain sparse arrays",
        );
  for (const key of Object.getOwnPropertyNames(item)) {
    const descriptor = Object.getOwnPropertyDescriptor(item, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
      throw new TypeError("Immutable JSON snapshots cannot contain accessors");
    const child: unknown = descriptor.value;
    pending.push({ value: child, exiting: false });
  }
};
