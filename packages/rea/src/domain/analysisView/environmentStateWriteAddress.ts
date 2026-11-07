import type { JsonValue } from "../jsonValue.js";
import {
  ownMember,
  at,
  requestJson,
  isObject,
  isParam,
  locateItem,
  normalizedPath,
  scalarText,
  segmentsOf,
  type JsonObject,
  type StateRecordFacts,
  type StateToolFacts,
  type StateView,
} from "./environmentStateRules.js";
import { entityTarget, succeeded } from "./environmentStateWriteChecks.js";
import type { WriteIo } from "./environmentStateWriteEffects.js";
import {
  pathValuesOf,
  type BodyAddress,
  type StateWritePlan,
  type WriteAddress,
  type WriteEffect,
} from "./environmentStateWriteRules.js";

/** Last segments of a POST at a collection that deletes the entities its body names. */
const BULK_DELETE_SEGMENTS = new Set(["delete", "remove", "destroy"]);

/** What classifying an addressed write reads: the state types, their id fields and item views, and the tool's recorded calls. */
export interface AddressFacts extends Pick<
  WriteIo,
  "withBody" | "requestBody" | "emptyResponse"
> {
  readonly types: ReadonlySet<string>;
  readonly idField: (type: string) => string | undefined;
  /** Where item reads of a type show its entity, and the fields each always shows. */
  readonly itemViews: (type: string) => readonly {
    readonly pointer: string;
    readonly required: readonly string[];
  }[];
  /** The tool's successful calls. */
  readonly calls: readonly StateRecordFacts[];
}

/** An addressed write's effect, the type it writes and how its calls name the entities. */
export interface AddressedWrite {
  readonly effect: WriteEffect;
  readonly target: string;
  readonly address: WriteAddress;
}

const sameSegment = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

/** Whether a literal segment names a collection: a state type ends in it. */
const namesCollection = (
  segment: string,
  types: ReadonlySet<string>,
): boolean =>
  [...types].some((type) => {
    const last = segmentsOf(type).at(-1);
    return last !== undefined && sameSegment(last, segment);
  });

/**
 * A POST, PUT or PATCH to `/{type}/{id}/{segment}` that changes the entity it names: the segment
 * names no collection, and every successful call answered nothing or the entity, where an item
 * read of its type shows it and with every field that read always shows. A call that answers
 * another entity, or a 201, made a sub-resource.
 */
export const itemAction = (
  tool: Pick<StateToolFacts, "method" | "path_template">,
  facts: AddressFacts,
): AddressedWrite | undefined => {
  if (!["POST", "PUT", "PATCH"].includes(tool.method)) return undefined;
  const segments = segmentsOf(tool.path_template);
  const [item, segment] = segments.slice(-2);
  if (
    segments.length < 3 ||
    item === undefined ||
    segment === undefined ||
    !isParam(item) ||
    isParam(segment) ||
    BULK_DELETE_SEGMENTS.has(segment.toLowerCase()) ||
    namesCollection(segment, facts.types)
  )
    return undefined;
  const target = normalizedPath(`/${segments.slice(0, -2).join("/")}`);
  const idField = facts.idField(target);
  if (
    !facts.types.has(target) ||
    idField === undefined ||
    facts.calls.length === 0
  )
    return undefined;
  const views = facts.itemViews(target);
  const showsEntity = (record: StateRecordFacts): boolean => {
    const id = pathValuesOf(tool.path_template, record.path)?.get(
      item.slice(1, -1),
    );
    if (id === undefined || record.status === 201) return false;
    if (facts.emptyResponse(record.ordinal)) return true;
    return facts.withBody(record.ordinal, (body) => {
      if (body === undefined || body === null) return true;
      const located = locateItem(body, id);
      const object =
        located === undefined ? undefined : at(body, located.pointer);
      return (
        located?.keys.includes(idField) === true &&
        isObject(object) &&
        views.some(
          (view) =>
            (view.pointer === located.pointer || located.pointer === "") &&
            view.required.every((field) => Object.hasOwn(object, field)),
        )
      );
    });
  };
  return facts.calls.every(showsEntity)
    ? { effect: "update", target, address: { by: "action", segment } }
    : undefined;
};

