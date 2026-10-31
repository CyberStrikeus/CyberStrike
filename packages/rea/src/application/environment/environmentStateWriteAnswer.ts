import {
  createdFields,
  documentBodyProblem,
  laterItemFields,
  optionalFields,
  renewUuids,
  updatedEntity,
  updatedFields,
  valueAt,
  writtenDocument,
  writtenResponse,
  type GenerateValue,
} from "../../domain/analysisView/environmentStateWriteApply.js";
import {
  insertIndex,
  resortedMembers,
  nextInteger,
} from "../../domain/analysisView/environmentStateWriteExplain.js";
import { callRenewal } from "../../domain/analysisView/environmentStateWriteGenerated.js";
import {
  heldObjects,
  madeObjectValue,
  nestedClockValue,
  nextMadeCount,
  unenveloped,
  readSpelledClocks,
} from "../../domain/analysisView/environmentStateWriteStamps.js";
import {
  anyLinkedSource,
  linkedCollection,
  sameLinkedSource,
} from "../../domain/analysisView/environmentStateWriteLinks.js";
import {
  pathValuesOf,
  type GeneratedRule,
  type StateWritePlan,
  type WriteCall,
} from "../../domain/analysisView/environmentStateWriteRules.js";
import { withRead } from "../../domain/analysisView/environmentStateWriteObserve.js";
import {
  formatClock,
  generatedIntegerDigits,
  seededInteger,
  seededLike,
  sequenceNumber,
  spelledLike,
  startedSequence,
} from "../../domain/analysisView/environmentStateWriteValues.js";
import {
  at,
  ownMember,
  collectionMatch,
  decodedSegment,
  isObject,
  pointerTokens,
  scalarText,
  type JsonObject,
  type StateEntity,
} from "../../domain/analysisView/environmentStateRules.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  replayAnswer,
  selectReplayExchange,
  type ObservedQuery,
  type ReplayArguments,
} from "./environmentReplay.js";
import type { EnvironmentManifestTool } from "./environmentSource.js";
import { callSegments } from "./environmentStateCallLines.js";
import {
  itemCall,
  missingAnswer,
  namedEntity,
  recordedJson,
  refused,
  deleteAnswerFields,
  softDeleteFlag,
  stateAnswer,
  type StateAnswer,
  type StateProvenance,
  type StateServing,
} from "./environmentStateAnswer.js";
import { createdCollection } from "./environmentStateCollections.js";
import {
  isLoadableValue,
  unloadableMember,
  type HeldDocument,
} from "./environmentStateDocument.js";
import { environmentToolArguments } from "./environmentTools.js";

/** Attempts at a generated UUID or token before a collision with held values is refused. */
const GENERATION_ATTEMPTS = 64;

/** One served write call: the tool, its plan and its arguments. */
export interface WriteRequest {
  readonly tool: EnvironmentManifestTool;
  readonly plan: StateWritePlan;
  readonly args: ReplayArguments;
  readonly observedQuery?: ObservedQuery;
}

/** The path values a call supplies, keyed by template segment as write plans name them. */
export const pathValues = (
  tool: EnvironmentManifestTool,
  args: ReplayArguments,
): Map<string, string> => {
  const names = environmentToolArguments(tool).path;
  const template = tool.path_template
    .slice(tool.path_template.indexOf("/") + 1)
    .split("/");
  const values = new Map<string, string>();
  for (const param of tool.params) {
    const value = ownMember(args, names.get(param.name) ?? param.name);
    const segment = template[param.index] ?? "";
    if (typeof value === "string") values.set(segment.slice(1, -1), value);
  }
  return values;
};

/** A refusal for a value `data/add` would refuse, so `data/get` always reports a state that loads back. */
export const unloadable = (
  tool: EnvironmentManifestTool,
  holder: string,
): AnalysisError =>
  refused(
    tool,
    `${holder} would hold a value that is not exactly representable JSON, which data/add could not load back.`,
  );

