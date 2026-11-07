import { jsonTextCodeUnits } from "../jsonSerialization.js";
import type { JsonValue } from "../jsonValue.js";
import {
  ownMember,
  collectionPathOf,
  isObject,
  isParam,
  normalizedPath,
  same,
  scalarText,
  segmentsOf,
  selectedCollection,
  type JsonObject,
  type StateEntity,
  type SuppliedSegment,
} from "./environmentStateRules.js";
import {
  createdFields,
  recordedGeneratedValue,
} from "./environmentStateWriteApply.js";
import {
  createdToken,
  heldObjects,
  isOpaqueToken,
  nextMadeCount,
  restampedFields,
  stampedBy,
} from "./environmentStateWriteStamps.js";
import {
  anyLinkedSource,
  recordedPathValues,
  respondedIds,
  sameLinkedSource,
} from "./environmentStateWriteLinks.js";
import {
  collectionTarget,
  entityTarget,
} from "./environmentStateWriteChecks.js";
import {
  built,
  callOf,
  clockEvidence,
  fail,
  referencedIn,
  itemReads,
  refuse,
  requestBodyPlan,
  retainFixed,
  retainCreateExemplar,
  searchFrom,
  startOf,
  UNKNOWN,
  type EffectContext,
  type EffectResult,
  type WriteDraft,
  type WriteStep,
} from "./environmentStateWriteEffects.js";
import {
  createdInteger,
  explainCreate,
  type CreateEvidence,
  insertCandidates,
  insertIndex,
  randomIdentities,
  nextInteger,
  responseShapeOf,
} from "./environmentStateWriteExplain.js";
import {
  laterObservation,
  newEntityIn,
  loadedLater,
  unloadedPointers,
  withRead,
  type Observed,
} from "./environmentStateWriteObserve.js";
import {
  keptOrders,
  pathValuesOf,
  siblingTrimmedClocks,
  type FieldRule,
  type WriteCall,
} from "./environmentStateWriteRules.js";
import {
  fittedClockFormat,
  noteFixedWidths,
} from "./environmentStateWriteClockFormats.js";
import {
  mergedCreatePlan,
  noteAmpersands,
  noteHeldAmpersands,
} from "./environmentStateWriteCreateCalls.js";
import {
  containsDelimited,
  generatedIntegerDigits,
  isUuid,
  likeGeneratedInteger,
  nextSequence,
  startedSequence,
  sequenceNumber,
  spelledLike,
} from "./environmentStateWriteValues.js";

/** The id a response names alone: a scalar body, or an object's id field or single scalar member. */
const respondedId = (
  body: JsonValue | undefined,
  idField: string,
): string | undefined => {
  if (body === undefined) return undefined;
  if (!isObject(body)) return scalarText(body);
  if (Object.hasOwn(body, idField)) return scalarText(body[idField]);
  const members = Object.values(body);
  return members.length === 1 ? scalarText(members[0]) : undefined;
};

/**
 * A create's answer with the first read of its entity before the next write over it, when that read shows fields the
 * answer lacks or spells its clocks to another precision: the state holds what reads show. An item read that agrees
 * with the answer otherwise lends it its fields and then observes rather than checks; one that disagrees still checks
 * the create. A list read, which may show fewer keys of an object, only adds fields the answer lacks and still checks.
 */
