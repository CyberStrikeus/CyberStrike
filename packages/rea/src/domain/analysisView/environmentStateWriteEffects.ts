import type { StateRecordChronology } from "./StateRecordChronology.js";
import { jsonTextCodeUnits } from "../jsonSerialization.js";
import type { JsonValue } from "../jsonValue.js";
import {
  ownMember,
  isObject,
  locateItem,
  at,
  same,
  type JsonObject,
  type ParsedRequestBody,
  requestJson,
  type StateDocument,
  type StateEntity,
  type StateRecordFacts,
  type StateToolFacts,
  type StateType,
  type StateView,
} from "./environmentStateRules.js";
import {
  updatedEntity,
  updatedFields,
  recordedGeneratedValue,
} from "./environmentStateWriteApply.js";
import {
  collectionTarget,
  entityTarget,
  itemTarget,
  type SimulatedState,
} from "./environmentStateWriteChecks.js";
import {
  explainUpdate,
  responseShapeOf,
} from "./environmentStateWriteExplain.js";
import { otherFields } from "./environmentStateWriteGenerated.js";
import {
  contradictsEarlierCalls,
  defaultsDisagree,
  disagreesWithCall,
  keptFields,
  rememberCall,
  appliedUpdate,
  type UpdateCall,
  conflictsWithPlan,
  refinedBody,
  reconciledUpdateRule,
  toggledRules,
} from "./environmentStateWriteCalls.js";
import {
  laterObservation,
  respelledInstant,
  shownBefore,
  viewFields,
  type Observed,
  type ObservationSearch,
  type ObservedRead,
} from "./environmentStateWriteObserve.js";
import {
  plannedBody,
  readSpellsCoarser,
  readSpelledClocks,
  restampedFields,
} from "./environmentStateWriteStamps.js";
import { readClock } from "./environmentStateWriteValues.js";
import type { CreateEvidence } from "./environmentStateWriteExplain.js";
import {
  noteAmpersands,
  noteHeldAmpersands,
  type AmpersandSpelling,
} from "./environmentStateWriteCreateCalls.js";
import {
  fittedClockFormat,
  matchesClockFormat,
  noteFixedWidths,
} from "./environmentStateWriteClockFormats.js";
import {
  actionItemPath,
  observationNeeds,
} from "./environmentStateWriteAddress.js";
import {
  keptOrders,
  pathValuesOf,
  siblingTrimmedClocks,
  type FieldRule,
  type InsertRule,
  type StateWritePlan,
  type WriteCall,
  type WriteReason,
  type WriteResponse,
} from "./environmentStateWriteRules.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A plan under construction and the evidence the walk gathers for its verdict. */
export interface WriteDraft {
  readonly plan: Mutable<StateWritePlan>;
  /** The exemplar's observed entity, whose unruled fields a create keeps. */
  observed: JsonObject | undefined;
  candidates: InsertRule[];
  readonly confirmed: number[];
  contradictedBy: number | undefined;
  sideEffect: boolean;
  calls: number;
  /** The scalar values each modelled update call showed and sent, and the fields it kept, which later rules must reproduce. */
  readonly updates: UpdateCall[];
  /** The last value each sequence took, by field and, for a collection's sequence, collection; the next call must follow it. */
  readonly sequences: Map<string, number>;
  /** Integers the exemplar showed in fields no rule wrote, above every value its type held, where a later call's sequence may start. */
  readonly starts: Map<string, number>;
  /** Collections of accepted create calls, used to check late sequence adoption. */
  readonly createCollections: string[];
  /** The largest integer each echoed field held on an accepted create, which a sequence adopted later must count past. */
  readonly sentLargest: Map<string, number>;
  /** The collection a create writes into when its own path names no state type: the one its returned id was read under. */
  readonly linked?: string | undefined;
  /** Fields an item action's call found already at the value it sets them to. */
  readonly steady: Set<string>;
  /** Unsent clocks a call left as they were in its own second, which it cannot show it stamps. */
  readonly unstamped: Set<string>;
  /** Members a call stored as sent with strings out of code-point order, which no plan may store sorted. */
  readonly kept: Set<string>;
  /** A value a held entity or an accepted call showed each clock field at a fixed width in, which keeps it untrimmed. */
  readonly fixedWidth: Map<string, JsonValue>;
  /** What explained a create's exemplar, kept until a later call widens the plan, which it may then explain again. */
  exemplarInput?: CreateEvidence | undefined;
  /** How the calls a create plan accepted and the entities its type held spelled `&` in each slugged field. */
  readonly ampersands: Map<string, AmpersandSpelling>;
}

