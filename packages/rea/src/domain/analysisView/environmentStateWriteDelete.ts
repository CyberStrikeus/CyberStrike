import {
  collectionTarget,
  entityTarget,
  itemTarget,
} from "./environmentStateWriteChecks.js";
import {
  built,
  fail,
  UNKNOWN,
  type EffectContext,
  type EffectResult,
  type WriteDraft,
  type WriteStep,
} from "./environmentStateWriteEffects.js";
import { responseShapeOf } from "./environmentStateWriteExplain.js";

/** Apply a recorded delete: the held entity leaves its collection, unless the call sent another query than serving pins, which may delete nothing. */
export const applyDelete = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
): EffectResult =>
  step.pinned
    ? deleteEntity(
        context,
        draft,
        step,
        itemTarget(context.state, draft.plan.target!, step.record),
      )
    : UNKNOWN;

/** Remove the held entity a call names. */
export const deleteEntity = (
  context: EffectContext,
  draft: WriteDraft,
  step: WriteStep,
  named: { readonly collection: string; readonly id: string },
): EffectResult => {
  const type = draft.plan.target!;
  const { collection, id } = named;
  const entity = context.state.entity(type, collection, id);
  if (entity === undefined) {
    fail(draft, step, "no-observation");
    return UNKNOWN;
  }
  const { ordinal } = step.record;
  if (!built(draft) && !step.observeOnly)
    Object.assign(draft.plan, {
      exemplar_ordinal: ordinal,
      response:
        step.response ??
        context.io.withBody(ordinal, (body) =>
          responseShapeOf(ordinal, body, context.io.emptyResponse(ordinal), {
            idField: context.idField(type),
            id,
          }),
        ),
    });
  context.state.remove(entity);
  const targets = [
    entityTarget(type, collection, id),
    collectionTarget(type, collection),
  ];
  return {
    kind: step.observeOnly ? "observed" : "applied",
    targets,
    entity: { type, collection, id },
  };
};
