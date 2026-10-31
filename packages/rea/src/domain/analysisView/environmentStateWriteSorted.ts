import type { JsonValue } from "../jsonValue.js";
import { compareUnicodeCodePoints as compare } from "../unicodeCodePointOrder.js";
import {
  ownMember,
  setOwnMember,
  at,
  isObject,
  isStringArray,
  listItems,
  replaceAt,
  scalarText,
  type JsonObject,
  type StateEntity,
  type StateItemView,
  type StateListView,
  type StateRecordFacts,
  type StateView,
} from "./environmentStateRules.js";
import {
  entityTarget,
  type CheckOutcome,
  type SimulatedState,
} from "./environmentStateWriteChecks.js";
import type { WriteIo } from "./environmentStateWriteEffects.js";
import { ENTRY_BYTES, textBytes } from "./webNetworkRouteTemplates.js";

/** Whether a string array is in code-point order. */
const inOrder = (values: readonly string[]): boolean =>
  values.every(
    (value, index) => index === 0 || compare(values[index - 1]!, value) <= 0,
  );

/** A string array with at least two distinct values, the only kind that shows an order. */
const ordered = (value: JsonValue | undefined): value is string[] =>
  value !== undefined && isStringArray(value) && new Set(value).size >= 2;

/** Whether no object a read shows lists the field as a string array out of order. */
const listedSorted = (shown: readonly JsonObject[], field: string): boolean =>
  shown.every((object) => {
    const value = ownMember(object, field);
    return !ordered(value) || inOrder(value);
  });

/** An entity's value of a field as one view shows it: its own recorded value, else the stored one. */
const shownBy = (
  entity: StateEntity,
  tool: string,
  field: string,
): JsonValue | undefined => {
  const own = entity.view_fields.find(
    (candidate) => candidate.tool === tool,
  )?.fields;
  return own !== undefined && Object.hasOwn(own, field)
    ? own[field]
    : ownMember(entity.fields, field);
};

/** Fields every initial entity shows, as the view renders it, as a sorted string array or null, one with two distinct strings. */
export const sortableFields = (
  view: Pick<StateItemView | StateListView, "tool" | "fields">,
  entities: readonly StateEntity[],
): string[] =>
  view.fields.filter((field) => {
    let distinct = false;
    for (const entity of entities) {
      const value = shownBy(entity, view.tool, field);
      if (value === undefined || value === null) continue;
      if (!isStringArray(value) || !inOrder(value)) return false;
      distinct ||= new Set(value).size >= 2;
    }
    return distinct;
  });

/**
 * Whether a sorted read of a written array could as well list values by when the application first
 * held them: those the initial state held first, then the rest in written order, as an application
 * ordering by tag id or creation would.
 */
const creationOrderFits = (
  shown: readonly string[],
  written: readonly string[],
  existing: ReadonlySet<string>,
): boolean => {
  const firstNew = shown.findIndex((value) => !existing.has(value));
  const fresh = written.filter((value) => !existing.has(value));
  return (
    firstNew < 0 ||
    (shown.slice(firstNew).every((value) => !existing.has(value)) &&
      shown.slice(firstNew).every((value, index) => value === fresh[index]))
  );
};

interface Candidates {
  readonly type: string;
  readonly fields: string[];
}

/**
 * Array fields a view lists sorted however they were written, as APIs that keep tags as sets do.
 * A field is learned only from a read the gate counts that fails with the stored order and passes
 * with it sorted, where the order could not be the written one or the order the application first
 * held the values in; one counted read listing it unsorted rules it out for that view, learned or
 * not. The stored value keeps the written order, so a write's response still echoes it; every view
 * of the type that could sort the field sorts it once one does.
 */
export class SortedArrays {
  readonly #candidates = new Map<string, Candidates>();
  readonly #adopted = new Map<string, string[]>();
  /** Retired views retain their former sort fields only for checking later values. */
  readonly #retired = new Map<string, string[]>();
  /** Values each type's initial entities held, per candidate field. */
  readonly #existing = new Map<string, Set<string>>();

