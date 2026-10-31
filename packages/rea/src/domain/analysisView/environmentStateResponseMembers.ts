import { canonicalJson } from "../comparisonSemantics.js";
import type { JsonValue } from "../jsonValue.js";
import { compareUnicodeCodePoints as compare } from "../unicodeCodePointOrder.js";
import {
  isObject,
  normalizedPath,
  replaceAt,
  type JsonObject,
  type StateRecordFacts,
} from "./environmentStateRules.js";
import { isUuid, readClock } from "./environmentStateWriteValues.js";
import { ENTRY_BYTES, textBytes } from "./webNetworkRouteTemplates.js";

/** Fewest repeats, across the capture, that show a member minted on every response rather than changed once. */
const MINIMUM_REPEATS = 2;

/** The paths whose repeated reads showed each member minted anew, so only views of those paths leave it out. */
export type MintedMembers = ReadonlyMap<string, ReadonlySet<string>>;

const succeeded = (record: StateRecordFacts): boolean =>
  record.status !== null && record.status >= 200 && record.status < 300;

/** A body's top-level members whose value looks minted: a UUID or a clock reading. */
const mintedValues = (
  body: JsonValue | undefined,
): Map<string, string> | undefined => {
  if (body === undefined || !isObject(body)) return undefined;
  const values = new Map<string, string>();
  for (const [name, value] of Object.entries(body))
    if (
      typeof value === "string" &&
      value.length <= 64 &&
      (isUuid(value) || readClock(value) !== undefined)
    )
      values.set(name, value);
  return values;
};

interface Repeats {
  differ: number;
  same: number;
}

const tally = (
  counts: Map<string, Repeats>,
  key: string,
  differ: boolean,
  retain: (bytes: number) => void,
): void => {
  let entry = counts.get(key);
  if (entry === undefined) {
    retain(ENTRY_BYTES * 2 + textBytes(key.length));
    entry = { differ: 0, same: 0 };
    counts.set(key, entry);
  }
  if (differ) entry.differ += 1;
  else entry.same += 1;
};

/** The successful GET reads that repeat their line with no write between, as line, earlier and later read: only those can show a member minted, so only those are parsed. */
const repeatPairs = (
  input: Pick<
    Parameters<typeof perResponseMembers>[0],
    "records" | "writeWithin" | "retain"
  >,
): (readonly [string, StateRecordFacts, StateRecordFacts])[] => {
  const previous = new Map<string, StateRecordFacts>();
  const pairs: (readonly [string, StateRecordFacts, StateRecordFacts])[] = [];
  for (const record of input.records) {
    if (record.method !== "GET" || !succeeded(record)) continue;
    const line = `${record.path}?${record.query ?? ""}`;
    const earlier = previous.get(line);
    input.retain(
      earlier === undefined ? ENTRY_BYTES * 2 + textBytes(line.length) : 0,
    );
    previous.set(line, record);
    if (earlier === undefined || input.writeWithin(earlier, record)) continue;
    input.retain(ENTRY_BYTES * 3);
    pairs.push([line, earlier, record]);
  }
  return pairs;
};

/** The members minted per path: differing on every repeat there, and across the capture on enough repeats and never the same. */
const mintedOf = (
  byPath: ReadonlyMap<string, Repeats>,
  byName: ReadonlyMap<string, Repeats>,
): Map<string, Set<string>> => {
  const minted = new Map<string, Set<string>>();
  for (const [key, counts] of byPath) {
    const [path, name] = JSON.parse(key) as [string, string];
    const overall = byName.get(name)!;
    if (counts.same > 0 || counts.differ === 0) continue;
    if (overall.same > 0 || overall.differ < MINIMUM_REPEATS) continue;
    minted.set(path, (minted.get(path) ?? new Set()).add(name));
  }
  return minted;
};

/**
 * Per path, the top-level members each response mints: a UUID or clock that differs on every repeat of that path's
 * successful GET lines with no write between, where the member also differed on at least two repeats in the
 * capture and never stayed the same. Each body is read once; only its minted-looking values are kept.
 */
