import {
  ownMember,
  renderStateEntity,
  same,
  type JsonObject,
  type StateEntity,
  type StateItemView,
  type StateView,
} from "./environmentStateRules.js";
import {
  collectionTarget,
  entityTarget,
} from "./environmentStateWriteChecks.js";

/** The fields a read of a view shows of its entities, less volatile ones it does not compare; all of a document's. */
export const shownFields = (
  view: StateView,
  volatileOf: (type: string) => ReadonlySet<string>,
): ReadonlySet<string> | "all" => {
  if (view.shape !== "item" && view.shape !== "list") return "all";
  const volatile = volatileOf(view.type);
  return new Set(view.fields.filter((field) => !volatile.has(field)));
};

/** Modelled writes per target since its last check, with the fields each wrote (null: all). */
export type TouchedTargets = Map<string, Map<string, readonly string[] | null>>;

/** Per target, when the latest modelled write since its last check ended, and each tool's latest call there. */
export type PendingTargets = Map<
  string,
  { until: number | undefined; readonly at: Map<string, number> }
>;

/** Whether a write that ended at `until` was still running when a read began at `start`, so the read may show either state. */
export const overlapsWrite = (
  until: number | undefined,
  start: number | undefined,
): boolean => until === undefined || start === undefined || until > start;

/** What the gate tracks of the writes since each target's last check, and when each unmodelled write ran. */
export interface WriteHistory {
  readonly touched: TouchedTargets;
  readonly pending: PendingTargets;
  readonly checked: ReadonlyMap<string, number>;
  readonly unmodelledAt: readonly number[];
}

/** The tools a failed read's difference an unmodelled write may explain: it came after the tool's call on a target where its effect survives, and after every differing target's last check and pending writes. */
export const interference = (
  history: WriteHistory,
  read: {
    readonly targets: readonly string[];
    readonly unheld: readonly string[];
    readonly differing?: readonly string[];
  },
): ((tool: string) => boolean) => {
  const keys = [...read.targets, ...read.unheld];
  const after = (since: number) =>
    history.unmodelledAt.some((index) => index > since);
  const explained = (read.differing ?? []).every((key) =>
    after(
      Math.max(
        history.checked.get(key) ?? -1,
        ...(history.pending.get(key)?.at.values() ?? []),
      ),
    ),
  );
  return (tool) =>
    explained &&
    keys.some((key) => {
      if (history.touched.get(key)?.has(tool) !== true) return false;
      const at = history.pending.get(key)?.at.get(tool);
      return at !== undefined && after(at);
    });
};

/** Whether a modelled write to the target was still running when a read began at `start`, so the read may show either state. */
export const runningAt = (
  pending: PendingTargets,
  key: string,
  start: number | undefined,
): boolean => {
  const held = pending.get(key);
  return held !== undefined && overlapsWrite(held.until, start);
};

/** The tools whose writes a read exercises: those that changed its targets since they were last checked, less those that borrowed the read to learn their effect. */
export const exercisedBy = (
  touched: TouchedTargets,
  keys: readonly string[],
  borrowers: ReadonlySet<string> | undefined,
): Set<string> => {
  const exercised = new Set<string>();
  for (const key of keys)
    for (const name of touched.get(key)?.keys() ?? [])
      if (!borrowers?.has(name)) exercised.add(name);
  return exercised;
};

/** Record a modelled write on a target: the fields it wrote (undefined: all), when it was made and when it ended. */
export const touchTarget = (
  touched: TouchedTargets,
  pending: PendingTargets,
  target: string,
  write: {
    readonly index: number;
    readonly tool: string;
    readonly end: number | undefined;
    readonly fields: readonly string[] | undefined;
  },
): void => {
  const held = pending.get(target);
  pending.set(target, {
    // One unknown completion keeps this target pending until a real check clears it.
    until:
      write.end === undefined ||
      (held !== undefined && held.until === undefined)
        ? undefined
        : Math.max(held?.until ?? -Infinity, write.end),
    at: (held?.at ?? new Map()).set(write.tool, write.index),
  });
  const tools = touched.get(target) ?? new Map();
  const before = tools.get(write.tool);
  tools.set(
    write.tool,
    write.fields === undefined || before === null
      ? null
      : [...new Set([...(before ?? []), ...write.fields])],
  );
  touched.set(target, tools);
};

/** The fields of a write's effect on an entity no later write has overwritten: all of them for a create or delete (null). */
type ChangedFields = readonly string[] | null;

/** What a later write overwrites: the whole entity, the fields it sets, or every field (a recorded outcome). A document's fields are pointers, each covering the members under it. */
interface Overwrite {
  readonly whole: boolean;
  readonly fields: ReadonlySet<string> | "all";
  readonly pointers: boolean;
}