/** The call's body: an object, unwrapped from the envelope the capture sent it in, nothing, or a refusal for any other value or one holding a value the state cannot hold. */
const callBody = ({
  tool,
  args,
  plan,
}: WriteRequest): Result<JsonObject | undefined, AnalysisError> => {
  const name = environmentToolArguments(tool).body;
  const sent = name === undefined ? undefined : ownMember(args, name);
  if (sent === undefined) return ok(undefined);
  const envelope = plan.body?.envelope ?? "";
  const value = unenveloped(sent as JsonValue, plan.body?.envelope);
  if (value === undefined)
    return err(
      refused(
        tool,
        `Tool ${tool.name} takes its JSON object body wrapped as {"${envelope}":[{...}]}, as the capture sent it.`,
      ),
    );
  if (!isObject(value))
    return err(refused(tool, `Tool ${tool.name} takes a JSON object body.`));
  const member = unloadableMember(value as JsonObject);
  return member === undefined
    ? ok(value as JsonObject)
    : err(unloadable(tool, `Member ${member}`));
};

/** The object a recorded response shows at a pointer. */
const recordedObject = (
  serving: StateServing,
  at: { readonly ordinal: number; readonly pointer: string },
): JsonObject | undefined => {
  const exchange = serving.source.exchanges.get(at.ordinal);
  const body = exchange === undefined ? undefined : recordedJson(exchange);
  const object = body === undefined ? undefined : valueAt(body, at.pointer);
  return isObject(object) ? object : undefined;
};

/** The entity a recorded observation shows, with a create's read-back over it: the values a create keeps and an update's constants. */
export const observedEntity = (
  serving: StateServing,
  plan: StateWritePlan,
): JsonObject | undefined => {
  if (plan.observation === null) return undefined;
  const object = recordedObject(serving, plan.observation);
  if (object === undefined || plan.observation.read === undefined)
    return object;
  const read = recordedObject(serving, plan.observation.read);
  return read === undefined
    ? undefined
    : withRead(object, read, plan.observation.read.shape);
};

/** One past the largest integer these entities hold in the field, read as the exemplar spells it, or undefined when none holds one. */
const nextHeld = (
  entities: readonly StateEntity[],
  field: string,
  exemplar: JsonValue,
) =>
  nextInteger(
    entities.map((entity) => entity.fields),
    field,
    exemplar,
  );

/** The entity a write generates values for: its collection, the observed entity and, for an update, the entity it writes. */
export interface GeneratedTarget {
  readonly name: string;
  readonly collection: readonly StateEntity[];
  readonly observed: JsonObject;
  /** The entity an update writes, whose values a renewed field keeps. */
  readonly current?: JsonObject;
}

/** The fields of each entity of a type with an id the live state holds, which a referencing write repeats. */
export const heldEntity =
  (serving: StateServing) =>
  (type: string, id: string): JsonObject[] =>
    serving.store
      .ofType(type)
      .flatMap((entity) => (entity.id === id ? [entity.fields] : []));

/** What an update generates values for: the entity it writes, in its collection. */
export const updateTarget = (
  serving: StateServing,
  entity: StateEntity,
  observed: JsonObject,
): GeneratedTarget => ({
  name: entity.collection,
  collection: serving.store.inCollection(entity.type, entity.collection),
  observed,
  current: entity.fields,
});

/**
 * Values one served write generates: its clock instant, sequences one past the largest held
 * value, and UUIDs and tokens seeded by the state Evidence, tool, field and write count,
 * skipping values the type already holds. Every entity the call writes shares them.
 */
