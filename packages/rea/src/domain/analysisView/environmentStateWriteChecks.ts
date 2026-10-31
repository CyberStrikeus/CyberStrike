import { ServedOrder } from "./environmentStateWriteOrder.js";
import type { JsonValue } from "../jsonValue.js";
import { compositeKey } from "../unicodeCodePointOrder.js";
import {
  ownMember,
  at,
  decodedSegment,
  deletedFlag,
  isObject,
  listItems,
  listsAll,
  markedDeleted,
  missingRequiredFields,
  pathSegmentMatches,
  renderStateEntity,
  renderStateList,
  replaceAt,
  same,
  scalarText,
  type JsonObject,
  type StateDocument,
  type StateEntity,
  type StateItemView,
  type StateListView,
  type StateRecordFacts,
  type StateView,
  segmentsOf,
} from "./environmentStateRules.js";
import { pageBound } from "./environmentStatePaging.js";
import { answerQuery, renderQueryList } from "./environmentStateListQuery.js";
import { singleQueryValues } from "../recordedTransportUrl.js";
import type { ServedLine } from "./environmentStateCheckedLines.js";
import { insertIndex } from "./environmentStateWriteExplain.js";
import type { InsertRule } from "./environmentStateWriteRules.js";
import { withoutMembers } from "./environmentStateResponseMembers.js";

export const entityTarget = (type: string, collection: string, id: string) =>
  `e${compositeKey([type, collection, id])}`;
export const collectionTarget = (type: string, collection: string) =>
  `c${compositeKey([type, collection])}`;
export const documentTarget = (tool: string) => `d${compositeKey([tool])}`;

/** A target `remove` dropped, so a later absence can still name the collection and id serving resolved. */
interface RemovedTarget {
  readonly type: string;
  readonly collection: string;
  readonly id: string;
}

/** The gate's copy of the state: entities in collection order and documents, changed by modelled writes. */
/** A write since a list in collection order last showed its entity, with the values it replaced (`null` for a create). */
export interface PendingWrite {
  readonly target: string;
  readonly before: JsonObject | null;
}

export class SimulatedState {
  readonly #entities = new Map<string, StateEntity>();
  readonly #collections = new Map<string, string[]>();
  readonly #documents = new Map<string, JsonValue>();
  readonly #removed: StateEntity[] = [];
  readonly #served = new ServedOrder();
  /** Each held id's targets, of any type. */
  readonly #named = new Map<string, Set<string>>();
  /** The order a type's collections keep their entities in, as its creates insert them. */
  #sortOf: (type: string) => InsertRule | undefined = () => undefined;
  /** The values each entity put since `track` replaced, `null` for one a put added. */
  readonly #prior = new Map<string, JsonObject | null>();

