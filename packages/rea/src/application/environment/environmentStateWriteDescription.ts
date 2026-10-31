import type {
  StateWritePlan,
  WriteBody,
} from "../../domain/analysisView/environmentStateWriteRules.js";
import { shownValue } from "../../domain/analysisView/environmentStateWriteApply.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { singleQueryValues } from "../../domain/recordedTransportUrl.js";
import type { EnvironmentSource } from "./environmentSource.js";
import {
  describeList,
  quotedName,
  type EnvironmentToolProperty,
} from "./environmentTools.js";
import type { EnvironmentToolSchema } from "./environmentToolSchemas.js";

/** Captured member names, quoted and sampled as response fields are; the plan in the state Evidence holds every one. */
const members = (names: readonly string[]): string =>
  describeList(names, names.length, quotedName, "state Evidence");

/** A member a served write fixes, with the recorded value it takes when that is short. */
const fixedMember = ({ member, sent }: WriteBody["fixed"][number]): string => {
  const shown = shownValue(sent);
  return `${quotedName(member)} ${shown === undefined ? "only as recorded" : `only as ${shown}`}`;
};

/** The body members a served write accepts, as a description clause. */
const bodyClause = (
  body: WriteBody,
  effect: StateWritePlan["effect"],
  action = false,
): string => {
  const parts: string[] = [];
  if (body.envelope !== undefined)
    parts.push(`one object wrapped as {${quotedName(body.envelope)}:[{…}]}`);
  if (body.accepted.length > 0)
    parts.push(`body members ${members(body.accepted)}`);
  if (body.fixed.length > 0)
    parts.push(
      describeList(
        body.fixed,
        body.fixed.length,
        fixedMember,
        "state Evidence",
      ),
    );
  if (body.required.length > 0)
    parts.push(`required: ${members(body.required)}`);
  else if (effect === "update" && !action) parts.push("send at least one");
  return parts.length === 0 ? "" : ` (${parts.join("; ")})`;
};

/** The query a served write takes, as a description clause. */
const queryClause = (query: ReadonlyMap<string, string> | undefined): string =>
  query === undefined || query.size === 0
    ? ""
    : ` with the recorded query ${describeList(query, query.size, ([name, value]) => `${name}=${value}`, "state Evidence")}`;

/** What a served write tool does to the state, for its description; undefined for a tool the state does not serve. */
export const describeWrite = (
  plan: StateWritePlan | undefined,
  query?: ReadonlyMap<string, string>,
): string | undefined => {
  if (plan?.served !== true) return undefined;
  const { address } = plan;
  const body =
    (plan.body === null
      ? ""
      : bodyClause(plan.body, plan.effect, address?.by === "action")) +
    queryClause(query);
  if (address !== undefined && address.by !== "action")
    return plan.effect === "delete"
      ? `removes the entities its body names by id from the served environment state${body}, modelled on the recorded calls`
      : `changes the entities its body names by id in the served environment state${body}, modelled on the recorded calls`;
  if (address?.by === "action")
    return `applies ${quotedName(address.segment)} to the entity the path names in the served environment state${body}, modelled on the recorded calls`;
  switch (plan.effect) {
    case "create":
      return `creates an entity of ${plan.target ?? ""} in the served environment state${body}, modelled on the recorded calls`;
    case "update":
      return `changes the entity the path names in the served environment state${body}, modelled on the recorded calls`;
    case "delete":
      return `removes the entity the path names from the served environment state${queryClause(query)}, modelled on the recorded calls`;
    case "document":
      return `changes a document of the served environment state${body}, modelled on the recorded calls`;
    case "none":
      return undefined;
  }
};

/** The query a served write's recording pins, by parameter; undefined when it sent none. */
export const writeQuery = (
  plan: StateWritePlan | undefined,
  source: Pick<EnvironmentSource, "exchanges">,
): ReadonlyMap<string, string> | undefined => {
  if (plan?.served !== true || plan.exemplar_ordinal === null) return undefined;
  const query = singleQueryValues(
    source.exchanges.get(plan.exemplar_ordinal)?.query ?? undefined,
  );
  return query === undefined || query.size === 0 ? undefined : query;
};

/** A fixed member's schema: its recorded value as `const` when short and not a boolean, which some clients reject as a literal. */
const fixedSchema = (sent: JsonValue): EnvironmentToolSchema => {
  const shown = shownValue(sent);
  if (shown !== undefined && typeof sent !== "boolean" && sent !== "")
    return { const: sent, description: "Only the recorded value is accepted." };
  return {
    ...(typeof sent === "string" ? { type: "string" as const } : {}),
    description:
      shown === undefined
        ? "Must equal the recorded value, which is too long to show here."
        : `Must be ${shown}, the recorded value.`,
  };
};

/** The body a served write takes: a bulk write's ids, or the recorded object with the values it fixes, wrapped as recorded. */
export const writeBody = (
  plan: StateWritePlan | undefined,
  recorded: EnvironmentToolProperty,
): EnvironmentToolProperty | undefined => {
  if (plan?.served !== true) return undefined;
  const { address, body } = plan;
  if (address !== undefined && address.by !== "action") {
    const ids =
      address.by === "ids"
        ? "an array of entity ids"
        : "an array of objects each carrying its entity's id field";
    const items = {
      type: address.by === "ids" ? address.kind : "object",
    } as const;
    return address.member === null
      ? {
          type: "array",
          items,
          description: `Request body: ${ids}, as recorded.`,
        }
      : {
          type: "object",
          description: `Request body: ${quotedName(address.member)} holds ${ids}, as recorded.`,
        };
  }
  if (body === null || (body.fixed.length === 0 && body.envelope === undefined))
    return undefined;
  const object: EnvironmentToolSchema = {
    type: "object",
    properties: Object.fromEntries(
      body.fixed.map(({ member, sent }) => [member, fixedSchema(sent)]),
    ),
  };
  return body.envelope === undefined
    ? { ...recorded, ...object }
    : {
        type: "object",
        required: [body.envelope],
        properties: {
          [body.envelope]: {
            type: "array",
            items: object,
            description: "One object, as the recording wrapped it.",
          },
        },
        description: `Request body: one object wrapped as {${quotedName(body.envelope)}:[{…}]}, as recorded. ${recorded.description}`,
      };
};