export const generator = (
  serving: StateServing,
  request: WriteRequest,
): {
  readonly forTarget: (target: GeneratedTarget) => GenerateValue;
  readonly taken: Map<string, number>;
  /** Count a number the call sent for a sequence, as replay does, so later generated ones follow it. */
  readonly sentSequence: (
    target: string,
    rule: Extract<GeneratedRule, { rule: "sequence" }>,
    value: JsonValue | undefined,
  ) => void;
} => {
  const { store } = serving;
  const write = store.pendingWrite();
  const taken = new Map<string, number>();
  const sequence = (key: string, held: number | undefined): number => {
    const value = store.sequenceAfter(key, held);
    taken.set(key, value);
    return value;
  };
  const sequenceKey = (
    rule: Extract<GeneratedRule, { rule: "sequence" }>,
    target: string,
  ) =>
    `${request.tool.name} ${rule.field} ${rule.scope === "collection" ? target : ""}`;
  const ofType = store.ofType(request.plan.target ?? "");
  // A sequence never reuses a value the state started with, even after its entity was deleted.
  const started = store.startedWith(request.plan.target ?? "");
  const startedIn = (collection: string) =>
    started.filter((held) => held.collection === collection);
  const renewed = callRenewal(
    `${store.state.evidenceId}:${request.tool.name}:renewed:${String(write.count)}`,
  );
  const unused = (
    field: string,
    make: (attempt: number) => JsonValue,
  ): Result<JsonValue, string> => {
    const held = new Set(
      ofType.map((entity) => scalarText(ownMember(entity.fields, field))),
    );
    for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
      const value = make(attempt);
      if (!held.has(scalarText(value))) return ok(value);
    }
    return err(
      `Could not generate a unique value for ${field} after ${String(GENERATION_ATTEMPTS)} attempts without colliding with the held state.`,
    );
  };
  const generate = (
    target: GeneratedTarget,
    rule: GeneratedRule,
  ): Result<JsonValue, string> => {
    const exemplar = ownMember(target.observed, rule.field) ?? "";
    const seed = (attempt: number) =>
      `${store.state.evidenceId}:${request.tool.name}:${rule.field}:${String(write.count)}:${String(attempt)}`;
    switch (rule.rule) {
      case "clock":
      case "held-clock":
      case "nested-clock": {
        const value = formatClock(write.clockMs, rule.format);
        if (value === undefined)
          return err(
            `The generated clock for ${rule.field} is outside its recorded four-digit year format.`,
          );
        return rule.rule === "nested-clock"
          ? nestedClockValue(
              ownMember(target.current ?? target.observed, rule.field),
              rule,
              value,
            )
          : ok(value);
      }
      case "sequence":
        return ok(
          spelledLike(
            exemplar,
            sequence(
              sequenceKey(rule, target.name),
              startedSequence(
                nextHeld(
                  rule.scope === "collection"
                    ? [...target.collection, ...startedIn(target.name)]
                    : [...ofType, ...started],
                  rule.field,
                  exemplar,
                ),
                rule.start,
              ),
            ),
          ),
        );
      case "made-object": {
        const clock = formatClock(write.clockMs, rule.format);
        if (clock === undefined)
          return err(
            `The generated clock for ${rule.field} is outside its recorded four-digit year format.`,
          );
        const base = ownMember(target.observed, rule.field);
        const held = heldObjects(
          [...ofType, ...started].map((entity) => entity.fields),
          rule.field,
        );
        return madeObjectValue(base, rule, clock, (count) =>
          sequence(
            `${request.tool.name} ${rule.field}/${count.member}`,
            nextMadeCount(
              held,
              count,
              isObject(base) ? ownMember(base, count.member) : undefined,
            ),
          ),
        );
      }
      case "unique":
        return unused(rule.field, (attempt) =>
          generatedIntegerDigits(exemplar) === undefined
            ? seededLike(seed(attempt), exemplar)
            : seededInteger(seed(attempt), exemplar),
        );
      case "renewed":
        return ok(
          renewUuids(
            ownMember(target.current, rule.field) ?? null,
            rule.pointers,
            renewed,
          ),
        );
      case "identity":
        if (rule.generator === "sequence")
          return ok(
            spelledLike(
              exemplar,
              sequence(
                `${request.plan.target ?? ""} ${rule.field} ${target.name}`,
                nextHeld(
                  [...target.collection, ...startedIn(target.name)],
                  rule.field,
                  exemplar,
                ),
              ),
            ),
          );
        return unused(rule.field, (attempt) =>
          seededLike(seed(attempt), exemplar, rule.generator === "uuid"),
        );
    }
  };
  return {
    forTarget: (target) => (rule) => generate(target, rule),
    taken,
    sentSequence: (target, rule, value) => {
      const number = sequenceNumber(value);
      if (number === undefined) return;
      const key = sequenceKey(rule, target);
      // commitWrite keeps the larger of this and the values taken before.
      taken.set(key, Math.max(taken.get(key) ?? number, number));
    },
  };
};