  constructor(
    entities: readonly StateEntity[],
    documents: readonly StateDocument[],
  ) {
    for (const entity of entities) {
      if (markedDeleted(entity.fields)) this.#removed.push(entity);
      else this.put(entity);
    }
    this.#served.reset(
      entities
        .filter((entity) => !markedDeleted(entity.fields))
        .map(({ type, collection, id }) => entityTarget(type, collection, id)),
    );
    for (const document of documents)
      this.#documents.set(document.tool, document.value);
  }

  entity(
    type: string,
    collection: string,
    id: string,
  ): StateEntity | undefined {
    return this.#entities.get(entityTarget(type, collection, id));
  }

  members(type: string, collection: string): StateEntity[] {
    return (
      this.#collections.get(collectionTarget(type, collection)) ?? []
    ).map((key) => this.#entities.get(key)!);
  }

  ofType(type: string): StateEntity[] {
    return this.#served.keys
      .map((key) => this.#entities.get(key)!)
      .filter((entity) => entity.type === type);
  }

  /** The entities of any type held under an id. */
  named(id: string): StateEntity[] {
    return [...(this.#named.get(id) ?? [])].map((key) =>
      this.#entities.get(key)!,
    );
  }

  knownCollections(type: string): readonly string[] {
    return this.#served.known(type);
  }

  /** Keep each type's collections in the order its creates insert by, which a change to the field sorted by moves an entity in. */
  keepSorted(sortOf: (type: string) => InsertRule | undefined): void {
    this.#sortOf = sortOf;
  }

  /** Replace an entity, moving it when its collection is sorted by a field it changed, or add it at `index` of its collection (the end when omitted). */
  put(entity: StateEntity, index?: number): void {
    const key = entityTarget(entity.type, entity.collection, entity.id);
    const held = this.#entities.get(key);
    if (!this.#prior.has(key)) this.#prior.set(key, held?.fields ?? null);
    this.#entities.set(key, entity);
    if (held !== undefined) {
      this.#resort(held, entity);
      return;
    }
    this.#named.set(
      entity.id,
      (this.#named.get(entity.id) ?? new Set()).add(key),
    );
    const collection = collectionTarget(entity.type, entity.collection);
    const order = this.#collections.get(collection) ?? [];
    const at = index ?? order.length;
    this.#served.place(key, order, at);
    order.splice(at, 0, key);
    this.#collections.set(collection, order);
    this.#served.remember(entity.type, entity.collection);
  }

  /** Start recording the values the next puts replace. */
  track(): void {
    this.#prior.clear();
  }

  /** The values an entity held before its first put since `track`: `null` when that put added it, undefined when none did. */
  priorFields(key: string): JsonObject | null | undefined {
    return this.#prior.get(key);
  }

  /**
   * A collection's entity keys in the order serving gives when each of `writes` moves its entity in turn by `rule`,
   * against the others' values before their own writes, or a create inserts it; undefined when that misses an entity.
   */
  replayedOrder(
    type: string,
    collection: string,
    rule: Extract<InsertRule, { rule: "sorted" }>,
    writes: readonly PendingWrite[],
  ): string[] | undefined {
    const before =
      this.#collections.get(collectionTarget(type, collection)) ?? [];
    const held = new Set(before);
    const ours = writes.filter((write) => held.has(write.target));
    const first = new Map<string, JsonObject | null>();
    for (const write of ours)
      if (!first.has(write.target)) first.set(write.target, write.before);
    const order = before
      .filter((key) => first.get(key) !== null)
      .map((key) => ({
        key,
        fields: first.get(key) ?? this.#entities.get(key)!.fields,
      }));
    for (const [index, { target: key, before: prior }] of ours.entries()) {
      const fields =
        ours.slice(index + 1).find((later) => later.target === key)?.before ??
        this.#entities.get(key)!.fields;
      const at = order.findIndex((member) => member.key === key);
      if ((prior === null) !== at < 0) continue;
      if (at >= 0) order.splice(at, 1);
      const moved =
        prior === null ||
        !same(ownMember(prior, rule.field), ownMember(fields, rule.field));
      order.splice(
        moved
          ? insertIndex(
              rule,
              order.map((member) => member.fields),
              fields,
            )
          : at,
        0,
        { key, fields },
      );
    }
    return order.length === before.length
      ? order.map((member) => member.key)
      : undefined;
  }

  /** Put a collection's entities in the order `replayedOrder` gives, returning the order they had. */
  replay(
    type: string,
    collection: string,
    rule: Extract<InsertRule, { rule: "sorted" }>,
    writes: readonly PendingWrite[],
  ): string[] {
    const before =
      this.#collections.get(collectionTarget(type, collection)) ?? [];
    const order = this.replayedOrder(type, collection, rule, writes);
    if (order !== undefined) this.restore(type, collection, order);
    return before;
  }

  /** Put a collection's entities back in an order `replay` returned. */
  restore(type: string, collection: string, keys: readonly string[]): void {
    this.#served.arrange(keys);
    this.#collections.set(collectionTarget(type, collection), [...keys]);
  }

  /** Move an entity whose sorted field changed to where its collection's order now puts it. */
  #resort(before: StateEntity, after: StateEntity): void {
    const rule = this.#sortOf(after.type);
    if (
      rule?.rule !== "sorted" ||
      same(
        ownMember(before.fields, rule.field),
        ownMember(after.fields, rule.field),
      )
    )
      return;
    const key = entityTarget(after.type, after.collection, after.id);
    const collection = collectionTarget(after.type, after.collection);
    const others = (this.#collections.get(collection) ?? []).filter(
      (member) => member !== key,
    );
    if (others.length === 0) return;
    const at = insertIndex(
      rule,
      others.map((member) => this.#entities.get(member)!.fields),
      after.fields,
    );
    this.#served.remove(key);
    this.#served.place(key, others, at);
    others.splice(at, 0, key);
    this.#collections.set(collection, others);
  }

  remove(entity: StateEntity): void {
    const key = entityTarget(entity.type, entity.collection, entity.id);
    this.#entities.delete(key);
    this.#named.get(entity.id)?.delete(key);
    this.#served.remove(key);
    const collection = collectionTarget(entity.type, entity.collection);
    const order = this.#collections.get(collection) ?? [];
    this.#collections.set(
      collection,
      order.filter((member) => member !== key),
    );
    const index = this.#removed.findIndex(
      (target) =>
        target.type === entity.type &&
        target.collection === entity.collection &&
        target.id === entity.id,
    );
    if (index >= 0) this.#removed.splice(index, 1);
    this.#removed.push(entity);
  }

  deleted(
    type: string,
    collection: string,
    id: string,
  ): StateEntity | undefined {
    return this.#removed.find(
      (entity) =>
        entity.type === type &&
        entity.collection === collection &&
        entity.id === id,
    );
  }

  /** Removed targets of this type the state does not hold again. */
  removedTargets(type: string): readonly RemovedTarget[] {
    return this.#removed.filter(
      (target) =>
        target.type === type &&
        !this.#entities.has(entityTarget(type, target.collection, target.id)),
    );
  }

  /** Place created entities again as a create under another insert rule would have. */
  reinsert(
    type: string,
    collection: string,
    entities: readonly StateEntity[],
    rule: InsertRule,
  ): void {
    for (const entity of entities) this.remove(entity);
    for (const entity of entities) {
      const order = this.members(type, collection).map(
        (member) => member.fields,
      );
      this.put(entity, insertIndex(rule, order, entity.fields));
    }
  }

  document(tool: string): JsonValue | undefined {
    return this.#documents.get(tool);
  }

  setDocument(tool: string, value: JsonValue): void {
    this.#documents.set(tool, value);
  }
}