/** The value a draft fits a clock field against: one showing it at a fixed width, else the exemplar's. */
export const clockEvidence = (
  draft: WriteDraft,
  field: string,
): JsonValue | undefined =>
  draft.fixedWidth.get(field) ?? ownMember(draft.observed, field);

/** A write observation plus the fields its selected read view actually covers, if any. */
type UpdateObservation = Observed & {
  readonly readFields?: readonly string[];
};

/** Response bodies, request bodies and budget the effects read. */
export interface WriteIo {
  readonly withBody: <T>(
    ordinal: number,
    use: (body: JsonValue | undefined) => T,
  ) => T;
  readonly requestBody: (ordinal: number) => ParsedRequestBody;
  readonly withRequestBody: <T>(
    ordinal: number,
    use: (body: ParsedRequestBody) => T,
  ) => T;
  readonly emptyResponse: (ordinal: number) => boolean;
  readonly retain: (bytes: number) => void;
  readonly queryOf: (ordinal: number) => string | null | undefined;
}

/** What the write gate reads: the manifest tools, the timeline, the read views and the initial state. */
export interface WriteSimulationInput {
  readonly tools: readonly StateToolFacts[];
  readonly records: readonly StateRecordFacts[];
  /** POST tools whose calls read state rather than change it. */
  readonly readOnly: ReadonlySet<string>;
  readonly chronology: StateRecordChronology;
  readonly views: ReadonlyMap<string, StateView>;
  readonly types: readonly StateType[];
  readonly entities: readonly StateEntity[];
  readonly documents: readonly StateDocument[];
  readonly volatileOf: (type: string) => ReadonlySet<string>;
  readonly io: WriteIo;
}

/** What applying a recorded write reads besides the draft and the call. */
export interface EffectContext {
  readonly state: SimulatedState;
  readonly io: WriteIo;
  readonly records: readonly StateRecordFacts[];
  readonly chronology: StateRecordChronology;
  /** Whether a record may change state: a write the capture does not show reading only. */
  readonly isWrite: (record: StateRecordFacts) => boolean;
  readonly viewOf: (ordinal: number) => StateView | undefined;
  readonly idField: (type: string) => string;
  /** Fields of a type whose values change on their own, which no read checks. */
  readonly volatileOf: (type: string) => ReadonlySet<string>;
  /** Mark a later read as a create's or update's observation, so it does not check that write. */
  readonly observed: (ordinal: number) => void;
  /** Whether an unmodelled write may have changed the entity since the state last saw it. */
  readonly unknown: (type: string, collection: string, id: string) => boolean;
  /** A document as the initial state holds it: its path, and the value serving also reads member types from. */
  readonly initialDocument: (tool: string) => StateDocument | undefined;
  /** The entities of a type the initial state held, whose values a sequence never reuses. */
  readonly startedWith: (type: string) => readonly StateEntity[];
  /** Fields the type's item views show that no initial entity holds, which an answer leaves out for an entity without them. */
  readonly laterFields: (type: string) => ReadonlySet<string>;
  /** Whether another tool's modelled write to the target awaits a check, which a later read must still make. */
  readonly pending: (target: string) => boolean;
}

/** One recorded write: the record, its timeline index, its tool, and whether its plan only takes the recorded outcome. */
export interface WriteStep {
  readonly record: StateRecordFacts;
  readonly index: number;
  readonly tool: StateToolFacts;
  /** Set once the plan has a reason: the write only brings the state to its recorded outcome. */
  readonly observeOnly: boolean;
  /** Whether the call sent the query serving pins, its exemplar's, as every call before the plan is built does. */
  readonly pinned: boolean;
  /** A bulk response already classified by its owning body lease. */
  readonly response?: WriteResponse;
  /** Its entity at the exact source pointer, or null when that response shows none. */
  readonly responseObservation?: Observed | null;
}

/**
 * What applying a recorded write did: the modelled effect (attributable to the tool), the
 * recorded outcome when the model does not explain it (not attributable), or nothing known.
 */
