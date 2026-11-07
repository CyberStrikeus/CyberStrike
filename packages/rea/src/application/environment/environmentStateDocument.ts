import { types } from "node:util";
import { z } from "zod";

import {
  isParam,
  normalizedPath,
  same,
  scalarText,
  segmentsOf,
  type JsonObject,
  type StateDocument,
  type StateEntity,
  type StateType,
} from "../../domain/analysisView/environmentStateRules.js";
import {
  AnalysisInputError,
  type AnalysisInputIssue,
} from "../../domain/analysisErrorCore.js";
import { canonicalJson } from "../../domain/comparisonSemantics.js";
import { parseExactJson } from "../../domain/exactJsonNumber.js";
import { projectInputIssues } from "../../domain/inputIssueProjection.js";
import {
  jsonObjectSchema,
  ownedJsonObjectSchema,
  jsonValueSchema,
  jsonValueValidationIssue,
  ownedJsonValueSchema,
  type JsonValue,
} from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import { compositeKey } from "../../domain/unicodeCodePointOrder.js";
import type { EnvironmentState } from "./environmentState.js";
import { ENVIRONMENT_SERVE_OPERATION } from "./environmentSource.js";
import { REA_STATE_FORMAT } from "./environmentTools.js";

/** A loaded state document is at most this large, whether it arrives as bytes, a file or a download. */
export const STATE_INTAKE_LIMIT_BYTES = 32 * 1024 * 1024;

/** A document as the state holds it; only a value equal to the Evidence's cites the record it came from. */
export type HeldDocument = Omit<StateDocument, "record_ordinal"> & {
  readonly record_ordinal?: number;
};

/** A validated whole state, ready to replace the current one. */
export interface StateContent {
  readonly entities: readonly StateEntity[];
  readonly documents: readonly HeldDocument[];
}

/** Check source-owned structural keys before Zod projects the declared fields. */
const strictStateObject = <Shape extends z.ZodRawShape>(shape: Shape) => {
  const schema = z.strictObject(shape);
  return z
    .unknown()
    .superRefine((value, context) => {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return;
      if (types.isProxy(value)) {
        context.addIssue({
          code: "custom",
          message: "Expected an ordinary state object",
        });
        return;
      }
      const keys = Object.getOwnPropertyNames(value).filter(
        (key) => !Object.hasOwn(schema.shape, key),
      );
      if (keys.length > 0)
        context.addIssue({ code: "unrecognized_keys", keys });
    })
    .pipe(schema);
};

const stateDocumentSchemaFor = (
  jsonValue: z.ZodType<JsonValue, unknown>,
  fieldsSchema: z.ZodType<JsonObject, unknown>,
) => {
  const ordinalSchema = z.number().int().nonnegative();

  return strictStateObject({
    rea_state: strictStateObject({
      version: z.literal(1),
      // `data/get` reports these; accepting them back lets its output be loaded unchanged.
      state_evidence_id: z.string().optional(),
      types: z.array(jsonValue).optional(),
      entities: z.array(
        strictStateObject({
          type: z.string(),
          collection: z.string(),
          id: z.string(),
          fields: fieldsSchema,
          view_fields: z
            .array(
              strictStateObject({ tool: z.string(), fields: fieldsSchema }),
            )
            .optional(),
          record_ordinals: z.array(ordinalSchema).optional(),
        }),
      ),
      documents: z.array(
        strictStateObject({
          tool: z.string(),
          path: z.string(),
          value: jsonValue,
          record_ordinal: ordinalSchema.optional(),
        }),
      ),
    }),
  });
};

const stateDocumentSchema = stateDocumentSchemaFor(
  jsonValueSchema,
  jsonObjectSchema,
);
const ownedStateDocumentSchema = stateDocumentSchemaFor(
  ownedJsonValueSchema,
  ownedJsonObjectSchema,
);

type ParsedDocument = z.output<typeof stateDocumentSchema>["rea_state"];
type ParsedEntity = ParsedDocument["entities"][number];
type Path = readonly (string | number)[];

const problem = (path: Path, message: string): AnalysisInputIssue => ({
  path,
  reason: "invalid_value",
  message,
});

/** Members whose values are the caller's data; a problem inside one is reported at the member, never deeper. */
const CONTENT_MEMBERS: ReadonlySet<string | number> = new Set([
  "fields",
  "value",
  "types",
]);

const contentIndex = (path: Path): number =>
  path.findIndex((segment) => CONTENT_MEMBERS.has(segment));

