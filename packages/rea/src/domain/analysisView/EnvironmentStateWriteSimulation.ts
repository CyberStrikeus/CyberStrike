import { CapturedWriteCompletion } from "./environmentStateWriteCompletion.js";
import type { JsonValue } from "../jsonValue.js";
import {
  at,
  changesState,
  isObject,
  isStateWrite,
  listItems,
  listsAll,
  markedDeleted,
  normalizedPath,
  ownMember,
  same,
  scalarText,
  type JsonObject,
  type ParsedRequestBody,
  type StateEntity,
  type StateRecordFacts,
  type StateToolFacts,
  type StateType,
  type StateView,
} from "./environmentStateRules.js";
import { UnseenEntities } from "./environmentStateWriteAdoption.js";
import { FailedReadBlame } from "./environmentStateWriteBlame.js";
import { addressedWrite } from "./environmentStateWriteAddress.js";
import { withoutMembers } from "./environmentStateResponseMembers.js";
import { linkedTarget } from "./environmentStateWriteLinks.js";
import {
  laterItemFields,
  updatedEntity,
} from "./environmentStateWriteApply.js";
import { projectedRead } from "./environmentStateWriteObserve.js";
import { OmittedFields } from "./environmentStateWriteOmitted.js";
import { SortedArrays } from "./environmentStateWriteSorted.js";
import { sameQuery } from "./environmentStateWriteStamps.js";
import {
  checkDocumentRead,
  checkItemRead,
  checkListRead,
  collectionTarget,
  entityTarget,
  isAbsence,
  itemTarget,
  succeeded,
  withBodies,
  showsPlacement,
  SimulatedState,
  type CheckOutcome,
  type PendingWrite,
} from "./environmentStateWriteChecks.js";
import {
  checkedLines,
  servedLine,
  type CheckedLines,
  type ServedLine,
} from "./environmentStateCheckedLines.js";
import {
  exercisedBy,
  interference,
  type WriteHistory,
  forgetChecked,
  runningAt,
  shownFields,
  shownWrites,
  touchTarget,
  WriteEffects,
  type PendingTargets,
  type TouchedTargets,
  writtenFieldChecks,
} from "./environmentStateWriteAttribution.js";
import { applyBulk } from "./environmentStateWriteBulk.js";
import { applyCreate } from "./environmentStateWriteCreate.js";
import { applyDocument } from "./environmentStateWriteDocument.js";
import { applyDelete } from "./environmentStateWriteDelete.js";
import {
  applyUpdate,
  built,
  type EffectContext,
  type EffectResult,
  type WriteDraft,
  type WriteSimulationInput,
  type WriteStep,
} from "./environmentStateWriteEffects.js";
import {
  classifyWrite,
  prefixRelated,
  unservedPlan,
  type InsertRule,
  type StateWritePlan,
} from "./environmentStateWriteRules.js";
import { WriteTaint } from "./environmentStateWriteTaint.js";
import { writeVerdict } from "./environmentStateWriteVerdict.js";
import { compareValues, orderedBy } from "./environmentStateWriteExplain.js";

/** Whether members are in a sorted rule's order, ties kept in place as an insert keeps them. */
const keptInOrder = (
  members: readonly JsonObject[],
  rule: Extract<InsertRule, { rule: "sorted" }>,
): boolean =>
  members.every((member, index) => {
    if (index === 0) return true;
    const order = compareValues(
      ownMember(members[index - 1]!, rule.field),
      ownMember(member, rule.field),
    );
    return (
      order !== undefined &&
      (rule.direction === "ascending" ? order <= 0 : order >= 0)
    );
  });

/** The sorts by a field every listed item holds as a string or number, and whether the items follow each. */
const listedSorts = (
  items: readonly JsonObject[],
): {
  readonly rule: Extract<InsertRule, { rule: "sorted" }>;
  readonly follows: boolean;
}[] =>
  [...new Set(items.flatMap((item) => Object.keys(item)))]
    .filter((field) =>
      items.every((item) =>
        ["string", "number"].includes(typeof ownMember(item, field)),
      ),
    )
    .flatMap((field) =>
      (["ascending", "descending"] as const).map((direction) => ({
        rule: { rule: "sorted", field, direction } as const,
        follows: orderedBy(items, field, direction),
      })),
    );

/** Whether a list read's query sets a parameter the view's query model reads as a sort or its direction. */
const sortedByQuery = (
  view: Extract<StateView, { shape: "list" }>,
  record: StateRecordFacts,
): boolean => {
  const sent = new Set(
    [...new URLSearchParams(record.query ?? "").keys()].map((key) =>
      key.toLowerCase(),
    ),
  );
  return Object.entries(view.query?.parameters ?? {}).some(
    ([parameter, { role }]) =>
      (role === "sort" || role === "direction") &&
      sent.has(parameter.toLowerCase()),
  );
};

const APPLY = {
  create: applyCreate,
  update: applyUpdate,
  delete: applyDelete,
  document: applyDocument,
} as const;

/**
 * Replay the capture's timeline on a copy of the initial state: modelled writes apply their
 * effects, other writes taint related types, and each read the served state would answer is
 * compared with its recording and attributed to the writes it exercises.
 */