  constructor(
    views: Iterable<StateView>,
    entities: readonly StateEntity[],
    private readonly facts: {
      readonly state: SimulatedState;
      readonly io: Pick<WriteIo, "withBody" | "retain">;
      readonly idField: (type: string) => string | undefined;
    },
  ) {
    for (const view of views) {
      if (view.shape !== "item" && view.shape !== "list") continue;
      const own = entities.filter((entity) => entity.type === view.type);
      const fields = sortableFields(view, own);
      if (fields.length === 0) continue;
      this.#candidates.set(view.tool, { type: view.type, fields });
      for (const field of fields) this.#noteExisting(view.type, field, own);
      facts.io.retain(
        ENTRY_BYTES +
          fields.reduce((bytes, field) => bytes + textBytes(field.length), 0),
      );
    }
  }

  /** The serving projection: recorded after ordering was disproved, otherwise with learned sorts. */
  view(view: StateView): StateView {
    if (view.shape !== "item" && view.shape !== "list") return view;
    if (this.#retired.has(view.tool))
      return {
        tool: view.tool,
        shape: "recorded",
        reason: view.shape === "item" ? "fields-differ" : "list-differs",
      };
    return this.comparisonView(view);
  }

  /** A retired view still describes where values were observed, but cannot supply serving proof. */
  comparisonView(view: StateView): StateView {
    if (view.shape !== "item" && view.shape !== "list") return view;
    const fields = this.#retired.get(view.tool) ?? this.#adopted.get(view.tool);
    return fields === undefined ? view : { ...view, sorted_arrays: fields };
  }

  /** The serving projections exported after simulation. */
  views(views: readonly StateView[]): StateView[] {
    return views.map((view) => this.view(view));
  }

  /**
   * Note what a read the gate counts shows, then retry it if it failed: the outcome with the fewest
   * candidate fields sorted that make it pass, which the type's views then keep; the outcome as it
   * was, without any learned field the read lists unsorted, when none does, the passing check is
   * blocked or the read's order is ambiguous.
   */
  retry(
    view: StateView,
    read: { readonly record: StateRecordFacts; readonly outcome: CheckOutcome },
    check: (
      view: StateView,
      comparisonBody?: (body: JsonValue) => JsonValue,
    ) => CheckOutcome | undefined,
    blocked: (targets: readonly string[]) => boolean,
  ): CheckOutcome {
    if (view.shape !== "item" && view.shape !== "list") return read.outcome;
    const retired = this.#retired.get(view.tool);
    if (retired !== undefined)
      return read.outcome.pass
        ? read.outcome
        : (check({ ...view, sorted_arrays: retired }, (body) =>
            this.#comparisonBody(view, retired, body),
          ) ?? read.outcome);
    // A view with no candidate or learned field left has nothing to note or retry, so its read is never parsed.
    if (!this.#candidates.has(view.tool) && !this.#adopted.has(view.tool))
      return read.outcome;
    const shown = this.#shown(view, read.record);
    this.#ruleOut(view.tool, shown);
    const adopted = this.#adopted.get(view.tool) ?? [];
    // Retire ordering proof, but still check values independently of the withdrawn array order.
    if (this.#unlearn(view.tool, shown))
      return (
        check({ ...view, sorted_arrays: adopted }, (body) =>
          this.#comparisonBody(view, adopted, body),
        ) ?? read.outcome
      );
    const current = view;
    const failed = read.outcome;
    const candidates = this.#candidates.get(view.tool)?.fields;
    if (failed.pass || candidates === undefined) return failed;
    const passing = (fields: readonly string[]) => {
      const outcome = check({
        ...current,
        sorted_arrays: [...(current.sorted_arrays ?? []), ...fields],
      });
      return outcome?.pass === true &&
        !blocked([...outcome.targets, ...outcome.unheld])
        ? outcome
        : undefined;
    };
    let outcome = passing(candidates);
    if (outcome === undefined) return failed;
    let needed = candidates;
    for (const field of candidates) {
      const fewer = needed.filter((name) => name !== field);
      const retried = fewer.length === 0 ? undefined : passing(fewer);
      if (retried !== undefined) [needed, outcome] = [fewer, retried];
    }
    const targets = new Set(outcome.targets);
    if (!needed.every((field) => this.#telling(view, shown, field, targets)))
      return failed;
    this.#adopt(view.type, needed);
    return outcome;
  }

  /** Compare a retired view's values as multisets only for its formerly sorted string-array fields. */
  #comparisonBody(
    view: StateItemView | StateListView,
    fields: readonly string[],
    body: JsonValue,
  ): JsonValue {
    const normalize = (value: JsonValue): JsonValue => {
      if (!isObject(value)) return value;
      const object = { ...value };
      for (const field of fields) {
        const array = ownMember(object, field);
        if (array !== undefined && isStringArray(array))
          setOwnMember(object, field, array.toSorted(compare));
      }
      return object;
    };
    const value = at(body, view.pointer);
    if (value === undefined) return body;
    return replaceAt(
      body,
      view.pointer,
      view.shape === "list" && Array.isArray(value)
        ? value.map(normalize)
        : normalize(value),
    );
  }

  /** The entity objects a read recorded at the view's pointer. */
  #shown(view: StateItemView | StateListView, record: StateRecordFacts) {
    return this.facts.io.withBody(record.ordinal, (body): JsonObject[] => {
      if (body === undefined || body === null) return [];
      if (view.shape === "list")
        return (listItems(body, view.pointer) ?? []).filter(isObject);
      const object = at(body, view.pointer);
      return isObject(object) ? [object] : [];
    });
  }

  /** A read listing a candidate field unsorted shows its view does not sort it. */
  #ruleOut(tool: string, shown: readonly JsonObject[]): void {
    const entry = this.#candidates.get(tool);
    if (entry === undefined) return;
    const left = entry.fields.filter((field) => listedSorted(shown, field));
    if (left.length === 0) this.#candidates.delete(tool);
    else if (left.length < entry.fields.length)
      this.#candidates.set(tool, { ...entry, fields: left });
  }

  /** Contradictory ordering makes the view recorded and invalidates its earlier confirmations. */
  #unlearn(tool: string, shown: readonly JsonObject[]): boolean {
    const adopted = this.#adopted.get(tool) ?? [];
    const kept = adopted.filter((field) => listedSorted(shown, field));
    if (kept.length === adopted.length) return false;
    this.#retired.set(tool, adopted);
    this.#adopted.delete(tool);
    this.#candidates.delete(tool);
    return true;
  }

  /** Whether a read shows a written array of an entity it covers in an order neither the written one nor the order the values were first held in. */
  #telling(
    view: StateItemView | StateListView,
    shown: readonly JsonObject[],
    field: string,
    targets: ReadonlySet<string>,
  ): boolean {
    const idField = this.facts.idField(view.type) ?? "";
    const existing = this.#existing.get(`${view.type}\u0000${field}`)!;
    return shown.some((object) => {
      const value = ownMember(object, field);
      const id = scalarText(ownMember(object, idField));
      if (!ordered(value) || id === undefined) return false;
      return this.facts.state.named(id).some((entity) => {
        const written = ownMember(entity.fields, field);
        return (
          targets.has(
            entityTarget(entity.type, entity.collection, entity.id),
          ) &&
          written !== undefined &&
          isStringArray(written) &&
          written.length === value.length &&
          written.some((item, index) => item !== value[index]) &&
          !creationOrderFits(value, written, existing)
        );
      });
    });
  }

