import type { JsonValue } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import {
  ownMember,
  setOwnMember,
  at,
  isObject,
  pointerTo,
  pointerTokens,
  replaceAt,
  same,
  scalarText,
  type JsonObject,
  type StateEntity,
  type StateView,
} from "./environmentStateRules.js";
import {
  emptySpellings,
  type FieldRule,
  type GeneratedRule,
  type JsonKind,
  type StateWritePlan,
  type WriteBody,
  type WriteCall,
  type WriteResponse,
} from "./environmentStateWriteRules.js";
import {
  stampProblem,
  nestedClockValue,
} from "./environmentStateWriteStamps.js";
import { composedValue } from "./environmentStateWriteComposed.js";
import {
  referencedValue,
  type ReferencedEntity,
} from "./environmentStateWriteReferences.js";
import {
  echoed,
  integerOf,
  readClock,
  respellClock,
  isUuid,
  replaceDelimited,
  slugOf,
  spelledLike,
} from "./environmentStateWriteValues.js";

/** The value with each UUID at the pointers (`*` for any array index) replaced by `fresh(uuid)`, others kept. */
export const renewUuids = (
  value: JsonValue,
  pointers: readonly string[],
  fresh: (uuid: string) => string,
): JsonValue => {
  const renewed = new Set(pointers);
  const renew = (item: JsonValue, pointer: string): JsonValue => {
    if (isUuid(item)) return renewed.has(pointer) ? fresh(item) : item;
    if (Array.isArray(item))
      return item.map((child) => renew(child, `${pointer}/*`));
    return isObject(item)
      ? Object.fromEntries(
          Object.entries(item).map(([key, child]) => [
            key,
            renew(child, `${pointer}${pointerTo(key)}`),
          ]),
        )
      : item;
  };
  return renew(value, "");
};

/** A refusal message naming what the call did wrong; the state is left unchanged. */
type Applied<T> = Result<T, string>;

/** A generated value or a typed refusal when the store cannot safely provide one. */
export type GenerateValue = (
  rule: GeneratedRule,
) => Applied<JsonValue | undefined>;

const kindOf = (value: JsonValue | undefined): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

/** The JSON types `stored` holds members in, for those `observed` shows no value of. */
export const storedKinds = (
  members: readonly string[],
  observed: JsonObject,
  stored: JsonObject,
): WriteBody["kinds"] =>
  members.flatMap((member) => {
    const value = ownMember(stored, member);
    return (ownMember(observed, member) ?? null) === null &&
      value !== undefined &&
      value !== null
      ? [{ member, kind: kindOf(value) as JsonKind }]
      : [];
  });

/** Members a refusal names, each cut to `LISTED_NAME_CHARS`; the plan in the state Evidence holds every one whole. */
const LISTED_MEMBERS = 12;
const LISTED_NAME_CHARS = 120;

/** Captured member names quoted, so a separator in one cannot read as another, and bounded in count and length. */
const listed = (members: readonly string[]): string => {
  if (members.length === 0) return "none";
  const shown = members
    .slice(0, LISTED_MEMBERS)
    .map((member) =>
      JSON.stringify(
        member.length > LISTED_NAME_CHARS
          ? `${member.slice(0, LISTED_NAME_CHARS)}…`
          : member,
      ),
    )
    .join(", ");
  return members.length > LISTED_MEMBERS
    ? `${shown}, … (${String(members.length)} members; all in the state Evidence)`
    : shown;
};

/** What a body may hold, for refusal messages. */
const bodyContract = (body: WriteBody): string =>
  `accepted members: ${listed(body.accepted)}; members accepted only with their recorded value: ${listed(body.fixed.map(({ member }) => member))}; required: ${listed(body.required)}`;

/** Recorded values up to this many characters are shown where a served write names them; a longer one is only named. */
const SHOWN_VALUE_CHARS = 120;

/** A recorded value as JSON text, when short enough to show. */
export const shownValue = (value: JsonValue): string | undefined => {
  const text = JSON.stringify(value);
  return text.length <= SHOWN_VALUE_CHARS ? text : undefined;
};