/** An item read status that says the entity does not exist: 400, 404 or 410, as applications answer a missing id. */
export const isAbsence = (status: number | null): boolean =>
  status === 400 || status === 404 || status === 410;

/** A 2xx record: the only status whose response shows what a request did. */
export const succeeded = (record: StateRecordFacts): boolean =>
  record.status !== null && record.status >= 200 && record.status < 300;

/** Hand a base recording's body and a read's body to `use` together, parsing a recording once when both are the same. */
export const withBodies = <T>(
  withBody: <U>(ordinal: number, use: (body: JsonValue | undefined) => U) => U,
  ordinals: { readonly base: number; readonly read: number },
  use: (base: JsonValue | undefined, body: JsonValue | undefined) => T,
): T => {
  const { base, read } = ordinals;
  return base === read
    ? withBody(read, (body) => use(body, body))
    : withBody(base, (served) => withBody(read, (body) => use(served, body)));
};

/** A check's outcome and the targets it covered. */
export interface CheckOutcome {
  readonly pass: boolean;
  /** The entities, by target, whose place a list read shows state order decides; absent, every listed entity's. */
  readonly positional?: ReadonlySet<string>;
  readonly targets: readonly string[];
  /** Entities the recording, or the served base of a recorded-membership list, lists that the state does not hold, by target. */
  readonly unheld: readonly string[];
  /** For a failed list read that differs only in some members' fields, those members' targets. */
  readonly differing?: readonly string[];
  /** Required fields the read shows the application leaves out of entities the state holds. */
  readonly omitted?: readonly string[];
}