/** The state type a collection path writes to: the type at the path, or at the path with its last segment singular or plural. */
const collectionType = (
  segments: readonly string[],
  types: ReadonlySet<string>,
): string | undefined => {
  const path = normalizedPath(`/${segments.join("/")}`);
  if (types.has(path)) return path;
  const last = segments.at(-1);
  if (last === undefined || isParam(last)) return undefined;
  const other = last.endsWith("s") ? last.slice(0, -1) : `${last}s`;
  const counterpart = normalizedPath(
    `/${[...segments.slice(0, -1), other].join("/")}`,
  );
  return other.length > 0 && types.has(counterpart) ? counterpart : undefined;
};

/** How a body names entities by their ids, if it does: an array of ids, or of objects carrying the id field, at the root or as the one array member. */
export const addressOf = (
  body: JsonValue | undefined,
  idField: string,
): BodyAddress | undefined => {
  const form = (
    value: JsonValue | undefined,
    member: string | null,
  ): BodyAddress | undefined => {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const kinds = new Set(value.map((entry) => typeof entry));
    const [kind] = kinds;
    if (
      kinds.size === 1 &&
      (kind === "string" || kind === "number") &&
      (member === null || /ids?$/i.test(member))
    )
      return { by: "ids", member, kind };
    return value.every(
      (entry) =>
        isObject(entry) && scalarText(ownMember(entry, idField)) !== undefined,
    )
      ? { by: "elements", member }
      : undefined;
  };
  if (Array.isArray(body)) return form(body, null);
  if (!isObject(body)) return undefined;
  const arrays = Object.entries(body).filter(([, value]) =>
    Array.isArray(value),
  );
  if (arrays.length !== 1) return undefined;
  const [[member, value]] = arrays as [[string, JsonValue]];
  const found = form(value, member);
  // Shared members apply to every id an array names; objects carry their own.
  return found?.by === "elements" && Object.keys(body).length > 1
    ? undefined
    : found;
};

/**
 * A DELETE, PUT or PATCH at a type's collection, or a POST to its `delete` segment, whose every
 * successful call names held entities by id in its body, the same way.
 */
export const bulkWrite = (
  tool: Pick<StateToolFacts, "method" | "path_template">,
  facts: AddressFacts,
): AddressedWrite | undefined => {
  const segments = segmentsOf(tool.path_template);
  const last = segments.at(-1) ?? "";
  const verb = tool.method === "POST" && BULK_DELETE_SEGMENTS.has(last);
  const effect: WriteEffect | undefined =
    tool.method === "DELETE" || verb
      ? "delete"
      : ["PUT", "PATCH"].includes(tool.method)
        ? "update"
        : undefined;
  if (effect === undefined) return undefined;
  const target = collectionType(
    verb ? segments.slice(0, -1) : segments,
    facts.types,
  );
  const idField = target === undefined ? undefined : facts.idField(target);
  if (target === undefined || idField === undefined) return undefined;
  const forms = facts.calls.map((record) =>
    addressOf(requestJson(facts.requestBody(record.ordinal)), idField),
  );
  const [first] = forms;
  if (
    first === undefined ||
    forms.some((form) => JSON.stringify(form) !== JSON.stringify(first))
  )
    return undefined;
  // An id array names entities only; an update needs members to apply.
  if (effect === "update" && first.by === "ids" && first.member === null)
    return undefined;
  return { effect, target, address: first };
};

/** One entity a bulk call names and the members it writes to it. */
export interface NamedEntity {
  readonly id: string;
  readonly body: JsonObject | undefined;
}