/** A write's answer on its recorded response's status and content type: a rendered body, none, or the recorded one. */
export const writeAnswer = (
  serving: StateServing,
  request: WriteRequest,
  rendered:
    | {
        readonly fields: JsonObject | undefined;
        readonly id: string;
        readonly sent?: readonly string[];
      }
    | ((
        recorded: JsonValue | undefined,
      ) => Result<JsonValue | undefined, string>),
  state: StateProvenance,
): Result<StateAnswer, AnalysisError> => {
  const { plan, tool, args } = request;
  const exchange =
    plan.response === null
      ? undefined
      : serving.source.exchanges.get(plan.response.ordinal);
  if (plan.response === null || exchange === undefined)
    return err(refused(tool, `Tool ${tool.name} has no recorded response.`));
  const exact =
    selectReplayExchange(
      tool,
      new Map([[exchange.ordinal, exchange]]),
      args,
      request.observedQuery,
    )?.exact === true;
  if (plan.response.shape === "recorded")
    return ok({ ...replayAnswer(serving.source, exchange, exact), state });
  const recorded = recordedJson(exchange);
  const body =
    typeof rendered === "function"
      ? rendered(recorded)
      : writtenResponse(
          plan.response,
          recorded,
          {
            ...rendered,
            clocks:
              plan.observation?.read?.shape === "item"
                ? plan.rules.flatMap((rule) =>
                    rule.rule === "clock" ? [rule.field] : [],
                  )
                : [],
            // A member the call sent and the plan stores as sent is answered as sent; any other keeps the recorded answer.
            unloaded: (plan.observation?.read?.unloaded ?? []).filter(
              (path) => {
                const [field] = pointerTokens(path);
                return !(
                  rendered.sent?.includes(field!) === true &&
                  plan.rules.some(
                    (rule) => rule.field === field && rule.rule === "echo",
                  )
                );
              },
            ),
          },
          optionalFields(plan),
          laterItemFields(
            serving.store.state.views.values(),
            serving.store.state.entities,
            plan.target,
          ),
        );
  if (!body.ok) return err(refused(tool, body.error));
  return stateAnswer(serving, { exchange, exact }, body.value ?? null, state);
};

/** The path arguments a call supplies as given, by the template segment each fills. */
const pathArguments = (
  tool: EnvironmentManifestTool,
  args: ReplayArguments,
): Map<number, string> => {
  const names = environmentToolArguments(tool).path;
  return new Map(
    tool.params.flatMap((param) => {
      const value = ownMember(args, names.get(param.name) ?? param.name);
      return typeof value === "string" ? [[param.index, value] as const] : [];
    }),
  );
};

/** The path of the recorded call a plan was built from. */
const exemplarPath = (
  serving: StateServing,
  plan: StateWritePlan,
): string | undefined =>
  plan.exemplar_ordinal === null
    ? undefined
    : serving.source.exchanges.get(plan.exemplar_ordinal)?.path;