/** Whether a write's fields cover a field: the same one, or, for a document's pointers, one above it. */
const covers = (write: Overwrite, field: string): boolean => {
  const { fields } = write;
  if (fields === "all" || fields.has(field)) return true;
  return (
    write.pointers && [...fields].some((over) => field.startsWith(`${over}/`))
  );
};

/** What an earlier effect keeps after a write: nothing once every field it holds is overwritten; an update leaves a create's or delete's whole effect. */
const remaining = (
  claim: ChangedFields,
  write: Overwrite,
): ChangedFields | undefined => {
  if (write.whole) return undefined;
  if (claim === null) return null;
  if (write.fields === "all") return undefined;
  const left = claim.filter((field) => !covers(write, field));
  return left.length > 0 ? left : undefined;
};

/** Add a write's changed fields under a key: all of them once any write there changed the whole entity. */
const record = (
  map: Map<string, ChangedFields>,
  key: string,
  whole: boolean,
  changed: readonly string[],
): Map<string, ChangedFields> => {
  const before = map.get(key);
  return map.set(
    key,
    whole || before === null
      ? null
      : [...new Set([...(before ?? []), ...changed])],
  );
};

/**
 * What each write changed since the targets it touched were last checked, less what later writes overwrote, so a
 * write whose effect is gone drops out: from the entity's target, and from its collection's once no entity it changed
 * there keeps any of it.
 */
export class WriteEffects {
  /** Per entity target, the fields each tool changed there. */
  readonly #changed = new Map<string, Map<string, ChangedFields>>();
  /** Per collection target, the entities each tool's claim there rests on, with the fields it changed on each. */
  readonly #members = new Map<
    string,
    Map<string, Map<string, ChangedFields>>
  >();

  /** Forget a checked target's writes, as the touched targets do: all, or all but those a read showed nothing of. */
  checked(key: string, unseen?: ReadonlySet<string>): void {
    for (const byTool of [this.#changed, this.#members])
      if (unseen === undefined) byTool.delete(key);
      else
        for (const tool of byTool.get(key)?.keys() ?? [])
          if (!unseen.has(tool)) byTool.get(key)!.delete(tool);
  }

  /** A read showed the entity absent: no write's effect on it remains, so a write left with no entity drops from the collection. */
  removed(
    touched: TouchedTargets,
    gone: {
      readonly type: string;
      readonly collection: string;
      readonly id: string;
    },
  ): void {
    const entity = entityTarget(gone.type, gone.collection, gone.id);
    const collection = collectionTarget(gone.type, gone.collection);
    this.#changed.delete(entity);
    const byTool = this.#members.get(collection);
    if (byTool === undefined) return;
    for (const [tool, entities] of byTool) {
      if (!entities.delete(entity) || entities.size > 0) continue;
      byTool.delete(tool);
      touched.get(collection)?.delete(tool);
    }
  }

  /** The fields a tool's effect on an entity still holds: null for a create's or delete's whole effect, undefined when none remains. */
  changedOn(key: string, tool: string): readonly string[] | null | undefined {
    return this.#changed.get(key)?.get(tool);
  }

  /** Whether a read showing `fields` of a target shows anything of a tool's effect there: a create's or delete's always, an update's through a field it changed; unknown claims count as shown. */
  shows(
    tool: string,
    key: string,
    fields: ReadonlySet<string> | "all",
  ): boolean {
    const visible = (claim: ChangedFields | undefined): boolean =>
      fields === "all" ||
      claim === undefined ||
      claim === null ||
      claim.some((field) => fields.has(field));
    const own = this.#changed.get(key);
    if (own !== undefined) return visible(own.get(tool));
    const members = this.#members.get(key)?.get(tool);
    return members === undefined || [...members.values()].some(visible);
  }

  /** A write's effect replaces what earlier writes left of theirs, then joins them. */
  supersede(
    touched: TouchedTargets,
    writer: string,
    effect: {
      readonly targets: readonly string[];
      readonly fields?: readonly string[];
      readonly changed?: {
        readonly fields: readonly string[];
        readonly accumulated: readonly string[];
      };
      /** Set when the fields are a document's pointers. */
      readonly pointers?: boolean;
      /** What the write overwrites of earlier effects, when more than the fields it claims. */
      readonly overwrites?: readonly string[];
    },
  ): void {
    const [entity, collection] = effect.targets as [string, string?];
    const changed = effect.changed?.fields ?? effect.fields ?? [];
    const whole = effect.fields === undefined;
    this.#overwrite(
      touched,
      { entity, collection, writer },
      {
        whole,
        fields: new Set(
          (effect.overwrites ?? changed).filter(
            (field) => !effect.changed?.accumulated.includes(field),
          ),
        ),
        pointers: effect.pointers === true,
      },
    );
    this.#changed.set(
      entity,
      record(this.#changed.get(entity) ?? new Map(), writer, whole, changed),
    );
    if (collection === undefined) return;
    const byTool = this.#members.get(collection) ?? new Map();
    byTool.set(
      writer,
      record(byTool.get(writer) ?? new Map(), entity, whole, changed),
    );
    this.#members.set(collection, byTool);
  }

  /** A recorded outcome is the entity's new baseline: what earlier writes changed on it is gone, its membership is not. */
  observed(touched: TouchedTargets, targets: readonly string[]): void {
    const [entity, collection] = targets as [string, string?];
    this.#overwrite(
      touched,
      { entity, collection, writer: undefined },
      { whole: false, fields: "all", pointers: false },
    );
  }