const withReadBack = (
  context: EffectContext,
  step: WriteStep,
  target: {
    readonly type: string;
    readonly collection: string;
    readonly idField: string;
  },
  own: Observed,
): Observed => {
  const later = laterObservation(searchFrom(context, step), {
    type: target.type,
    collection: target.collection,
    idField: target.idField,
    id: own.id,
    held: () => false,
    isWrite: context.isWrite,
  });
  if (later === undefined) return own;
  const view = context.viewOf(later.ordinal);
  if (
    view?.shape === "item" &&
    (view.fields.some(
      (field) =>
        Object.hasOwn(own.object, field) && !Object.hasOwn(later.object, field),
    ) ||
      Object.entries(later.object).some(
        ([field, value]) =>
          Object.hasOwn(own.object, field) &&
          !loadedLater(own.object[field], value),
      ))
  )
    return own;
  const shape = view?.shape === "item" ? "item" : "list";
  const object = withRead(own.object, later.object, shape);
  if (same(object, own.object)) return own;
  if (shape === "item") context.observed(later.ordinal);
  // Answers keep the values the response had not loaded, which the state holds as the item read shows them.
  const unloaded =
    shape === "item" ? unloadedPointers(own.object, later.object) : [];
  return {
    ...own,
    object,
    read: {
      ordinal: later.ordinal,
      pointer: later.pointer,
      shape,
      ...(unloaded.length === 0 ? {} : { unloaded }),
    },
  };
};

/**
 * The written entity a create's response or a later read shows. A linked create's read must name an
 * id its response returned, as the read that linked it did, envelopes included.
 */
const createdObservation = (
  context: EffectContext,
  step: WriteStep,
  target: {
    readonly type: string;
    readonly collection: string;
    readonly idField: string;
    readonly linked: boolean;
  },
): Observed | undefined => {
  const held = (id: string) =>
    context.state.entity(target.type, target.collection, id) !== undefined;
  const own = context.io.withBody(step.record.ordinal, (body) =>
    newEntityIn(step.record.ordinal, body, target.idField, held),
  );
  if (own !== undefined) return withReadBack(context, step, target, own);
  const { id, ids } = context.io.withBody(step.record.ordinal, (body) => {
    const returned = target.linked ? respondedIds(body) : [];
    // A response that names the created id alone ties the later read to that id.
    const named =
      respondedId(body, target.idField) ??
      (returned.length === 1 ? returned[0] : undefined);
    return { id: named, ids: returned };
  });
  const later = laterObservation(searchFrom(context, step), {
    type: target.type,
    collection: target.collection,
    idField: target.idField,
    ...(id === undefined ? {} : { id }),
    held,
    isWrite: context.isWrite,
  });
  // A read named by the id is tied already; otherwise a linked create's read must name a returned id.
  if (
    later === undefined ||
    (target.linked && id === undefined && !ids.includes(later.id))
  )
    return undefined;
  context.observed(later.ordinal);
  return later;
};

const fieldsOf = (entities: readonly StateEntity[]): JsonObject[] =>
  entities.map((entity) => entity.fields);

/** Whether a created field holds a generated token or integer that another field holds too, which no rule rebuilds. */
const linkedGenerated = (
  field: string,
  entity: JsonObject,
  type: readonly JsonObject[],
): boolean =>
  createdToken(field, entity, type) === "linked" ||
  createdInteger(field, entity, type) === "linked";

/** Whether a field's rule rebuilds it from `source`, as a template or a composition does. */
const rebuiltFrom = (rule: FieldRule | undefined, source: string): boolean =>
  rule?.rule === "template"
    ? rule.from === source
    : rule?.rule === "composed" &&
      rule.parts.some((part) => "from" in part && part.from === source);

/** Whether a unique integer's digits show in another string whose rule does not rebuild them from it, which seeding would leave behind. */
const strandedInteger = (
  rules: readonly FieldRule[],
  entity: JsonObject,
): boolean =>
  rules.some((rule) => {
    const digits =
      rule.rule === "unique"
        ? generatedIntegerDigits(ownMember(entity, rule.field))
        : undefined;
    return (
      digits !== undefined &&
      Object.entries(entity).some(
        ([other, kept]) =>
          other !== rule.field &&
          typeof kept === "string" &&
          containsDelimited(kept, digits) &&
          !rebuiltFrom(
            rules.find((candidate) => candidate.field === other),
            rule.field,
          ),
      )
    );
  });

/** Whether a created field no rule explains holds a generated value another field links to, or a unique integer another string strands, which serving cannot keep consistent. */
const linkedUnexplained = (
  rules: readonly FieldRule[],
  entity: JsonObject,
  held: readonly JsonObject[],
): boolean => {
  const explained = new Set(rules.map((rule) => rule.field));
  return (
    Object.keys(entity).some(
      (field) => !explained.has(field) && linkedGenerated(field, entity, held),
    ) || strandedInteger(rules, entity)
  );
};