export type EffectResult =
  | {
      readonly kind: "applied";
      readonly targets: readonly string[];
      readonly entity?: WrittenEntity;
      /** The fields an update wrote, or the pointers a document write wrote; a create writes the whole entity. */
      readonly fields?: readonly string[];
      /** Set when the fields are a document's pointers, each covering the members under it. */
      readonly pointers?: boolean;
      /** A document replacement's object, as a pointer: it overwrites every earlier effect under it, though it claims only its members. */
      readonly overwrites?: readonly string[];
      /** The fields an update sent or changed, derived ones included, and those of them its increments add to. */
      readonly changed?: {
        readonly fields: readonly string[];
        readonly accumulated: readonly string[];
      };
      readonly inserted?: string;
      /** Validated update-response fields, before a later read restamps stored clocks. */
      readonly responseFields?: JsonObject;
    }
  | {
      readonly kind: "observed";
      readonly targets: readonly string[];
      readonly entity?: WrittenEntity;
    }
  | { readonly kind: "unknown" };

/** The entity a write changed, by type, collection and id. */
export interface WrittenEntity {
  readonly type: string;
  readonly collection: string;
  readonly id: string;
}

export const UNKNOWN: EffectResult = { kind: "unknown" };

export const built = (draft: WriteDraft): boolean =>
  draft.plan.exemplar_ordinal !== null;

/** Give an unbuilt plan its reason; a built plan keeps its model. */
export const fail = (
  draft: WriteDraft,
  step: WriteStep,
  reason: WriteReason,
): void => {
  if (!built(draft) && !step.observeOnly) draft.plan.reason = reason;
};

/** A recorded call the built model does not explain disqualifies the plan. */
export const refuse = (
  draft: WriteDraft,
  step: WriteStep,
  reason: WriteReason,
): void => {
  if (!step.observeOnly) draft.plan.reason = reason;
};

/** Shared request interpretation: the object's own fields take precedence over a one-element envelope. */
export const requestBodyPlan = (
  context: EffectContext,
  step: WriteStep,
  draft: WriteDraft,
  observed?: JsonObject,
) =>
  step.pinned
    ? plannedBody(
        requestJson(context.io.requestBody(step.record.ordinal)),
        { built: built(draft), envelope: draft.plan.body?.envelope },
        (member) => observed !== undefined && Object.hasOwn(observed, member),
      )
    : undefined;

export const callOf = (
  step: WriteStep,
  body: JsonObject | undefined,
): WriteCall => ({
  path: step.record.path,
  pathValues:
    pathValuesOf(step.tool.path_template, step.record.path) ?? new Map(),
  body,
});

/** The fields of each entity of a type with an id, as the replayed state holds them. */
export const referencedIn =
  (context: EffectContext) =>
  (type: string, id: string): JsonObject[] =>
    context.state
      .ofType(type)
      .flatMap((entity) => (entity.id === id ? [entity.fields] : []));

export const startOf = (
  context: EffectContext,
  step: WriteStep,
): number | undefined =>
  context.chronology.timeline === "recorded-start-time"
    ? step.record.timing.start?.ms
    : undefined;

export const searchFrom = (context: EffectContext, step: WriteStep) => ({
  records: context.records,
  from: step.index,
  chronology: context.chronology,
  viewOf: context.viewOf,
  withBody: context.io.withBody,
  queryOf: context.io.queryOf,
});

/** The later item reads of the entity a write resolved, as a forward search finds them. */
export const itemReads = (
  context: EffectContext,
  entity: {
    readonly type: string;
    readonly idField: string;
    readonly collection: string;
    readonly id: string;
  },
) => ({
  ...entity,
  held: () => true,
  isWrite: context.isWrite,
  sameItem: (record: StateRecordFacts) => {
    const found = itemTarget(context.state, entity.type, record);
    return found.collection === entity.collection && found.id === entity.id;
  },
});

