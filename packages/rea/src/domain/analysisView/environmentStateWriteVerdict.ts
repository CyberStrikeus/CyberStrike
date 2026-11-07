import {
  at,
  isObject,
  type StateEntity,
  type StateView,
} from "./environmentStateRules.js";
import { laterItemFields } from "./environmentStateWriteApply.js";
import type { WriteDraft, WriteIo } from "./environmentStateWriteEffects.js";
import type { StateWritePlan } from "./environmentStateWriteRules.js";

/** Whether an update or delete that answers with the entity can answer for an initial entity: one holds, or an update's rules write, every field its recorded response shows that some initial entity holds. */
const renders = (
  plan: StateWritePlan,
  input: {
    readonly io: WriteIo;
    readonly entities: readonly StateEntity[];
    readonly views: ReadonlyMap<string, StateView>;
  },
): boolean => {
  const { response } = plan;
  if (
    (plan.effect !== "update" && plan.effect !== "delete") ||
    response?.shape !== "entity"
  )
    return true;
  const shown = input.io.withBody(response.ordinal, (body) => {
    const object =
      body === undefined ? undefined : at(body, response.pointer ?? "");
    return isObject(object) ? Object.keys(object) : undefined;
  });
  // Serving renders an update's answer from the entity it wrote; an increment only adds to a field held.
  const written = new Set(
    plan.effect === "update"
      ? plan.rules.flatMap((rule) =>
          rule.rule === "increment" ? [] : [rule.field],
        )
      : [],
  );
  const later = laterItemFields(
    input.views.values(),
    input.entities,
    plan.target,
  );
  return (
    shown === undefined ||
    input.entities.some(
      (entity) =>
        entity.type === plan.target &&
        shown.every(
          (field) =>
            Object.hasOwn(entity.fields, field) ||
            written.has(field) ||
            later.has(field),
        ),
    )
  );
};

/** Whether an item action sets or toggles something, and a call showed each field it sets already at that value, so it sets rather than toggles those. */
const steady = (plan: StateWritePlan, draft: WriteDraft): boolean => {
  if (plan.address?.by !== "action") return true;
  const set = plan.rules.flatMap((rule) =>
    rule.rule === "set" ? [rule.field] : [],
  );
  // A toggle is learned only from calls that flipped its field both ways.
  return (
    (set.length > 0 || plan.rules.some((rule) => rule.rule === "toggle")) &&
    set.every((field) => draft.steady.has(field))
  );
};

/** Whether a clock a call left as it was in its own second has no rule another call showed, so no call showed whether the write stamps it. */
const unstamped = (plan: StateWritePlan, draft: WriteDraft): boolean =>
  [...draft.unstamped].some(
    (field) => !plan.rules.some((rule) => rule.field === field),
  );

/** A replayed write's plan, served only when it was called, nothing contradicted it, a read confirmed it and its answers can render. */
export const writeVerdict = (
  draft: WriteDraft,
  input: {
    readonly io: WriteIo;
    readonly entities: readonly StateEntity[];
    readonly views: ReadonlyMap<string, StateView>;
  },
): StateWritePlan => {
  const plan = draft.plan;
  if (plan.reason === null) {
    if (draft.calls === 0) plan.reason = "no-call";
    else if (draft.contradictedBy !== undefined) {
      plan.reason = "contradicted";
      plan.contradicted_by = draft.contradictedBy;
    } else if (draft.sideEffect) plan.reason = "side-effect";
    else if (
      draft.confirmed.length === 0 ||
      !steady(plan, draft) ||
      unstamped(plan, draft)
    )
      plan.reason = "unconfirmed";
    else if (!renders(plan, input)) plan.reason = "incomplete-entities";
  }
  plan.served = plan.reason === null;
  plan.checked_record_ordinals = [...new Set(draft.confirmed)];
  return { ...plan };
};