/** Why a call's body does not fit the members the capture showed, if it does not; `shapes` gives each accepted member's JSON type, else the body's recorded kind. */
export const bodyProblem = (
  body: WriteBody,
  call: WriteCall,
  shapes: { readonly entity: JsonObject; readonly id?: string },
): string | undefined => {
  const sent = call.body ?? {};
  const fixed = new Map(body.fixed.map((entry) => [entry.member, entry.sent]));
  const kinds = new Map(body.kinds.map((entry) => [entry.member, entry.kind]));
  for (const [member, value] of Object.entries(sent)) {
    if (member === body.identity) {
      if (scalarText(value) !== shapes.id)
        return `Member ${member} must repeat the target's identity ${shapes.id ?? ""}.`;
      continue;
    }
    if (fixed.has(member)) {
      if (!same(fixed.get(member), value))
        return `Member ${member} is accepted only with the value the capture sent, ${shownValue(fixed.get(member)!) ?? "too long to show here"}, because the application stored it differently or other recorded fields go with it (${bodyContract(body)}).`;
      continue;
    }
    if (!body.accepted.includes(member))
      return `Member ${member} is not one the capture showed stored (${bodyContract(body)}).`;
    // A recorded call sent this member empty, as a form does for a field left as it was.
    if (
      body.blank?.some(
        (entry) => entry.member === member && same(entry.sent, value),
      ) === true
    )
      continue;
    const recorded = ownMember(shapes.entity, member);
    const kind =
      recorded === undefined || recorded === null
        ? kinds.get(member)
        : kindOf(recorded);
    if (kind !== undefined && kind !== kindOf(value))
      return `Member ${member} must be a JSON ${kind}, as the capture stored it.`;
  }
  const missing = body.required.filter(
    (member) => !Object.hasOwn(sent, member),
  );
  if (missing.length > 0)
    return `The call lacks required members ${listed(missing)} (${bodyContract(body)}).`;
  return undefined;
};

/** The value at a JSON pointer inside a body, following array indexes and members. */
export const valueAt = (
  body: JsonValue,
  pointer: string,
): JsonValue | undefined => {
  let value: JsonValue | undefined = body;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(value)) value = value[Number(token)];
    else if (isObject(value) && Object.hasOwn(value, token))
      value = value[token];
    else return undefined;
  }
  return value;
};

/** A path value spelled as the observed value: a number when the observed value is one. */
const pathValue = (observed: JsonValue | undefined, text: string): JsonValue =>
  typeof observed === "number" && integerOf(text) !== undefined
    ? Number(text)
    : text;

/** A generated field from a recorded call, reproduced with the same nested-clock renderer serving uses. */
export const recordedGeneratedValue = (
  rule: GeneratedRule,
  base: JsonValue | undefined,
  value: JsonValue | undefined,
): Applied<JsonValue | undefined> => {
  if (rule.rule !== "nested-clock") return ok(value);
  const clock = isObject(value)
    ? ownMember(value, rule.members[0]!)
    : undefined;
  if (
    clock === undefined ||
    JSON.stringify(readClock(clock)?.format) !== JSON.stringify(rule.format)
  )
    return err(`The recorded ${rule.field} has no clock in the plan's format.`);
  const rebuilt = nestedClockValue(base, rule, clock);
  return rebuilt.ok && same(rebuilt.value, value)
    ? rebuilt
    : err(
        `The recorded ${rule.field} differs from its nested-clock rendering.`,
      );
};