/** The entity an update's response shows, located by its identity, else a later item read of the target the write resolved. */
const updatedObservation = (
  context: EffectContext,
  step: WriteStep,
  entity: {
    readonly type: string;
    readonly idField: string;
    readonly collection: string;
    readonly id: string;
  },
  observing: {
    readonly required: readonly string[];
    readonly borrow: boolean;
  },
): UpdateObservation | undefined => {
  const { required, borrow } = observing;
  const own =
    step.responseObservation === undefined
      ? context.io.withBody(
          step.record.ordinal,
          (body): Observed | undefined => {
            const located =
              body === undefined ? undefined : locateItem(body, entity.id);
            const object =
              located === undefined ? undefined : at(body!, located.pointer);
            return located?.keys.includes(entity.idField) === true &&
              isObject(object)
              ? {
                  ordinal: step.record.ordinal,
                  pointer: located.pointer,
                  object,
                  id: entity.id,
                }
              : undefined;
          },
        )
      : (step.responseObservation ?? undefined);
  if (
    own !== undefined &&
    required.every((field) => Object.hasOwn(own.object, field))
  )
    return own;
  if (!borrow) return undefined;
  const later = laterObservation(searchFrom(context, step), {
    ...itemReads(context, entity),
    // With an answer or without one, only a read whose view shows every learned clock shows what this call stamped.
    covers: (view) => required.every((field) => view.fields.includes(field)),
  });
  if (later === undefined) return own;
  const readFields = viewFields(context.viewOf(later.ordinal));
  context.observed(later.ordinal);
  const object = { ...own?.object, ...later.object };
  // For covered fields, the later read's omission is evidence too; do not fill it back
  // from an earlier write response. Fields outside that view retain response evidence.
  for (const field of readFields ?? [])
    if (!Object.hasOwn(later.object, field)) delete object[field];
  return {
    ...later,
    object,
    ...(readFields === undefined ? {} : { readFields }),
  };
};

/** Add what a later call of an update showed to its plan: members, their stored types, fixed values and rules not seen before. */
const refineUpdate = (
  context: EffectContext,
  draft: WriteDraft,
  evidence: {
    readonly after: Observed;
    readonly explained: ReturnType<typeof explainUpdate>;
  },
): void => {
  const { plan } = draft;
  const body = refinedBody(plan.body!, evidence.explained.body, {
    observed: draft.observed!,
    stored: evidence.after.object,
  });
  retainFixed(context, body.fixed.slice(plan.body!.fixed.length));
  plan.body = body;
  const ruled = new Set(plan.rules.map((rule) => rule.field));
  const later = new Map(
    evidence.explained.rules.map((rule) => [rule.field, rule]),
  );
  plan.rules = [
    // A later call may be the first to show an echoed array sorted.
    ...plan.rules.map((rule) => {
      const shown = later.get(rule.field);
      return shown === undefined
        ? rule
        : (reconciledUpdateRule(rule, shown, draft.kept, {
            entity: evidence.after.object,
            ampersands: draft.ampersands,
          }) ?? rule);
    }),
    ...evidence.explained.rules.filter((rule) => !ruled.has(rule.field)),
  ];
};

/** Count the sent values of fixed members a plan keeps, which outlive the request body they were read from. */
export const retainFixed = (
  context: EffectContext,
  fixed: readonly { readonly sent: JsonValue }[],
): void => {
  if (fixed.length > 0) context.io.retain(64 + jsonTextCodeUnits(fixed) * 2);
};

/** Retain only exemplars that may acquire a composed rule; state already owns and charges their entity facts. */
export const retainCreateExemplar = (
  context: EffectContext,
  input: CreateEvidence,
  rules: readonly FieldRule[],
): CreateEvidence | undefined => {
  if (
    !Object.entries(input.entity).some(
      ([field, value]) =>
        typeof value === "string" &&
        !rules.some((rule) => rule.field === field),
    )
  )
    return undefined;
  // Snapshot arrays borrow immutable entity fields whose state charges last
  // throughout simulation. Their containers and the request reader's temporary
  // facts need their own retained charge before the draft adopts them.
  const references = [...new Set([input.collection, input.type])].reduce(
    (count, items) => count + items.length,
    0,
  );
  context.io.retain(
    192 +
      references * 8 +
      jsonTextCodeUnits(input.call.body) * 2 +
      input.call.path.length * 2 +
      [...input.call.pathValues].reduce(
        (bytes, [key, value]) => bytes + 64 + (key.length + value.length) * 2,
        0,
      ),
  );
  return input;
};

/** An update's targets, and its recorded outcome: the entity takes what its observation shows, attributed to no tool. */
const outcomes = (
  context: EffectContext,
  entity: StateEntity,
  shown: JsonObject,
) => {
  const { type, collection, id } = entity;
  const targets = [
    entityTarget(type, collection, id),
    collectionTarget(type, collection),
  ];
  const target = { type, collection, id };
  const recorded = (): EffectResult => {
    context.state.put(updatedEntity(entity, { ...entity.fields, ...shown }));
    return { kind: "observed", targets, entity: target };
  };
  return { targets, target, recorded };
};

