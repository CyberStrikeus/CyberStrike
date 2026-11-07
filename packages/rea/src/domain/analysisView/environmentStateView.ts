import { z } from "zod";
import { jsonObjectSchema, jsonValueSchema } from "../jsonValue.js";
import { jsonRecordSchema } from "../jsonRecord.js";
import { ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import { EnvironmentStateAccumulator } from "./EnvironmentStateAccumulator.js";
import { DELETED_FLAGS } from "./environmentStateRules.js";
import { isClockZone } from "./environmentStateWriteValues.js";
import { CLOCK_PATTERNS } from "./environmentStateWriteClockFormats.js";
import {
  groupCaptureRecords,
  templateRulesSchema,
} from "./environmentManifestView.js";

export const environmentStateViewRequestSchema = z.strictObject({
  kind: z.literal("environment-state"),
  template_rules: templateRulesSchema.describe(
    "Opt-in template rules as for environment-manifest, each listed at most once. Use the rules of the manifest the state accompanies so tool names match.",
  ),
});

const queryParameterSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("filter"),
    field: z
      .string()
      .describe(
        "Entities whose field equals the value as text, or whose array field holds it directly or as an object's id, slug or name.",
      ),
  }),
  z.strictObject({
    role: z.literal("search"),
    fields: z
      .array(z.string())
      .describe(
        "Entities with a string field containing a plain substring value, ignoring case using Unicode simple case folding; an empty value matches every entity. Syntax-like operators replay instead.",
      ),
  }),
  z
    .strictObject({ role: z.literal("sort") })
    .describe(
      "Orders by the field the value names (`name`, `-name`, `name:desc`, `name-ASC`): numbers by value, text ignoring case, null last ascending.",
    ),
  z
    .strictObject({ role: z.literal("direction") })
    .describe("asc or desc for the sort parameter."),
  z
    .strictObject({ role: z.literal("limit") })
    .describe("Page size; zero or a negative value lists every match."),
  z
    .strictObject({ role: z.literal("offset") })
    .describe("Matches skipped before the page."),
  z.strictObject({
    role: z.literal("page"),
    first: z
      .number()
      .int()
      .describe(
        "The first page, 0 or 1, when recordings distinguish the convention.",
      ),
  }),
  z.strictObject({
    role: z.literal("inert"),
    values: z
      .array(z.string())
      .describe(
        "Recorded values that change nothing the view lists; other values are not computed.",
      ),
  }),
]);
const listQuerySchema = z.strictObject({
  parameters: jsonRecordSchema(queryParameterSchema).describe(
    "What each query parameter does. A call whose every parameter has a role is answered by evaluating them over the state.",
  ),
  record_ordinals: z
    .array(z.number().int().nonnegative())
    .describe("Checked lines the query reproduces, answered by evaluating it."),
  totals: z
    .array(z.string())
    .describe(
      "Observed envelope members with reproducible counts of every match before paging, named as counters are; absent or unknown representations stay recorded.",
    ),
});
const checkedSchema = z
  .array(z.number().int().nonnegative())
  .describe(
    "Latest init record per request line that the view reproduced from the state.",
  );
const clockFormatSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("iso"),
    separator: z.enum(["T", " "]),
    fraction: z.number().int().nonnegative().max(9),
    zone: z.string().refine(isClockZone),
    trimmed: z.literal(true).exactOptional(),
  }),
  z.strictObject({ kind: z.literal("epoch"), unit: z.enum(["s", "ms"]) }),
]);
const perResponseSchema = z
  .array(z.string())
  .optional()
  .describe(
    "Top-level members minted per response, such as a request id: a UUID or clock that differed on every repeat of every concrete path the view answers with no write between. Checks leave them out; serving keeps the recorded value, so a served response repeats it.",
  );