/** Whether a passing check shows where a create placed its entity: a list's does unless a sort orders that entity, leaving it tied with none, or it matched alone. */
export const showsPlacement = (
  view: StateView,
  outcome: Pick<CheckOutcome, "positional">,
  inserted: ReadonlyMap<string, string>,
  tool: string,
): boolean =>
  view.shape === "list" &&
  (outcome.positional === undefined ||
    [...inserted].some(
      ([target, create]) => create === tool && outcome.positional!.has(target),
    ));

/** What a check compares: the read's recorded body and the served base recording it would answer on. */
export interface ReadBodies {
  readonly body: JsonValue | undefined;
  /** The recording whose envelope the served answer keeps: an item view's envelope, a list line's latest init recording. */
  readonly base: JsonValue | undefined;
  readonly volatile: ReadonlySet<string>;
}

/** An item read: the answer the held entity renders into the served envelope must equal the recording; a recorded 404 or 410 agrees with none held. */
/** How many of a held collection's segments match a path's verbatim, or undefined when one matches neither verbatim nor either spelling once percent-decoded. */
const segmentMatch = (
  held: readonly string[],
  read: readonly string[],
): number | undefined => {
  if (held.length !== read.length) return undefined;
  let verbatim = 0;
  for (const [index, segment] of held.entries()) {
    const value = read[index]!;
    if (segment === value) verbatim += 1;
    else if (!pathSegmentMatches(segment, value)) return undefined;
  }
  return verbatim;
};

/** A held target an item path names, preferring the path's own collection, then a verbatim spelling. */
const matchingTarget = (
  path: {
    readonly read: readonly string[];
    readonly ids: readonly string[];
    readonly written: string;
  },
  /** Called only when the path's own collection holds none of its ids, since listing walks the type's entities. */
  collections: () => readonly string[],
  held: (collection: string, id: string) => boolean,
): { readonly collection: string; readonly id: string } | undefined => {
  for (const id of path.ids)
    if (held(path.written, id)) return { collection: path.written, id };
  const ranked = [...new Set(collections())]
    .flatMap((collection) => {
      const verbatim = segmentMatch(segmentsOf(collection), path.read);
      return verbatim === undefined ? [] : [{ collection, verbatim }];
    })
    .sort((left, right) => right.verbatim - left.verbatim);
  for (const { collection } of ranked)
    for (const id of path.ids)
      if (held(collection, id)) return { collection, id };
  return undefined;
};

/**
 * The entity an item read or write names, as serving names it: in a held collection its path matches, verbatim
 * spellings first, the id percent-decoded once, then as written; else a removed target still named that way, so
 * an absence keeps the collection and id a delete resolved; else the collection and decoded id as written.
 */
export const itemTarget = (
  state: SimulatedState,
  type: string,
  record: Pick<StateRecordFacts, "path">,
): { readonly collection: string; readonly id: string } => {
  const read = segmentsOf(record.path);
  const raw = read.pop() ?? "";
  return targetFrom(state, type, {
    read,
    ids: [...new Set([decodedSegment(raw), raw])],
    written: `/${read.join("/")}`,
  });
};

/** A JSON body's identity is literal, independent of URL escaping or path-segment syntax. */
export const bodyTarget = (
  state: SimulatedState,
  type: string,
  read: readonly string[],
  id: string,
): { readonly collection: string; readonly id: string } =>
  targetFrom(state, type, { read, ids: [id], written: `/${read.join("/")}` });