/** The item read after an update that spells a clock the update stamped at a coarser precision, which serving stores it as. */
const spelledReadBack = (
  context: EffectContext,
  step: WriteStep,
  target: {
    readonly type: string;
    readonly idField: string;
    readonly collection: string;
    readonly id: string;
  },
  call: { readonly rules: readonly FieldRule[]; readonly after: JsonObject },
): ObservedRead | undefined => {
  const read = laterObservation(
    searchFrom(context, step),
    itemReads(context, target),
  );
  if (read === undefined || context.viewOf(read.ordinal)?.shape !== "item")
    return undefined;
  const respelled = call.rules.some((rule) => {
    if (rule.rule !== "clock") return false;
    const [own, shown] = [
      ownMember(call.after, rule.field),
      ownMember(read.object, rule.field),
    ];
    return respelledInstant(own, shown) && readSpellsCoarser(own, shown);
  });
  return respelled
    ? { ordinal: read.ordinal, pointer: read.pointer, shape: "item" }
    : undefined;
};

/** The object the plan's kept read-back shows, which serving spells every update's clocks by. */
const keptRead = (
  search: ObservationSearch,
  read: ObservedRead | undefined,
): JsonObject | undefined =>
  read === undefined
    ? undefined
    : search.withBody(read.ordinal, (body) => {
        const object = body === undefined ? undefined : at(body, read.pointer);
        return isObject(object) ? object : undefined;
      });

/** Build an update plan from its exemplar, or add what a later call showed. */
const buildUpdate = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
  evidence: {
    readonly after: Observed;
    readonly explained: ReturnType<typeof explainUpdate>;
    readonly idField: string;
  },
): void => {
  if (built(draft)) {
    refineUpdate(context, draft, evidence);
    return;
  }
  retainFixed(context, evidence.explained.body.fixed);
  const { ordinal } = step.record;
  const envelope = requestBodyPlan(
    context,
    step,
    draft,
    evidence.after.object,
  )?.envelope;
  Object.assign(draft.plan, {
    exemplar_ordinal: ordinal,
    observation: {
      ordinal: evidence.after.ordinal,
      pointer: evidence.after.pointer,
    },
    response:
      step.response ??
      context.io.withBody(ordinal, (response) =>
        responseShapeOf(ordinal, response, context.io.emptyResponse(ordinal), {
          idField: evidence.idField,
          id: evidence.after.id,
        }),
      ),
    body: {
      ...evidence.explained.body,
      ...(envelope === undefined ? {} : { envelope }),
    },
    rules: evidence.explained.rules,
  });
  draft.observed = evidence.after.object;
  const held = context.state.ofType(draft.plan.target!);
  for (const entity of held) noteFixedWidths(draft.fixedWidth, entity.fields);
  noteHeldAmpersands(
    draft.ampersands,
    evidence.explained.rules,
    held.map((entity) => entity.fields),
  );
};

/**
 * Apply a recorded update to the held entity, explaining every change it made. An update the
 * model does not explain, or of an entity an unmodelled write may have changed, brings the
 * entity to what it recorded instead and is not attributed to the tool.
 */
export const applyUpdate = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
): EffectResult => {
  const action = draft.plan.address?.by === "action";
  // The entity as serving names it.
  const named = itemTarget(context.state, draft.plan.target!, {
    path: action ? actionItemPath(step.record.path) : step.record.path,
  });
  return updateEntity(context, draft, step, { ...named, request: true });
};