/** Widen a create plan by a later call, when that call explained on its own agrees with it; whether it did. */
const refineCreate = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
  evidence: CreateCallEvidence,
): boolean => {
  const { explained, held } = explainedCall(context, draft, step, evidence);
  for (const member of keptOrders(evidence.call.body, evidence.observed.object))
    draft.kept.add(member);
  if (
    (explained.tied && draft.plan.collection === null) ||
    linkedUnexplained(explained.rules, evidence.observed.object, held)
  )
    return false;
  const later = laterOf(evidence, explained);
  const widened =
    mergedCreatePlan(
      { rules: draft.plan.rules, body: draft.plan.body! },
      draft.observed!,
      later,
      earlierOf(draft, evidence.collection),
    ) ?? reexplained(draft, explained.rules, later, evidence.collection);
  if (widened === undefined) return false;
  retainFixed(context, widened.body.fixed.slice(draft.plan.body!.fixed.length));
  draft.plan.rules = widened.rules;
  draft.plan.body = widened.body;
  draft.exemplarInput = undefined;
  noteAmpersands(draft.ampersands, explained.rules, evidence.observed.object);
  return true;
};

/** What the plan's earlier calls showed, for merging a later one. */
const earlierOf = (draft: WriteDraft, collection: string) => ({
  kept: draft.kept,
  clockOf: (field: string) => clockEvidence(draft, field),
  startOf: (field: string) => draft.starts.get(field),
  createCollections: draft.createCollections,
  sentLargest: (field: string, scope: "collection" | "type") =>
    draft.sentLargest.get(
      scope === "collection" ? `${field} ${collection}` : field,
    ),
  ampersands: draft.ampersands,
});

/** A later create as the plan merge reads it. */
const laterOf = (
  evidence: CreateCallEvidence,
  explained: ReturnType<typeof explainCreate>,
) => ({
  entity: evidence.observed.object,
  body: evidence.call.body,
  rules: explained.rules,
  contract: {
    ...explained.body,
    ...(evidence.envelope === undefined ? {} : { envelope: evidence.envelope }),
  },
});

/**
 * The plan its exemplar gives again with the composed rules a later call learned for fields the exemplar left
 * unexplained, such as an address spelled from an id that equals the title's slug, merged with that call. Undefined
 * once a later call widened the plan, or unless the rules spell the exemplar's own values.
 */
const reexplained = (
  draft: WriteDraft,
  learned: readonly FieldRule[],
  later: ReturnType<typeof laterOf>,
  collection: string,
) => {
  const input = draft.exemplarInput;
  if (input === undefined) return undefined;
  const hints = learned.filter(
    (rule) =>
      rule.rule === "composed" &&
      !draft.plan.rules.some((held) => held.field === rule.field),
  );
  if (hints.length === 0) return undefined;
  const again = explainCreate({ ...input, hints });
  if (!hints.every((hint) => again.rules.includes(hint))) return undefined;
  const envelope = draft.plan.body!.envelope;
  return mergedCreatePlan(
    {
      rules: again.rules,
      body: {
        ...again.body,
        ...(envelope === undefined ? {} : { envelope }),
      },
    },
    draft.observed!,
    later,
    earlierOf(draft, collection),
  );
};

type CreateCallEvidence = {
  readonly observed: Observed;
  readonly call: WriteCall & { readonly body: JsonObject };
  readonly collection: string;
  readonly envelope: string | undefined;
};

/** Explain one recorded create on its own, against the entities its collection and type held before it. */
const explainedCall = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
  evidence: CreateCallEvidence,
) => {
  const type = draft.plan.target!;
  const members = fieldsOf(context.state.members(type, evidence.collection));
  const held = fieldsOf(context.state.ofType(type));
  const input: CreateEvidence = {
    entity: evidence.observed.object,
    call: evidence.call,
    idField: context.idField(type),
    startMs: startOf(context, step),
    collection: members,
    type: held,
    named: (id) => context.state.named(id),
  };
  return { explained: explainCreate(input), members, held, input };
};