const targetFrom = (
  state: SimulatedState,
  type: string,
  path: {
    readonly read: readonly string[];
    readonly ids: readonly string[];
    readonly written: string;
  },
): { readonly collection: string; readonly id: string } => {
  const removed = state.removedTargets(type);
  return (
    matchingTarget(
      path,
      () => state.ofType(type).map((entity) => entity.collection),
      (collection, id) => state.entity(type, collection, id) !== undefined,
    ) ??
    matchingTarget(
      path,
      () => removed.map((target) => target.collection),
      (collection, id) =>
        removed.some(
          (target) => target.collection === collection && target.id === id,
        ),
    ) ?? { collection: path.written, id: path.ids[0]! }
  );
};

/** The held collection of a type a path names, as serving picks a create's: the most verbatim spelling, else the path as written. */
export const heldCollection = (
  state: SimulatedState,
  type: string,
  path: string,
): string => {
  const read = segmentsOf(path);
  let held: string | undefined;
  let verbatim = -1;
  for (const collection of new Set(
    state.ofType(type).map((entity) => entity.collection),
  )) {
    const matched = segmentMatch(segmentsOf(collection), read);
    if (matched !== undefined && matched > verbatim) {
      held = collection;
      verbatim = matched;
    }
  }
  return held ?? `/${read.join("/")}`;
};

export const checkItemRead = (
  state: SimulatedState,
  view: StateItemView,
  record: StateRecordFacts,
  check: ReadBodies,
): CheckOutcome | undefined => {
  const { collection, id } = itemTarget(state, view.type, record);
  const entity = state.entity(view.type, collection, id);
  const targets = [entityTarget(view.type, collection, id)];
  if (isAbsence(record.status) || (succeeded(record) && check.body === null))
    return { pass: entity === undefined, targets, unheld: [] };
  if (!succeeded(record) || check.base === undefined) return undefined;
  const object =
    check.body === undefined ? undefined : at(check.body, view.pointer);
  // A usable body that no longer holds the entity is not what serving answers for one it holds.
  if (!isObject(object))
    return check.body === undefined || entity === undefined
      ? undefined
      : { pass: false, targets, unheld: [] };
  // Serving keeps a removed entity's fields and changes only the soft-delete flag.
  const flag = deletedFlag(object);
  if (flag !== undefined) {
    const removed = state.deleted(view.type, collection, id);
    if (entity !== undefined) return { pass: false, targets, unheld: [] };
    if (removed === undefined) return { pass: true, targets, unheld: [] };
    const deleted = { ...removed, fields: { ...removed.fields, [flag]: true } };
    const shown = renderStateEntity(deleted, view, check.volatile, object);
    return {
      pass: same(replaceAt(check.base, view.pointer, shown), check.body),
      targets,
      unheld: [],
    };
  }
  if (entity === undefined) return { pass: false, targets, unheld: targets };
  // Serving refuses an entity lacking a field every recording carried, so no read can confirm one.
  if (missingRequiredFields(entity, view, check.volatile).length > 0)
    return { pass: false, targets, unheld: [] };
  const shown = renderStateEntity(entity, view, check.volatile, object);
  return {
    pass: same(replaceAt(check.base, view.pointer, shown), check.body),
    targets,
    unheld: [],
  };
};

/** A list read's bodies with the listed items of the read and of its served base. */
interface ListBodies {
  readonly body: JsonValue;
  readonly base: JsonValue;
  readonly items: readonly JsonObject[];
  readonly baseItems: readonly JsonObject[];
  readonly idField: string;
  readonly volatile: ReadonlySet<string>;
  /** The collection serving lists: the answering line's. */
  readonly collection: string;
}