export const perResponseMembers = (input: {
  /** Records in timeline order. */
  readonly records: readonly StateRecordFacts[];
  readonly withBody: <T>(
    ordinal: number,
    use: (body: JsonValue | undefined) => T,
  ) => T;
  readonly writeWithin: (
    earlier: StateRecordFacts,
    later: StateRecordFacts,
  ) => boolean;
  readonly retain: (bytes: number) => void;
  /** Mark the retained bytes; the returned call releases the scan's line memory. */
  readonly checkpoint: () => () => void;
}): MintedMembers => {
  const release = input.checkpoint();
  const pairs = repeatPairs(input);
  // Each read is parsed once: a line's later read is kept for the next pair of that line.
  const parsed = new Map<
    string,
    { ordinal: number; values: Map<string, string> | undefined }
  >();
  const valuesOf = (line: string, record: StateRecordFacts) => {
    const kept = parsed.get(line);
    if (kept?.ordinal === record.ordinal) return kept.values;
    const values = input.withBody(record.ordinal, mintedValues);
    for (const [name, value] of values ?? [])
      input.retain(ENTRY_BYTES + textBytes(name.length + value.length));
    return values;
  };
  const byPath = new Map<string, Repeats>();
  const byName = new Map<string, Repeats>();
  for (const [line, earlier, record] of pairs) {
    const before = valuesOf(line, earlier);
    const after = valuesOf(line, record);
    parsed.set(line, { ordinal: record.ordinal, values: after });
    if (before === undefined || after === undefined) continue;
    const path = normalizedPath(record.path);
    for (const name of new Set([...before.keys(), ...after.keys()])) {
      // A member minted-looking on one side only is not minted on every response.
      const was = before.get(name);
      const now = after.get(name);
      const differ = was !== undefined && now !== undefined && was !== now;
      tally(byPath, JSON.stringify([path, name]), differ, input.retain);
      tally(byName, name, differ, input.retain);
    }
  }
  const minted = mintedOf(byPath, byName);
  release();
  for (const [path, names] of minted)
    input.retain(
      ENTRY_BYTES * 2 +
        textBytes(path.length) +
        [...names].reduce(
          (bytes, name) => bytes + ENTRY_BYTES + textBytes(name.length),
          0,
        ),
    );
  return minted;
};

/** Only members proved minted on every concrete path this shared view answers may be masked in its envelope. */
export const mintedFor = (
  minted: MintedMembers,
  records: readonly Pick<StateRecordFacts, "path">[],
): ReadonlySet<string> => {
  let common: Set<string> | undefined;
  for (const path of new Set(
    records.map((record) => normalizedPath(record.path)),
  )) {
    const names = minted.get(path);
    if (names === undefined) return new Set();
    if (common === undefined) common = new Set(names);
    else for (const name of common) if (!names.has(name)) common.delete(name);
    if (common.size === 0) return common;
  }
  return common ?? new Set();
};

/** The first member a pointer names, which holds the entity rather than the envelope. */
const pointerRoot = (pointer: string): string =>
  pointer.slice(1).split("/")[0]!.replaceAll("~1", "/").replaceAll("~0", "~");

/** Of these names, the top-level members a body carries outside the entity at `pointer`, or anywhere in a document (no pointer); none when the entity is the whole body. */
export const envelopeMembers = (
  body: JsonValue | undefined,
  names: ReadonlySet<string>,
  pointer?: string,
): string[] => {
  if (body === undefined || !isObject(body) || pointer === "") return [];
  const root = pointer === undefined ? undefined : pointerRoot(pointer);
  return Object.keys(body)
    .filter((name) => names.has(name) && name !== root)
    .sort(compare);
};

/** The body with the named top-level members set to null, so values each response mints do not decide a comparison. */
export const withoutMembers = (
  body: JsonValue,
  names: readonly string[] | undefined,
): JsonValue => {
  if (names === undefined || names.length === 0 || !isObject(body)) return body;
  const copy: JsonObject = { ...body };
  for (const name of names) if (Object.hasOwn(copy, name)) copy[name] = null;
  return copy;
};

/** An item recording's envelope without its entity and minted members, and those members. */
export const mintedEnvelope = (
  body: JsonValue,
  pointer: string,
  names: ReadonlySet<string>,
): { readonly skeleton: string; readonly members: string[] } => {
  const members = envelopeMembers(body, names, pointer);
  return {
    skeleton: canonicalJson(
      withoutMembers(replaceAt(body, pointer, null), members),
      "Environment state",
    ),
    members,
  };
};

/** The view member naming the minted members it leaves out, charged as retained output; none when there are none. */
export const declaredMembers = (
  members: readonly string[] | undefined,
  retain: (bytes: number) => void,
): { readonly per_response_members?: string[] } => {
  if (members === undefined || members.length === 0) return {};
  for (const name of members) retain(ENTRY_BYTES + textBytes(name.length));
  return { per_response_members: [...members] };
};