/** Build a create plan from its exemplar's observation. */
const buildCreate = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
  evidence: CreateCallEvidence,
): boolean => {
  const type = draft.plan.target!;
  const idField = context.idField(type);
  const { explained, members, held, input } = explainedCall(
    context,
    draft,
    step,
    evidence,
  );
  if (linkedUnexplained(explained.rules, evidence.observed.object, held)) {
    refuse(draft, step, "unexplained-change");
    return false;
  }
  const clocks = explained.rules.flatMap((rule) =>
    rule.rule === "clock" ? [rule.field] : [],
  );
  // Identity and clock orders first, then any other scalar field the collection may be sorted by.
  const scalars = Object.keys(members[0] ?? {}).filter((field) =>
    members.every((member) =>
      ["string", "number"].includes(typeof ownMember(member, field)),
    ),
  );
  const generated = explained.rules.some(
    (rule) =>
      rule.rule === "identity" &&
      rule.field === idField &&
      rule.generator !== "sequence",
  );
  draft.candidates = insertCandidates(
    members,
    [...new Set([idField, ...clocks, ...scalars])],
    {
      ...(generated && randomIdentities(members, idField, clocks)
        ? { random: idField }
        : {}),
      created: evidence.observed.object,
    },
  );
  retainFixed(context, explained.body.fixed);
  for (const member of keptOrders(evidence.call.body, evidence.observed.object))
    draft.kept.add(member);
  Object.assign(draft.plan, {
    exemplar_ordinal: step.record.ordinal,
    observation: {
      ordinal: evidence.observed.ordinal,
      pointer: evidence.observed.pointer,
      ...(evidence.observed.read === undefined
        ? {}
        : { read: evidence.observed.read }),
    },
    response: context.io.withBody(step.record.ordinal, (body) =>
      responseShapeOf(
        step.record.ordinal,
        body,
        context.io.emptyResponse(step.record.ordinal),
        { idField, id: evidence.observed.id },
      ),
    ),
    body: {
      ...explained.body,
      ...(evidence.envelope === undefined
        ? {}
        : { envelope: evidence.envelope }),
    },
    rules: explained.rules,
    collection:
      explained.tied || draft.linked !== undefined ? evidence.collection : null,
    insert: draft.candidates[0]!,
  });
  draft.observed = evidence.observed.object;
  draft.exemplarInput = retainCreateExemplar(context, input, explained.rules);
  noteHeldAmpersands(draft.ampersands, explained.rules, held);
  noteAmpersands(draft.ampersands, explained.rules, evidence.observed.object);
  for (const entity of held) noteFixedWidths(draft.fixedWidth, entity);
  const ruled = new Set(explained.rules.map((rule) => rule.field));
  for (const [field, value] of Object.entries(evidence.observed.object)) {
    const integer = sequenceNumber(value);
    if (ruled.has(field) || integer === undefined) continue;
    const next = nextInteger(held, field, value);
    if (next === undefined || integer >= next) draft.starts.set(field, integer);
  }
  return true;
};

type SequenceRule = Extract<FieldRule, { rule: "sequence" }>;

/** The sequences a create's plan generates, each with the key serving counts it under. */
const sequencesOf = (
  draft: WriteDraft,
  collection: string,
): { readonly rule: SequenceRule; readonly key: string }[] =>
  draft.plan.rules.flatMap((rule) =>
    rule.rule === "sequence"
      ? [
          {
            rule,
            key:
              rule.scope === "collection"
                ? `${rule.field} ${collection}`
                : rule.field,
          },
        ]
      : [],
  );

