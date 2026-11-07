import { hasRepeatedQueryArgument } from "./environmentTools.js";
import { stateBodyJson } from "../../domain/analysisView/EnvironmentStateAccumulator.js";
import {
  isObject,
  ownMember,
  collectionMatch,
  collectionPathOf,
  decodedSegment,
  allLines,
  listItems,
  listsAll,
  missingRequiredFields,
  renderStateEntity,
  renderStateList,
  replaceAt,
  scalarText,
  type JsonObject,
  type RecordedViewReason,
  type StateEntity,
  type SuppliedSegment,
  type StateItemView,
  type StateListView,
  type StateView,
} from "../../domain/analysisView/environmentStateRules.js";
import { pageBound } from "../../domain/analysisView/environmentStatePaging.js";
import { replayReason } from "../../domain/analysisView/environmentStateVariants.js";
import { isAbsence } from "../../domain/analysisView/environmentStateWriteChecks.js";
import {
  evaluateQuery,
  renderQueryList,
} from "../../domain/analysisView/environmentStateListQuery.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import { jsonByteLength } from "../../domain/jsonSerialization.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  replayAnswer,
  replayEnvironmentTool,
  selectReplayExchange,
  type ObservedQuery,
  type ReplayArguments,
  type ReplayResult,
} from "./environmentReplay.js";
import {
  ENVIRONMENT_SERVE_OPERATION,
  REPLAY_BODY_LIMIT_BYTES,
  type EnvironmentManifestTool,
  type EnvironmentSource,
  type RecordedExchange,
} from "./environmentSource.js";
import {
  callQuery,
  callSegments,
  checkedLine,
  queryLine,
  unfilteredLine,
} from "./environmentStateCallLines.js";
import type { EnvironmentStateStore } from "./environmentStateStore.js";

/** Where a served answer came from: the live state, or a recording and why. */
export type StateProvenance =
  | {
      readonly source: "recording";
      readonly reason:
        | RecordedViewReason
        | "no-view"
        | "query-multiplicity"
        | "unrecorded-request"
        | "page-exceeded"
        | "projection"
        | "variant";
    }
  | {
      readonly source: "state";
      readonly view: "item";
      readonly type: string;
      readonly collection: string;
      readonly id: string;
    }
  | {
      readonly source: "state";
      readonly view: "list";
      readonly type: string;
      readonly collection: string;
      readonly membership: "all" | "query" | "recorded";
      readonly listed: number;
    }
  | {
      readonly source: "state";
      readonly view: "document" | "document-write";
      readonly path: string;
    }
  | {
      readonly source: "state";
      /** A write applied to the state, or the recorded answer for an entity it does not hold. */
      readonly view: "create" | "update" | "delete" | "missing";
      readonly type: string;
      readonly collection: string;
      readonly id: string;
      /** Every entity a bulk call wrote, in body order; `id` is the first. */
      readonly ids?: readonly string[];
    };

/** A replay answer that also says whether the state or a recording produced it. */
export interface StateAnswer extends ReplayResult {
  readonly state: StateProvenance;
}

/** The manifest and capture a state answer cites, and the live state it reads. */
export interface StateServing {
  readonly source: EnvironmentSource;
  readonly store: EnvironmentStateStore;
}

export const refused = (
  tool: EnvironmentManifestTool,
  userMessage: string,
): AnalysisError =>
  new AnalysisInputError(ENVIRONMENT_SERVE_OPERATION, { userMessage }, [
    { path: ["tool"], reason: "invalid_value", expected: tool.name },
  ]);

/** One entity as an item or list view shows it, or a refusal when it lacks a field the view's every recording carried; a partial body is never answered. */
const shownEntity = (
  tool: EnvironmentManifestTool,
  view: StateItemView | StateListView,
  entity: StateEntity,
  volatile: ReadonlySet<string>,
): Result<JsonObject, AnalysisError> => {
  const missing = missingRequiredFields(entity, view, volatile);
  return missing.length === 0
    ? ok(renderStateEntity(entity, view, volatile))
    : err(
        refused(
          tool,
          `The state holds no complete ${view.type} entity ${entity.id} in ${entity.collection}: it lacks fields this tool's responses always carried: ${missing.join(", ")}.`,
        ),
      );
};