/** The collection a create writes into: a linked plan's, only for its exemplar's path arguments, else the one the call's path selects. */
const writtenCollection = (
  serving: StateServing,
  request: WriteRequest,
): Result<string | undefined, AnalysisError> => {
  const { tool, plan } = request;
  const linked = linkedCollection(plan, tool.path_template);
  if (linked === undefined)
    return ok(
      createdCollection(serving, tool, request.args, plan.target ?? ""),
    );
  // No read showed where other path arguments create, unless they cannot change it.
  return anyLinkedSource(plan, tool.path_template) ||
    sameLinkedSource(
      tool.path_template,
      exemplarPath(serving, plan),
      pathArguments(tool, request.args),
    )
    ? ok(linked)
    : err(
        refused(
          tool,
          `Tool ${tool.name} creates into ${linked} only with the path arguments its recording sent.`,
        ),
      );
};

/**
 * The path values a create's path fields take, decoded once as the gate learned them: a linked
 * create that accepts its exemplar's source only takes that; another the collection this call
 * selects, else its own arguments.
 */
const createdPathValues = (
  serving: StateServing,
  request: WriteRequest,
  call: WriteCall,
  collection: string,
): ReadonlyMap<string, string> => {
  const { tool, plan } = request;
  const exemplar =
    linkedCollection(plan, tool.path_template) === undefined ||
    anyLinkedSource(plan, tool.path_template)
      ? undefined
      : exemplarPath(serving, plan);
  return (
    (exemplar === undefined
      ? undefined
      : pathValuesOf(tool.path_template, exemplar)) ??
    pathValuesOf(tool.path_template, collection) ??
    new Map(
      [...call.pathValues].map(([name, value]) => [
        name,
        decodedSegment(value),
      ]),
    )
  );
};

const answerCreate = (
  serving: StateServing,
  request: WriteRequest,
  call: WriteCall,
): Result<StateAnswer, AnalysisError> => {
  const { tool, plan } = request;
  const type = plan.target ?? "";
  const idField = serving.store.type(type)?.id_field ?? "";
  const target = writtenCollection(serving, request);
  if (!target.ok) return target;
  const collection = target.value;
  const observed = observedEntity(serving, plan);
  if (collection === undefined || observed === undefined)
    return err(
      refused(
        tool,
        `Tool ${tool.name} needs every path argument to be non-empty.`,
      ),
    );
  if (plan.collection !== null && plan.collection !== collection)
    return err(
      refused(
        tool,
        `The recorded create's values are tied to ${plan.collection}; the environment models creates only there.`,
      ),
    );
  const members = serving.store.inCollection(type, collection);
  const values = generator(serving, request);
  const created = {
    ...call,
    pathValues: createdPathValues(serving, request, call, collection),
  };
  const fields = createdFields(
    plan,
    observed,
    created,
    values.forTarget({ name: collection, collection: members, observed }),
    heldEntity(serving),
    idField,
  );
  if (!fields.ok) return err(refused(tool, fields.error));
  for (const rule of plan.rules)
    if (
      rule.rule === "sequence" &&
      rule.sent === true &&
      Object.hasOwn(call.body ?? {}, rule.field)
    )
      values.sentSequence(
        collection,
        rule,
        ownMember(fields.value, rule.field),
      );
  const field = unloadableMember(fields.value);
  if (field !== undefined) return err(unloadable(tool, `Field ${field}`));
  const id = scalarText(ownMember(fields.value, idField));
  if (
    id === undefined ||
    serving.store.entity(type, collection, id) !== undefined
  )
    return err(
      refused(
        tool,
        `The state already holds a ${type} entity ${id ?? ""} in ${collection}.`,
      ),
    );
  const state = {
    source: "state",
    view: "create",
    type,
    collection,
    id,
  } as const;
  const answer = writeAnswer(
    serving,
    request,
    { fields: fields.value, id, sent: Object.keys(call.body ?? {}) },
    state,
  );
  if (!answer.ok) return answer;
  const inserted = serving.store.insert(
    {
      type,
      collection,
      id,
      fields: fields.value,
      view_fields: [],
      record_ordinals: [],
    },
    insertIndex(
      plan.insert ?? { rule: "last" },
      members.map((entity) => entity.fields),
      fields.value,
    ),
  );
  if (!inserted.ok) return inserted;
  serving.store.commitWrite(values.taken);
  return answer;
};