/** Apply a recorded update to the held entity a call names, with the members it wrote to that entity. */
export const updateEntity = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
  named: {
    readonly collection: string;
    readonly id: string;
  } & ({ readonly request: true } | { readonly body: JsonObject | undefined }),
): EffectResult => {
  const type = draft.plan.target!;
  const idField = context.idField(type);
  const { collection, id } = named;
  const needs = observationNeeds(
    draft.plan,
    {
      collection,
      id,
      type,
      idField,
      body: "body" in named ? named.body : undefined,
    },
    context.pending,
  );
  const entity = context.state.entity(type, collection, id);
  const after =
    entity === undefined
      ? undefined
      : updatedObservation(
          context,
          step,
          { type, idField, collection, id },
          needs,
        );
  if (entity === undefined || after === undefined) {
    fail(draft, step, "no-observation");
    return UNKNOWN;
  }
  const { targets, target, recorded } = outcomes(context, entity, after.object);
  // Only confirmed absence makes a bodyless action; malformed or unretained content stays unknown.
  const body =
    "body" in named
      ? named.body
      : draft.plan.address?.by === "action" &&
          step.pinned &&
          context.io.requestBody(step.record.ordinal).kind === "absent"
        ? {}
        : requestBodyPlan(context, step, draft, after.object)?.object;
  if (step.observeOnly || body === undefined) {
    fail(draft, step, "body-unusable");
    return recorded();
  }
  const unknown = context.unknown(type, collection, id);
  const call = { ...callOf(step, body), body };
  const fitted = fitUpdateClocks(
    draft,
    after.object,
    explainUpdate({
      before: entity.fields,
      after: after.object,
      call,
      method: step.tool.method,
      idField,
      id,
      startMs: startOf(context, step),
      ...(after.readFields === undefined
        ? {}
        : { readFields: after.readFields }),
      others: otherFields(context.state.ofType(type), { collection, id }),
      shown: shownBefore(context.viewOf, entity, after.ordinal),
      named: (named) => context.state.named(named),
      action: needs.action,
      references: draft.plan.rules.filter((rule) => rule.rule === "reference"),
    }),
  );
  // An action a later call shows flipping back what an earlier one set toggles it.
  const { rules, later } = toggledRules(
    fitted.rules,
    fitted.explained.rules,
    entity.fields,
    draft.steady,
    draft.updates,
  );
  const explained = { ...fitted.explained, rules: later };
  for (const member of keptOrders(call.body, after.object))
    draft.kept.add(member);
  if (explained.unexplained.length > 0 && !unknown) {
    refuse(draft, step, "unexplained-change");
    return recorded();
  }
  // What the read after the call showed, for members its answer left out that a default must agree with.
  const read = laterObservation(
    searchFrom(context, step),
    itemReads(context, { type, idField, collection, id }),
  )?.object;
  // Each call must agree with the plan; one on an unknown entity cannot be checked, so it adds nothing to the plan.
  if (
    built(draft) &&
    (unknown ||
      contradictsPlan(
        { ...draft, plan: { ...draft.plan, rules } },
        entity.fields,
        after.object,
        explained,
      ) ||
      // A member calls left out is cleared by every one or by none.
      // A reference this call or an earlier one showed counts its member as the field's, whichever came first.
      defaultsDisagree(explained.body.defaults, { earlier: draft.updates }, [
        ...rules,
        ...explained.rules,
      ]) ||
      defaultsDisagree(
        draft.plan.body?.defaults,
        { earlier: [], sent: body, after: { ...read, ...after.object } },
        [...rules, ...explained.rules],
      ))
  ) {
    if (!unknown) refuse(draft, step, "unexplained-change");
    return recorded();
  }
  draft.plan.rules = rules;
  noteFixedWidths(draft.fixedWidth, after.object);
  buildUpdate(context, draft, step, { after, explained, idField });
  // Serving stores the clocks it stamps as the read after the update spells them.
  const readBack = spelledReadBack(
    context,
    step,
    { type, idField, collection, id },
    { rules: explained.rules, after: after.object },
  );
  if (
    readBack !== undefined &&
    draft.plan.observation !== null &&
    draft.plan.observation.read === undefined
  )
    Object.assign(draft.plan, {
      observation: { ...draft.plan.observation, read: readBack },
    });
  noteAmpersands(draft.ampersands, explained.rules, after.object);
  // Serving reads the plan's observation, so the gate does too; generated values are this call's.
  const written = updatedFields(
    draft.plan,
    { before: entity.fields, observed: draft.observed! },
    { ...call, id },
    (rule) =>
      recordedGeneratedValue(
        rule,
        ownMember(entity.fields, rule.field),
        ownMember(after.object, rule.field),
      ),
    referencedIn(context),
  );
  const kept = keptFields(entity.fields, after.object);
  const disagrees =
    written.ok &&
    disagreesWithCall(draft.plan.rules, {
      written: written.value,
      after: after.object,
      kept,
    });
  if (!written.ok || (disagrees && !unknown))
    refuse(draft, step, "unexplained-change");
  if (!written.ok || disagrees || unknown) return recorded();
  rememberCall(
    context.io.retain,
    draft,
    { before: entity.fields, after: after.object, sent: body, kept, read },
    explained.unstamped,
  );
  // Response reproducibility is established before the read owner adopts a stored clock spelling; serving spells every update's clocks as the plan's kept read-back does, so replay does too.
  const search = searchFrom(context, step);
  const stored = readSpelledClocks(
    draft.plan.rules,
    restampedFields(
      search,
      itemReads(context, { type, idField, collection, id }),
      written.value,
      draft.plan.rules,
    ),
    keptRead(search, draft.plan.observation?.read),
  );
  context.io.retain(
    64 +
      jsonTextCodeUnits(stored) * 2 +
      (stored === written.value ? 0 : jsonTextCodeUnits(written.value) * 2),
  );
  context.state.put(updatedEntity(entity, stored));
  return {
    ...appliedUpdate(draft.plan, { targets, target }, entity.fields, {
      written: stored,
      body,
    }),
    responseFields: written.value,
  };
};

