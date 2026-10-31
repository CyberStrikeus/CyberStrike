import { StateRecordChronology } from "./StateRecordChronology.js";
import { jsonByteLength } from "../jsonSerialization.js";
import type { JsonValue } from "../jsonValue.js";
import {
  compareUnicodeCodePoints as compare,
  compositeKey,
} from "../unicodeCodePointOrder.js";
import {
  ownMember,
  apiBaseLengths,
  at,
  collectionPathOf,
  deletedFlag,
  identifies,
  IDENTITY_NAMES,
  identityCandidates,
  isObject,
  isQueryPost,
  isSafeHttpMethod,
  stateValueRetentionBytes,
  lastSegmentValue,
  STATE_BODY_LIMIT_BYTES,
  listItems,
  markedDeleted,
  locateItem,
  locateList,
  projectsFields,
  rootOf,
  selectsSomeFields,
  same,
  scalarText,
  writeSpanCheck,
  type ExtractedState,
  type JsonObject,
  type RecordedViewReason,
  type StateBudget,
  type ParsedRequestBody,
  requestJson,
  type StateDocument,
  type StateEntity,
  type StateRecordFacts,
  type StateTimeline,
  type StateToolFacts,
  type StateType,
  type StateView,
} from "./environmentStateRules.js";
import { ENTRY_BYTES, textBytes } from "./webNetworkRouteTemplates.js";
import {
  classifyEntityChanges,
  compareObservedEntities,
  mergeObservedEntity,
  type ObservedEntity,
  type StateObservation,
} from "./environmentStateMerge.js";
import { orderByWholeLines } from "./environmentStateInitialOrder.js";
import { rewriteCuts, type RewriteSpan } from "./environmentStateRewrites.js";
import {
  checkItemPlan,
  checkListPlan,
  type LateLine,
  type StateGateContext,
  type StatePlan,
} from "./environmentStateGate.js";
import { StateWriteCutoffs } from "./environmentStateWriteCutoffs.js";
import {
  createdIdsOf,
  creationLimit,
  readType,
  respondedIds,
  type CreatedIds,
} from "./environmentStateWriteLinks.js";
import { extractWrites } from "./environmentStateWrites.js";
import {
  dropObservations,
  lineShapes,
  shapesOtherwise,
  withoutVariants,
} from "./environmentStateVariants.js";
import { stateWritesOf } from "./environmentStateQueryCalls.js";
import {
  declaredMembers,
  envelopeMembers,
  mintedFor,
  perResponseMembers,
  type MintedMembers,
} from "./environmentStateResponseMembers.js";

class StateBudgetExhausted extends Error {}

type Candidate = Pick<StatePlan, "tool" | "item" | "type">;

interface ObservedMembership {
  record: StateRecordFacts;
  readonly ids: Set<string>;
  capacity: number;
}

const entityKey = (type: string, collection: string, id: string): string =>
  compositeKey([type, collection, id]);

const requestLine = (record: StateRecordFacts): string =>
  record.path + (record.query ?? "");

/** The member names of the object at a pointer, none when it holds no object. */
const memberNames = (body: JsonValue, pointer: string): string[] => {
  const object = at(body, pointer);
  return isObject(object) ? Object.keys(object) : [];
};

/** Derive the init state and render plans from manifest tools and timeline-ordered records. */
export class EnvironmentStateExtraction {
  readonly #tools: readonly StateToolFacts[];
  readonly #records: readonly StateRecordFacts[];
  readonly #chronology: StateRecordChronology;
  readonly #budget: StateBudget;
  readonly #byOrdinal: ReadonlyMap<number, StateRecordFacts>;
  /** POST tools whose calls the capture shows read state rather than change it. */
  #readOnly: ReadonlySet<string> = new Set();
  #writes: readonly StateRecordFacts[] = [];
  #writeWithin: ReturnType<typeof writeSpanCheck> = () => false;
  readonly #bases: ReadonlyMap<string, number>;
  #writeCutoffs: StateWriteCutoffs | undefined;
  readonly #initLimits = new Map<string, StateRecordFacts | undefined>();
  /** Successful POSTs with the ids their responses named, read once before planning. */
  #created: CreatedIds[] | undefined;
  readonly #identity = new Map<
    string,
    { readonly field: string; readonly basis: StateType["id_basis"] }
  >();
  readonly #views = new Map<string, StateView>();
  readonly #plans: StatePlan[] = [];
  readonly #entities = new Map<string, ObservedEntity>();
  readonly #volatile = new Map<string, Set<string>>();
  /** Types with a value that changed across a recorded write, which may be that write's effect. */
  readonly #rewritten = new Set<string>();
  /** The recordings either side of each such change, and per type the write its initial reads end at. */
  #spans: RewriteSpan[] = [];
  #cuts: ReadonlyMap<string, StateRecordFacts> = new Map();
  #minted: MintedMembers | undefined;
  readonly #merged = new Map<string, StateEntity>();
  /** Merged entities by type and collection, built once on first use after merging. */
  #collections: Map<string, StateEntity[]> | undefined;