/** One field's value under a rule that reads the call or generates. */
const ruledValue = (
  rule: FieldRule,
  observed: JsonObject,
  call: WriteCall,
  generate: GenerateValue,
  references: {
    readonly referenced: ReferencedEntity | undefined;
    readonly blank: WriteBody["blank"];
  },
): Applied<JsonValue | undefined> => {
  const body = call.body ?? {};
  switch (rule.rule) {
    case "reference":
      return referencedValue(
        rule,
        body,
        references.referenced,
        references.blank,
      );
    case "sequence":
      return rule.sent === true && Object.hasOwn(body, rule.field)
        ? ok(body[rule.field]!)
        : generate(rule);
    case "identity":
    case "unique":
    case "renewed":
    case "clock":
    case "nested-clock":
    case "held-clock":
    case "made-object":
      return generate(rule);
    case "echo":
      return ok(
        Object.hasOwn(body, rule.field)
          ? echoed(rule, body[rule.field]!)
          : undefined,
      );
    case "copy": {
      const value = valueAt(body, rule.from);
      return value === undefined
        ? err(
            `The call has no value at ${rule.from} in its body, which ${rule.field} copies.`,
          )
        : ok(value);
    }
    case "path": {
      const value = call.pathValues.get(rule.from);
      return value === undefined
        ? err(
            `The call names no ${rule.from} path value, which ${rule.field} takes.`,
          )
        : ok(pathValue(ownMember(observed, rule.field), value));
    }
    default:
      return ok(undefined);
  }
};

/** A string field rebuilt around the new value of the generated field it embeds. */
const templated = (
  observed: JsonObject,
  written: JsonObject,
  rule: Extract<FieldRule, { rule: "template" }>,
): JsonValue | undefined => {
  const text = ownMember(observed, rule.field);
  const token = scalarText(ownMember(observed, rule.from));
  const replacement = scalarText(ownMember(written, rule.from));
  return typeof text === "string" &&
    token !== undefined &&
    replacement !== undefined
    ? replaceDelimited(text, token, replacement)
    : undefined;
};

/** Apply the rules that derive from fields already written or the call: slugs, templates, stamps and composed strings; why a composed string cannot be rebuilt, if one cannot. */
const derive = (
  rules: readonly FieldRule[],
  observed: JsonObject,
  written: JsonObject,
  sent: JsonObject,
): string | undefined => {
  for (const rule of rules) {
    if (rule.rule === "slug") {
      const from = ownMember(sent, rule.from);
      if (typeof from === "string")
        setOwnMember(written, rule.field, slugOf(from, rule.ampersand));
    } else if (rule.rule === "template") {
      const value = templated(observed, written, rule);
      if (value !== undefined) setOwnMember(written, rule.field, value);
    } else if (rule.rule === "stamp")
      setOwnMember(written, rule.field, rule.value);
    else if (rule.rule === "derived" && Object.hasOwn(sent, rule.member))
      setOwnMember(written, rule.field, rule.value);
  }
  // Composed strings read the fields the rules above wrote.
  for (const rule of rules)
    if (rule.rule === "composed") {
      const value = composedValue(rule.parts, written);
      if (value === undefined) {
        const sources = new Set(
          rule.parts.flatMap((part) => ("from" in part ? [part.from] : [])),
        );
        return `The write composes ${JSON.stringify(rule.field)} from ${listed([...sources])}, and the entity holds no value one of them can spell.`;
      }
      setOwnMember(written, rule.field, value);
    }
  return undefined;
};

/** Members stored only under another name, with the value of the field each is copied whole into, for type checks. */
const copiedShapes = (
  rules: readonly FieldRule[],
  observed: JsonObject,
): JsonObject =>
  Object.fromEntries(
    rules.flatMap((rule): [string, JsonValue][] => {
      if (rule.rule !== "copy" || !Object.hasOwn(observed, rule.field))
        return [];
      const tokens = pointerTokens(rule.from);
      return tokens.length === 1 ? [[tokens[0]!, observed[rule.field]!]] : [];
    }),
  );

/** A create's call with the members it left out that recorded calls sent empty, as the earliest sent them; one a call that left it out showed a default for keeps that default, and one `unheld` names stays left out. */
const withBlanks = (
  body: WriteBody,
  call: WriteCall,
  unheld: ReadonlySet<string>,
): WriteCall => {
  const given = call.body ?? {};
  const left = (body.blank ?? []).filter(
    ({ member }, index, blank) =>
      !Object.hasOwn(given, member) &&
      !unheld.has(member) &&
      !(body.defaults ?? []).some((entry) => entry.member === member) &&
      blank.findIndex((entry) => entry.member === member) === index,
  );
  return left.length === 0
    ? call
    : {
        ...call,
        body: {
          ...Object.fromEntries(left.map(({ member, sent }) => [member, sent])),
          ...given,
        },
      };
};