/** A later update's clocks in the plan's format, and the plan's rules widened to the trimmed spelling the call showed when one covers both, its siblings with it wherever the call's values fit; the plan adopts them only once the call is checked. */
const fitUpdateClocks = (
  draft: WriteDraft,
  after: JsonObject,
  explained: ReturnType<typeof explainUpdate>,
): {
  readonly explained: ReturnType<typeof explainUpdate>;
  readonly rules: FieldRule[];
} => {
  if (!built(draft)) return { explained, rules: draft.plan.rules };
  const rules = draft.plan.rules.map((rule) => {
    const later = explained.rules.find((other) => other.field === rule.field);
    if (
      rule.rule !== "clock" ||
      later?.rule !== "clock" ||
      JSON.stringify(later.format) === JSON.stringify(rule.format)
    )
      return rule;
    const format = fittedClockFormat(
      rule.format,
      ownMember(after, rule.field),
      clockEvidence(draft, rule.field),
    );
    return format === undefined ? rule : { ...rule, format };
  });
  const fitted = siblingTrimmedClocks(
    rules,
    draft.observed,
    after,
    Object.fromEntries(draft.fixedWidth),
  );
  const planned = new Map(fitted.map((rule) => [rule.field, rule]));
  return {
    explained: {
      ...explained,
      rules: explained.rules.map((rule) => {
        const held = planned.get(rule.field);
        return rule.rule === "clock" &&
          held?.rule === "clock" &&
          matchesClockFormat(
            held.format,
            readClock(ownMember(after, rule.field)),
          )
          ? { ...rule, format: held.format }
          : rule;
      }),
    },
    rules: fitted,
  };
};

/** Serving regenerates a learned clock on every update, so recorded calls must advance it. */
const contradictsGeneratedClock = (
  before: JsonObject,
  after: JsonObject,
  rules: readonly FieldRule[],
  explained: ReturnType<typeof explainUpdate>,
): boolean =>
  rules.some((rule) => {
    // A clock left in the call's own second cannot show whether it advanced.
    if (
      rule.rule !== "clock" ||
      !Object.hasOwn(after, rule.field) ||
      explained.unstamped.includes(rule.field) ||
      explained.rules.some(
        (candidate) =>
          candidate.field === rule.field && candidate.rule === "held-clock",
      )
    )
      return false;
    const previous = readClock(ownMember(before, rule.field));
    if (previous === undefined) return false;
    const next = readClock(after[rule.field]);
    return (
      !explained.rules.some(
        (candidate) =>
          candidate.field === rule.field && candidate.rule === "clock",
      ) ||
      next === undefined ||
      next.ms <= previous.ms
    );
  });

/** Whether a later call explains its changes otherwise than the plan: rules for unsent changes hold for every call, so each call must agree with the others. */
const contradictsPlan = (
  draft: WriteDraft,
  before: JsonObject,
  after: JsonObject,
  explained: ReturnType<typeof explainUpdate>,
): boolean =>
  contradictsEarlierCalls(draft, explained.rules) ||
  contradictsGeneratedClock(before, after, draft.plan.rules, explained) ||
  conflictsWithPlan(draft.plan, explained, draft.kept, {
    entity: after,
    ampersands: draft.ampersands,
  });
