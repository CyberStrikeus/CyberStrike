import { jsonTextCodeUnits } from "../jsonSerialization.js";
import type { JsonValue } from "../jsonValue.js";
import {
  at as valueAt,
  isObject,
  requestJson,
  pathSegmentMatches,
  pointerTo,
  same,
  segmentsOf,
  type JsonObject,
} from "./environmentStateRules.js";
import {
  documentBodyProblem,
  writtenDocument,
} from "./environmentStateWriteApply.js";
import { documentTarget } from "./environmentStateWriteChecks.js";
import {
  built,
  callOf,
  fail,
  refuse,
  UNKNOWN,
  type EffectContext,
  type EffectResult,
  type WriteDraft,
  type WriteStep,
} from "./environmentStateWriteEffects.js";
import { documentPointerOf } from "./environmentStateWriteExplain.js";

/** Whether a write's path names the held document's: each segment verbatim, or either spelling once percent-decoded, as serving matches a supplied value. */
const namesDocument = (path: string, held: string): boolean => {
  const written = segmentsOf(path);
  const recorded = segmentsOf(held);
  return (
    written.length === recorded.length &&
    recorded.every((segment, index) =>
      pathSegmentMatches(segment, written[index]!),
    )
  );
};

/** Where a write goes: a built plan writes where serving does, at its own object; an exemplar at the object holding most of its members. */
const writePointer = (
  draft: WriteDraft,
  value: JsonValue,
  body: JsonObject,
): string | undefined =>
  built(draft)
    ? draft.plan.observation?.pointer
    : documentPointerOf(value, body);

/**
 * The fields a document write changed, as pointers: a merge the members it sent at its object, a replacement every
 * member it wrote or removed there, so later writes can overwrite its effect (undefined: the whole document).
 */
const writtenPointers = (
  draft: WriteDraft,
  body: JsonObject,
  values: { readonly before: JsonValue; readonly after: JsonValue },
): readonly string[] | undefined => {
  const at = draft.plan.observation?.pointer ?? "";
  if (draft.plan.merge === "merge")
    return Object.keys(body).map((member) => `${at}${pointerTo(member)}`);
  const members = new Set(
    [values.before, values.after].flatMap((value) => {
      const object = valueAt(value, at);
      return isObject(object) ? Object.keys(object) : [];
    }),
  );
  if (members.size === 0) return at === "" ? undefined : [at];
  return [...members].map((member) => `${at}${pointerTo(member)}`);
};

/** Build a document plan from its exemplar: its object, merge or replacement by method, and the members it sent. */
const buildDocument = (
  draft: WriteDraft,
  step: WriteStep,
  evidence: { readonly pointer: string; readonly body: JsonObject },
): void => {
  const { ordinal } = step.record;
  Object.assign(draft.plan, {
    exemplar_ordinal: ordinal,
    observation: { ordinal, pointer: evidence.pointer },
    merge: step.tool.method === "PUT" ? "replace" : "merge",
    body: {
      accepted: Object.keys(evidence.body),
      fixed: [],
      required: [],
      identity: null,
      kinds: [],
    },
  });
};

/** Apply a recorded document write: the body merged into, or replacing, the object holding most of its members. */
export const applyDocument = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
): EffectResult => {
  const tool = draft.plan.target!;
  const initial = context.initialDocument(tool);
  // Serving refuses a write at another path, so one here changes no document the state holds.
  if (initial !== undefined && !namesDocument(step.record.path, initial.path))
    return UNKNOWN;
  const value = context.state.document(tool);
  const parsed = step.pinned
    ? requestJson(context.io.requestBody(step.record.ordinal))
    : undefined;
  const body = isObject(parsed) ? parsed : undefined;
  const pointer =
    value === undefined || body === undefined
      ? undefined
      : writePointer(draft, value, body);
  if (step.observeOnly || pointer === undefined) {
    fail(draft, step, body === undefined ? "body-unusable" : "no-observation");
    return UNKNOWN;
  }
  if (!built(draft)) buildDocument(draft, step, { pointer, body: body! });
  const call = callOf(step, body!);
  // Serving refuses a body its check refuses, so such a call cannot confirm the plan.
  if (
    documentBodyProblem(draft.plan, call, {
      initial: initial?.value,
      current: value!,
    }) !== undefined
  ) {
    refuse(draft, step, "unexplained-change");
    return UNKNOWN;
  }
  const written = writtenDocument(draft.plan, value!, call);
  if (!written.ok) {
    refuse(draft, step, "no-observation");
    return UNKNOWN;
  }
  const { ordinal } = step.record;
  draft.plan.response ??= context.io.withBody(ordinal, (response) => ({
    ordinal,
    shape: context.io.emptyResponse(ordinal)
      ? "empty"
      : response !== undefined && same(response, written.value)
        ? "entity"
        : "recorded",
    pointer: null,
  }));
  context.io.retain(64 + jsonTextCodeUnits(written.value) * 2);
  context.state.setDocument(tool, written.value);
  const fields = writtenPointers(draft, body!, {
    before: value!,
    after: written.value,
  });
  const replaced = draft.plan.merge === "merge" ? undefined : pointer;
  return {
    kind: "applied",
    targets: [documentTarget(tool)],
    ...(fields === undefined ? {} : { fields, pointers: true }),
    ...(fields === undefined || replaced === undefined
      ? {}
      : { overwrites: [replaced] }),
  };
};