/** The fields of a created entity: the observed entity with every ruled field taken from the call or generated. */
export const createdFields = (
  plan: Pick<StateWritePlan, "rules" | "body">,
  observed: JsonObject,
  sentCall: WriteCall,
  generate: GenerateValue,
  referenced?: ReferencedEntity,
  idField?: string,
): Applied<JsonObject> => {
  if (plan.body === null) return err("The tool has no modelled body.");
  // A reference the observed entity lacks is one a create left out and stored nothing for, as a call leaving it out does.
  const unheld = new Set(
    plan.rules.flatMap((rule) =>
      rule.rule === "reference" && !Object.hasOwn(observed, rule.field)
        ? [rule.member]
        : [],
    ),
  );
  // A member a `sequence` with `sent` numbers when a call leaves it out takes the next number, not an empty value one sent.
  const numbered = new Set(
    plan.rules.flatMap((rule) =>
      rule.rule === "sequence" && rule.sent === true ? [rule.field] : [],
    ),
  );
  const call = withBlanks(
    {
      ...plan.body,
      blank: (plan.body.blank ?? []).filter(
        ({ member }) => !numbered.has(member),
      ),
    },
    sentCall,
    unheld,
  );
  const problem = bodyProblem(plan.body, call, {
    entity: { ...copiedShapes(plan.rules, observed), ...observed },
  });
  if (problem !== undefined) return err(problem);
  const written: JsonObject = { ...observed };
  const defaults = new Map(
    (plan.body.defaults ?? []).map(({ member, value }) => [member, value]),
  );
  for (const rule of plan.rules) {
    const value = ruledValue(rule, observed, call, generate, {
      referenced,
      blank: plan.body.blank,
    });
    if (!value.ok) return value;
    if (value.value !== undefined)
      setOwnMember(written, rule.field, value.value);
    else if (rule.rule === "echo" && defaults.has(rule.field))
      setOwnMember(written, rule.field, defaults.get(rule.field)!);
    else if (rule.rule === "echo" || rule.rule === "reference")
      delete written[rule.field];
  }
  ownMadeMembers(plan.rules, written, idField);
  const unspelled = derive(plan.rules, observed, written, call.body ?? {});
  return unspelled === undefined ? ok(written) : err(unspelled);
};

/** Set each made object's members that hold the entity's identity to the identity it was written with, generated or sent. */
const ownMadeMembers = (
  rules: readonly FieldRule[],
  written: JsonObject,
  idField: string | undefined,
): void => {
  const identity =
    idField ?? rules.find((rule) => rule.rule === "identity")?.field;
  const id = identity === undefined ? undefined : ownMember(written, identity);
  if (id === undefined) return;
  for (const rule of rules) {
    if (rule.rule !== "made-object" || rule.own.length === 0) continue;
    const made = ownMember(written, rule.field);
    if (made === undefined || !isObject(made)) continue;
    const owned: JsonObject = { ...made };
    for (const member of rule.own)
      setOwnMember(owned, member, spelledIdentity(ownMember(made, member), id));
    setOwnMember(written, rule.field, owned);
  }
};

/** An identity spelled as a recorded member spells it: a string, or a number when the identity is one. */
const spelledIdentity = (
  exemplar: JsonValue | undefined,
  id: JsonValue,
): JsonValue => (typeof exemplar === "string" ? (scalarText(id) ?? id) : id);

/** Rules an update gives a new value on every call. */
const REGENERATED: ReadonlySet<FieldRule["rule"]> = new Set([
  "clock",
  "nested-clock",
  "held-clock",
  "unique",
]);
const regenerated = (
  rule: FieldRule,
): rule is Extract<
  GeneratedRule,
  { rule: "clock" | "nested-clock" | "held-clock" | "unique" }
> => REGENERATED.has(rule.rule);