/** A problem inside the caller's data is reported at the content member holding it; one in a structural object, at that object. */
const memberProblem = (path: Path): AnalysisInputIssue => {
  const content = contentIndex(path);
  return content >= 0 && content < path.length - 1
    ? problem(
        path.slice(0, content + 1),
        "holds a value that is not exactly representable JSON",
      )
    : problem(
        path.slice(0, -1),
        `has a member ${REA_STATE_FORMAT} does not define`,
      );
};

/** Whether `data/add` accepts a value as a `fields` member or a document's `value`: bounded nesting and numbers exact as `data/get` writes them. */
export const isLoadableValue = (value: JsonValue): boolean =>
  jsonValueValidationIssue(value) === undefined &&
  parseExactJson(JSON.stringify(value)) !== undefined;

/** The first member of an object `data/add` would refuse as `fields`, if any: one whose value does not load. */
export const unloadableMember = (object: JsonObject): string | undefined =>
  Object.keys(object).find((member) => !isLoadableValue(object[member]!));

/** The first schema problem, located without naming the caller's data. */
const schemaProblem = (
  issues: readonly z.core.$ZodIssue[],
  value: unknown,
): AnalysisInputIssue => {
  const first = projectInputIssues(issues, value)[0];
  if (first === undefined)
    return problem([], `is not a ${REA_STATE_FORMAT} document`);
  const content = contentIndex(first.path);
  if (
    (content >= 0 && content < first.path.length - 1) ||
    first.reason === "unknown_argument"
  )
    return memberProblem(first.path);
  if (
    content >= 0 &&
    first.path[content] === "fields" &&
    first.reason === "invalid_value"
  )
    return problem(
      first.path.slice(0, content + 1),
      "holds a value that is not exactly representable JSON",
    );
  if (first.reason === "missing_argument")
    return { ...first, message: "is required" };
  return {
    ...first,
    message:
      content >= 0 && first.reason !== "invalid_type"
        ? "is not exactly representable JSON"
        : `is not a valid ${REA_STATE_FORMAT} value for this member`,
  };
};

/** Whether a concrete collection path instantiates a template; parameters match any one segment. */
const instantiates = (collection: string, template: string): boolean => {
  const concrete = segmentsOf(collection);
  const pattern = segmentsOf(template);
  return (
    normalizedPath(collection) === collection &&
    concrete.length === pattern.length &&
    pattern.every(
      (segment, index) => isParam(segment) || segment === concrete[index],
    )
  );
};

/** What validating one entity reads: the served state, its Evidence entities by key and the keys already seen. */
interface EntityCheck {
  readonly state: EnvironmentState;
  readonly initial: ReadonlyMap<string, StateEntity>;
  readonly seen: Set<string>;
}

const entityKey = (entity: Pick<StateEntity, "type" | "collection" | "id">) =>
  compositeKey([entity.type, entity.collection, entity.id]);

/** The first problem with an entity's view values: each names an item or list view of its type once and keeps its identity. */
const viewFieldsProblem = (
  state: EnvironmentState,
  type: StateType,
  entity: ParsedEntity,
  path: Path,
): AnalysisInputIssue | undefined => {
  const tools = new Set<string>();
  for (const [index, view] of (entity.view_fields ?? []).entries()) {
    const plan = state.views.get(view.tool);
    if (
      (plan?.shape !== "item" && plan?.shape !== "list") ||
      plan.type !== entity.type ||
      tools.has(view.tool)
    )
      return problem(
        [...path, "view_fields", index, "tool"],
        "is not an item or list view of the entity's type, or repeats one",
      );
    tools.add(view.tool);
    // Views render these values over the entity's fields, so one carrying another id would answer under this entity's key with another entity's identity.
    if (
      Object.hasOwn(view.fields, type.id_field) &&
      scalarText(view.fields[type.id_field]) !== entity.id
    )
      return problem(
        [...path, "view_fields", index, "fields"],
        `sets the type's ${type.id_field} field to a value other than the entity's id`,
      );
  }
  return undefined;
};

/** The first problem with one entity, given the keys already seen. */
const entityProblem = (
  { state, initial, seen }: EntityCheck,
  entity: ParsedEntity,
  path: Path,
): AnalysisInputIssue | undefined => {
  const type = state.types.find(
    (candidate) => candidate.collection_template === entity.type,
  );
  if (type === undefined)
    return problem([...path, "type"], "is not a type of the served state");
  if (!instantiates(entity.collection, type.collection_template))
    return problem(
      [...path, "collection"],
      `does not match its type's collection_template ${type.collection_template}`,
    );
  if (scalarText(entity.fields[type.id_field]) !== entity.id)
    return problem(
      [...path, "id"],
      `does not equal the entity's ${type.id_field} field`,
    );
  const key = entityKey(entity);
  if (seen.has(key))
    return problem([...path, "id"], "repeats an earlier entity's key");
  seen.add(key);
  const cited = entity.record_ordinals ?? [];
  if (cited.length > 0 && !same(cited, initial.get(key)?.record_ordinals ?? []))
    return problem(
      [...path, "record_ordinals"],
      "cites records the served Evidence does not cite for this entity",
    );
  return viewFieldsProblem(state, type, entity, path);
};