/** The recorded answer, labelled with why the state did not produce it. */
const fromRecording = (
  source: EnvironmentSource,
  tool: EnvironmentManifestTool,
  args: ReplayArguments,
  reason: Extract<StateProvenance, { source: "recording" }>["reason"],
  observedQuery?: ObservedQuery,
): Result<StateAnswer, AnalysisError> => {
  const replayed = replayEnvironmentTool(source, tool, args, observedQuery);
  return replayed.ok
    ? ok({ ...replayed.value, state: { source: "recording", reason } })
    : replayed;
};

/** Why a call replays the view's replayed reads, or undefined when the state answers it. */
const replayedCall = (
  source: EnvironmentSource,
  view: StateItemView | StateListView,
  call: ReadonlyMap<string, string>,
): "projection" | "variant" | undefined =>
  replayReason(
    view,
    new Map([...call].map(([name, value]) => [name, [value]])),
    (ordinal) => source.exchanges.get(ordinal)?.query,
  );

/** A recorded body the state renders into, usable exactly when extraction could use it. */
export const recordedJson = (
  exchange: RecordedExchange,
): JsonValue | undefined => stateBodyJson(exchange.contentType, exchange);

/** The rendered body on the base record's status, content type and provenance; never cut. */
export const stateAnswer = (
  serving: StateServing,
  base: { readonly exchange: RecordedExchange; readonly exact: boolean },
  body: JsonValue,
  state: StateProvenance,
): Result<StateAnswer, AnalysisError> => {
  const bytes = jsonByteLength(body);
  if (bytes > REPLAY_BODY_LIMIT_BYTES)
    return err(
      new AnalysisResourceConstraintError(
        ENVIRONMENT_SERVE_OPERATION,
        "capacity",
        "The answer rendered from the state exceeds the reply body limit",
        { max_body_bytes: REPLAY_BODY_LIMIT_BYTES, body_bytes: bytes },
        {
          retryable: false,
          remediationAction:
            "Load a smaller state with data/add; the state is not cut to fit.",
        },
      ),
    );
  return ok({
    ...replayAnswer(serving.source, base.exchange, base.exact, {
      body,
      truncated: false,
    }),
    state,
  });
};

/** An item call's collection segments and identity value, kept as supplied rather than joined and re-split. */
export interface ItemCall {
  readonly segments: readonly SuppliedSegment[];
  readonly id: string;
  /** Set for an id a body names, which is taken as written rather than percent-decoded. */
  readonly literal?: boolean;
}

/** What an item call names, or undefined when a path argument is missing; an item action's id comes before its action segment. */
export const itemCall = (
  tool: EnvironmentManifestTool,
  args: ReplayArguments,
  action = false,
): ItemCall | undefined => {
  const segments = callSegments(tool, args);
  if (action && segments?.pop()?.supplied !== false) return undefined;
  const last = segments?.pop();
  return segments !== undefined && last?.supplied === true
    ? { segments, id: last.text }
    : undefined;
};

/** Whether the state started with the item a call names, which a served delete may since have removed. */
const startedWithItem = (
  store: EnvironmentStateStore,
  type: string,
  call: ItemCall,
): boolean => {
  const ids = new Set([decodedSegment(call.id), call.id]);
  return store
    .startedWith(type)
    .some(
      (entity) =>
        ids.has(entity.id) &&
        collectionMatch(entity.collection, call.segments) !== undefined,
    );
};

/** The first entity `find` gives for a collection an item call names, preferring verbatim spellings as replay does; the id is tried percent-decoded, then as written, unless it is literal. */
const callNamed = (
  collections: readonly string[],
  call: ItemCall,
  find: (collection: string, id: string) => StateEntity | undefined,
): StateEntity | undefined => {
  const ids =
    call.literal === true
      ? [call.id]
      : [...new Set([decodedSegment(call.id), call.id])];
  const candidates = collections
    .flatMap((collection) => {
      const verbatim = collectionMatch(collection, call.segments);
      return verbatim === undefined ? [] : [{ collection, verbatim }];
    })
    .sort((left, right) => right.verbatim - left.verbatim);
  for (const { collection } of candidates)
    for (const id of ids) {
      const entity = find(collection, id);
      if (entity !== undefined) return entity;
    }
  return undefined;
};