/** Whether a later call's sequences hold what serving generates: one past the largest value their scope holds or started with and past the plan's last, spelled as the exemplar spells it; or, for one that takes a sent value, the value the call sent. */
const followsSequences = (
  context: EffectContext,
  draft: WriteDraft,
  created: Pick<StateEntity, "type" | "collection" | "fields"> & {
    readonly sent: JsonObject;
    readonly observed: JsonObject;
  },
): boolean =>
  sequencesOf(draft, created.collection).every(({ rule, key }) => {
    if (rule.sent === true && Object.hasOwn(created.sent, rule.field))
      return (
        !Object.hasOwn(created.observed, rule.field) ||
        same(ownMember(created.observed, rule.field), created.sent[rule.field])
      );
    const scope = [
      ...context.state.ofType(created.type),
      ...context.startedWith(created.type),
    ].filter(
      (entity) =>
        rule.scope === "type" || entity.collection === created.collection,
    );
    const next = nextSequence(
      startedSequence(
        nextInteger(
          fieldsOf(scope),
          rule.field,
          ownMember(draft.observed, rule.field),
        ),
        rule.start,
      ),
      draft.sequences.get(key),
    );
    return (
      ownMember(created.fields, rule.field) ===
      spelledLike(ownMember(draft.observed, rule.field) ?? "", next)
    );
  });

/** Whether a later call's rules reproduce its observed fields and its omitted members agree with the learned defaults. */
const agreesLater = (
  context: EffectContext,
  draft: WriteDraft,
  created: Pick<StateEntity, "type" | "collection" | "fields">,
  call: {
    readonly body: JsonObject;
    readonly observed: JsonObject;
    readonly startMs: number | undefined;
  },
): boolean =>
  followsCreateRules(context, draft, {
    ...created,
    observed: call.observed,
    startMs: call.startMs,
    sent: call.body,
  }) &&
  !contradictsDefault(draft.plan.rules, call, created.fields) &&
  !unruledDiffers(draft.plan.rules, call.observed, {
    written: created.fields,
    volatile: context.volatileOf(created.type),
  });

/** Whether the call stored a field no rule writes and no read leaves unchecked otherwise than the plan keeps it, as the exemplar stored it. */
const unruledDiffers = (
  rules: readonly FieldRule[],
  observed: JsonObject,
  plan: {
    readonly written: JsonObject;
    readonly volatile: ReadonlySet<string>;
  },
): boolean => {
  const { written, volatile } = plan;
  const ruled = new Set(rules.map((rule) => rule.field));
  return Object.keys(observed).some(
    (field) =>
      !ruled.has(field) &&
      !volatile.has(field) &&
      Object.hasOwn(written, field) &&
      !same(observed[field], ownMember(written, field)),
  );
};

/** Whether an echoed member the call left out was stored otherwise than its learned default. */
const contradictsDefault = (
  rules: readonly FieldRule[],
  call: { readonly body: JsonObject; readonly observed: JsonObject },
  written: JsonObject,
): boolean =>
  rules.some(
    (rule) =>
      rule.rule === "echo" &&
      !Object.hasOwn(call.body, rule.field) &&
      Object.hasOwn(call.observed, rule.field) &&
      !same(call.observed[rule.field], ownMember(written, rule.field)),
  );

/** Whether a later create preserves generation shapes and its derived fields reproduce the captured observation. */
const followsCreateRules = (
  context: EffectContext,
  draft: WriteDraft,
  created: Pick<StateEntity, "type" | "collection" | "fields"> & {
    readonly observed: JsonObject;
    readonly startMs: number | undefined;
    readonly sent: JsonObject;
  },
): boolean =>
  draft.plan.rules.every((rule) => {
    const value = ownMember(created.fields, rule.field);
    const exemplar = ownMember(draft.observed, rule.field);
    // Serving always rebuilds a composed or templated field, so a response that leaves it out contradicts the plan.
    if (rule.rule === "composed" || rule.rule === "template")
      return value === ownMember(created.observed, rule.field);
    if (rule.rule === "reference")
      return (
        !Object.hasOwn(created.observed, rule.field) ||
        same(value, ownMember(created.observed, rule.field))
      );
    if (rule.rule === "clock")
      return (
        fittedClockFormat(
          rule.format,
          value,
          clockEvidence(draft, rule.field),
        ) !== undefined
      );
    if (rule.rule === "unique")
      return (
        (isUuid(exemplar)
          ? isUuid(value)
          : generatedIntegerDigits(exemplar) !== undefined
            ? likeGeneratedInteger(value, exemplar)
            : isOpaqueToken(value, exemplar)) &&
        !context.state
          .ofType(created.type)
          .some((held) => ownMember(held.fields, rule.field) === value)
      );
    return (
      rule.rule !== "identity" || rule.generator !== "uuid" || isUuid(value)
    );
  }) &&
  followsSequences(context, draft, created) &&
  followsMadeObjects(context, draft, created);