const entityViewFields = {
  tool: z.string(),
  type: z.string(),
  pointer: z
    .string()
    .describe(
      "JSON pointer to the entity object or array within the response: the root or one member, or for an item the element of a one-element array there (/0 or /<member>/0).",
    ),
  fields: z
    .array(z.string())
    .describe("Ordered fields the view shows of each entity."),
  required_fields: z.array(z.string()),
  checked_record_ordinals: checkedSchema,
  per_response_members: perResponseSchema,
  clock_formats: jsonRecordSchema(clockFormatSchema)
    .optional()
    .describe(
      "How the view spells clock fields it always spells otherwise than the entities' stored values; a stored value the view never recorded is spelled this way.",
    ),
  nested_fields: jsonRecordSchema(z.array(z.string()))
    .optional()
    .describe(
      "The keys the view shows of object fields it always shows with fewer keys than an entity stores, such as a parent listed without its own nested type; a stored object the view never recorded shows those keys.",
    ),
  sorted_arrays: z
    .array(z.string())
    .optional()
    .describe(
      "Fields whose string arrays the view lists in code-point order, whatever order they were written in; learned from a read that shows a written array sorted.",
    ),
};
const replayedReadFields = {
  projected_record_ordinals: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe(
      "Recorded reads left to replay: they asked for some fields only (`fields`, `select`), or show the entities in another representation than the checked lines (an augmenting or reducing query). Replayed calls do not show served writes.",
    ),
  projected_query_keys: z
    .array(
      z.strictObject({
        name: z.string(),
        value: z.string().optional(),
        absent: z.literal(true).optional(),
      }),
    )
    .optional()
    .describe(
      "Query keys that pick calls of the replayed reads out: a parameter only they name, a value only they give a parameter, or (absent) a parameter every checked line names and they leave out. A call matching any key replays; a projection parameter's value is tested on its own: a call replays unless every value it gives is `*` or one a checked line gave, and no replayed read gave it.",
    ),
};
const viewSchema = z.discriminatedUnion("shape", [
  z.strictObject({
    ...entityViewFields,
    shape: z.literal("item"),
    envelope_ordinal: z
      .number()
      .int()
      .nonnegative()
      .describe(
        "Record whose response, with the entity object replaced, every item response shares.",
      ),
    deleted_flag: z
      .enum(DELETED_FLAGS)
      .optional()
      .describe(
        "Member its reads set true on an entity the application soft-deleted.",
      ),
    ...replayedReadFields,
  }),
  z.strictObject({
    ...entityViewFields,
    shape: z.literal("list"),
    membership: z
      .enum(["all", "recorded"])
      .describe(
        "all: every entity of the collection in state order; recorded: the entities each recorded response listed, except on the lines all_record_ordinals names.",
      ),
    all_record_ordinals: z
      .array(z.number().int().nonnegative())
      .optional()
      .describe(
        "With recorded membership, the checked lines that each listed every entity of their collection in state order, with only paging parameters starting at zero; a call answered on one lists the whole collection. Absent when none does.",
      ),
    counters: z
      .array(z.string())
      .describe(
        "Envelope members that count the listed entities: a top-level member's name, or a JSON pointer to one in a top-level object beside the list (`/pageInfo/totalRows`); a top-level name starting with `/` is written as its pointer (`/~1total`).",
      ),
    listed_ids: z
      .array(z.strictObject({ member: z.string(), field: z.string() }))
      .optional()
      .describe(
        "Top-level envelope members listing each listed entity's identity field in list order, as Paperless's `all` does.",
      ),
    query: listQuerySchema
      .optional()
      .describe(
        "How the view's other checked lines select and order entities, when filters, a search, a sort or paging explain them; absent when none does.",
      ),
    ...replayedReadFields,
  }),
  z.strictObject({
    tool: z.string(),
    shape: z.literal("document"),
    checked_record_ordinals: checkedSchema,
    per_response_members: perResponseSchema,
  }),
  z.strictObject({
    tool: z.string(),
    shape: z.literal("recorded"),
    reason: z.enum([
      "query-body",
      "method-replay",
      "no-init-recording",
      "body-unusable",
      "no-identity",
      "path-varies",
      "query-varies",
      "fields-differ",
      "envelope-varies",
      "list-differs",
      "rendered-oversize",
    ]),
  }),
]);