/** The entities a bulk call's body names, each once, with the members each gets; undefined when the body does not take the address's form. */
export const namedEntities = (
  address: BodyAddress,
  body: JsonValue | undefined,
  idField: string,
): NamedEntity[] | undefined => {
  const found = addressOf(body, idField);
  if (
    found === undefined ||
    found.by !== address.by ||
    found.member !== address.member ||
    (found.by === "ids" && address.by === "ids" && found.kind !== address.kind)
  )
    return undefined;
  const entries = (
    address.member === null
      ? body
      : ownMember(body as JsonObject, address.member)
  ) as JsonValue[];
  const shared =
    address.member === null || !isObject(body)
      ? undefined
      : Object.fromEntries(
          Object.entries(body).filter(([member]) => member !== address.member),
        );
  const named = entries.map((entry) =>
    address.by === "ids"
      ? { id: scalarText(entry)!, body: shared }
      : {
          id: scalarText(ownMember(entry as JsonObject, idField))!,
          body: entry,
        },
  ) as NamedEntity[];
  return new Set(named.map(({ id }) => id)).size === named.length
    ? named
    : undefined;
};

/** The segments of the collection a bulk call writes in: its path's, without a delete segment, with the type's spelling of the last one. */
export const bulkCollectionOf = <T>(
  target: string,
  segments: readonly T[],
  spelled: (text: string) => T,
): T[] => {
  const typed = segmentsOf(target);
  const collection = segments.slice(0, typed.length);
  const last = typed.at(-1)!;
  if (!isParam(last)) collection[typed.length - 1] = spelled(last);
  return collection;
};

/** An item action call's path without its action segment: the item path its entity is read under. */
export const actionItemPath = (path: string): string =>
  `/${segmentsOf(path).slice(0, -1).join("/")}`;

/** An item action or a bulk write at a collection, for a tool whose path names no target. */
export const addressedWrite = (
  tool: StateToolFacts,
  input: Pick<AddressFacts, "types" | "idField"> & {
    readonly views: Iterable<StateView>;
    readonly records: readonly StateRecordFacts[];
    readonly io: Pick<WriteIo, "withBody" | "requestBody" | "emptyResponse">;
  },
): AddressedWrite | undefined => {
  const ordinals = new Set(tool.record_ordinals);
  const views = [...input.views];
  const facts: AddressFacts = {
    types: input.types,
    idField: input.idField,
    itemViews: (type) =>
      views.flatMap((view) =>
        view.shape === "item" && view.type === type
          ? [{ pointer: view.pointer, required: view.required_fields }]
          : [],
      ),
    calls: input.records.filter(
      (record) => ordinals.has(record.ordinal) && succeeded(record),
    ),
    withBody: input.io.withBody,
    requestBody: input.io.requestBody,
    emptyResponse: input.io.emptyResponse,
  };
  return itemAction(tool, facts) ?? bulkWrite(tool, facts);
};

/**
 * What an update's observation must show, and whether it may be a later read: a bulk call's
 * response may name its entities only, so it must show what the call sent; an item action never
 * takes a read another write to the entity still needs as its check.
 */
export const observationNeeds = (
  plan: Pick<StateWritePlan, "address" | "rules">,
  named: {
    readonly type: string;
    readonly idField: string;
    readonly collection: string;
    readonly id: string;
    readonly body: JsonObject | undefined;
  },
  pending: (target: string) => boolean,
): {
  readonly required: string[];
  readonly borrow: boolean;
  readonly action: boolean;
} => {
  const { address } = plan;
  const clocks = plan.rules.flatMap((rule) =>
    rule.rule === "clock" ? [rule.field] : [],
  );
  if (address === undefined)
    return { required: clocks, borrow: true, action: false };
  if (address.by !== "action")
    return {
      required: [
        ...clocks,
        ...Object.keys(named.body ?? {}).filter(
          (member) => member !== named.idField,
        ),
      ],
      borrow: true,
      action: false,
    };
  return {
    required: clocks,
    borrow: !pending(entityTarget(named.type, named.collection, named.id)),
    action: true,
  };
};