/** The key a made object's count is taken under in a plan's sequences. */
const madeKey = (field: string, member: string): string => `${field}/${member}`;

/** Whether a later call's recorded made objects hold what serving makes: the exemplar's members, the entity's identity, clocks, and each count one past what held objects show or started with, past the plan's last. */
const followsMadeObjects = (
  context: EffectContext,
  draft: WriteDraft,
  created: Pick<StateEntity, "type" | "collection" | "fields"> & {
    readonly observed: JsonObject;
    readonly startMs: number | undefined;
  },
): boolean =>
  draft.plan.rules.every((rule) => {
    if (rule.rule !== "made-object") return true;
    const made = ownMember(created.observed, rule.field);
    const exemplar = ownMember(draft.observed, rule.field);
    if (!isObject(made) || !isObject(exemplar)) return false;
    const id = scalarText(
      ownMember(created.fields, context.idField(created.type)),
    );
    const held = heldObjects(
      [
        ...context.state.ofType(created.type),
        ...context.startedWith(created.type),
      ].map((entity) => entity.fields),
      rule.field,
    );
    return [...new Set([...Object.keys(exemplar), ...Object.keys(made)])].every(
      (member) => {
        const value = ownMember(made, member);
        if (rule.clocks.includes(member))
          return stampedBy(value, rule.format, created.startMs);
        if (rule.own.includes(member)) return scalarText(value) === id;
        const count = rule.counts.find((entry) => entry.member === member);
        if (count === undefined)
          return same(value, ownMember(exemplar, member));
        return (
          sequenceNumber(value) ===
          nextSequence(
            nextMadeCount(held, count, ownMember(exemplar, member)),
            draft.sequences.get(madeKey(rule.field, member)),
          )
        );
      },
    );
  });

/** Widen the plan's clock formats to the trimmed spelling a later call showed, and its other clocks with them unless a value the plan saw shows them at a fixed width. */
const fitClocks = (draft: WriteDraft, fields: JsonObject): void => {
  const fitted = draft.plan.rules.map((rule) => {
    if (rule.rule !== "clock") return rule;
    const format = fittedClockFormat(
      rule.format,
      ownMember(fields, rule.field),
      clockEvidence(draft, rule.field),
    );
    return format === undefined || format === rule.format
      ? rule
      : { ...rule, format };
  });
  draft.plan.rules = siblingTrimmedClocks(
    fitted,
    draft.observed,
    fields,
    Object.fromEntries(draft.fixedWidth),
  );
  noteFixedWidths(draft.fixedWidth, fields);
};

/** Record the values a create's sequences took, which the next call follows; as serving does, the largest stays, so a lower sent value does not lower it. */
const takeSequences = (
  draft: WriteDraft,
  created: Pick<StateEntity, "collection" | "fields">,
): void => {
  const take = (key: string, value: number | undefined) => {
    if (value === undefined) return;
    const taken = draft.sequences.get(key);
    draft.sequences.set(
      key,
      taken === undefined ? value : Math.max(taken, value),
    );
  };
  for (const { rule, key } of sequencesOf(draft, created.collection))
    take(
      key,
      sequenceNumber(
        ownMember(created.fields, rule.field),
        ownMember(draft.observed, rule.field),
      ),
    );
  for (const rule of draft.plan.rules) {
    if (rule.rule !== "made-object") continue;
    const made = ownMember(created.fields, rule.field);
    for (const { member } of rule.counts) {
      take(
        madeKey(rule.field, member),
        isObject(made) ? sequenceNumber(ownMember(made, member)) : undefined,
      );
    }
  }
  for (const rule of draft.plan.rules) {
    if (rule.rule !== "echo") continue;
    const value = sequenceNumber(ownMember(created.fields, rule.field));
    // By type and by collection, as a sequence adopted later may count either.
    for (const key of [rule.field, `${rule.field} ${created.collection}`]) {
      const held = draft.sentLargest.get(key);
      if (value !== undefined && (held === undefined || value > held))
        draft.sentLargest.set(key, value);
    }
  }
};

