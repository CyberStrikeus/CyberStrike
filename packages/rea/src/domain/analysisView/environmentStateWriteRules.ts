import type { JsonValue } from "../jsonValue.js";
import {
  ownMember,
  decodedSegment,
  isParam,
  normalizedPath,
  pathSegmentMatches,
  same,
  segmentsOf,
  type JsonObject,
} from "./environmentStateRules.js";
import {
  sortedStrings,
  type Ampersand,
  type ClockFormat,
} from "./environmentStateWriteValues.js";
import {
  showsFixedWidth,
  trimmedLike,
  type ClockPattern,
} from "./environmentStateWriteClockFormats.js";

/** What a write tool does to the state, by method and the target its path names. */
export type WriteEffect = "create" | "update" | "delete" | "document" | "none";

/** Why a write tool is not served. */
export type WriteReason =
  | "no-state-target"
  | "no-call"
  | "body-unusable"
  | "no-observation"
  | "unexplained-change"
  | "contradicted"
  | "side-effect"
  | "unconfirmed"
  | "incomplete-entities"
  | "unknown-clock";

/** Whether serving a plan generates a value from the environment's global clock. */
export const usesWriteClock = (plan: Pick<StateWritePlan, "rules">): boolean =>
  plan.rules.some(
    (rule) =>
      rule.rule === "clock" ||
      rule.rule === "held-clock" ||
      rule.rule === "nested-clock" ||
      rule.rule === "made-object",
  );

/** Rules that generate a value when served; the gate takes the recorded value instead. */
export type GeneratedRule =
  | {
      readonly field: string;
      readonly rule: "identity";
      readonly generator: "sequence" | "uuid" | "token";
    }
  /** One past the largest value its scope holds, and never below `start`, a value the first create took above them; with `sent`, the value a call sends instead. */
  | {
      readonly field: string;
      readonly rule: "sequence";
      readonly scope: "collection" | "type";
      readonly start?: number;
      readonly sent?: true;
    }
  | { readonly field: string; readonly rule: "unique" }
  /** The value kept with each UUID at the pointers (`*` for any array index) replaced by a fresh one, as rewritten child rows are. */
  | {
      readonly field: string;
      readonly rule: "renewed";
      readonly pointers: string[];
    }
  | {
      readonly field: string;
      readonly rule: "clock";
      readonly format: ClockFormat;
    }
  /** An object value whose members hold the write's clock, the others kept. */
  | {
      readonly field: string;
      readonly rule: "nested-clock";
      readonly members: string[];
      readonly format: ClockFormat;
    }
  /** A sent clock the application stamps anew, which a call must send as the entity holds it. */
  | {
      readonly field: string;
      readonly rule: "held-clock";
      readonly format: ClockFormat;
    }
  /** An object made with the entity, which no initial entity holds: `clocks` take the write's clock, `own` the entity's identity, each of `counts` one past the largest value held objects show and never below its start; other members as the exemplar showed them. */
  | {
      readonly field: string;
      readonly rule: "made-object";
      readonly clocks: string[];
      readonly format: ClockFormat;
      readonly own: string[];
      readonly counts: { readonly member: string; readonly start: number }[];
    };

/** How one field of a written entity gets its value; fields no rule names keep the observed value. */
export type FieldRule =
  | GeneratedRule
  /** The sent member stored as sent, or with its strings in code-point order when `sorted`. */
  | { readonly field: string; readonly rule: "echo"; readonly sorted?: true }
  | { readonly field: string; readonly rule: "copy"; readonly from: string }
  | { readonly field: string; readonly rule: "path"; readonly from: string }
  /** A slug of the sent member, spelling `&` as the word when `ampersand` says so. */
  | {
      readonly field: string;
      readonly rule: "slug";
      readonly from: string;
      readonly ampersand?: Ampersand;
    }
  | { readonly field: string; readonly rule: "template"; readonly from: string }
  /** A string rebuilt from literal text and other written fields, in order. */
  | {
      readonly field: string;
      readonly rule: "composed";
      readonly parts: ComposedPart[];
    }
  /** An object holding `fields` of the entity of `type` the sent `member` names, as the state holds it; absent when the call does not send it. */
  | {
      readonly field: string;
      readonly rule: "reference";
      readonly member: string;
      readonly type: string;
      readonly fields: string[];
      /** The member sends a list of ids, and the field holds each named entity in that order. */
      readonly many?: true;
    }
  | { readonly field: string; readonly rule: "increment" }
  /** An update stores `value` whenever the call sends the member, as the call that showed it did. */
  | {
      readonly field: string;
      readonly rule: "constant";
      readonly value: JsonValue;
    }
  /** An update stores `value`, the acting user's, without being sent it. */
  | {
      readonly field: string;
      readonly rule: "stamp";
      readonly value: JsonValue;
    }
  /** An update that sends `member` stores `value`, derived from it, on an entity holding `from` there. */
  | {
      readonly field: string;
      readonly rule: "derived";
      readonly value: JsonValue;
      readonly from: JsonValue;
      readonly member: string;
    }
  /** An item action stores `value` on every call, sent or not. */
  | {
      readonly field: string;
      readonly rule: "set";
      readonly value: JsonValue;
    }
  /** An item action flips a boolean on every call. */
  | {
      readonly field: string;
      readonly rule: "toggle";
    };