/** The first problem with the documents: each names a document view once, at the initial document's path. */
const documentsProblem = (
  state: EnvironmentState,
  documents: ParsedDocument["documents"],
): AnalysisInputIssue | undefined => {
  const tools = new Set<string>();
  for (const [index, document] of documents.entries()) {
    const initial = state.documents.find(
      (candidate) => candidate.tool === document.tool,
    );
    if (
      state.views.get(document.tool)?.shape !== "document" ||
      initial === undefined ||
      tools.has(document.tool)
    )
      return problem(
        ["rea_state", "documents", index, "tool"],
        "is not a document view of the served state, or repeats one",
      );
    tools.add(document.tool);
    if (document.path !== initial.path)
      return problem(
        ["rea_state", "documents", index, "path"],
        `differs from the initial document's path ${initial.path}`,
      );
    if (
      document.record_ordinal !== undefined &&
      document.record_ordinal !== initial.record_ordinal
    )
      return problem(
        ["rea_state", "documents", index, "record_ordinal"],
        `is not the initial document's record ${String(initial.record_ordinal)}`,
      );
  }
  return undefined;
};

const sameTypes = (
  supplied: readonly unknown[],
  types: readonly StateType[],
): boolean =>
  canonicalJson(supplied, "State types") ===
  canonicalJson(types, "State types");

/** The first problem in document order with a structurally valid document. */
const contentProblem = (
  state: EnvironmentState,
  document: ParsedDocument,
  initial: ReadonlyMap<string, StateEntity>,
): AnalysisInputIssue | undefined => {
  if (
    document.state_evidence_id !== undefined &&
    document.state_evidence_id !== state.evidenceId
  )
    return problem(
      ["rea_state", "state_evidence_id"],
      `is not the served state's Evidence ${state.evidenceId}`,
    );
  if (document.types !== undefined && !sameTypes(document.types, state.types))
    return problem(["rea_state", "types"], "differs from the served types");
  const check: EntityCheck = { state, initial, seen: new Set<string>() };
  for (const [index, entity] of document.entities.entries()) {
    const found = entityProblem(check, entity, [
      "rea_state",
      "entities",
      index,
    ]);
    if (found !== undefined) return found;
  }
  return documentsProblem(state, document.documents);
};

/** Loaded content citing the Evidence's records only where its values are the Evidence's; edited values cite none. */
const heldContent = (
  state: EnvironmentState,
  document: ParsedDocument,
  initial: ReadonlyMap<string, StateEntity>,
): StateContent => ({
  entities: document.entities.map((entity) => {
    const view_fields = entity.view_fields ?? [];
    const recorded = initial.get(entityKey(entity));
    const unchanged =
      recorded !== undefined &&
      same(entity.fields, recorded.fields) &&
      same(view_fields, recorded.view_fields);
    return {
      type: entity.type,
      collection: entity.collection,
      id: entity.id,
      fields: entity.fields,
      view_fields,
      record_ordinals: unchanged ? recorded.record_ordinals : [],
    };
  }),
  documents: document.documents.map(({ tool, path, value }) => {
    const recorded = state.documents.find(
      (candidate) => candidate.tool === tool,
    );
    return {
      tool,
      path,
      value,
      ...(recorded !== undefined && same(value, recorded.value)
        ? { record_ordinal: recorded.record_ordinal }
        : {}),
    };
  }),
});

/**
 * Validate a `rea-state/v1` document against the served state's types and
 * views; a refusal carries one issue naming the first problem by path.
 */
export const parseStateDocument = (
  state: EnvironmentState,
  value: unknown,
  owned = false,
): Result<StateContent, AnalysisInputError> => {
  const parsed = (
    owned ? ownedStateDocumentSchema : stateDocumentSchema
  ).safeParse(value);
  const initial = new Map(
    state.entities.map((entity) => [entityKey(entity), entity]),
  );
  const issue = parsed.success
    ? contentProblem(state, parsed.data.rea_state, initial)
    : schemaProblem(parsed.error.issues, value);
  if (issue !== undefined || !parsed.success)
    return err(
      new AnalysisInputError(
        ENVIRONMENT_SERVE_OPERATION,
        {
          userMessage: `The document is not a valid ${REA_STATE_FORMAT} state.`,
        },
        issue === undefined ? [] : [issue],
      ),
    );
  return ok(heldContent(state, parsed.data.rea_state, initial));
};