const ordinalSchema = z.number().int().nonnegative();
const ruled = { field: z.string() };
const fieldRuleSchema = z.discriminatedUnion("rule", [
  z.strictObject({
    ...ruled,
    rule: z.literal("identity"),
    generator: z.enum(["sequence", "uuid", "token"]),
  }),
  z.strictObject({
    ...ruled,
    rule: z.literal("sequence"),
    scope: z.enum(["collection", "type"]),
    start: z.number().int().exactOptional(),
    sent: z.literal(true).exactOptional(),
  }),
  z.strictObject({ ...ruled, rule: z.literal("unique") }),
  z.strictObject({
    ...ruled,
    rule: z.literal("renewed"),
    pointers: z.array(z.string()).min(1),
  }),
  z.strictObject({
    ...ruled,
    rule: z.literal("clock"),
    format: clockFormatSchema,
  }),
  z.strictObject({
    ...ruled,
    rule: z.literal("nested-clock"),
    members: z.array(z.string()).min(1),
    format: clockFormatSchema,
  }),
  z.strictObject({
    ...ruled,
    rule: z.literal("made-object"),
    clocks: z.array(z.string()).min(1),
    format: clockFormatSchema,
    own: z.array(z.string()),
    counts: z.array(
      z.strictObject({ member: z.string(), start: z.number().int() }),
    ),
  }),
  z.strictObject({
    ...ruled,
    rule: z.literal("held-clock"),
    format: clockFormatSchema,
  }),
  z.strictObject({
    ...ruled,
    rule: z.literal("echo"),
    sorted: z.literal(true).exactOptional(),
  }),
  z.strictObject({ ...ruled, rule: z.literal("copy"), from: z.string() }),
  z.strictObject({ ...ruled, rule: z.literal("path"), from: z.string() }),
  z.strictObject({
    ...ruled,
    rule: z.literal("slug"),
    from: z.string(),
    ampersand: z.literal("and").exactOptional(),
  }),
  z.strictObject({ ...ruled, rule: z.literal("template"), from: z.string() }),
  z.strictObject({
    ...ruled,
    rule: z.literal("composed"),
    parts: z
      .array(
        z.union([
          z.strictObject({ text: z.string().min(1) }),
          z.strictObject({ from: z.string(), as: z.literal("value") }),
          z.strictObject({
            from: z.string(),
            as: z.literal("slug"),
            ampersand: z.literal("and").exactOptional(),
          }),
          z.strictObject({
            from: z.string(),
            as: z.literal("clock"),
            pattern: z.enum(CLOCK_PATTERNS),
          }),
        ]),
      )
      .min(1),
  }),
  z.strictObject({
    ...ruled,
    rule: z.literal("reference"),
    member: z.string(),
    type: z.string(),
    fields: z.array(z.string()).min(1),
    many: z.literal(true).exactOptional(),
  }),
  z.strictObject({ ...ruled, rule: z.literal("increment") }),
  z.strictObject({
    ...ruled,
    rule: z.literal("constant"),
    value: jsonValueSchema,
  }),
  z.strictObject({
    ...ruled,
    rule: z.literal("stamp"),
    value: jsonValueSchema,
  }),
  z.strictObject({
    ...ruled,
    rule: z.literal("derived"),
    value: jsonValueSchema,
    from: jsonValueSchema,
    member: z.string(),
  }),
  z.strictObject({ ...ruled, rule: z.literal("set"), value: jsonValueSchema }),
  z.strictObject({ ...ruled, rule: z.literal("toggle") }),
]);
const insertRuleSchema = z.union([
  z.strictObject({ rule: z.enum(["first", "last"]) }),
  z.strictObject({
    rule: z.literal("sorted"),
    field: z.string(),
    direction: z.enum(["ascending", "descending"]),
  }),
]);
const writePlanSchema = z.strictObject({
  tool: z.string(),
  effect: z.enum(["create", "update", "delete", "document", "none"]),
  target: z
    .string()
    .nullable()
    .describe(
      "The entity type an entity effect writes, or the document view a document write changes.",
    ),
  served: z.boolean(),
  reason: z
    .enum([
      "no-state-target",
      "no-call",
      "body-unusable",
      "no-observation",
      "unexplained-change",
      "contradicted",
      "side-effect",
      "unconfirmed",
      "incomplete-entities",
      "unknown-clock",
    ])
    .nullable(),
  exemplar_ordinal: ordinalSchema
    .nullable()
    .describe("The first successful recorded call the plan was built from."),
  observation: z
    .strictObject({
      ordinal: ordinalSchema,
      pointer: z.string(),
      read: z
        .strictObject({
          ordinal: ordinalSchema,
          pointer: z.string(),
          shape: z.enum(["item", "list"]),
          unloaded: z
            .array(z.string())
            .exactOptional()
            .describe(
              "JSON pointers into the entity to values the response had not loaded, which answers keep as the response showed them.",
            ),
        })
        .exactOptional()
        .describe(
          "A write's later read of the entity: an item read lends a create fields the response lacks, and its clock spellings; a list read only adds fields the response lacks.",
        ),
    })
    .nullable()
    .describe(
      "The record whose response showed the written entity or document, and a JSON pointer to it.",
    ),
  response: z
    .strictObject({
      ordinal: ordinalSchema,
      shape: z.enum(["entity", "identity", "empty", "recorded"]),
      pointer: z.string().nullable(),
    })
    .nullable(),
  body: z
    .strictObject({
      accepted: z.array(z.string()),
      fixed: z.array(
        z.strictObject({ member: z.string(), sent: jsonValueSchema }),
      ),
      required: z.array(z.string()),
      identity: z.string().nullable(),
      kinds: z.array(
        z.strictObject({
          member: z.string(),
          kind: z.enum(["array", "boolean", "number", "object", "string"]),
        }),
      ),
      envelope: z.string().optional(),
      defaults: z
        .array(z.strictObject({ member: z.string(), value: jsonValueSchema }))
        .optional(),
      blank: z
        .array(z.strictObject({ member: z.string(), sent: jsonValueSchema }))
        .optional(),
    })
    .nullable()
    .describe(
      "Body members the application stored as sent (accepted), members accepted only with their recorded value (fixed), members every call sends (required), the JSON type a later call stored an accepted member as when the observation does not show it (kinds), the member a call wraps its object in as a one-element array (envelope), the value a create stores for an accepted member a call leaves out, as a call that left it out showed (defaults), and members a recorded create sent empty, which a call that leaves them out is applied as sending (blank).",
    ),
  rules: z
    .array(fieldRuleSchema)
    .describe(
      "How written fields get their values; unlisted fields of a created entity keep the observed value.",
    ),
  collection: z
    .string()
    .nullable()
    .describe(
      "For a create whose recorded values are tied to its collection, the only collection it writes to.",
    ),
  insert: insertRuleSchema.nullable(),
  merge: z.enum(["merge", "replace"]).nullable(),
  checked_record_ordinals: z
    .array(ordinalSchema)
    .describe("Later reads that reproduced from the state after this write."),
  contradicted_by: ordinalSchema.nullable(),
  address: z
    .discriminatedUnion("by", [
      z.strictObject({ by: z.literal("action"), segment: z.string() }),
      z.strictObject({
        by: z.literal("ids"),
        member: z.string().nullable(),
        kind: z.enum(["number", "string"]),
      }),
      z.strictObject({
        by: z.literal("elements"),
        member: z.string().nullable(),
      }),
    ])
    .optional()
    .describe(
      "How a call names its entities when its path does not end in one: the action segment after the item's id, or the body's ids as an array of one JSON `kind` or as objects carrying the id field, at the root or under `member`.",
    ),
});