/** Clock rules spelled as a trimmed sibling is, since an application spells its clocks alike: fields whose `values`, and every `later` call's, show no fixed width. */
export const siblingTrimmedClocks = (
  rules: readonly FieldRule[],
  values: Readonly<Record<string, JsonValue>> | undefined,
  ...later: readonly Readonly<Record<string, JsonValue>>[]
): FieldRule[] => {
  const trimmed = new Map<string, Extract<ClockFormat, { kind: "iso" }>>();
  for (const rule of rules) {
    if (
      rule.rule !== "clock" ||
      rule.format.kind !== "iso" ||
      rule.format.trimmed !== true
    )
      continue;
    const format = rule.format;
    const group = `${format.separator}${format.zone}`;
    const widest = trimmed.get(group);
    if (widest === undefined || format.fraction > widest.fraction)
      trimmed.set(group, format);
  }
  if (trimmed.size === 0) return [...rules];
  return rules.map((rule) => {
    if (rule.rule !== "clock" || rule.format.kind !== "iso") return rule;
    const peer = trimmed.get(`${rule.format.separator}${rule.format.zone}`);
    if (peer === undefined) return rule;
    const format = later.some((fields) =>
      showsFixedWidth(rule.format, ownMember(fields, rule.field)),
    )
      ? rule.format
      : trimmedLike(rule.format, peer, ownMember(values, rule.field));
    return format === rule.format ? rule : { ...rule, format };
  });
};

/**
 * Two calls' rules for a field as one plan holds them: equal, or echoes one of which sorted its strings (a call whose
 * array was already in order cannot show it), kept sorted unless a call kept strings out of order. Undefined when they
 * differ otherwise.
 */
export const alikeRules = (
  held: FieldRule,
  later: FieldRule,
  kept: ReadonlySet<string> = new Set(),
): FieldRule | undefined => {
  if (held.rule !== "echo" || later.rule !== "echo")
    return same(held, later) ? held : undefined;
  if ((held.sorted === true) === (later.sorted === true)) return held;
  if (kept.has(held.field)) return undefined;
  return held.sorted === true ? held : later;
};

/** Members a call sent as strings out of code-point order and stored as sent, which shows the application keeps their order. */
export const keptOrders = (body: JsonObject, stored: JsonObject): string[] =>
  Object.keys(body).filter(
    (member) =>
      sortedStrings(body[member]) !== undefined &&
      same(ownMember(stored, member), body[member]),
  );

/** One part of a composed string: literal text, or another written field as written, slugged, or as a clock's calendar digits. */
export type ComposedPart =
  | { readonly text: string }
  | { readonly from: string; readonly as: "value" }
  | {
      readonly from: string;
      readonly as: "slug";
      readonly ampersand?: Ampersand;
    }
  | {
      readonly from: string;
      readonly as: "clock";
      readonly pattern: ClockPattern;
    };

/** Where a create places its entity in its collection's order. */
export type InsertRule =
  | { readonly rule: "first" | "last" }
  | {
      readonly rule: "sorted";
      readonly field: string;
      readonly direction: "ascending" | "descending";
    };

/** The JSON type of a stored value that is not null. */
export type JsonKind = "array" | "boolean" | "number" | "object" | "string";

/** The body members a write accepts: echoed ones with any value, fixed ones only with the value they were sent. */
export interface WriteBody {
  readonly accepted: string[];
  readonly fixed: { readonly member: string; readonly sent: JsonValue }[];
  readonly required: string[];
  /** The member that may repeat the target's identity, which must then equal the path's. */
  readonly identity: string | null;
  /** The JSON type a later call stored an accepted member as, for members the observation does not show. */
  readonly kinds: { readonly member: string; readonly kind: JsonKind }[];
  /** The member a call wraps its object in, as a one-element array. */
  readonly envelope?: string | undefined;
  /** The value a create stores for an accepted member a call leaves out, as a recorded call that left it out showed. */
  readonly defaults?:
    | { readonly member: string; readonly value: JsonValue }[]
    | undefined;
  /** Members a recorded create sent empty, which a call may leave out: one left out is applied as sent that value. */
  readonly blank?:
    | { readonly member: string; readonly sent: JsonValue }[]
    | undefined;
}