/** The value an echo or constant rule writes for a sent member, or a set rule on every call; undefined when it writes none. */
const statedValue = (
  rule: FieldRule,
  sent: JsonObject,
): JsonValue | undefined => {
  if (rule.rule === "set") return rule.value;
  if (rule.rule !== "echo" && rule.rule !== "constant") return undefined;
  if (!Object.hasOwn(sent, rule.field)) return undefined;
  return rule.rule === "echo" ? echoed(rule, sent[rule.field]!) : rule.value;
};

/** The fields of an updated entity: sent echoed members, the constants the plan recorded, generated and derived changes. */
export const updatedFields = (
  plan: Pick<StateWritePlan, "rules" | "body" | "address">,
  entity: { readonly before: JsonObject; readonly observed: JsonObject },
  call: WriteCall & { readonly id: string },
  generate: GenerateValue,
  referenced?: ReferencedEntity,
): Applied<JsonObject> => {
  const { before, observed } = entity;
  if (plan.body === null) return err("The tool has no modelled body.");
  const sent = call.body ?? {};
  const problem =
    bodyProblem(plan.body, call, {
      entity: { ...observed, ...before },
      id: call.id,
    }) ?? stampProblem(plan.rules, before, sent);
  if (problem !== undefined) return err(problem);
  const members = Object.keys(sent).filter(
    (member) => member !== plan.body?.identity,
  );
  // An item action names its change in its path, so it may send nothing.
  if (members.length === 0 && plan.address?.by !== "action")
    return err(
      `The call sends none of the members an update applies (${bodyContract(plan.body)}).`,
    );
  const written: JsonObject = { ...before };
  for (const rule of plan.rules) {
    const stated = statedValue(rule, sent);
    if (stated !== undefined) setOwnMember(written, rule.field, stated);
    else if (rule.rule === "toggle") {
      const was = ownMember(before, rule.field);
      if (typeof was !== "boolean")
        return err(`The entity holds no flag ${rule.field} to flip.`);
      setOwnMember(written, rule.field, !was);
    } else if (rule.rule === "reference" && Object.hasOwn(sent, rule.member)) {
      const value = referencedValue(rule, sent, referenced, plan.body.blank);
      if (!value.ok) return value;
      if (value.value !== undefined)
        setOwnMember(written, rule.field, value.value);
    } else if (rule.rule === "increment") {
      const was = integerOf(ownMember(before, rule.field));
      if (was !== undefined)
        setOwnMember(
          written,
          rule.field,
          spelledLike(ownMember(before, rule.field)!, was + 1),
        );
    } else if (
      regenerated(rule) ||
      // Child rows are renewed only on an entity that holds them.
      (rule.rule === "renewed" && Object.hasOwn(before, rule.field))
    ) {
      const value = generate(rule);
      if (!value.ok) return value;
      if (value.value !== undefined)
        setOwnMember(written, rule.field, value.value);
    }
  }
  // A member the call leaves out takes the default a whole-object update showed; one a reference names by its member is not left out.
  for (const { member, value } of plan.body.defaults ?? [])
    if (
      !Object.hasOwn(sent, member) &&
      !plan.rules.some(
        (rule) =>
          rule.rule === "reference" &&
          rule.field === member &&
          Object.hasOwn(sent, rule.member),
      )
    )
      setOwnMember(written, member, value);
  const unspelled = derive(
    plan.rules.filter(
      (rule) => rule.rule !== "slug" || Object.hasOwn(sent, rule.from),
    ),
    observed,
    written,
    sent,
  );
  return unspelled === undefined ? ok(written) : err(unspelled);
};

/** Why a document write's body does not fit what the capture showed: members its plan accepts, as the JSON types the document holds, a member a replacing write dropped keeping the type the initial document showed. */
export const documentBodyProblem = (
  plan: Pick<StateWritePlan, "body" | "observation">,
  call: WriteCall,
  documents: {
    readonly initial: JsonValue | undefined;
    readonly current: JsonValue;
  },
): string | undefined => {
  if (plan.body === null) return "The tool has no modelled body.";
  const pointer = plan.observation?.pointer ?? "";
  const members = (value: JsonValue | undefined): JsonObject => {
    const object = value === undefined ? undefined : at(value, pointer);
    return isObject(object) ? object : {};
  };
  return bodyProblem(plan.body, call, {
    entity: { ...members(documents.initial), ...members(documents.current) },
  });
};