/** Segments of a recorded path as a create call supplies them: template literals, and each parameter's recorded spelling. */
const recordedSegments = (
  template: string,
  path: string,
): SuppliedSegment[] | undefined => {
  const pattern = segmentsOf(template);
  const concrete = segmentsOf(path);
  if (pattern.length !== concrete.length) return undefined;
  const segments: SuppliedSegment[] = [];
  for (const [index, part] of pattern.entries()) {
    const value = concrete[index]!;
    if (!isParam(part)) {
      if (part !== value) return undefined;
      segments.push({ text: part, supplied: false });
      continue;
    }
    if (value.length === 0) return undefined;
    segments.push({ text: value, supplied: true });
  }
  return segments;
};

/** Collections a create may join, in serving's order: held ones, then emptied ones as first known, then checked list lines. */
const createCandidates = (context: EffectContext, type: string): string[] => {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (collection: string): void => {
    if (seen.has(collection)) return;
    seen.add(collection);
    candidates.push(collection);
  };
  for (const entity of context.state.ofType(type)) add(entity.collection);
  for (const collection of context.state.knownCollections(type))
    add(collection);
  for (const record of context.records) {
    const view = context.viewOf(record.ordinal);
    if (
      view?.shape === "list" &&
      view.type === type &&
      view.checked_record_ordinals.includes(record.ordinal)
    )
      add(collectionPathOf(record, false));
  }
  return candidates;
};

/** The collection serving would write this recorded create into, when the path instantiates the tool. */
const servedCollection = (
  context: EffectContext,
  step: WriteStep,
  type: string,
): string | undefined => {
  const segments = recordedSegments(step.tool.path_template, step.record.path);
  return segments === undefined
    ? undefined
    : selectedCollection(segments, createCandidates(context, type));
};

/** Whether a linked create's call sends the source path values its exemplar did, the only ones its link holds for. */
const fromLinkedSource = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
): boolean =>
  anyLinkedSource(draft.plan, step.tool.path_template) ||
  sameLinkedSource(
    step.tool.path_template,
    context.records.find(
      (record) => record.ordinal === draft.plan.exemplar_ordinal,
    )?.path,
    recordedPathValues(step.tool.path_template, step.record.path),
  );

/** Add a created entity to the state at the plan's insert position, or last before the plan has one. */
const insertCreated = (
  context: EffectContext,
  draft: WriteDraft,
  entity: StateEntity,
): string => {
  const members = fieldsOf(
    context.state.members(entity.type, entity.collection),
  );
  context.io.retain(64 + jsonTextCodeUnits(entity.fields) * 2);
  context.state.put(
    entity,
    draft.plan.insert === null
      ? members.length
      : insertIndex(draft.plan.insert, members, entity.fields),
  );
  return entityTarget(entity.type, entity.collection, entity.id);
};