/** The entity an item call names. */
export const namedEntity = (
  store: EnvironmentStateStore,
  type: string,
  call: ItemCall,
): StateEntity | undefined =>
  callNamed(store.collectionsOf(type), call, (collection, id) =>
    store.entity(type, collection, id),
  );

/** The member a type's item view learned its reads set `true` on an entity the application soft-deleted, if any. */
export const softDeleteFlag = (
  serving: StateServing,
  type: string,
): string | undefined => {
  for (const view of serving.store.state.views.values())
    if (
      view.shape === "item" &&
      view.type === type &&
      view.deleted_flag !== undefined
    )
      return view.deleted_flag;
  return undefined;
};

/** Fields as an application that soft-deletes shows them once deleted: with the type's deleted flag set, when it has one. */
const deletedFields = (
  serving: StateServing,
  type: string,
  fields: JsonObject,
): JsonObject => {
  const flag = softDeleteFlag(serving, type);
  return flag === undefined ? fields : { ...fields, [flag]: true };
};

/** Fields as a delete's answer shows them: with the type's deleted flag as its recorded answer `shown` gave it, if it did. */
export const deleteAnswerFields = (
  serving: StateServing,
  type: string,
  fields: JsonObject,
  shown: JsonValue | undefined,
): JsonObject => {
  const flag = softDeleteFlag(serving, type);
  const value =
    flag === undefined || !isObject(shown) ? undefined : ownMember(shown, flag);
  return value === undefined ? fields : { ...fields, [flag!]: value };
};

/** An entity a served delete removed, as an application that soft-deletes answers for it by id: with its deleted flag set. */
const deletedEntity = (
  serving: StateServing,
  type: string,
  call: ItemCall,
): StateEntity | undefined => {
  const { store } = serving;
  const entity = callNamed(
    store.knownCollectionsOf(type),
    call,
    (collection, id) => store.deleted(type, collection, id),
  );
  return entity === undefined
    ? undefined
    : { ...entity, fields: deletedFields(serving, type, entity.fields) };
};

/** The answer for an entity the state does not hold: the tool's latest recorded 400, 404 or 410, else a tool error. */
export const missingAnswer = (
  serving: StateServing,
  tool: EnvironmentManifestTool,
  missing: {
    readonly type: string;
    readonly collection: string;
    readonly id: string;
  },
): Result<StateAnswer, AnalysisError> => {
  // A read also answers with a 2xx JSON null, the absence the write gate accepts; a write never does, as a 2xx would
  // report success for an entity that is not there.
  const nullAbsence = tool.method === "GET";
  const latestAbsence = (ordinals: readonly number[]) =>
    ordinals
      .map((ordinal) => serving.source.exchanges.get(ordinal))
      .filter(
        (exchange): exchange is RecordedExchange =>
          exchange !== undefined &&
          (isAbsence(exchange.status) ||
            (nullAbsence &&
              exchange.status !== null &&
              exchange.status >= 200 &&
              exchange.status < 300 &&
              recordedJson(exchange) === null)),
      )
      .at(-1);
  // The tool's own recorded absence first, else that of an item view of the type.
  const itemTools = new Set(
    [...serving.store.state.views.values()].flatMap((view) =>
      view.shape === "item" && view.type === missing.type ? [view.tool] : [],
    ),
  );
  const recorded =
    latestAbsence(tool.record_ordinals) ??
    latestAbsence(
      serving.source.manifest.tools
        .filter((candidate) => itemTools.has(candidate.name))
        .flatMap((candidate) => candidate.record_ordinals),
    );
  if (recorded === undefined)
    return err(
      refused(
        tool,
        `The state holds no ${missing.type} entity ${missing.id} in ${missing.collection}.`,
      ),
    );
  return ok({
    ...replayAnswer(serving.source, recorded, false),
    state: { source: "state", view: "missing", ...missing },
  });
};