/** The served list rendered from the base with `members`, compared with the read; volatile fields take the read's values. */
const listCheck = (
  view: StateListView,
  check: ListBodies,
  members: readonly StateEntity[],
  /** The matches a whole or query answer counts; undefined for recorded members, whose totals stay as recorded. */
  total: number | undefined,
): Pick<CheckOutcome, "pass" | "differing"> => {
  if (
    members.some(
      (entity) =>
        missingRequiredFields(entity, view, check.volatile).length > 0,
    )
  )
    return { pass: false };
  const observed = new Map(
    check.items.map((item) => [
      scalarText(ownMember(item, check.idField)) ?? "",
      item,
    ]),
  );
  const rendered = members.map((entity) =>
    renderStateEntity(entity, view, check.volatile, observed.get(entity.id)),
  );
  const render = (items: readonly JsonObject[]): JsonValue =>
    view.query === undefined || total === undefined
      ? renderStateList(view, check.base, items)
      : renderQueryList(
          { ...view, query: view.query },
          check.base,
          items,
          total,
        );
  if (same(render(rendered), check.body)) return { pass: true };
  // When the recorded members alone account for the difference, only they differ.
  const differs = members.filter((entity, index) => {
    const item = observed.get(entity.id);
    return item !== undefined && !same(rendered[index], item);
  });
  const patched = rendered.map(
    (item, index) => observed.get(members[index]!.id) ?? item,
  );
  return differs.length > 0 && same(render(patched), check.body)
    ? {
        pass: false,
        differing: differs.map((entity) =>
          entityTarget(view.type, check.collection, entity.id),
        ),
      }
    : { pass: false };
};

/** The base line's and the read's listed entities by target: those the state holds, and those it no longer does. */
const listedTargets = (
  state: SimulatedState,
  view: StateListView,
  check: ListBodies,
): { readonly targets: string[]; readonly unheld: string[] } => {
  const targets: string[] = [];
  const unheld: string[] = [];
  const ids = [...check.baseItems, ...check.items].map(
    (item) => scalarText(ownMember(item, check.idField)) ?? "",
  );
  for (const id of new Set(ids))
    (state.entity(view.type, check.collection, id) === undefined
      ? unheld
      : targets
    ).push(entityTarget(view.type, check.collection, id));
  return { targets, unheld };
};

/**
 * A list read on a line the query answers: the query's matches in the state, in its order and page. Only a line whose
 * parameters all sort or page, and that shows every match, covers the collection; any other covers the entities it lists.
 */
const checkQueryList = (
  state: SimulatedState,
  view: StateListView,
  check: ListBodies,
  values: ReadonlyMap<string, string>,
): CheckOutcome | undefined => {
  const { collection } = check;
  const result = answerQuery(
    view.query!,
    values,
    state.members(view.type, collection),
  );
  if (result === undefined) return undefined;
  const outcome = listCheck(view, check, result.page, result.total);
  return {
    ...outcome,
    // A lone match has no neighbour whose order it shows, so it shows nothing of where a create put it.
    ...(result.positional === "all" && result.total > 1
      ? {}
      : {
          positional: new Set(
            (result.positional === "all" ? [] : result.positional).map(
              (entity) => entityTarget(view.type, collection, entity.id),
            ),
          ),
        }),
    targets: [
      ...new Set([
        ...(result.whole ? [collectionTarget(view.type, collection)] : []),
        ...result.page.map((entity) =>
          entityTarget(view.type, collection, entity.id),
        ),
        // A failed read also covers the held entities it lists, as a write may have moved them out of the answer.
        ...(outcome.pass
          ? []
          : listedTargets(state, view, { ...check, baseItems: [] }).targets),
      ]),
    ],
    // What the base line or the read listed that the state no longer holds: the read shows whether it went.
    unheld: listedTargets(state, view, check).unheld,
  };
};

/** A list read of every entity of a collection: membership, order, fields and counters must render from the state. */
const checkAllList = (
  state: SimulatedState,
  view: StateListView,
  check: ListBodies,
): CheckOutcome => {
  const { collection } = check;
  const members = state.members(view.type, collection);
  const held = new Set(members.map((entity) => entity.id));
  return {
    ...listCheck(view, check, members, members.length),
    targets: [
      collectionTarget(view.type, collection),
      ...members.map((entity) =>
        entityTarget(view.type, collection, entity.id),
      ),
    ],
    unheld: check.items
      .map((item) => scalarText(ownMember(item, check.idField)) ?? "")
      .filter((id) => !held.has(id))
      .map((id) => entityTarget(view.type, collection, id)),
  };
};