export const environmentStateFields = {
  origin: z
    .string()
    .describe("Primary origin, as the environment manifest selects it."),
  name: z.string(),
  timeline: z
    .enum(["recorded-start-time", "record-order"])
    .describe(
      "Records are ordered by recorded start time, or by record order when any start time is missing.",
    ),
  types: z.array(
    z.strictObject({
      collection_template: z.string(),
      id_field: z.string(),
      id_basis: z
        .enum(["path-parameter", "field-name"])
        .describe(
          "path-parameter: item responses repeat the requested path value in this field; field-name: inferred from listed items as the first identity name, else the first field ending in Id or _id shown distinct across at least two items, that every listed item carries distinctly.",
        ),
      init_before_ordinal: z
        .number()
        .int()
        .nonnegative()
        .nullable()
        .describe(
          "First recorded write whose path root relates to the type; state comes from records that finished before it.",
        ),
      volatile_fields: z
        .array(z.string())
        .describe(
          "Fields whose recorded values changed with no recorded write between; the state keeps the latest.",
        ),
    }),
  ),
  entities: z
    .array(
      z.strictObject({
        type: z.string(),
        collection: z.string(),
        id: z.string(),
        fields: jsonObjectSchema,
        view_fields: z.array(
          z.strictObject({ tool: z.string(), fields: jsonObjectSchema }),
        ),
        record_ordinals: z.array(z.number().int().nonnegative()),
      }),
    )
    .describe(
      "Entities in collection order: type, collection, then first sighting.",
    ),
  documents: z.array(
    z.strictObject({
      tool: z.string(),
      path: z.string(),
      value: jsonValueSchema,
      record_ordinal: z.number().int().nonnegative(),
    }),
  ),
  views: z.array(viewSchema),
  writes: z
    .array(writePlanSchema)
    .describe(
      "One plan per tool whose method may change state: its modelled effect, and whether the capture's later reads confirmed it (served).",
    ),
  write_clock: z
    .string()
    .nullable()
    .describe(
      "The instant a served clock starts from: the end of the capture's last timed record.",
    ),
  unknowns: z.array(
    z.strictObject({
      kind: z.enum([
        "authorization-model",
        "response-semantics",
        "state-transition",
      ]),
      statement: z.string(),
    }),
  ),
};