/** The held entity an update or delete names, or the answer for one the state does not hold. */
const targetEntity = (
  serving: StateServing,
  request: WriteRequest,
): Result<StateEntity, Result<StateAnswer, AnalysisError>> => {
  const { tool, plan, args } = request;
  const call = itemCall(tool, args, plan.address?.by === "action");
  if (call === undefined)
    return err(
      err(refused(tool, `Tool ${tool.name} needs every path argument.`)),
    );
  const entity = namedEntity(serving.store, plan.target ?? "", call);
  return entity === undefined
    ? err(
        missingAnswer(serving, tool, {
          type: plan.target ?? "",
          collection: `/${call.segments.map(({ text }) => text).join("/")}`,
          id: call.id,
        }),
      )
    : ok(entity);
};

const answerUpdate = (
  serving: StateServing,
  request: WriteRequest,
  call: WriteCall,
): Result<StateAnswer, AnalysisError> => {
  const { tool, plan } = request;
  const target = targetEntity(serving, request);
  if (!target.ok) return target.error;
  const entity = target.value;
  const observed = observedEntity(serving, plan) ?? {};
  const values = generator(serving, request);
  const written = updatedFields(
    plan,
    { before: entity.fields, observed },
    { ...call, id: entity.id },
    values.forTarget(updateTarget(serving, entity, observed)),
    heldEntity(serving),
  );
  if (!written.ok) return err(refused(tool, written.error));
  // An increment can pass the exact integers.
  const field = unloadableMember(written.value);
  if (field !== undefined) return err(unloadable(tool, `Field ${field}`));
  const answer = writeAnswer(
    serving,
    request,
    {
      fields: written.value,
      id: entity.id,
      sent: Object.keys(call.body ?? {}),
    },
    {
      source: "state",
      view: "update",
      type: entity.type,
      collection: entity.collection,
      id: entity.id,
    },
  );
  if (!answer.ok) return answer;
  const after = updatedEntity(
    entity,
    storedUpdate(serving, plan, written.value),
  );
  const updated = serving.store.updateAll(
    [after],
    sortedOrder(serving, plan, [{ before: entity, after }]),
  );
  if (!updated.ok) return updated;
  serving.store.commitWrite(values.taken);
  return answer;
};

/** An update's fields as the state stores them: its clocks spelled as the plan's read-back spelled them. */
export const storedUpdate = (
  serving: StateServing,
  plan: StateWritePlan,
  written: JsonObject,
): JsonObject =>
  readSpelledClocks(
    plan.rules,
    written,
    plan.observation?.read === undefined
      ? undefined
      : recordedObject(serving, plan.observation.read),
  );

/** The collection's members in the order a sorted collection holds them after these writes; empty when the plan keeps them in place. */
export const sortedOrder = (
  serving: StateServing,
  plan: StateWritePlan,
  writes: readonly {
    readonly before: StateEntity;
    readonly after: StateEntity;
  }[],
): StateEntity[] => {
  const [first] = writes;
  if (plan.insert?.rule !== "sorted" || first === undefined) return [];
  return resortedMembers(
    plan.insert,
    serving.store.inCollection(first.before.type, first.before.collection),
    writes,
  );
};