/** A list read of recorded members: the served list holds the base's members the state still holds, so a member it dropped or never listed fails. */
const checkRecordedList = (
  state: SimulatedState,
  view: StateListView,
  check: ListBodies,
): CheckOutcome => {
  const { collection } = check;
  const idOf = (item: JsonObject) =>
    scalarText(ownMember(item, check.idField)) ?? "";
  const members = check.baseItems.flatMap((item) => {
    const entity = state.entity(view.type, collection, idOf(item));
    return entity === undefined ? [] : [entity];
  });
  return {
    ...listCheck(view, check, members, undefined),
    ...listedTargets(state, view, check),
  };
};

/** The read's query values when serving evaluates the query for it: on a named query line, or with query values on a line it did not name. */
const evaluatedQuery = (
  view: StateListView,
  record: StateRecordFacts,
  line: ServedLine,
): ReadonlyMap<string, string> | undefined =>
  (
    line.named
      ? view.query?.record_ordinals.includes(line.ordinal) === true
      : line.queried === true
  )
    ? singleQueryValues(record.query)
    : undefined;

/** A list read on a checked line, compared with the answer the served environment renders on that line's base recording from the collection it names: every entity when that line lists them all. */
export const checkListRead = (
  state: SimulatedState,
  view: StateListView,
  record: StateRecordFacts,
  check: ReadBodies & {
    readonly idField: string;
    readonly collection: string;
    /** The checked line serving answers the read on. */
    readonly line: ServedLine;
  },
): CheckOutcome | undefined => {
  if (!succeeded(record)) return undefined;
  const { line } = check;
  const query = evaluatedQuery(view, record, line);
  const all = query === undefined && listsAll(view, line.ordinal);
  const { body, base } = check;
  const baseItems =
    base === undefined ? undefined : listItems(base, view.pointer);
  if (body === undefined || base === undefined || baseItems === undefined)
    return undefined;
  // Serving answers a page too small for the collection from its recording, so such a read checks nothing.
  const size = pageBound(record.query, baseItems.length);
  if (
    all &&
    size !== undefined &&
    state.members(view.type, check.collection).length > size
  )
    return undefined;
  // A usable body that no longer holds the list is not what serving answers on this line.
  const items = listItems(body, view.pointer);
  // A line the read did not name keeps its own call's envelope, such as a link naming that call's values, which no write changes.
  const envelope = line.named || items === undefined ? base : body;
  // A query answered on a line the read did not name lists none of that line's members, so only the read's show what the state no longer holds.
  const bodies = {
    ...check,
    body,
    base: envelope,
    items: items ?? [],
    baseItems: line.named || query === undefined ? baseItems : [],
  };
  const outcome =
    query !== undefined
      ? checkQueryList(state, view, bodies, query)
      : all
        ? checkAllList(state, view, bodies)
        : checkRecordedList(state, view, bodies);
  if (outcome === undefined) return undefined;
  return items === undefined ? { ...outcome, pass: false } : outcome;
};

/** A document read on its checked line must equal the held document. */
export const checkDocumentRead = (
  state: SimulatedState,
  view: Extract<StateView, { shape: "document" }>,
  record: StateRecordFacts,
  body: JsonValue | undefined,
): CheckOutcome | undefined => {
  if (!succeeded(record)) return undefined;
  const value = state.document(view.tool);
  if (body === undefined || value === undefined) return undefined;
  const minted = view.per_response_members;
  return {
    pass: same(withoutMembers(value, minted), withoutMembers(body, minted)),
    targets: [documentTarget(view.tool)],
    unheld: [],
  };
};