/** Whether two values both say a container is empty, as `null`, `[]` or `{}`, which encoders spell differently from one answer to another. */
export const emptySpellings = (
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean =>
  [left, right].every(
    (value) =>
      value === null ||
      (Array.isArray(value)
        ? value.length === 0
        : typeof value === "object" && Object.keys(value).length === 0),
  );

/** A value a form sends for a field left empty: `""`, `null`, `false`, `[]` or `{}`. */
export const isBlankValue = (value: JsonValue | undefined): boolean =>
  value === "" ||
  value === null ||
  value === false ||
  (Array.isArray(value)
    ? value.length === 0
    : typeof value === "object" && Object.keys(value).length === 0);

/**
 * How a write names its entities when its path does not end in one: an action segment after the
 * item's id, or ids in the body of a write at the collection, as an array of one JSON kind (`ids`)
 * or as objects carrying the type's id field (`elements`), at the body's root or under one member.
 */
export type WriteAddress =
  | { readonly by: "action"; readonly segment: string }
  | {
      readonly by: "ids";
      readonly member: string | null;
      readonly kind: "number" | "string";
    }
  | { readonly by: "elements"; readonly member: string | null };

/** How a bulk write names its entities in its body. */
export type BodyAddress = Exclude<WriteAddress, { by: "action" }>;

/** What a write answers: the written entity or its identity rendered into a recorded body, no body, or the recorded body. */
export interface WriteResponse {
  readonly ordinal: number;
  readonly shape: "entity" | "identity" | "empty" | "recorded";
  readonly pointer: string | null;
}

/** One write tool's modelled effect and whether the capture confirmed it. */
export interface StateWritePlan {
  readonly tool: string;
  readonly effect: WriteEffect;
  /** The entity type for entity effects; the document tool for a document write. */
  readonly target: string | null;
  readonly served: boolean;
  readonly reason: WriteReason | null;
  readonly exemplar_ordinal: number | null;
  /** The record whose response showed the written entity or document, and where; a create's later read whose fields the entity adds to the response's. */
  readonly observation: {
    readonly ordinal: number;
    readonly pointer: string;
    readonly read?: {
      readonly ordinal: number;
      readonly pointer: string;
      readonly shape: "item" | "list";
      /** Pointers into the entity to values the response had not loaded, which answers keep as it showed them. */
      readonly unloaded?: string[];
    };
  } | null;
  readonly response: WriteResponse | null;
  readonly body: WriteBody | null;
  readonly rules: FieldRule[];
  /** A create tied to the exemplar's collection writes only there. */
  readonly collection: string | null;
  readonly insert: InsertRule | null;
  readonly merge: "merge" | "replace" | null;
  readonly checked_record_ordinals: number[];
  readonly contradicted_by: number | null;
  /** Set when the call's path does not end in the entity's id. */
  readonly address?: WriteAddress | undefined;
}

/** The tool facts classification reads. */
interface WriteToolFacts {
  readonly method: string;
  readonly path_template: string;
}

/** The effect a state-changing tool has and its target: a state type, or a document tool by template. */
export const classifyWrite = (
  tool: WriteToolFacts,
  types: ReadonlySet<string>,
  documents: ReadonlyMap<string, string>,
): { readonly effect: WriteEffect; readonly target: string | null } => {
  const segments = segmentsOf(tool.path_template);
  const path = normalizedPath(tool.path_template);
  const parent = `/${segments.slice(0, -1).join("/")}`;
  const item = segments.length > 0 && isParam(segments.at(-1)!);
  if (tool.method === "POST" && types.has(path))
    return { effect: "create", target: path };
  if (item && types.has(parent)) {
    if (tool.method === "DELETE") return { effect: "delete", target: parent };
    if (["PUT", "PATCH", "POST"].includes(tool.method))
      return { effect: "update", target: parent };
  }
  const document = documents.get(path);
  if (document !== undefined && ["PUT", "PATCH", "POST"].includes(tool.method))
    return { effect: "document", target: document };
  return { effect: "none", target: null };
};

/** A plan for a tool whose effect is not modelled or cannot be built. */
export const unservedPlan = (
  tool: string,
  effect: WriteEffect,
  target: string | null,
  reason: WriteReason,
): StateWritePlan => ({
  tool,
  effect,
  target,
  served: false,
  reason,
  exemplar_ordinal: null,
  observation: null,
  response: null,
  body: null,
  rules: [],
  collection: null,
  insert: null,
  merge: null,
  checked_record_ordinals: [],
  contradicted_by: null,
});

/** One write call: its concrete path, the values its path parameters took and its body. */
export interface WriteCall {
  readonly path: string;
  readonly pathValues: ReadonlyMap<string, string>;
  readonly body: JsonObject | undefined;
}

/** The value each template parameter takes in a concrete path, decoded; undefined when the path does not instantiate it. */
export const pathValuesOf = (
  template: string,
  path: string,
): Map<string, string> | undefined => {
  const pattern = segmentsOf(template);
  const concrete = segmentsOf(path);
  if (pattern.length !== concrete.length) return undefined;
  const values = new Map<string, string>();
  for (const [index, segment] of pattern.entries()) {
    const value = concrete[index]!;
    if (!isParam(segment)) {
      if (segment !== value) return undefined;
      continue;
    }
    values.set(segment.slice(1, -1), decodedSegment(value));
  }
  return values;
};

/** Whether two paths are segment prefixes of one another, a parameter on either side matching any segment, with the shared single-decode spelling rule. */
export const prefixRelated = (left: string, right: string): boolean => {
  const a = segmentsOf(left);
  const b = segmentsOf(right);
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1)
    if (
      !isParam(a[index]!) &&
      !isParam(b[index]!) &&
      !pathSegmentMatches(a[index]!, b[index]!)
    )
      return false;
  return true;
};