  constructor(input: {
    readonly tools: readonly StateToolFacts[];
    readonly records: readonly StateRecordFacts[];
    readonly timeline: StateTimeline;
    readonly budget: StateBudget;
  }) {
    this.#tools = input.tools;
    this.#records = input.records;
    this.#chronology = new StateRecordChronology(input.records, input.timeline);
    this.#budget = input.budget;
    this.#byOrdinal = new Map(
      input.records.map((record) => [record.ordinal, record]),
    );
    this.#bases = apiBaseLengths(input.tools.map((tool) => tool.path_template));
  }

  /** The timeline's state writes, less the calls of tools that only read. */
  #findWrites(): void {
    // The body digests the decision keeps are dropped with it, so what they were charged is released.
    const release = this.#budget.checkpoint();
    ({ readOnly: this.#readOnly, writes: this.#writes } = stateWritesOf(
      this.#tools,
      this.#records,
      {
        withBody: (ordinal, use) => this.#withBody(ordinal, use),
        request: (ordinal) => this.#requestBody(ordinal),
        retain: (bytes) => this.#retain(bytes),
      },
      this.#chronology,
    ));
    release();
    this.#writeWithin = writeSpanCheck(this.#writes, this.#chronology);
  }

  /** The extracted state, or null when the representation budget is exhausted. */
  run(): ExtractedState | null {
    try {
      this.#findWrites();
      if (this.#writes.length > 0) {
        this.#writeCutoffs = new StateWriteCutoffs(
          this.#writes,
          this.#bases,
          (left, right) =>
            this.#chronology.positions.get(left.ordinal)! <
            this.#chronology.positions.get(right.ordinal)!,
          (bytes) => this.#retain(bytes),
        );
        this.#creations();
      }
      // A rewrite cut discards the first planning pass, so what it retained is released before the second.
      const release = this.#budget.checkpoint();
      let candidates = this.#plan();
      if (this.#cutRewrites()) {
        release();
        candidates = this.#plan();
      }
      const gate = this.#gateContext();
      for (const plan of this.#plans)
        if (this.#rewritten.has(plan.type))
          this.#recorded(plan.tool, "fields-differ");
        else
          this.#views.set(
            plan.tool.name,
            plan.item ? checkItemPlan(gate, plan) : checkListPlan(gate, plan),
          );
      return this.#withWrites(this.#result(this.#documents(candidates)));
    } catch (cause: unknown) {
      if (cause instanceof StateBudgetExhausted) return null;
      throw cause;
    }
  }

  /** Plan and observe every candidate, then merge the observed entities. */
  #plan(): Candidate[] {
    const candidates = this.#candidates();
    for (const candidate of candidates.filter((entry) => entry.item))
      this.#planItem(candidate);
    for (const candidate of candidates.filter((entry) => !entry.item))
      this.#planList(candidate);
    for (const plan of this.#plans) this.#observePlan(plan);
    this.#dropVariants();
    orderByWholeLines(
      this.#entities.values(),
      (ordinal) => this.#byOrdinal.get(ordinal)?.query,
    );
    this.#classifyChanges();
    this.#merge();
    return candidates;
  }

  /** Leave each plan's representation variants to replay: out of its lines, the observed entities and the membership changes. */
  #dropVariants(): void {
    const shapes = lineShapes(this.#entities.values(), (bytes) =>
      this.#retain(bytes),
    );
    const dropped = new Set<number>();
    for (const [index, plan] of this.#plans.entries()) {
      const split = withoutVariants(plan, {
        shapeOf: (record) => shapes.get(record.ordinal),
        queryOf: (ordinal) => this.#byOrdinal.get(ordinal)?.query,
        position: (ordinal) => this.#chronology.positions.get(ordinal)!,
        retain: (bytes) => this.#retain(bytes),
        checkpoint: () => this.#budget.checkpoint(),
      });
      if (split === undefined) continue;
      this.#retain(ENTRY_BYTES * (split.dropped.size + 2));
      this.#plans[index] = split.plan;
      dropObservations(this.#entities, split.dropped);
      for (const ordinal of split.dropped) dropped.add(ordinal);
    }
    this.#spans = this.#spans.filter((span) => !dropped.has(span.later));
  }

  /** End each rewritten type's initial reads at the earliest write its reads disagree across, and clear the plans to make them again. */
  #cutRewrites(): boolean {
    this.#cuts = rewriteCuts(
      this.#spans.filter((span) => this.#rewritten.has(span.type)),
      this.#writes,
      this.#byOrdinal,
      this.#chronology,
    );
    if (this.#cuts.size === 0) return false;
    for (const map of [this.#initLimits, this.#identity, this.#views])
      map.clear();
    for (const map of [this.#entities, this.#volatile, this.#merged])
      map.clear();
    this.#rewritten.clear();
    this.#plans.length = 0;
    this.#spans = [];
    this.#collections = undefined;
    return true;
  }

  /** The write plans the capture's own timeline confirms against the extracted state. */
  #withWrites(
    state: Omit<ExtractedState, "writes" | "write_clock">,
  ): ExtractedState {
    return {
      ...state,
      ...extractWrites(state, {
        tools: this.#tools,
        records: this.#records,
        readOnly: this.#readOnly,
        chronology: this.#chronology,
        volatileOf: (type) => this.#volatileOf(type),
        io: {
          withBody: (ordinal, use) => this.#withBody(ordinal, use),
          requestBody: (ordinal) => this.#parsedRequestBody(ordinal),
          withRequestBody: (ordinal, use) =>
            this.#withRequestBody(ordinal, use),
          emptyResponse: (ordinal) => this.#budget.emptyResponse(ordinal),
          retain: (bytes) => this.#retain(bytes),
          queryOf: (ordinal) => this.#byOrdinal.get(ordinal)?.query,
        },
      }),
    };
  }

  #withRequestBody<T>(ordinal: number, use: (body: ParsedRequestBody) => T): T {
    const value = this.#budget.withRequestBody(ordinal, use);
    if (value === null) throw new StateBudgetExhausted();
    return value;
  }

  #parsedRequestBody(ordinal: number): ParsedRequestBody {
    return this.#withRequestBody(ordinal, (body) => body);
  }

  #requestBody(ordinal: number): JsonValue | undefined {
    return requestJson(this.#parsedRequestBody(ordinal));
  }

  #retain(bytes: number): void {
    if (!this.#budget.retain(bytes)) throw new StateBudgetExhausted();
  }

  /** Parse one body and hand it to `use` before its temporary work is dropped; unusable bodies arrive undefined. */
  #withBody<T>(ordinal: number, use: (body: JsonValue | undefined) => T): T {
    try {
      const parsed = this.#budget.body(ordinal);
      if (parsed === null) throw new StateBudgetExhausted();
      return use(parsed.kind === "json" ? parsed.value : undefined);
    } finally {
      this.#budget.release();
    }
  }

  #recorded(tool: StateToolFacts, reason: RecordedViewReason): void {
    this.#views.set(tool.name, { tool: tool.name, shape: "recorded", reason });
  }

  /** GET tools may render from state; other safe methods and query POSTs replay. */
  #candidates(): Candidate[] {
    const candidates: Candidate[] = [];
    for (const tool of this.#tools) {
      if (
        isQueryPost(tool.method, tool.path_template) ||
        this.#readOnly.has(tool.name)
      )
        this.#recorded(tool, "query-body");
      else if (tool.method !== "GET" && isSafeHttpMethod(tool.method))
        this.#recorded(tool, "method-replay");
      if (tool.method !== "GET") continue;
      candidates.push({ tool, ...readType(tool.path_template) });
    }
    return candidates;
  }

  /** The first write whose root relates to the template's, or that made one of its entities, bounds its init recordings. */
  #initLimit(template: string): StateRecordFacts | undefined {
    if (this.#writeCutoffs === undefined) return undefined;
    if (this.#initLimits.has(template)) return this.#initLimits.get(template);
    const first = this.#writeCutoffs.first(rootOf(template, this.#bases));
    const bound =
      creationLimit(
        this.#creations(),
        {
          type: template,
          chronology: this.#chronology,
          tools: this.#tools,
          records: this.#byOrdinal,
          position: (record) => this.#chronology.positions.get(record.ordinal)!,
          withBody: (ordinal, use) => this.#withBody(ordinal, use),
          retain: (bytes) => this.#retain(bytes),
        },
        first,
      ) ?? first;
    const cut = this.#cuts.get(template);
    const limit =
      cut !== undefined &&
      (bound === undefined ||
        this.#chronology.positions.get(cut.ordinal)! <
          this.#chronology.positions.get(bound.ordinal)!)
        ? cut
        : bound;
    this.#retain(ENTRY_BYTES + textBytes(template.length));
    this.#initLimits.set(template, limit);
    return limit;
  }

  #creations(): CreatedIds[] {
    this.#created ??= createdIdsOf(this.#writes, (ordinal) => {
      const ids = this.#withBody(ordinal, respondedIds);
      this.#retain(ENTRY_BYTES + textBytes(ids.join("").length));
      return ids;
    });
    return this.#created;
  }

  /** Initial-state admission is shared with later projection-evidence selection. */
  #beforeInitLimit(
    record: StateRecordFacts,
    limit: StateRecordFacts | undefined,
  ): boolean {
    return (
      limit === undefined ||
      (this.#chronology.positions.get(record.ordinal)! <
        this.#chronology.positions.get(limit.ordinal)! &&
        this.#chronology.completedBefore(record, limit))
    );
  }

  /** Successful recordings that finished before the first related write began. */
  #initRecordings(tool: StateToolFacts, template: string): StateRecordFacts[] {
    const limit = this.#initLimit(template);
    return tool.record_ordinals
      .map((ordinal) => this.#byOrdinal.get(ordinal))
      .filter(
        (record): record is StateRecordFacts =>
          record !== undefined &&
          record.status !== null &&
          record.status >= 200 &&
          record.status < 300 &&
          this.#beforeInitLimit(record, limit),
      )
      .sort(
        (left, right) =>
          this.#chronology.positions.get(left.ordinal)! -
          this.#chronology.positions.get(right.ordinal)!,
      );
  }

  #latestPerLine(recordings: readonly StateRecordFacts[]): StateRecordFacts[] {
    const latest = new Map<string, StateRecordFacts>();
    for (const record of recordings) {
      latest.delete(requestLine(record));
      latest.set(requestLine(record), record);
    }
    return [...latest.values()];
  }

  /** A candidate's initial recordings, or undefined after recording that it has none. */
  #initRecordingsOf(candidate: Candidate): StateRecordFacts[] | undefined {
    const recordings = this.#initRecordings(candidate.tool, candidate.type);
    if (recordings.length > 0) return recordings;
    this.#recorded(candidate.tool, "no-init-recording");
    return undefined;
  }

  #addPlan(
    candidate: Candidate,
    pointer: string,
    recordings: readonly StateRecordFacts[],
    replayed: Pick<
      StatePlan,
      "projected" | "late" | "laterFields" | "deletedFlag"
    > = {},
  ): void {
    this.#plans.push({
      ...candidate,
      pointer,
      recordings,
      latest: this.#latestPerLine(recordings),
      projected: replayed.projected ?? [],
      late: replayed.late ?? [],
      ...(replayed.laterFields === undefined ||
      replayed.laterFields.length === 0
        ? {}
        : { laterFields: replayed.laterFields }),
      ...(replayed.deletedFlag === undefined
        ? {}
        : { deletedFlag: replayed.deletedFlag }),
    });
  }

  /** The members later plain item reads show of the entity they name, in first-seen order, and the flag any of its reads sets on one the application soft-deleted. */
  #laterFields(
    tool: StateToolFacts,
    type: string,
    entity: { readonly field: string; readonly pointer: string },
  ): Pick<StatePlan, "laterFields" | "deletedFlag"> {
    const limit = this.#initLimit(type);
    const names: string[] = [];
    const seen = new Set<string>();
    let flag: StatePlan["deletedFlag"];
    if (limit === undefined) return { laterFields: names };
    for (const ordinal of tool.record_ordinals) {
      const record = this.#byOrdinal.get(ordinal);
      if (
        record === undefined ||
        record.status === null ||
        record.status < 200 ||
        record.status >= 300
      )
        continue;
      // Any read may show the soft-delete flag; only plain later reads add fields.
      const later =
        (record.query ?? "") === "" && !this.#beforeInitLimit(record, limit);
      if (!later && flag !== undefined) continue;
      this.#withBody(ordinal, (body) => {
        const object =
          body === undefined ? undefined : at(body, entity.pointer);
        if (!isObject(object) || ownMember(object, entity.field) === undefined)
          return;
        flag ??= deletedFlag(object);
        if (!later) return;
        for (const name of Object.keys(object))
          if (!seen.has(name)) {
            seen.add(name);
            names.push(name);
            this.#retain(ENTRY_BYTES + textBytes(name.length));
          }
      });
    }
    if (flag === undefined) return { laterFields: names };
    // The flag is a field the item view shows, even when only a query read showed it.
    if (!seen.has(flag)) names.push(flag);
    return { laterFields: names, deletedFlag: flag };
  }

  /**
   * Later identity-free projections are evidence of replay, never initial entities; later lines that
   * show the identity and name a shaping or projection parameter are kept, with their members, for
   * the variant pass to decide against the lines left. Read only those query bodies.
   */
  #addLateProjections(
    tool: StateToolFacts,
    type: string,
    projected: number[],
  ): LateLine[] {
    const limit = this.#initLimit(type);
    const late: LateLine[] = [];
    if (limit === undefined) return late;
    for (const ordinal of tool.record_ordinals) {
      const record = this.#byOrdinal.get(ordinal);
      if (
        record === undefined ||
        record.status === null ||
        record.status < 200 ||
        record.status >= 300 ||
        this.#beforeInitLimit(record, limit)
      )
        continue;
      const projecting = projectsFields(record.query);
      // A selection of every field (`fields=*`) shows the entity whole, so only a partial one may replay.
      const selecting = selectsSomeFields(record.query);
      const shaping = shapesOtherwise(record.query);
      if (!projecting && !shaping) continue;
      const line = this.#withBody(ordinal, (body) => {
        if (body === undefined) return undefined;
        const located = locateItem(body, lastSegmentValue(record.path));
        if (located === undefined) return projecting ? null : undefined;
        if (!selecting && !shaping) return undefined;
        const names = memberNames(body, located.pointer);
        // The kept set holds the names, which the body's own reservation no longer covers.
        this.#retain(
          ENTRY_BYTES * (2 + names.length) +
            names.reduce((bytes, name) => bytes + textBytes(name.length), 0),
        );
        return { record, members: new Set(names), projecting: selecting };
      });
      if (line === null) {
        this.#retain(ENTRY_BYTES);
        projected.push(ordinal);
      } else if (line !== undefined) late.push(line);
    }
    return late;
  }

  /** Item tools prove a type's identity field by the path value their bodies repeat. */
  #planItem(candidate: Candidate): void {
    const { tool, type } = candidate;
    const recordings = this.#initRecordingsOf(candidate);
    if (recordings === undefined) return;
    let pointer: string | undefined;
    let keys: string[] | undefined;
    const kept: StateRecordFacts[] = [];
    const projected: number[] = [];
    for (const record of recordings) {
      const located = this.#withBody(record.ordinal, (body) =>
        body === undefined
          ? null
          : locateItem(body, lastSegmentValue(record.path)),
      );
      if (located === null) {
        this.#recorded(tool, "body-unusable");
        return;
      }
      // A read that asked for some fields only may leave the identity out; replay answers it.
      if (located === undefined && projectsFields(record.query)) {
        this.#retain(ENTRY_BYTES);
        projected.push(record.ordinal);
        continue;
      }
      kept.push(record);
      if (
        located === undefined ||
        (pointer ?? located.pointer) !== located.pointer
      ) {
        this.#recorded(tool, "no-identity");
        return;
      }
      pointer = located.pointer;
      if (keys === undefined) keys = located.keys;
      else {
        const matching = new Set(located.keys);
        keys = keys.filter((key) => matching.has(key));
      }
    }
    const field =
      IDENTITY_NAMES.find((name) => keys?.includes(name) === true) ?? keys?.[0];
    const known = this.#identity.get(type);
    if (
      field === undefined ||
      pointer === undefined ||
      (known !== undefined && known.field !== field)
    ) {
      this.#recorded(tool, "no-identity");
      return;
    }
    this.#identity.set(type, { field, basis: "path-parameter" });
    const late = this.#addLateProjections(tool, type, projected);
    projected.sort(
      (left, right) =>
        this.#chronology.positions.get(left)! -
        this.#chronology.positions.get(right)!,
    );
    const later = this.#laterFields(tool, type, { field, pointer });
    this.#addPlan(candidate, pointer, kept, { projected, late, ...later });
  }

  /**
   * List tools use the proved field, else the first identity candidate every non-empty recording's
   * items share; a suffix-named field must also show distinct values across two items of one
   * recording. Reads without a list or identity are left to documents.
   */
  #planList(candidate: Candidate): void {
    const { tool, type } = candidate;
    const initial = this.#initRecordingsOf(candidate);
    if (initial === undefined) return;
    // Beside a line showing whole entities, one asking for some fields only is replayed and proves nothing; one asking for all is whole.
    const whole = initial.filter((record) => !selectsSomeFields(record.query));
    const recordings = whole.length > 0 ? whole : initial;
    const proved = this.#identity.get(type)?.field;
    const fieldsOf = (items: readonly JsonObject[]): string[] =>
      proved === undefined
        ? identityCandidates(items)
        : identifies(items, proved)
          ? [proved]
          : [];
    let pointer: string | undefined;
    let names: readonly string[] | undefined;
    // A single listed item is distinct from nothing, so it shows no field distinct.
    const shown = new Set<string>();
    for (const record of recordings) {
      const found = this.#withBody(record.ordinal, (body) => {
        if (body === undefined) return null;
        // Every recording must locate the same list, so a later entity envelope is not taken as one.
        const located = locateList(body, proved);
        if (pointer !== undefined && located !== pointer) return undefined;
        const items =
          located === undefined ? undefined : listItems(body, located);
        if (items === undefined) return undefined;
        pointer = located;
        // An empty list constrains no field.
        return items.length === 0
          ? true
          : { fields: fieldsOf(items), several: items.length > 1 };
      });
      if (found === undefined) return;
      if (found === null) {
        this.#recorded(tool, "body-unusable");
        return;
      }
      if (found === true) continue;
      // The first recording's candidates stand; later ones intersect through a set, so a wide
      // item costs one pass per recording.
      if (names === undefined) names = found.fields;
      else {
        const matching = new Set(found.fields);
        names = names.filter((name) => matching.has(name));
      }
      if (found.several) for (const name of found.fields) shown.add(name);
    }
    // An identity name is only inferred from items that carry it; empty lists prove none.
    const field = (names ?? (proved === undefined ? [] : [proved])).find(
      (name) =>
        name === proved || IDENTITY_NAMES.includes(name) || shown.has(name),
    );
    if (field === undefined || pointer === undefined) return;
    if (!this.#identity.has(type))
      this.#identity.set(type, { field, basis: "field-name" });
    this.#retain(ENTRY_BYTES * (initial.length - recordings.length));
    this.#addPlan(candidate, pointer, recordings, {
      projected: initial
        .filter((record) => !recordings.includes(record))
        .map((record) => record.ordinal),
    });
  }

  #observePlan(plan: StatePlan): void {
    // Only lists whose observations span a write need membership snapshots, including empty lists.
    const memberships =
      !plan.item &&
      this.#writeWithin(plan.recordings[0]!, plan.recordings.at(-1)!)
        ? new Map<string, ObservedMembership>()
        : undefined;
    for (const record of plan.recordings)
      this.#withBody(record.ordinal, (body) => {
        const located = body === undefined ? undefined : at(body, plan.pointer);
        const objects = plan.item
          ? isObject(located)
            ? [located]
            : []
          : body === undefined
            ? []
            : (listItems(body, plan.pointer) ?? []);
        if (memberships !== undefined)
          this.#observeMembership(plan, record, objects, memberships);
        objects.forEach((object, index) =>
          this.#observe(plan, record, object, index),
        );
      });
  }

  /** Compare one request line's membership before discarding older recordings; reuse its bounded set. */
  #observeMembership(
    plan: StatePlan,
    record: StateRecordFacts,
    objects: readonly JsonObject[],
    memberships: Map<string, ObservedMembership>,
  ): void {
    const line = requestLine(record);
    let previous = memberships.get(line);
    const earlier = previous?.record;
    if (previous === undefined) {
      this.#retain(ENTRY_BYTES * 2 + textBytes(line.length));
      previous = { record, ids: new Set(), capacity: 0 };
      memberships.set(line, previous);
    }
    // Reserve the peak membership representation before growing the set, including numeric ID text.
    if (objects.length > previous.capacity) {
      this.#retain((objects.length - previous.capacity) * ENTRY_BYTES * 4);
      previous.capacity = objects.length;
    }
    const field = this.#identity.get(plan.type)!.field;
    let changed = previous.ids.size !== objects.length;
    for (const object of objects)
      if (!previous.ids.delete(scalarText(ownMember(object, field))!))
        changed = true;
    if (previous.ids.size > 0) changed = true;
    if (
      earlier !== undefined &&
      changed &&
      this.#writeWithin(earlier, record)
    ) {
      // Each kept span is charged as an entity change's is.
      this.#retain(ENTRY_BYTES * 4);
      this.#spans.push({
        type: plan.type,
        earlier: earlier.ordinal,
        later: record.ordinal,
      });
    }
    previous.ids.clear();
    for (const object of objects)
      previous.ids.add(scalarText(ownMember(object, field))!);
    previous.record = record;
  }

  /** Record one observed entity object; a value that changes between one tool's own observations is volatile. */
  #observe(
    plan: StatePlan,
    record: StateRecordFacts,
    object: JsonObject,
    index: number,
  ): void {
    const field = this.#identity.get(plan.type)!.field;
    const id = scalarText(ownMember(object, field));
    if (id === undefined) return;
    const collection = collectionPathOf(record, plan.item);
    const key = entityKey(plan.type, collection, id);
    const position = this.#chronology.positions.get(record.ordinal)!;
    let entity = this.#entities.get(key);
    if (entity === undefined) {
      this.#retain(ENTRY_BYTES * 4 + textBytes(key.length));
      entity = {
        type: plan.type,
        collection,
        id,
        order: [position, index],
        observations: [],
      };
      this.#entities.set(key, entity);
    } else {
      // Plans are observed item tools first, so keep the earliest sighting in timeline order.
      const [first, at] = entity.order;
      if (position < first || (position === first && index < at))
        entity.order = [position, index];
    }
    this.#retain(ENTRY_BYTES + stateValueRetentionBytes(object));
    entity.observations.push({
      position,
      index,
      ordinal: record.ordinal,
      tool: plan.tool.name,
      item: plan.item,
      object,
    });
  }

  /** A change across any recorded write, in values or in a kept line's membership, rewrites the type; one between repeats of a line with no write is volatile. */
  #classifyChanges(): void {
    const recordOf = (observation: StateObservation): StateRecordFacts =>
      this.#byOrdinal.get(observation.ordinal)!;
    const changes = classifyEntityChanges(
      this.#entities.values(),
      (observation) => [observation.tool, requestLine(recordOf(observation))],
      (earlier, later) => this.#writeWithin(recordOf(earlier), recordOf(later)),
    );
    this.#retain(ENTRY_BYTES * 4 * changes.spans.length);
    for (const span of changes.spans) this.#spans.push(span);
    for (const { type } of this.#spans) this.#rewritten.add(type);
    for (const [type, names] of changes.volatile)
      this.#volatile.set(type, names);
  }

  #merge(): void {
    for (const entity of [...this.#entities.values()].sort(
      compareObservedEntities,
    ))
      this.#merged.set(
        entityKey(entity.type, entity.collection, entity.id),
        mergeObservedEntity(entity),
      );
  }

  #gateContext(): StateGateContext {
    this.#minted ??= perResponseMembers({
      records: this.#records,
      withBody: (ordinal, use) => this.#withBody(ordinal, use),
      writeWithin: this.#writeWithin,
      retain: (bytes) => this.#retain(bytes),
      checkpoint: () => this.#budget.checkpoint(),
    });
    return {
      minted: this.#minted,
      withBody: (ordinal, use) => this.#withBody(ordinal, use),
      retain: (bytes) => this.#retain(bytes),
      entity: (type, collection, id) =>
        this.#merged.get(entityKey(type, collection, id)),
      inCollection: (type, collection) => this.#inCollection(type, collection),
      heldFields: (type) => {
        const fields = new Set<string>();
        for (const entity of this.#merged.values())
          if (entity.type === type) {
            for (const name of Object.keys(entity.fields)) fields.add(name);
            for (const view of entity.view_fields)
              for (const name of Object.keys(view.fields)) fields.add(name);
          }
        return fields;
      },
      volatileOf: (type) => this.#volatileOf(type),
      idField: (type) => this.#identity.get(type)!.field,
    };
  }

  #volatileOf(type: string): ReadonlySet<string> {
    return this.#volatile.get(type) ?? new Set<string>();
  }

  #inCollection(type: string, collection: string): StateEntity[] {
    if (this.#collections === undefined) {
      this.#retain(ENTRY_BYTES * (this.#merged.size + 1));
      this.#collections = new Map();
      // List serving selects live entities; item observations retain deleted entities separately.
      for (const entity of this.#merged.values()) {
        if (markedDeleted(entity.fields)) continue;
        const key = JSON.stringify([entity.type, entity.collection]);
        const members = this.#collections.get(key);
        if (members === undefined) this.#collections.set(key, [entity]);
        else members.push(entity);
      }
    }
    return this.#collections.get(JSON.stringify([type, collection])) ?? [];
  }

  /** A list tool without a plan or recorded reason holds one document value: its latest init recording, under one request line. */
  #documents(candidates: readonly Candidate[]): StateDocument[] {
    const documents: StateDocument[] = [];
    for (const { tool, item } of candidates) {
      if (item || this.#views.has(tool.name)) continue;
      const recordings = this.#initRecordings(tool, tool.path_template);
      const latest = this.#latestPerLine(recordings);
      if (latest.length !== 1) {
        const paths = new Set(latest.map((record) => record.path));
        this.#recorded(
          tool,
          latest.length === 0
            ? "no-init-recording"
            : paths.size > 1
              ? "path-varies"
              : "query-varies",
        );
        continue;
      }
      const record = latest[0]!;
      // A value that changed across a write, even under another root, is not one initial state.
      if (
        recordings.some(
          (after, index) =>
            index > 0 &&
            this.#writeWithin(recordings[index - 1]!, after) &&
            this.#withBody(recordings[index - 1]!.ordinal, (before) =>
              this.#withBody(after.ordinal, (body) => !same(before, body)),
            ),
        )
      ) {
        this.#recorded(tool, "fields-differ");
        continue;
      }
      const value = this.#withBody(record.ordinal, (body) => body);
      if (value === undefined) {
        this.#recorded(tool, "body-unusable");
        continue;
      }
      // Parsing can lengthen a body that was admitted under the recorded-text limit:
      // `1e3` is four bytes once rendered as `1000`. Serving refuses that rendering,
      // so an oversized document stays the recorded replay instead of a failing read.
      if (jsonByteLength(value) > STATE_BODY_LIMIT_BYTES) {
        this.#recorded(tool, "rendered-oversize");
        continue;
      }
      this.#retain(
        ENTRY_BYTES +
          stateValueRetentionBytes(value) +
          textBytes(record.path.length),
      );
      documents.push({
        tool: tool.name,
        path: record.path,
        value,
        record_ordinal: record.ordinal,
      });
      const minted = mintedFor(this.#minted ?? new Map(), [record]);
      this.#views.set(tool.name, {
        tool: tool.name,
        shape: "document",
        checked_record_ordinals: [record.ordinal],
        ...declaredMembers(envelopeMembers(value, minted), (bytes) =>
          this.#retain(bytes),
        ),
      });
    }
    return documents.sort((left, right) => compare(left.tool, right.tool));
  }

  /** Types and entities that at least one state-backed view renders; view values only for those views. */
  #result(
    documents: StateDocument[],
  ): Omit<ExtractedState, "writes" | "write_clock"> {
    const backed = new Set<string>();
    const backedTypes = new Set<string>();
    for (const view of this.#views.values())
      if (view.shape === "item" || view.shape === "list") {
        this.#retain(ENTRY_BYTES);
        backed.add(view.tool);
        if (!backedTypes.has(view.type)) {
          this.#retain(ENTRY_BYTES);
          backedTypes.add(view.type);
        }
      }
    const types = [...this.#identity.entries()]
      .filter(([type]) => backedTypes.has(type))
      .map(([type, { field, basis }]): StateType => ({
        collection_template: type,
        id_field: field,
        id_basis: basis,
        init_before_ordinal: this.#initLimit(type)?.ordinal ?? null,
        volatile_fields: [...this.#volatileOf(type)].sort(compare),
      }))
      .sort((left, right) =>
        compare(left.collection_template, right.collection_template),
      );
    const typed = new Set(types.map((type) => type.collection_template));
    return {
      types,
      entities: [...this.#merged.values()]
        .filter((entity) => typed.has(entity.type))
        .map((entity) => ({
          ...entity,
          view_fields: entity.view_fields.filter((view) =>
            backed.has(view.tool),
          ),
        })),
      documents,
      views: this.#tools.flatMap((tool) => {
        const view = this.#views.get(tool.name);
        return view === undefined ? [] : [view];
      }),
    };
  }
}