/** An item call renders the named entity into the recorded envelope; it never invents an entity; one the state does not hold answers the tool's recorded absence. */
const answerItem = (
  serving: StateServing,
  tool: EnvironmentManifestTool,
  view: StateItemView,
  args: ReplayArguments,
  observedQuery?: ObservedQuery,
): Result<StateAnswer, AnalysisError> => {
  const { source, store } = serving;
  const call = itemCall(tool, args);
  if (call === undefined)
    return err(refused(tool, `Tool ${tool.name} needs every path argument.`));
  const held = namedEntity(store, view.type, call);
  // A projection or another representation of an entity the state holds replays as the capture's reads did.
  const replayed = replayedCall(source, view, callQuery(tool, args));
  const entity =
    held ??
    (replayed === undefined
      ? deletedEntity(serving, view.type, call)
      : undefined);
  if (entity === undefined) {
    // An item only a replayed line showed, which the state never held, answers with its own recording; a created
    // item may since have been deleted, so a type a served create added to keeps the missing answer.
    if (
      replayed !== undefined &&
      !store.createdInto(view.type) &&
      !startedWithItem(store, view.type, call) &&
      selectReplayExchange(tool, source.exchanges, args, observedQuery)
        ?.exact === true
    )
      return fromRecording(source, tool, args, replayed, observedQuery);
    return missingAnswer(serving, tool, {
      type: view.type,
      collection: `/${call.segments.map(({ text }) => text).join("/")}`,
      id: call.id,
    });
  }
  if (replayed !== undefined)
    return fromRecording(source, tool, args, replayed, observedQuery);
  const shown = shownEntity(
    tool,
    view,
    entity,
    new Set(store.type(view.type)?.volatile_fields),
  );
  if (!shown.ok) return shown;
  const base = source.exchanges.get(view.envelope_ordinal);
  const envelope = base === undefined ? undefined : recordedJson(base);
  if (base === undefined || envelope === undefined)
    return err(
      refused(tool, `Tool ${tool.name} has no usable recorded envelope.`),
    );
  const exact =
    selectReplayExchange(
      tool,
      new Map([[base.ordinal, base]]),
      args,
      observedQuery,
    )?.exact === true;
  return stateAnswer(
    serving,
    { exchange: base, exact },
    replaceAt(envelope, view.pointer, shown.value),
    {
      source: "state",
      view: "item",
      type: view.type,
      collection: entity.collection,
      id: entity.id,
    },
  );
};

type StateDocumentView = Extract<StateView, { shape: "document" }>;

/** One tool call: the tool, the arguments it was called with, and whether they name the answering line exactly. */
interface ToolCall {
  readonly tool: EnvironmentManifestTool;
  readonly args: ReplayArguments;
  readonly exact: boolean;
}

/**
 * The entities a list call shows on its line: every entity of the collection on a whole line, the query's matches on
 * a line the query answers or for a call it computes, else the line's recorded members still held; undefined when the
 * query cannot apply the call's values.
 */
const listSelection = (
  store: EnvironmentStateStore,
  { tool, args, exact }: ToolCall,
  view: StateListView,
  line: {
    readonly base: RecordedExchange;
    readonly recorded: readonly JsonObject[];
  },
):
  | {
      readonly members: readonly StateEntity[];
      readonly membership: "all" | "query" | "recorded";
      readonly total: number;
    }
  | undefined => {
  const collection = collectionPathOf(line.base, false);
  const values = callQuery(tool, args);
  // A named query line, or a call with query arguments answered on a line it did not name, evaluates the query.
  const queried =
    view.query !== undefined &&
    (exact
      ? view.query.record_ordinals.includes(line.base.ordinal)
      : values.size > 0);
  if (queried) {
    const computed = evaluateQuery(
      view.query!.parameters,
      values,
      store.inCollection(view.type, collection),
    );
    return computed === undefined
      ? undefined
      : { members: computed.page, membership: "query", total: computed.total };
  }
  if (listsAll(view, line.base.ordinal)) {
    const members = store.inCollection(view.type, collection);
    return { members, membership: "all", total: members.length };
  }
  const idField = store.type(view.type)?.id_field ?? "";
  const members = line.recorded.flatMap((item) => {
    const id = scalarText(ownMember(item, idField));
    const entity =
      id === undefined ? undefined : store.entity(view.type, collection, id);
    return entity === undefined ? [] : [entity];
  });
  return { members, membership: "recorded", total: members.length };
};