export class EnvironmentStateWriteSimulation {
  readonly #input: WriteSimulationInput;
  readonly #state: SimulatedState;
  readonly #drafts = new Map<string, WriteDraft>();
  readonly #toolOf = new Map<number, StateToolFacts>();
  readonly #types = new Map<string, StateType>();
  /** Each list or document view's checked request lines, with the recording a call of the line is answered on. */
  readonly #checkedLines: ReadonlyMap<string, CheckedLines>;
  /** Reads a write's effect was learned from, with the tools that borrowed each. */
  readonly #observations = new Map<number, Set<string>>();
  readonly #taint: WriteTaint;
  readonly #touched: TouchedTargets = new Map();
  readonly #effects = new WriteEffects();
  /** Fields reads show the application leaves out, which serving then does not require. */
  readonly omitted = new OmittedFields((bytes) => this.#input.io.retain(bytes));
  /** Array fields reads showed a view lists sorted. */
  readonly #sorted: SortedArrays;
  readonly #lastCheck = new Map<string, number>();
  /** When the latest modelled write to each target since its last check ended. */
  readonly #touchedSince: PendingTargets = new Map();
  /** Timeline indexes of writes the gate does not model. */
  readonly #unmodelledAt: number[] = [];
  readonly #writeCompletion: CapturedWriteCompletion;
  readonly #history: WriteHistory = {
    touched: this.#touched,
    pending: this.#touchedSince,
    checked: this.#lastCheck,
    unmodelledAt: this.#unmodelledAt,
  };
  readonly #log: {
    readonly index: number;
    readonly tool: string;
    readonly path: string;
  }[] = [];
  /** Entities a create inserted, by target, with the create's tool. */
  readonly #inserted = new Map<string, string>();
  /** Targets a write changed or placed since a passing list read last showed them, whose position no read has confirmed. */
  readonly #moved = new Set<string>();
  /** The writes to those targets' entities, in order. */
  #pending: PendingWrite[] = [];
  /** Sorts, by type, that a whole list in collection order ruled out: moving the writes it showed by them gives another order. */
  readonly #refutedSorts = new Map<string, Set<string>>();
  /** Creates whose insert rule a passing list check relied on, so it is no longer changed. */
  readonly #placed = new Set<string>();
  /** Placed creates a read other than a whole listing in collection order placed, whose insert stays as it is. */
  readonly #settledInserts = new Set<string>();
  /** Sorts a whole listing that placed a create did not follow, by create, which no later listing adds back. */
  readonly #unfollowedSorts = new Map<string, Set<string>>();
  /** The order a read showed a type's collections sorted in after an update, when no create of it showed one. */
  readonly #learnedSorts = new Map<string, InsertRule>();
  /** Entities writes no plan models made, taken when an item read first shows them. */
  readonly #unseen: UnseenEntities;
  readonly #blame: FailedReadBlame;

  constructor(input: WriteSimulationInput) {
    this.#input = input;
    this.#writeCompletion = new CapturedWriteCompletion(input.io.retain);
    this.#state = new SimulatedState(input.entities, input.documents);
    this.#unseen = new UnseenEntities(input.entities, {
      state: this.#state,
      io: input.io,
      lastCheck: this.#lastCheck,
      idField: (type) => this.#types.get(type)?.id_field,
    });
    this.#blame = new FailedReadBlame({
      state: this.#state,
      io: input.io,
      records: input.records,
      touched: this.#touched,
      pending: this.#touchedSince,
      effects: this.#effects,
      inserted: this.#inserted,
      idField: (type) => this.#types.get(type)?.id_field,
      volatileOf: input.volatileOf,
    });
    for (const type of input.types)
      this.#types.set(type.collection_template, type);
    for (const tool of input.tools)
      for (const ordinal of tool.record_ordinals)
        this.#toolOf.set(ordinal, tool);
    this.#checkedLines = checkedLines(input);
    this.#sorted = new SortedArrays(input.views.values(), input.entities, {
      state: this.#state,
      io: input.io,
      idField: (type) => this.#types.get(type)?.id_field,
    });
    this.#taint = new WriteTaint(
      [...this.#types.keys()],
      new Map(
        input.documents.map((document) => [document.tool, document.path]),
      ),
      this.#state,
    );
    this.#state.keepSorted((type) => this.#sortOf(type));
  }

  /**
   * The sorted order a type's placed creates insert by, when they agree on one and nothing contradicted them: updates
   * move their entity only by an order a list read showed, in replay as in serving.
   */
  #sortOf(type: string): InsertRule | undefined {
    const rules = new Map<string, InsertRule>();
    for (const { plan, observed, contradictedBy } of this.#drafts.values())
      if (
        plan.effect === "create" &&
        plan.target === type &&
        observed !== undefined &&
        plan.reason === null &&
        contradictedBy === undefined &&
        plan.insert?.rule === "sorted" &&
        this.#placed.has(plan.tool)
      )
        rules.set(JSON.stringify(plan.insert), plan.insert);
    if (rules.size === 0) return this.#learnedSorts.get(type);
    return rules.size === 1 ? [...rules.values()][0] : undefined;
  }

  /** Every state-changing tool's plan, in manifest order, with its verdict. */
  run(): StateWritePlan[] {
    const documents = new Map<string, string>();
    for (const tool of this.#input.tools)
      if (this.#input.views.get(tool.name)?.shape === "document")
        documents.set(normalizedPath(tool.path_template), tool.name);
    const types = new Set(this.#types.keys());
    for (const tool of this.#input.tools) {
      if (
        !changesState(tool.method, tool.path_template) ||
        this.#input.readOnly.has(tool.name)
      )
        continue;
      const link = linkedTarget(tool, classifyWrite(tool, types, documents), {
        ...this.#input,
        isWrite: (record) => this.#isWrite(record),
        viewOf: (ordinal) =>
          this.#input.views.get(this.#toolOf.get(ordinal)?.name ?? ""),
      });
      const addressed =
        link.effect === "none"
          ? addressedWrite(tool, {
              ...this.#input,
              types,
              idField: (type) => this.#types.get(type)?.id_field,
              views: this.#input.views.values(),
            })
          : undefined;
      const { effect, target } = addressed ?? link;
      this.#input.io.retain(512);
      this.#drafts.set(tool.name, {
        plan: {
          ...unservedPlan(tool.name, effect, target, "no-state-target"),
          reason: effect === "none" ? "no-state-target" : null,
          ...(addressed === undefined ? {} : { address: addressed.address }),
        },
        observed: undefined,
        candidates: [],
        confirmed: [],
        contradictedBy: undefined,
        sideEffect: false,
        calls: 0,
        updates: [],
        sequences: new Map(),
        starts: new Map(),
        createCollections: [],
        sentLargest: new Map(),
        steady: new Set(),
        unstamped: new Set(),
        kept: new Set(),
        fixedWidth: new Map(),
        ampersands: new Map(),
        linked: link.collection,
      });
    }
    // Reads may finish after writes with the same or a later start: index the
    // complete capture before replay so ordinal tie-breaking cannot create proof.
    for (const record of this.#input.records)
      if (this.#isWrite(record))
        this.#writeCompletion.write(
          record.path,
          this.#input.chronology.endMs(record),
          this.#input.chronology.startMs(record),
        );
    this.#input.records.forEach((record, index) => this.#step(record, index));
    const views = new Map(
      this.views([...this.#input.views.values()]).map((view) => [
        view.tool,
        view,
      ]),
    );
    const sorts = new Map(
      [...this.#types.keys()].map((type) => [type, this.#sortOf(type)]),
    );
    return [...this.#drafts.values()].map((draft) => {
      // A view that became recorded cannot supply proof for a served write.
      let kept = 0;
      for (const ordinal of draft.confirmed) {
        const tool = this.#toolOf.get(ordinal)?.name;
        if (tool !== undefined && views.get(tool)?.shape !== "recorded")
          draft.confirmed[kept++] = ordinal;
      }
      draft.confirmed.length = kept;
      // An update moves its entity in a sorted collection when it writes the field sorted by.
      const sort =
        draft.plan.effect === "update" && draft.plan.target !== null
          ? sorts.get(draft.plan.target)
          : undefined;
      if (
        sort?.rule === "sorted" &&
        draft.plan.rules.some((rule) => rule.field === sort.field)
      )
        draft.plan.insert = sort;
      return writeVerdict(draft, this.#input);
    });
  }

  #step(record: StateRecordFacts, index: number): void {
    const tool = this.#toolOf.get(record.ordinal);
    // A redirected or unanswered write may have changed state, even made an entity, but only a 2xx one shows its effect.
    if (this.#isWrite(record) && !succeeded(record)) {
      this.#unmodelled(record.path, index);
      this.#unseen.unplanned(index);
    } else if (this.#isWrite(record)) this.#write(record, index, tool);
    else if (tool?.method === "GET") this.#read(record, index, tool);
  }

  /** Whether a record may change state: a state write whose tool the capture does not show reading only. */
  #isWrite(record: StateRecordFacts): boolean {
    return (
      isStateWrite(record) &&
      !this.#input.readOnly.has(this.#toolOf.get(record.ordinal)?.name ?? "")
    );
  }

  #context(
    writer: string,
    request?: { readonly ordinal: number; readonly body: ParsedRequestBody },
  ): EffectContext {
    return {
      isWrite: (record) => this.#isWrite(record),
      state: this.#state,
      io:
        request === undefined
          ? this.#input.io
          : {
              ...this.#input.io,
              requestBody: (ordinal) =>
                ordinal === request.ordinal
                  ? request.body
                  : this.#input.io.requestBody(ordinal),
            },
      records: this.#input.records,
      chronology: this.#input.chronology,
      viewOf: (ordinal) => {
        const view = this.#input.views.get(
          this.#toolOf.get(ordinal)?.name ?? "",
        );
        return view === undefined ? undefined : this.#viewOf(view);
      },
      idField: (type) => this.#types.get(type)!.id_field,
      volatileOf: this.#input.volatileOf,
      observed: (ordinal) =>
        this.#observations.set(
          ordinal,
          (this.#observations.get(ordinal) ?? new Set()).add(writer),
        ),
      unknown: (type, collection, id) =>
        this.#taint.unknown(type, collection, id),
      initialDocument: (tool) =>
        this.#input.documents.find((document) => document.tool === tool),
      startedWith: (type) =>
        this.#input.entities.filter((entity) => entity.type === type),
      laterFields: (type) =>
        laterItemFields(this.#input.views.values(), this.#input.entities, type),
      pending: (target) =>
        [...(this.#touched.get(target)?.keys() ?? [])].some(
          (name) => name !== writer,
        ),
    };
  }

  #write(
    record: StateRecordFacts,
    index: number,
    tool: StateToolFacts | undefined,
  ): void {
    const draft = tool === undefined ? undefined : this.#drafts.get(tool.name);
    const effect = draft?.plan.effect;
    if (
      draft === undefined ||
      tool === undefined ||
      effect === undefined ||
      effect === "none"
    ) {
      this.#unmodelled(record.path, index);
      this.#unseen.unplanned(index);
      return;
    }
    const observeOnly = draft.plan.reason !== null;
    if (!observeOnly) draft.calls += 1;
    // Serving pins the exemplar's query, so a call with another may do something else and confirms nothing.
    const pinned =
      !built(draft) ||
      sameQuery(
        this.#input.io.queryOf(draft.plan.exemplar_ordinal ?? -1),
        record.query,
      );
    const step: WriteStep = { record, index, tool, observeOnly, pinned };
    const { address } = draft.plan;
    const bulk = address !== undefined && address.by !== "action";
    const apply = (body?: ParsedRequestBody): void => {
      this.#state.track();
      const context = this.#context(
        tool.name,
        body === undefined ? undefined : { ordinal: record.ordinal, body },
      );
      const results = bulk
        ? applyBulk(context, draft, step)
        : [APPLY[effect](context, draft, step)];
      // A call of a tool whose plan was never built, or one a linked plan does not place, is no more modelled than one of a tool without a plan.
      if (
        results.some((result) => result.kind === "unknown") &&
        (!built(draft) || draft.linked !== undefined)
      )
        this.#unseen.unplanned(index);
      for (const result of results)
        this.#settle(result, {
          index,
          tool: tool.name,
          path: record.path,
          end: this.#input.chronology.endMs(record),
        });
    };
    // Item deletes use their path; calls outside a built plan's query never interpret their body.
    if (pinned && (effect !== "delete" || bulk))
      this.#input.io.withRequestBody(record.ordinal, apply);
    else apply();
  }

  /** Attribute an applied effect to its tool; a recorded outcome is the state's new baseline; an unknown one taints. */
  #settle(
    result: EffectResult,
    write: {
      readonly index: number;
      readonly tool: string;
      readonly path: string;
      readonly end: number | undefined;
    },
  ): void {
    if (result.kind === "unknown") {
      this.#unmodelled(write.path, write.index);
      return;
    }
    if (result.entity !== undefined) {
      this.#unseen.touched(result.entity);
      const { type, collection, id } = result.entity;
      this.#taint.known(type, collection, id);
    }
    if (result.kind === "observed") {
      this.#effects.observed(this.#touched, result.targets);
      this.#blame.rebased(result.targets[0]!, write.index);
      // A recorded outcome replaces the entity's values, not its collection's membership.
      this.#touched.delete(result.targets[0]!);
      return;
    }
    this.#effects.supersede(this.#touched, write.tool, result);
    if (result.entity !== undefined) {
      const { type, collection, id } = result.entity;
      const target = entityTarget(type, collection, id);
      const before = this.#state.priorFields(target);
      if (before !== undefined) this.#pending.push({ target, before });
    }
    for (const target of result.targets) {
      this.#moved.add(target);
      touchTarget(this.#touched, this.#touchedSince, target, {
        ...write,
        fields: result.fields,
      });
    }
    this.#log.push(write);
    if (result.inserted === undefined) return;
    this.#inserted.set(result.inserted, write.tool);
    if (result.entity !== undefined)
      this.#blame.inserted(result.entity, write.tool);
  }

  /**
   * An item read of an entity an unmodelled write may have changed shows it again: the writes that
   * changed it are checked on their own fields, and the state takes what the read recorded.
   */
  #resync(
    view: Extract<StateView, { shape: "item" }>,
    record: StateRecordFacts,
    entity: StateEntity,
  ): void {
    const target = entityTarget(entity.type, entity.collection, entity.id);
    const writes = this.#touched.get(target) ?? new Map();
    this.#taint.known(entity.type, entity.collection, entity.id);
    this.#touched.delete(target);
    if (
      isAbsence(record.status) ||
      this.#input.io.withBody(record.ordinal, (body) =>
        markedDeleted(
          body === undefined || body === null
            ? undefined
            : at(body, view.pointer),
        ),
      )
    ) {
      this.#removeEntity(entity);
      return;
    }
    const object = this.#checkFields(view, record, entity, writes);
    if (object !== undefined)
      this.#state.put(updatedEntity(entity, { ...entity.fields, ...object }));
  }

  /** Whether an item read shows an entity an unmodelled write made, or one left unknown, again rather than checks it. */
  #resynced(view: StateView, record: StateRecordFacts, index: number): boolean {
    if (view.shape !== "item") return false;
    if (this.#writeOverlapsRead(record)) return true;
    const adopted = this.#unseen.adopt(view, { record, index });
    if (adopted !== undefined) {
      this.#taint.known(adopted.type, adopted.collection, adopted.id);
      return true;
    }
    const { collection, id } = itemTarget(this.#state, view.type, record);
    if (!this.#taint.unknown(view.type, collection, id)) return false;
    // A read begun while a modelled write to the entity still ran may show either state, so it neither checks nor shows it.
    const target = entityTarget(view.type, collection, id);
    if (
      runningAt(
        this.#touchedSince,
        target,
        this.#input.chronology.startMs(record),
      )
    )
      return true;
    // A failed read that is no absence shows nothing of the entity, so it stays unknown for a usable read.
    if (!succeeded(record) && !isAbsence(record.status)) return true;
    const entity = this.#state.entity(view.type, collection, id);
    // A recorded absence of an entity the state no longer holds is still a check of its delete.
    if (entity === undefined) {
      if (isAbsence(record.status)) return false;
      this.#taint.known(view.type, collection, id);
      return true;
    }
    this.#resync(view, record, entity);
    return true;
  }

  #check(
    view: StateView,
    record: StateRecordFacts,
    comparisonBody?: (body: JsonValue) => JsonValue,
  ): CheckOutcome | undefined {
    if (view.shape === "recorded") return undefined;
    const line = this.#line(view, record);
    if (view.shape !== "item" && line === undefined) return undefined;
    if (view.shape === "document")
      return this.#input.io.withBody(record.ordinal, (body) =>
        checkDocumentRead(this.#state, view, record, body),
      );
    const item = view.shape === "item";
    const target = item
      ? itemTarget(this.#state, view.type, record)
      : undefined;
    const collection =
      target === undefined ? line!.collection : target.collection;
    if (this.#taint.under(collection)) return undefined;
    if (!item) {
      const ids = this.#state
        .members(view.type, collection)
        .map((entity) => entity.id);
      // A recorded-membership list covers no collection target, so a write at the collection is checked here.
      if (
        this.#taint.tainted(collectionTarget(view.type, collection)) ||
        this.#taint.blocksList(view.type, collection, ids)
      )
        return undefined;
    }
    // The served answer keeps the envelope of the item view's or the line's base recording.
    const base = item ? view.envelope_ordinal : line!.ordinal;
    const ordinals = { base, read: record.ordinal };
    const minted = view.per_response_members;
    return withBodies(this.#input.io.withBody, ordinals, (served, body) => {
      const check = {
        body:
          body === undefined
            ? body
            : withoutMembers(
                comparisonBody === undefined ? body : comparisonBody(body),
                minted,
              ),
        base: served === undefined ? served : withoutMembers(served, minted),
        idField: this.#types.get(view.type)?.id_field ?? "",
        volatile: this.#input.volatileOf(view.type),
        collection,
        ...(target === undefined ? {} : { itemId: target.id }),
      };
      return this.omitted.check(this.#state, view, record, check, (loosened) =>
        loosened.shape === "item"
          ? checkItemRead(this.#state, loosened, record, check)
          : checkListRead(this.#state, loosened, record, {
              ...check,
              line: line!,
            }),
      );
    });
  }

  /** The checked line serving answers a list or document read's call from, as replay chooses it. */
  #line(view: StateView, record: StateRecordFacts): ServedLine | undefined {
    return servedLine(this.#checkedLines.get(view.tool), record);
  }

  /** The view as the gate currently knows it: without the fields reads showed omitted, with the arrays they showed sorted. */
  #viewOf(view: StateView): StateView {
    return this.#sorted.view(this.omitted.view(view));
  }

  /** The views as reads showed them. */
  views(views: readonly StateView[]): StateView[] {
    return this.#sorted.views(this.omitted.views(views));
  }

  #read(record: StateRecordFacts, index: number, tool: StateToolFacts): void {
    const original = this.#input.views.get(tool.name);
    if (original === undefined) return;
    let view = this.#sorted.comparisonView(this.omitted.view(original));
    if (projectedRead(view, record, this.#input.io)) return;
    if (this.#writeOverlapsRead(record)) return;
    const borrowers = this.#observations.get(record.ordinal);
    if (
      this.#viewOf(original).shape !== "recorded" &&
      !borrowers &&
      this.#resynced(view, record, index)
    )
      return;
    let outcome = this.#check(view, record);
    if (outcome === undefined) return;
    let keys = [...outcome.targets, ...outcome.unheld];
    const blocked = (targets: readonly string[]) =>
      targets.some(
        (key) =>
          this.#taint.tainted(key) ||
          runningAt(
            this.#touchedSince,
            key,
            this.#input.chronology.startMs(record),
          ),
      );
    if (blocked(keys)) return;
    // A read the gate counts can show the view lists a written array sorted, or rule that out.
    outcome = this.#sorted.retry(
      view,
      { record, outcome },
      (candidate, comparisonBody) =>
        this.#check(candidate, record, comparisonBody),
      blocked,
    );
    view = this.#viewOf(original);
    keys = [...outcome.targets, ...outcome.unheld];
    if (blocked(keys)) return;
    let exercised = exercisedBy(this.#touched, keys, borrowers);
    if (view.shape === "recorded") {
      // Retiring a view withdraws ordering proof, not a remaining mismatch in values.
      if (!outcome.pass)
        this.#contradictOthers(
          exercised,
          record,
          interference(this.#history, outcome),
        );
      return;
    }
    if (borrowers !== undefined) {
      this.omitted.keep(view, outcome);
      if (!outcome.pass)
        this.#contradictOthers(
          exercised,
          record,
          interference(this.#history, outcome),
        );
      return;
    }
    if (!outcome.pass && view.shape === "list") {
      const retried =
        this.#retryInsert(view, record, exercised) ??
        this.#retrySort(view, record, exercised);
      if (retried !== undefined) {
        // Reordering can replace the entities on a query page. Confirmation
        // and pending-write cleanup must use the successful check's coverage.
        outcome = retried;
        keys = [...outcome.targets, ...outcome.unheld];
        if (blocked(keys)) return;
        exercised = exercisedBy(this.#touched, keys, borrowers);
      }
    }
    // Retain omissions only after the final check's coverage passes the ownership guards.
    this.omitted.keep(view, outcome);
    const interferes = interference(this.#history, outcome);
    const unseen = outcome.pass
      ? this.#confirm(view, record, outcome, exercised)
      : undefined;
    // Only a read whose order the state decides for every entity it lists shows them in place.
    if (
      outcome.pass &&
      view.shape === "list" &&
      outcome.positional === undefined
    ) {
      this.#refuteSorts(view, record);
      const shown = new Set(outcome.targets);
      for (const target of shown) this.#moved.delete(target);
      this.#pending = this.#pending.filter((write) => !shown.has(write.target));
    }
    if (!outcome.pass) {
      const interfered = new Set([...exercised].filter(interferes));
      if (interfered.size === 0)
        this.#mismatch({ record, index, keys, exercised, view });
      else {
        // An unmodelled write after some of these writes may explain the difference: those are checked on their own members only.
        this.#contradictOthers(exercised, record, interferes);
        if (view.shape === "item") this.#checkMembers(view, record, interfered);
        else for (const key of keys) this.#taint.fail(key);
      }
      if (view.shape === "item") this.#adopt(view, record);
    }
    const pending = {
      touched: this.#touched,
      since: this.#touchedSince,
      effects: this.#effects,
    };
    for (const key of keys) {
      this.#lastCheck.set(key, index);
      forgetChecked(pending, key, unseen?.get(key));
    }
  }

  /** A failed read contradicts the writes it exercised that no unmodelled write came after, as a read a write's effect was learned from still does the others. */
  #contradictOthers(
    exercised: ReadonlySet<string>,
    record: StateRecordFacts,
    interferes: (name: string) => boolean,
  ): void {
    for (const name of exercised)
      if (!interferes(name))
        this.#drafts.get(name)!.contradictedBy ??= record.ordinal;
  }

  /** A passing read confirms the writes it exercised that it shows something of, and names, per target, those it shows nothing of. */
  #confirm(
    view: StateView,
    record: StateRecordFacts,
    outcome: CheckOutcome,
    exercised: ReadonlySet<string>,
  ): Map<string, Set<string>> {
    const shown = shownWrites(this.#touched, this.#effects, {
      keys: [...outcome.targets, ...outcome.unheld],
      exercised,
      fields: shownFields(view, this.#input.volatileOf),
    });
    for (const name of shown.confirmed) {
      this.#drafts.get(name)!.confirmed.push(record.ordinal);
      if (showsPlacement(view, outcome, this.#inserted, name)) {
        this.#placed.add(name);
        // Only whole listings in collection order narrow the inserts a later list may still choose among.
        if (view.shape !== "list" || !this.#narrowInserts(view, record, name))
          this.#settledInserts.add(name);
      }
    }
    return shown.unseen;
  }

  /** An overlapping captured write cannot supply a stable read baseline. */
  #writeOverlapsRead(read: StateRecordFacts): boolean {
    return this.#writeCompletion.runningAt(
      read.path,
      this.#input.chronology.startMs(read),
      this.#input.chronology.endMs(read),
    );
  }

  #unmodelled(path: string, index: number): void {
    this.#taint.write(path);
    this.#unmodelledAt.push(index);
  }

  /** Check the writes to an item read's entity on the members they sent, as a resynchronising read does. */
  #checkMembers(
    view: Extract<StateView, { shape: "item" }>,
    record: StateRecordFacts,
    only: ReadonlySet<string>,
  ): void {
    const { collection, id } = itemTarget(this.#state, view.type, record);
    const entity = this.#state.entity(view.type, collection, id);
    if (entity === undefined) return;
    const target = entityTarget(entity.type, entity.collection, entity.id);
    const writes = [...(this.#touched.get(target) ?? [])];
    const checked = new Map(writes.filter(([name]) => only.has(name)));
    this.#checkFields(view, record, entity, checked);
  }

  /** Check the writes to an entity on the fields each wrote against an item read; the read's object, when it shows one. */
  #checkFields(
    view: Extract<StateView, { shape: "item" }>,
    record: StateRecordFacts,
    entity: StateEntity,
    writes: ReadonlyMap<string, readonly string[] | null> = new Map(),
  ): JsonObject | undefined {
    const object = this.#input.io.withBody(record.ordinal, (body) =>
      body === undefined || body === null ? undefined : at(body, view.pointer),
    );
    if (!isObject(object)) return undefined;
    for (const [name, pass] of writtenFieldChecks(entity, view, object, {
      volatile: this.#input.volatileOf(view.type),
      writes,
    })) {
      const draft = this.#drafts.get(name)!;
      if (pass) draft.confirmed.push(record.ordinal);
      else draft.contradictedBy ??= record.ordinal;
    }
    return object;
  }

  /** After a failed item check the state takes what the read recorded, so later checks start from it. */
  #adopt(
    view: Extract<StateView, { shape: "item" }>,
    record: StateRecordFacts,
  ): void {
    const { collection, id } = itemTarget(this.#state, view.type, record);
    const entity = this.#state.entity(view.type, collection, id);
    if (entity === undefined) {
      this.#taint.fail(entityTarget(view.type, collection, id));
      return;
    }
    const object = this.#input.io.withBody(record.ordinal, (body) =>
      body === undefined || body === null ? undefined : at(body, view.pointer),
    );
    if (isObject(object) && !markedDeleted(object))
      this.#state.put(updatedEntity(entity, { ...entity.fields, ...object }));
    else this.#removeEntity(entity);
  }

  /** A read showed the entity gone: the state drops it, and no write keeps a claim on its collection through it. */
  #removeEntity(entity: StateEntity): void {
    this.#state.remove(entity);
    this.#effects.removed(this.#touched, entity);
  }

  /** Contradict the writes a failed check exercised, or, when none, the related writes since its targets were last checked; a failed list stops being checked. */
  #mismatch(failed: {
    readonly record: StateRecordFacts;
    readonly index: number;
    readonly keys: readonly string[];
    readonly exercised: ReadonlySet<string>;
    readonly view: StateView;
  }): void {
    const ordinal = failed.record.ordinal;
    const since = Math.min(
      ...failed.keys.map((key) => this.#lastCheck.get(key) ?? -1),
    );
    const blame = this.#blame.of({ ...failed, since });
    for (const name of blame.confirmed)
      this.#drafts.get(name)!.confirmed.push(ordinal);
    for (const name of blame.contradicted)
      this.#drafts.get(name)!.contradictedBy ??= ordinal;
    if (failed.exercised.size === 0)
      for (const write of this.#log)
        if (
          write.index > since &&
          prefixRelated(write.path, failed.record.path)
        )
          this.#drafts.get(write.tool)!.sideEffect = true;
    if (failed.view.shape !== "item")
      for (const key of failed.keys) this.#taint.fail(key);
  }

  /** What `use` makes of a read's items when the read lists the whole collection the state holds, the only read that shows the order it is kept in. */
  #wholeListing<T>(
    view: Extract<StateView, { shape: "list" }>,
    record: StateRecordFacts,
    use: (items: readonly JsonObject[]) => T,
  ): T | undefined {
    const line = this.#line(view, record);
    const idField = this.#types.get(view.type)?.id_field;
    if (line === undefined || idField === undefined) return undefined;
    const held = new Set(
      this.#state
        .members(view.type, line.collection)
        .map((entity) => entity.id),
    );
    return this.#input.io.withBody(record.ordinal, (body) => {
      const items =
        body === undefined ? undefined : listItems(body, view.pointer);
      if (
        items === undefined ||
        items.length < 2 ||
        items.length !== held.size ||
        !items.every((item) =>
          held.has(scalarText(ownMember(item, idField)) ?? ""),
        )
      )
        return undefined;
      return use(items);
    });
  }

  /** A whole-collection read in collection order that placed a create leaves it only the sorted inserts whose order the read follows, adding those by a field its items all hold, and says whether it did; one its query sorts shows the query's order instead. */
  #narrowInserts(
    view: Extract<StateView, { shape: "list" }>,
    record: StateRecordFacts,
    name: string,
  ): boolean {
    if (sortedByQuery(view, record)) return false;
    const draft = this.#drafts.get(name)!;
    const kept = this.#wholeListing(view, record, (items) => {
      const followed = draft.candidates.filter(
        (candidate) =>
          candidate.rule !== "sorted" ||
          same(candidate, draft.plan.insert) ||
          orderedBy(items, candidate.field, candidate.direction),
      );
      const sorts = listedSorts(items);
      const unfollowed = this.#unfollowedSorts.get(name) ?? new Set<string>();
      for (const { rule, follows } of sorts)
        if (!follows) unfollowed.add(JSON.stringify(rule));
      this.#unfollowedSorts.set(name, unfollowed);
      // A list shown in the order of the field that names its items says less than one in a field people read.
      const idField = this.#types.get(view.type)?.id_field;
      const learned = sorts
        .map(({ rule }) => rule)
        .filter(
          (rule) =>
            !unfollowed.has(JSON.stringify(rule)) &&
            !followed.some((candidate) => same(candidate, rule)),
        )
        .sort(
          (left, right) =>
            Number(left.field === idField) - Number(right.field === idField),
        );
      return [...followed, ...learned];
    });
    if (kept === undefined) return false;
    draft.candidates = kept;
    return true;
  }

  /**
   * The successful check with the collection sorted by a field an update the read exercised writes, when the read
   * lists the whole collection in that order and no create of the type was placed by a sort that excludes it; the
   * type's creates then insert by it, and its updates move their entity by it. A sort the creates chose by a field the
   * update did not write does not stop this when every whole-collection read that placed them followed this order too.
   */
  #retrySort(
    view: Extract<StateView, { shape: "list" }>,
    record: StateRecordFacts,
    exercised: ReadonlySet<string>,
  ): CheckOutcome | undefined {
    const line = this.#line(view, record);
    // A read its query sorts shows the query's order, which may break ties otherwise than the collection.
    if (line === undefined || sortedByQuery(view, record)) return undefined;
    const written = new Set(
      [...exercised].flatMap((name) => {
        const { plan } = this.#drafts.get(name)!;
        return plan.effect === "update" && plan.target === view.type
          ? plan.rules.map((rule) => rule.field)
          : [];
      }),
    );
    // A sort by a field the update wrote has moved its entity already; one by another field may be a guess both fit.
    const current = this.#sortOf(view.type);
    if (current?.rule === "sorted" && written.has(current.field))
      return undefined;
    const creates = [...this.#drafts.values()].filter(
      (draft) =>
        draft.plan.effect === "create" &&
        draft.plan.target === view.type &&
        draft.observed !== undefined,
    );
    const rules =
      this.#wholeListing(view, record, (items) =>
        [...written].flatMap((field) =>
          (["ascending", "descending"] as const).flatMap((direction) =>
            orderedBy(items, field, direction)
              ? [{ rule: "sorted", field, direction } as const]
              : [],
          ),
        ),
      ) ?? [];
    // Serving moves only the entities writes changed since a list last showed them, so the others, including one an
    // earlier write moved that a list then showed in place, must already be in the order tried.
    const kept = this.#state
      .members(view.type, line.collection)
      .filter(
        (entity) =>
          !this.#moved.has(
            entityTarget(entity.type, entity.collection, entity.id),
          ),
      )
      .map((entity) => entity.fields);
    const refuted = this.#refutedSorts.get(view.type);
    for (const rule of rules.filter(
      (candidate) =>
        (current === undefined || !same(candidate, current)) &&
        refuted?.has(JSON.stringify(candidate)) !== true &&
        keptInOrder(kept, candidate),
    )) {
      // A create placed by another sort shows the collection is not kept in this order.
      if (
        creates.some(
          ({ candidates }) =>
            candidates.some((candidate) => candidate.rule === "sorted") &&
            !candidates.some((candidate) => same(candidate, rule)),
        )
      )
        continue;
      // Serving moves each written entity in turn, against the others' values before their own writes.
      const before = this.#state.replay(
        view.type,
        line.collection,
        rule,
        this.#pending,
      );
      const outcome = this.#check(view, record);
      if (outcome?.pass === true) {
        for (const draft of creates) draft.plan.insert = rule;
        this.#learnedSorts.set(view.type, rule);
        return outcome;
      }
      this.#state.restore(view.type, line.collection, before);
    }
    return undefined;
  }

  /** Note the sorts by a field a pending write changed that this passing whole list in collection order rules out. */
  #refuteSorts(
    view: Extract<StateView, { shape: "list" }>,
    record: StateRecordFacts,
  ): void {
    const line = this.#line(view, record);
    if (
      line === undefined ||
      this.#wholeListing(view, record, () => true) === undefined
    )
      return;
    const members = new Map(
      this.#state
        .members(view.type, line.collection)
        .map((entity) => [
          entityTarget(entity.type, entity.collection, entity.id),
          entity.fields,
        ]),
    );
    const writes = this.#pending.filter((write) => members.has(write.target));
    const fields = new Set<string>();
    for (const [index, { target, before }] of writes.entries()) {
      if (before === null) continue;
      const after =
        writes.slice(index + 1).find((later) => later.target === target)
          ?.before ?? members.get(target)!;
      for (const field of Object.keys(after))
        if (!same(ownMember(before, field), ownMember(after, field)))
          fields.add(field);
    }
    const order = [...members.keys()];
    const refuted = this.#refutedSorts.get(view.type) ?? new Set<string>();
    for (const field of fields)
      for (const direction of ["ascending", "descending"] as const) {
        const rule = { rule: "sorted", field, direction } as const;
        const replayed = this.#state.replayedOrder(
          view.type,
          line.collection,
          rule,
          writes,
        );
        if (replayed !== undefined && !same(replayed, order))
          refuted.add(JSON.stringify(rule));
      }
    if (refuted.size > 0) this.#refutedSorts.set(view.type, refuted);
  }

  /** The successful check under another create insertion candidate, including its possibly different query-page coverage. */
  #retryInsert(
    view: Extract<StateView, { shape: "list" }>,
    record: StateRecordFacts,
    exercised: ReadonlySet<string>,
  ): CheckOutcome | undefined {
    const line = this.#line(view, record);
    if (line === undefined || !listsAll(view, line.ordinal)) return undefined;
    const members = this.#state.members(view.type, line.collection);
    const key = (entity: StateEntity) =>
      entityTarget(entity.type, entity.collection, entity.id);
    const inserted = members.filter((entity) =>
      this.#inserted.has(key(entity)),
    );
    const creates = new Set(
      inserted.map((entity) => this.#inserted.get(key(entity))!),
    );
    if (creates.size !== 1) return undefined;
    const [name] = creates;
    const draft = this.#drafts.get(name!)!;
    // An item read confirms the entity, not where a list places it; a read that placed it otherwise than a whole
    // listing did settles where it goes.
    if (!exercised.has(name!) || this.#settledInserts.has(name!))
      return undefined;
    // A create whole listings placed may still take a sort they followed: one placed last fits it before the next shows the order.
    const options = this.#placed.has(name!)
      ? draft.candidates.filter(
          (candidate) =>
            candidate.rule === "sorted" && !same(candidate, draft.plan.insert),
        )
      : draft.candidates.slice(1);
    // A sort an earlier update's whole list ruled out must not become this create's order: serving would move those updates by it.
    const refuted = this.#refutedSorts.get(view.type);
    for (const candidate of options) {
      if (
        candidate.rule === "sorted" &&
        refuted?.has(JSON.stringify(candidate)) === true
      )
        continue;
      this.#state.reinsert(view.type, line.collection, inserted, candidate);
      const outcome = this.#check(view, record);
      if (outcome?.pass === true) {
        draft.plan.insert = candidate;
        return outcome;
      }
    }
    if (draft.plan.insert !== null)
      this.#state.reinsert(
        view.type,
        line.collection,
        inserted,
        draft.plan.insert,
      );
    return undefined;
  }
}