  /** Sort the fields in every view of the type that could sort them. */
  #adopt(type: string, fields: readonly string[]): void {
    for (const [tool, entry] of this.#candidates) {
      if (entry.type !== type) continue;
      const taken = entry.fields.filter((field) => fields.includes(field));
      if (taken.length === 0) continue;
      this.#adopted.set(tool, [...(this.#adopted.get(tool) ?? []), ...taken]);
      const left = entry.fields.filter((field) => !taken.includes(field));
      if (left.length === 0) this.#candidates.delete(tool);
      else this.#candidates.set(tool, { ...entry, fields: left });
    }
  }

  #noteExisting(
    type: string,
    field: string,
    entities: readonly StateEntity[],
  ): void {
    const key = `${type}\u0000${field}`;
    let values = this.#existing.get(key);
    if (values === undefined) this.#existing.set(key, (values = new Set()));
    const held = entities.flatMap((entity) =>
      [
        ownMember(entity.fields, field),
        ...entity.view_fields.map((view) => ownMember(view.fields, field)),
      ].flatMap((value) =>
        value !== undefined && value !== null && isStringArray(value)
          ? value
          : [],
      ),
    );
    for (const item of held)
      if (!values.has(item)) {
        this.facts.io.retain(textBytes(item.length));
        values.add(item);
      }
  }
}