  #overwrite(
    touched: TouchedTargets,
    at: {
      readonly entity: string;
      readonly collection: string | undefined;
      readonly writer: string | undefined;
    },
    write: Overwrite,
  ): void {
    const own = this.#changed.get(at.entity);
    for (const [tool, claim] of own ?? []) {
      const left = tool === at.writer ? claim : remaining(claim, write);
      if (left !== undefined) {
        own!.set(tool, left);
        if (tool !== at.writer) {
          const tools = touched.get(at.entity);
          const sent = tools?.get(tool);
          // touched keeps sent members. A members check compares those; a surviving derived field stays on the effect.
          if (tools !== undefined && sent !== undefined)
            tools.set(
              tool,
              sent !== null && left !== null
                ? sent.filter((field) => left.includes(field))
                : left,
            );
        }
      } else {
        own!.delete(tool);
        touched.get(at.entity)?.delete(tool);
      }
    }
    if (at.collection === undefined) return;
    const byTool = this.#members.get(at.collection);
    for (const [tool, entities] of byTool ?? []) {
      const claim = entities.get(at.entity);
      if (tool === at.writer || claim === undefined) continue;
      const left = remaining(claim, write);
      if (left !== undefined) entities.set(at.entity, left);
      else entities.delete(at.entity);
      if (entities.size > 0) continue;
      byTool!.delete(tool);
      touched.get(at.collection)?.delete(tool);
    }
  }
}

/** Of the tools a read exercised, those it shows something of on some target, and per target those it shows nothing of. */
export const shownWrites = (
  touched: TouchedTargets,
  effects: WriteEffects,
  read: {
    readonly keys: readonly string[];
    readonly exercised: ReadonlySet<string>;
    readonly fields: ReadonlySet<string> | "all";
  },
): {
  readonly confirmed: string[];
  readonly unseen: Map<string, Set<string>>;
} => {
  const confirmed: string[] = [];
  const unseen = new Map<string, Set<string>>();
  for (const name of read.exercised) {
    const on = read.keys.filter((key) => touched.get(key)?.has(name));
    const seen = on.filter((key) => effects.shows(name, key, read.fields));
    for (const key of on)
      if (!seen.includes(key))
        unseen.set(key, (unseen.get(key) ?? new Set()).add(name));
    if (seen.length > 0) confirmed.push(name);
  }
  return { confirmed, unseen };
};

/** A checked target forgets its writes, but for those a passing read showed nothing of, which a later check still takes. */
export const forgetChecked = (
  pending: {
    readonly touched: TouchedTargets;
    readonly since: PendingTargets;
    readonly effects: WriteEffects;
  },
  key: string,
  unseen: ReadonlySet<string> | undefined,
): void => {
  const writes = pending.touched.get(key);
  if (unseen === undefined || writes === undefined) {
    pending.touched.delete(key);
    pending.effects.checked(key);
    pending.since.delete(key);
    return;
  }
  const at = pending.since.get(key)?.at;
  for (const name of writes.keys())
    if (!unseen.has(name)) {
      writes.delete(name);
      at?.delete(name);
    }
  pending.effects.checked(key, unseen);
};

/**
 * Check, field by field, the writes that changed an entity an unmodelled write also changed:
 * each write's own fields must show as the state holds them, but for volatile ones, which take
 * the read's value and so show nothing of a write. A create wrote every field, so it cannot be
 * told apart from the unmodelled change and is not checked.
 */
export const writtenFieldChecks = (
  entity: StateEntity,
  view: StateItemView,
  observed: JsonObject,
  check: {
    readonly volatile: ReadonlySet<string>;
    readonly writes: ReadonlyMap<string, readonly string[] | null>;
  },
): Map<string, boolean> => {
  const shown = renderStateEntity(entity, view, check.volatile, observed);
  const outcomes = new Map<string, boolean>();
  for (const [tool, fields] of check.writes) {
    const compared = (fields ?? []).filter(
      (field) =>
        !check.volatile.has(field) &&
        (Object.hasOwn(observed, field) || Object.hasOwn(shown, field)),
    );
    if (fields === null || compared.length === 0) continue;
    outcomes.set(
      tool,
      compared.every((field) =>
        same(ownMember(shown, field), ownMember(observed, field)),
      ),
    );
  }
  return outcomes;
};