/** State extraction and coverage share the same budget and template-rule policy. */
export const createEnvironmentStateAccumulator = (view: {
  readonly template_rules: z.output<typeof templateRulesSchema>;
}): EnvironmentStateAccumulator =>
  new EnvironmentStateAccumulator(undefined, view.template_rules);

/** Extract the init state a capture's reads observed and each read tool's render plan; types and identity are inferences. */
export const projectEnvironmentStateView = (
  parent: AnalysisViewParent,
  view: z.output<typeof environmentStateViewRequestSchema>,
  accumulator = createEnvironmentStateAccumulator(view),
) => {
  const grouped = groupCaptureRecords(parent, view.kind, view.template_rules, {
    accumulator,
    noun: "state",
    limitations: [
      "Entity types, identity fields, list membership and counters are inferences from recorded response bodies; the state does not establish server-side schemas, derived values or values copied outside entity objects.",
    ],
  });
  if (!grouped.ok) return grouped;
  const state = accumulator.finishState();
  if (!state.ok) return state;
  return ok({
    kind: "environment-state" as const,
    view,
    parent_evidence_id: parent.evidenceId,
    parent_operation: grouped.value.operation,
    parent_digest: parent.evidenceId.slice(3),
    artifact: {
      path: grouped.value.artifact.path,
      sha256: grouped.value.artifact.sha256,
    },
    ...state.value,
  });
};