/** Apply a recorded create, with the values it recorded for generated fields; an unexplained create adds what it recorded. */
export const applyCreate = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
): EffectResult => {
  const type = draft.plan.target!;
  const idField = context.idField(type);
  const spelled = normalizedPath(step.record.path);
  // Serving writes a create into the collection it chooses for the path, and a tied plan refuses any other, so a create there is not counted.
  const collection =
    draft.linked ?? servedCollection(context, step, type) ?? spelled;
  // A linked plan's collection holds only for its exemplar's source path, so serving refuses any other.
  if (
    built(draft) &&
    ((draft.plan.collection !== null && draft.plan.collection !== collection) ||
      (draft.linked !== undefined && !fromLinkedSource(context, draft, step)))
  )
    return UNKNOWN;
  const observed = createdObservation(context, step, {
    type,
    collection,
    idField,
    linked: draft.linked !== undefined,
  });
  const request = requestBodyPlan(context, step, draft, observed?.object);
  const body = request?.object;
  if (observed === undefined) {
    fail(draft, step, body === undefined ? "body-unusable" : "no-observation");
    return UNKNOWN;
  }
  const entity = (fields: JsonObject, id: string): StateEntity => ({
    type,
    collection,
    id,
    fields,
    view_fields: [],
    record_ordinals: [],
  });
  const recorded = (): EffectResult => {
    const inserted = insertCreated(
      context,
      draft,
      entity(observed.object, observed.id),
    );
    return {
      kind: "observed",
      targets: [inserted, collectionTarget(type, collection)],
      entity: { type, collection, id: observed.id },
    };
  };
  if (step.observeOnly || body === undefined) {
    fail(draft, step, "body-unusable");
    return recorded();
  }
  const call = { ...callOf(step, body), body };
  // The exemplar defines the plan's sequences; each later call must follow them.
  const later = built(draft);
  if (
    later &&
    (draft.plan.rules.some(
      (rule) =>
        rule.rule === "unique" &&
        linkedGenerated(
          rule.field,
          observed.object,
          fieldsOf(context.state.ofType(type)),
        ),
    ) ||
      strandedInteger(draft.plan.rules, observed.object))
  ) {
    refuse(draft, step, "unexplained-change");
    return recorded();
  }
  if (
    !later &&
    !buildCreate(context, draft, step, {
      observed,
      call,
      collection,
      envelope: request?.envelope,
    })
  )
    return recorded();
  // Rules learn from the recorded path; serving fills path fields from the collection it selects.
  const created = {
    ...call,
    pathValues:
      pathValuesOf(step.tool.path_template, collection) ?? call.pathValues,
  };
  const fieldsOfCall = () =>
    createdFields(
      draft.plan,
      draft.observed!,
      created,
      (rule) =>
        recordedGeneratedValue(
          rule,
          ownMember(draft.observed!, rule.field),
          ownMember(observed.object, rule.field) ?? null,
        ),
      referencedIn(context),
      idField,
    );
  // A later call that agrees with the plan widens it, as a later update does: to members it alone sent or left out, an
  // array it showed sorted, or a clock spelling. One that disagrees leaves the plan as it was.
  if (later)
    refineCreate(context, draft, step, {
      observed,
      call,
      collection,
      envelope: request?.envelope,
    });
  const fields = fieldsOfCall();
  const id = fields.ok
    ? scalarText(ownMember(fields.value, idField))
    : undefined;
  if (
    !fields.ok ||
    id === undefined ||
    context.state.entity(type, collection, id) !== undefined ||
    (later &&
      !agreesLater(
        context,
        draft,
        { type, collection, fields: fields.value },
        {
          body: call.body,
          observed: observed.object,
          startMs: startOf(context, step),
        },
      ))
  ) {
    refuse(draft, step, "unexplained-change");
    return recorded();
  }
  takeSequences(draft, { collection, fields: fields.value });
  fitClocks(draft, fields.value);
  // The call's own values follow the forms serving generates; the state holds a nested clock as the read-back restamped it, as an update's.
  const stored = restampedFields(
    searchFrom(context, step),
    itemReads(context, { type, idField, collection, id }),
    fields.value,
    draft.plan.rules,
  );
  const inserted = insertCreated(context, draft, entity(stored, id));
  context.io.retain(collection.length * 2 + 16);
  draft.createCollections.push(collection);
  return {
    kind: "applied",
    targets: [inserted, collectionTarget(type, collection)],
    entity: { type, collection, id },
    inserted,
  };
};
