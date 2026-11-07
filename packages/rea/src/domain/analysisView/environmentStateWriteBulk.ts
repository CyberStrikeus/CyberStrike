import type { JsonValue } from "../jsonValue.js";
import {
  at,
  requestJson,
  isObject,
  locateItem,
  same,
  scalarText,
  segmentsOf,
  type JsonObject,
} from "./environmentStateRules.js";
import {
  bulkCollectionOf,
  namedEntities,
  type NamedEntity,
} from "./environmentStateWriteAddress.js";
import { bodyTarget } from "./environmentStateWriteChecks.js";
import { responseShapeOf } from "./environmentStateWriteExplain.js";
import {
  optionalFields,
  writtenBulkResponse,
} from "./environmentStateWriteApply.js";
import { deleteEntity } from "./environmentStateWriteDelete.js";
import {
  built,
  fail,
  refuse,
  retainFixed,
  updateEntity,
  UNKNOWN,
  type EffectContext,
  type EffectResult,
  type WriteDraft,
  type WriteStep,
} from "./environmentStateWriteEffects.js";
import { integerOf } from "./environmentStateWriteValues.js";
import type { WriteBody, WriteResponse } from "./environmentStateWriteRules.js";

/** Whether any scalar in a body passes the test. */
const holds = (
  body: JsonValue | undefined,
  test: (scalar: JsonValue) => boolean,
): boolean => {
  const pending: JsonValue[] = body === undefined ? [] : [body];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (Array.isArray(next)) for (const child of next) pending.push(child);
    else if (isObject(next))
      for (const child of Object.values(next)) pending.push(child);
    else if (test(next)) return true;
  }
  return false;
};

/**
 * Whether serving can answer a bulk call with this response for any ids: no body, one that names
 * none of them and counts nothing it wrote, or an array with one element per named entity, each
 * showing its id where the first does.
 */
export const bulkResponseFits = (
  response: WriteResponse,
  body: JsonValue | undefined,
  named: readonly NamedEntity[],
): boolean => {
  if (response.shape === "empty") return true;
  const ids = new Set(named.map(({ id }) => id));
  if (response.shape === "recorded")
    return (
      body !== undefined &&
      !holds(
        body,
        (scalar) =>
          ids.has(scalarText(scalar) ?? "") ||
          integerOf(scalar) === named.length,
      )
    );
  if (response.pointer !== "/0" || !Array.isArray(body)) return false;
  return (
    body.length === named.length &&
    named.every(({ id }, index) => {
      const element = body[index];
      if (response.shape === "identity") return scalarText(element) === id;
      const located =
        element === undefined ? undefined : locateItem(element, id);
      return located?.pointer === "" && isObject(at(element!, ""));
    })
  );
};

/** Classify a complete bulk response by corresponding element, without changing its source pointers. */
const bulkResponseShape = (
  ordinal: number,
  body: JsonValue | undefined,
  empty: boolean,
  named: readonly NamedEntity[],
  idField: string,
): WriteResponse => {
  if (!empty && Array.isArray(body) && body.length === named.length) {
    let shape: "entity" | "identity" | undefined;
    for (const [index, target] of named.entries()) {
      const element = responseShapeOf(ordinal, body[index], false, {
        idField,
        id: target.id,
      });
      if (
        element.pointer !== "" ||
        (element.shape !== "entity" && element.shape !== "identity") ||
        (shape !== undefined && shape !== element.shape)
      ) {
        shape = undefined;
        break;
      }
      shape = element.shape;
    }
    if (shape !== undefined) return { ordinal, shape, pointer: "/0" };
  }
  return responseShapeOf(ordinal, body, empty, { idField, id: named[0]!.id });
};

/** The members a bulk delete sends besides the ids and each element's `identity` member, alike for every entity it names; undefined when they differ. */
const deleteOptions = (
  named: readonly NamedEntity[],
  identity: string | null,
): JsonObject | undefined => {
  const [first, ...rest] = named.map(({ body }) =>
    Object.fromEntries(
      Object.entries(body ?? {}).filter(([member]) => member !== identity),
    ),
  );
  return rest.every((options) => same(options, first)) ? first : undefined;
};