const answerDelete = (
  serving: StateServing,
  request: WriteRequest,
): Result<StateAnswer, AnalysisError> => {
  const target = targetEntity(serving, request);
  if (!target.ok) return target.error;
  const entity = target.value;
  const { response } = request.plan;
  const exchange =
    response === null
      ? undefined
      : serving.source.exchanges.get(response.ordinal);
  const recorded = exchange === undefined ? undefined : recordedJson(exchange);
  // A soft-deleting application answers with the entity's deleted flag as its recorded answer showed it.
  const answer = writeAnswer(
    serving,
    request,
    {
      fields: deleteAnswerFields(
        serving,
        entity.type,
        entity.fields,
        recorded === undefined
          ? undefined
          : at(recorded, response!.pointer ?? ""),
      ),
      id: entity.id,
    },
    {
      source: "state",
      view: "delete",
      type: entity.type,
      collection: entity.collection,
      id: entity.id,
    },
  );
  if (answer.ok) {
    // An application that soft-deletes still answers the entity by id, so its last fields are kept for that read.
    serving.store.remove(
      entity,
      softDeleteFlag(serving, entity.type) !== undefined,
    );
    serving.store.commitWrite(new Map());
  }
  return answer;
};

/** The held document a call changes: only at the path the state holds it, with members the capture sent as the JSON types the document holds. */
const documentTarget = (
  serving: StateServing,
  { tool, plan, args }: WriteRequest,
  call: WriteCall,
): Result<HeldDocument, AnalysisError> => {
  const held = serving.store.document(plan.target ?? "");
  const segments = callSegments(tool, args);
  if (held === undefined || plan.body === null)
    return err(
      refused(tool, `The state holds no document for ${plan.target ?? ""}.`),
    );
  if (segments === undefined)
    return err(refused(tool, `Tool ${tool.name} needs every path argument.`));
  // Document reads answer only on their recorded line, so a write elsewhere has no document to change.
  if (collectionMatch(held.path, segments) === undefined)
    return err(
      refused(
        tool,
        `The state holds this document only at ${held.path}; the environment models writes to it only there.`,
      ),
    );
  const initial = serving.store.state.documents.find(
    (document) => document.tool === held.tool,
  );
  const problem = documentBodyProblem(plan, call, {
    initial: initial?.value,
    current: held.value,
  });
  return problem === undefined ? ok(held) : err(refused(tool, problem));
};

const answerDocument = (
  serving: StateServing,
  request: WriteRequest,
  call: WriteCall,
): Result<StateAnswer, AnalysisError> => {
  const { tool, plan } = request;
  const target = documentTarget(serving, request, call);
  if (!target.ok) return target;
  const held = target.value;
  const written = writtenDocument(plan, held.value, call);
  if (!written.ok) return err(refused(tool, written.error));
  if (!isLoadableValue(written.value))
    return err(unloadable(tool, "The document"));
  const state = {
    source: "state",
    view: "document-write",
    path: held.path,
  } as const;
  const answer =
    plan.response?.shape === "entity"
      ? (() => {
          const exchange = serving.source.exchanges.get(plan.response.ordinal);
          return exchange === undefined
            ? err(refused(tool, `Tool ${tool.name} has no recorded response.`))
            : stateAnswer(
                serving,
                { exchange, exact: true },
                written.value,
                state,
              );
        })()
      : writeAnswer(serving, request, { fields: undefined, id: "" }, state);
  if (!answer.ok) return answer;
  const set = serving.store.setDocument(held.tool, written.value);
  if (!set.ok) return set;
  serving.store.commitWrite(new Map());
  return answer;
};

/** Apply one served write tool call to the live state and answer it; a refused call leaves the state unchanged. */
export const answerWrite = (
  serving: StateServing,
  request: WriteRequest,
): Result<StateAnswer, AnalysisError> => {
  const body = callBody(request);
  if (!body.ok) return body;
  const call: WriteCall = {
    path: request.tool.path_template,
    pathValues: pathValues(request.tool, request.args),
    body: body.value,
  };
  switch (request.plan.effect) {
    case "create":
      return answerCreate(serving, request, call);
    case "update":
      return answerUpdate(serving, request, call);
    case "delete":
      return answerDelete(serving, request);
    case "document":
      return answerDocument(serving, request, call);
    case "none":
      return err(
        refused(
          request.tool,
          `Tool ${request.tool.name} is not served from the state.`,
        ),
      );
  }
};