/** A document after a write: the body's members merged into, or replacing, the object at the pointer. */
export const writtenDocument = (
  plan: Pick<StateWritePlan, "merge" | "observation">,
  before: JsonValue,
  call: WriteCall,
): Applied<JsonValue> => {
  const pointer = plan.observation?.pointer ?? "";
  const target = at(before, pointer);
  if (!isObject(target) || call.body === undefined)
    return err("The call's body does not fit the document.");
  const value =
    plan.merge === "replace" ? { ...call.body } : { ...target, ...call.body };
  return ok(replaceAt(before, pointer, value));
};

/** The fields a create stores only when a call sends their member: references and echoes of members not every call sent, with no default. */
export const optionalFields = (
  plan: Pick<StateWritePlan, "effect" | "rules" | "body">,
): string[] => {
  if (plan.effect !== "create" || plan.body === null) return [];
  const { required, defaults = [] } = plan.body;
  return plan.rules.flatMap((rule) =>
    (rule.rule === "reference" && !required.includes(rule.member)) ||
    (rule.rule === "echo" &&
      !required.includes(rule.field) &&
      !defaults.some(({ member }) => member === rule.field))
      ? [rule.field]
      : [],
  );
};

/** Fields an item view of the type shows that no initial entity of the type holds, which only later reads showed. */
export const laterItemFields = (
  views: Iterable<StateView>,
  entities: readonly StateEntity[],
  type: string | null,
): Set<string> => {
  const fields = new Set<string>();
  for (const view of views)
    if (view.shape === "item" && view.type === type)
      for (const field of view.fields)
        if (!view.required_fields.includes(field)) fields.add(field);
  for (const entity of entities)
    if (entity.type === type)
      for (const held of [
        entity.fields,
        ...entity.view_fields.map((view) => view.fields),
      ])
        for (const field of Object.keys(held)) fields.delete(field);
  return fields;
};

/** A write's answer body from its recorded response: the entity or identity rendered in, nothing, or the recorded body; optional fields show only when written. */
export const writtenResponse = (
  response: WriteResponse,
  recorded: JsonValue | undefined,
  written: {
    readonly fields: JsonObject | undefined;
    readonly id: string;
    /** Generated clocks keep the response's spelling independently of the stored entity's. */
    readonly clocks?: readonly string[];
    /** Members the call sent, which the answer shows as stored. */
    readonly sent?: readonly string[];
    /** Pointers into the entity to values the recorded answer had not loaded, which the answer keeps as recorded. */
    readonly unloaded?: readonly string[];
  },
  optional: readonly string[] = [],
  /** Fields only later reads showed, which the answer leaves out when the entity does not hold them. */
  later: ReadonlySet<string> = new Set(),
): Applied<JsonValue | undefined> => {
  if (response.shape === "empty") return ok(undefined);
  if (response.shape === "recorded" || recorded === undefined)
    return ok(recorded);
  const pointer = response.pointer ?? "";
  const shown = at(recorded, pointer);
  if (response.shape === "identity")
    return ok(
      replaceAt(
        recorded,
        pointer,
        typeof shown === "number" && integerOf(written.id) !== undefined
          ? Number(written.id)
          : written.id,
      ),
    );
  if (!isObject(shown) || written.fields === undefined)
    return err("The recorded response does not carry the entity.");
  const held = (field: string) => Object.hasOwn(written.fields!, field);
  const missing = Object.keys(shown).filter(
    (field) => !held(field) && !optional.includes(field) && !later.has(field),
  );
  if (missing.length > 0)
    return err(
      `The state holds no complete entity for this response: it lacks ${missing.join(", ")}.`,
    );
  const fields = [
    ...Object.keys(shown).filter(held),
    ...optional.filter((field) => !Object.hasOwn(shown, field) && held(field)),
  ];
  const entity = Object.fromEntries(
    fields.map((field): [string, JsonValue] => {
      const value = ownMember(written.fields!, field)!;
      const answered = ownMember(shown, field);
      // An answer spells an empty list or map the call did not send as its recording did.
      if (
        answered !== undefined &&
        written.sent?.includes(field) !== true &&
        emptySpellings(answered, value)
      )
        return [field, answered];
      const clock =
        written.clocks?.includes(field) === true
          ? readClock(answered)
          : undefined;
      return [
        field,
        clock === undefined ? value : respellClock(value, clock.format),
      ];
    }),
  );
  const answer = (written.unloaded ?? []).reduce<JsonObject>(
    (rendered, path) => {
      const tokens = pointerTokens(path);
      const kept = memberAt(shown, tokens);
      if (kept !== undefined) return withMemberAt(rendered, tokens, kept);
      // A member the answer left out of an object it showed stays out.
      return isObject(memberAt(shown, tokens.slice(0, -1)))
        ? withoutMemberAt(rendered, tokens)
        : rendered;
    },
    entity,
  );
  return ok(replaceAt(recorded, pointer, answer));
};