/** A list call renders the entities its line selects from the state into that line's recorded envelope. */
const answerList = (
  serving: StateServing,
  call: ToolCall,
  view: StateListView,
  base: RecordedExchange,
): Result<StateAnswer, AnalysisError> => {
  const { source, store } = serving;
  const { tool, args, exact } = call;
  const envelope = recordedJson(base);
  const recorded =
    envelope === undefined ? undefined : listItems(envelope, view.pointer);
  if (envelope === undefined || recorded === undefined)
    return fromRecording(source, tool, args, "body-unusable");
  // A requested page the collection has outgrown is answered as recorded, never with more items than it asked for.
  const size = exact
    ? pageBound(base.query ?? undefined, recorded.length)
    : undefined;
  if (
    listsAll(view, base.ordinal) &&
    size !== undefined &&
    store.inCollection(view.type, collectionPathOf(base, false)).length > size
  )
    return fromRecording(source, tool, args, "page-exceeded");
  const selection = listSelection(store, call, view, { base, recorded });
  if (selection === undefined)
    return fromRecording(source, tool, args, "unrecorded-request");
  const volatile = new Set(store.type(view.type)?.volatile_fields);
  const items: JsonObject[] = [];
  for (const entity of selection.members) {
    const shown = shownEntity(tool, view, entity, volatile);
    if (!shown.ok) return shown;
    items.push(shown.value);
  }
  const body =
    view.query === undefined || selection.membership === "recorded"
      ? renderStateList(view, envelope, items)
      : renderQueryList(
          { ...view, query: view.query },
          envelope,
          items,
          selection.total,
        );
  return stateAnswer(serving, { exchange: base, exact }, body, {
    source: "state",
    view: "list",
    type: view.type,
    collection: collectionPathOf(base, false),
    membership: selection.membership,
    listed: items.length,
  });
};

/** A document call answers the state's value for the document on its checked line's status and provenance. */
const answerDocument = (
  serving: StateServing,
  tool: EnvironmentManifestTool,
  base: RecordedExchange,
): Result<StateAnswer, AnalysisError> => {
  const current = serving.store.document(tool.name);
  if (current === undefined)
    return err(refused(tool, `The state holds no document for ${tool.name}.`));
  return stateAnswer(serving, { exchange: base, exact: true }, current.value, {
    source: "state",
    view: "document",
    path: current.path,
  });
};

/** A list or document call that names a checked line answers from the state; one that names none answers from its recording. */
const answerCheckedLine = (
  serving: StateServing,
  tool: EnvironmentManifestTool,
  view: StateListView | StateDocumentView,
  args: ReplayArguments,
  observedQuery?: ObservedQuery,
): Result<StateAnswer, AnalysisError> => {
  const replayed =
    view.shape === "list"
      ? replayedCall(serving.source, view, callQuery(tool, args))
      : undefined;
  if (replayed !== undefined)
    return fromRecording(serving.source, tool, args, replayed, observedQuery);
  const named = checkedLine(
    serving.source,
    tool,
    view.checked_record_ordinals,
    args,
    observedQuery,
  );
  const base =
    named ??
    (view.shape === "list"
      ? (unfilteredLine(
          serving.source,
          tool,
          allLines(view),
          args,
          observedQuery,
        ) ?? queryLine(serving.source, tool, view, args, observedQuery))
      : undefined);
  if (base === undefined)
    return fromRecording(
      serving.source,
      tool,
      args,
      "unrecorded-request",
      observedQuery,
    );
  // An unfiltered call answers on a line it did not name, so its replay match is not exact.
  return view.shape === "list"
    ? answerList(
        serving,
        { tool, args, exact: named !== undefined },
        view,
        base,
      )
    : answerDocument(serving, tool, base);
};

/** Answer one read tool call from the live state where its view is state-backed, else from its recordings. */
export const answerFromState = (
  serving: StateServing,
  tool: EnvironmentManifestTool,
  args: ReplayArguments,
  observedQuery?: ObservedQuery,
): Result<StateAnswer, AnalysisError> => {
  if (hasRepeatedQueryArgument(tool, args))
    return fromRecording(
      serving.source,
      tool,
      args,
      "query-multiplicity",
      observedQuery,
    );
  const view = serving.store.state.views.get(tool.name);
  if (view === undefined)
    return fromRecording(serving.source, tool, args, "no-view", observedQuery);
  switch (view.shape) {
    case "recorded":
      return fromRecording(
        serving.source,
        tool,
        args,
        view.reason,
        observedQuery,
      );
    case "item":
      return answerItem(serving, tool, view, args, observedQuery);
    case "list":
    case "document":
      return answerCheckedLine(serving, tool, view, args, observedQuery);
  }
};