/** A bulk delete's body: every member its exemplar sent besides the ids, required and accepted only with the value sent. */
const deleteBody = (
  options: JsonObject,
  identity: string | null,
): WriteBody => ({
  accepted: [],
  fixed: Object.entries(options).map(([member, sent]) => ({ member, sent })),
  required: Object.keys(options),
  identity,
  kinds: [],
});

/** The members besides the ids a built bulk delete takes, as its body pins them. */
const pinnedOptions = (body: WriteBody | null): JsonObject =>
  Object.fromEntries(
    (body?.fixed ?? []).map(({ member, sent }) => [member, sent]),
  );

/** Apply a recorded bulk call to each entity its body names; one it names without holding leaves the call unmodelled there. */
export const applyBulk = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
): EffectResult[] => {
  // Serving refuses another query before interpreting the request body.
  if (!step.pinned) return [UNKNOWN];
  const type = draft.plan.target!;
  const { address } = draft.plan;
  const body = requestJson(context.io.requestBody(step.record.ordinal));
  const named =
    address === undefined || address.by === "action"
      ? undefined
      : namedEntities(address, body, context.idField(type));
  if (named === undefined) {
    fail(draft, step, "body-unusable");
    return [UNKNOWN];
  }
  const deleted = draft.plan.effect === "delete";
  const identity = address?.by === "elements" ? context.idField(type) : null;
  const options = deleted ? deleteOptions(named, identity) : undefined;
  // Serving deletes only with the members its exemplar sent besides the ids; a call sending others may do something else.
  if (
    deleted &&
    (options === undefined ||
      (built(draft) && !same(options, pinnedOptions(draft.plan.body))))
  ) {
    fail(draft, step, "body-unusable");
    return [UNKNOWN];
  }
  const collection = bulkCollectionOf(
    type,
    segmentsOf(step.record.path),
    (text) => text,
  );
  const targets = named.map(({ id }) =>
    bodyTarget(context.state, type, collection, id),
  );
  // Keep the response's one parsed lease while its rows are interpreted. Nested reads retain its scratch charge.
  return context.io.withBody(step.record.ordinal, (recorded) => {
    const empty = context.io.emptyResponse(step.record.ordinal);
    const response = bulkResponseShape(
      step.record.ordinal,
      recorded,
      empty,
      named,
      context.idField(type),
    );
    const before = targets.map((target) =>
      context.state.entity(type, target.collection, target.id),
    );
    const wasBuilt = built(draft);
    const results = named.map(({ id, body: members }, index) => {
      const target = targets[index]!;
      const object =
        response.shape === "entity" &&
        response.pointer === "/0" &&
        Array.isArray(recorded)
          ? recorded[index]
          : undefined;
      const call = {
        ...step,
        response,
        responseObservation: isObject(object)
          ? { ordinal: step.record.ordinal, pointer: `/${index}`, id, object }
          : null,
      };
      return deleted
        ? deleteEntity(context, draft, call, target)
        : updateEntity(context, draft, call, { ...target, body: members });
    });
    if (!wasBuilt && built(draft) && options !== undefined) {
      draft.plan.body = deleteBody(options, identity);
      retainFixed(context, draft.plan.body.fixed);
    }
    const planned = draft.plan.response;
    if (planned !== null) {
      const written = targets.flatMap((target, index) => {
        const result = results[index];
        const fields = deleted
          ? before[index]?.fields
          : result?.kind === "applied"
            ? result.responseFields
            : undefined;
        return fields === undefined
          ? []
          : [
              {
                id: target.id,
                fields,
                sent: Object.keys(named[index]!.body ?? {}),
              },
            ];
      });
      const fits =
        planned.shape === response.shape &&
        planned.pointer === response.pointer &&
        bulkResponseFits(planned, recorded, named);
      // Replay renders as serving does: optional and later-only fields stay out for entities without them.
      const render = (exemplar: JsonValue | undefined) =>
        writtenBulkResponse(
          planned,
          exemplar,
          written,
          optionalFields(draft.plan),
          context.laterFields(draft.plan.target ?? ""),
        );
      const rendered =
        !fits || written.length !== named.length
          ? undefined
          : planned.ordinal === step.record.ordinal
            ? render(recorded)
            : context.io.withBody(planned.ordinal, render);
      if (
        !fits ||
        (rendered !== undefined &&
          (!rendered.ok || !same(rendered.value, empty ? undefined : recorded)))
      )
        refuse(draft, step, "body-unusable");
    }
    return results;
  });
};