/** The value under these member names, nested objects included. */
const memberAt = (
  value: JsonValue | undefined,
  tokens: readonly string[],
): JsonValue | undefined =>
  tokens.reduce<JsonValue | undefined>(
    (inner, token) => (isObject(inner) ? ownMember(inner, token) : undefined),
    value,
  );

/** A copy with the value under these member names replaced, when the object holds every one of them. */
const withMemberAt = (
  object: JsonObject,
  tokens: readonly string[],
  value: JsonValue,
): JsonObject => {
  const [first, ...rest] = tokens;
  if (first === undefined || !Object.hasOwn(object, first)) return object;
  if (rest.length === 0) return { ...object, [first]: value };
  const inner = object[first];
  return isObject(inner)
    ? { ...object, [first]: withMemberAt(inner, rest, value) }
    : object;
};

/** A copy without the value under these member names, when the object holds every one of them. */
const withoutMemberAt = (
  object: JsonObject,
  tokens: readonly string[],
): JsonObject => {
  const [first, ...rest] = tokens;
  if (first === undefined || !Object.hasOwn(object, first)) return object;
  if (rest.length === 0) {
    const { [first]: _dropped, ...kept } = object;
    return kept;
  }
  const inner = object[first];
  return isObject(inner)
    ? { ...object, [first]: withoutMemberAt(inner, rest) }
    : object;
};

/** The shared bulk renderer: fixed acknowledgements, or one first-template element per written entity, each with the single answer's optional and later fields. */
export const writtenBulkResponse = (
  response: WriteResponse,
  recorded: JsonValue | undefined,
  written: readonly {
    readonly fields: JsonObject;
    readonly id: string;
    readonly sent?: readonly string[];
  }[],
  optional: readonly string[] = [],
  later: ReadonlySet<string> = new Set(),
): Applied<JsonValue | undefined> => {
  if (response.shape === "empty") return ok(undefined);
  if (response.shape === "recorded") return ok(recorded);
  const [template] = Array.isArray(recorded) ? recorded : [];
  if (template === undefined)
    return err("The recorded response shows no element to render.");
  const elements: JsonValue[] = [];
  for (const entity of written) {
    const element = writtenResponse(
      { ...response, pointer: "" },
      template,
      entity,
      optional,
      later,
    );
    if (!element.ok) return element;
    elements.push(element.value ?? null);
  }
  return ok(elements);
};

/** An entity with updated fields: view-specific values of the fields that changed give way to the new values, and it cites no records. */
export const updatedEntity = (
  entity: StateEntity,
  fields: JsonObject,
): StateEntity => {
  const changed = new Set(
    Object.keys(fields).filter(
      (field) => !same(ownMember(entity.fields, field), fields[field]),
    ),
  );
  // Written values are no longer the ones the cited records show.
  return {
    ...entity,
    fields,
    record_ordinals: [],
    view_fields: entity.view_fields
      .map((view) => ({
        tool: view.tool,
        fields: Object.fromEntries(
          Object.entries(view.fields).filter(([field]) => !changed.has(field)),
        ),
      }))
      .filter((view) => Object.keys(view.fields).length > 0),
  };
};
