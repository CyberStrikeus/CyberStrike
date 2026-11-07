import {
  bulkCollectionOf,
  namedEntities,
} from "../../domain/analysisView/environmentStateWriteAddress.js";
import {
  bodyProblem,
  laterItemFields,
  optionalFields,
  updatedEntity,
  updatedFields,
  writtenBulkResponse,
} from "../../domain/analysisView/environmentStateWriteApply.js";
import type { FieldRule } from "../../domain/analysisView/environmentStateWriteRules.js";
import {
  ownMember,
  type JsonObject,
  type StateEntity,
} from "../../domain/analysisView/environmentStateRules.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import { callSegments } from "./environmentStateCallLines.js";
import {
  namedEntity,
  refused,
  deleteAnswerFields,
  softDeleteFlag,
  type StateAnswer,
  type StateServing,
} from "./environmentStateAnswer.js";
import {
  isLoadableValue,
  unloadableMember,
} from "./environmentStateDocument.js";
import {
  generator,
  observedEntity,
  pathValues,
  sortedOrder,
  storedUpdate,
  unloadable,
  heldEntity,
  updateTarget,
  writeAnswer,
  type WriteRequest,
} from "./environmentStateWriteAnswer.js";
import { environmentToolArguments } from "./environmentTools.js";

/** Rules whose generated value is drawn once per call, which one call cannot give several entities. */
const DRAWN_ONCE = new Set<FieldRule["rule"]>(["unique", "renewed"]);

/** One entity a bulk call names, held by the state, with the members it gets. */
interface BulkTarget {
  readonly entity: StateEntity;
  readonly body: JsonObject | undefined;
}

/** The held entities a bulk call names, with the members each gets, or a refusal for an entity the state does not hold. */
const namedTargets = (
  serving: StateServing,
  request: WriteRequest,
): Result<BulkTarget[], AnalysisError> => {
  const { tool, plan, args } = request;
  const { address } = plan;
  const type = plan.target ?? "";
  const name = environmentToolArguments(tool, true).body;
  const body =
    name === undefined ? undefined : (ownMember(args, name) as JsonValue);
  if (body !== undefined && !isLoadableValue(body))
    return err(unloadable(tool, "The body"));
  const named =
    address === undefined || address.by === "action"
      ? undefined
      : namedEntities(address, body, serving.store.type(type)?.id_field ?? "");
  if (named === undefined)
    return err(
      refused(
        tool,
        `Tool ${tool.name} names the entities it writes by their ids in its body, as its recording did.`,
      ),
    );
  const segments = callSegments(tool, args);
  if (segments === undefined)
    return err(refused(tool, `Tool ${tool.name} needs every path argument.`));
  const collection = bulkCollectionOf(type, segments, (text) => ({
    text,
    supplied: false,
  }));
  const targets: BulkTarget[] = [];
  for (const { id, body: members } of named) {
    // A body's id is the entity's as written, never a percent-encoded spelling of another.
    const entity = namedEntity(serving.store, type, {
      segments: collection,
      id,
      literal: true,
    });
    if (entity === undefined)
      return err(
        refused(
          tool,
          `The state holds no ${type} entity ${id}; the state is unchanged.`,
        ),
      );
    if (targets.some((target) => target.entity === entity))
      return err(
        refused(
          tool,
          `The body names ${type} entity ${entity.id} more than once; the state is unchanged.`,
        ),
      );
    targets.push({ entity, body: members });
  }
  return ok(targets);
};

/** Each named entity as the call writes it, or a refusal: a delete takes only the members its recording sent, an update gets its fields with the call's shared values. */
const writtenTargets = (
  serving: StateServing,
  request: WriteRequest,
  targets: readonly BulkTarget[],
  values: ReturnType<typeof generator>,
): Result<StateEntity[], AnalysisError> => {
  const { tool, plan, args } = request;
  const observed = observedEntity(serving, plan) ?? {};
  const path = { path: tool.path_template, pathValues: pathValues(tool, args) };
  const written: StateEntity[] = [];
  for (const { entity, body } of targets) {
    const call = { ...path, body, id: entity.id };
    if (plan.effect !== "update") {
      const problem =
        plan.body === null
          ? "The tool has no modelled body."
          : bodyProblem(plan.body, call, { entity: {}, id: entity.id });
      if (problem !== undefined) return err(refused(tool, problem));
      written.push(entity);
      continue;
    }
    const fields = updatedFields(
      plan,
      { before: entity.fields, observed },
      call,
      values.forTarget(updateTarget(serving, entity, observed)),
      heldEntity(serving),
    );
    if (!fields.ok) return err(refused(tool, fields.error));
    const field = unloadableMember(fields.value);
    if (field !== undefined) return err(unloadable(tool, `Field ${field}`));
    written.push(updatedEntity(entity, fields.value));
  }
  return ok(written);
};

/** Apply one served bulk call to every entity its body names and answer it; a refused call leaves the state unchanged. */
export const answerBulk = (
  serving: StateServing,
  request: WriteRequest,
): Result<StateAnswer, AnalysisError> => {
  const { tool, plan } = request;
  const targets = namedTargets(serving, request);
  if (!targets.ok) return targets;
  const update = plan.effect === "update";
  if (
    update &&
    targets.value.length > 1 &&
    plan.rules.some((rule) => DRAWN_ONCE.has(rule.rule))
  )
    return err(
      refused(
        tool,
        `Tool ${tool.name} generates a value per call, so it writes one entity per call here.`,
      ),
    );
  const [first] = targets.value;
  const values = generator(serving, request);
  const written = writtenTargets(serving, request, targets.value, values);
  if (!written.ok) return written;
  const answer = writeAnswer(
    serving,
    request,
    (recorded) =>
      writtenBulkResponse(
        plan.response!,
        recorded,
        written.value.map((entity, index) => ({
          ...entity,
          fields: update
            ? entity.fields
            : deleteAnswerFields(
                serving,
                entity.type,
                entity.fields,
                Array.isArray(recorded) ? recorded[0] : undefined,
              ),
          sent: Object.keys(targets.value[index]!.body ?? {}),
        })),
        optionalFields(plan),
        laterItemFields(
          serving.store.state.views.values(),
          serving.store.state.entities,
          plan.target,
        ),
      ),
    {
      source: "state",
      view: update ? "update" : "delete",
      type: first!.entity.type,
      collection: first!.entity.collection,
      id: first!.entity.id,
      ids: written.value.map((entity) => entity.id),
    },
  );
  if (!answer.ok) return answer;
  if (update) {
    const stored = written.value.map((entity) => ({
      ...entity,
      fields: storedUpdate(serving, plan, entity.fields),
    }));
    const updated = serving.store.updateAll(
      stored,
      sortedOrder(
        serving,
        plan,
        stored.map((after, index) => ({
          before: targets.value[index]!.entity,
          after,
        })),
      ),
    );
    if (!updated.ok) return updated;
  } else
    serving.store.removeAll(
      written.value,
      softDeleteFlag(serving, first!.entity.type) !== undefined,
    );
  serving.store.commitWrite(values.taken);
  return answer;
};
