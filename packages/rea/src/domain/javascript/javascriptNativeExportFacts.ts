import {
  compositeKey,
  compareUnicodeCodePoints,
} from "../unicodeCodePointOrder.js";
import type { ApplicationNode } from "./javascriptApplicationGraphSchemas.js";

type Observation = ApplicationNode["observations"][number];

/** Read member facts without changing historical observations or their identifiers. */
export const nativeExportObservationFacts = (observation: Observation) => {
  const requested = observation.properties.requested_members;
  const members = observation.properties.members;
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  const requestedPresent = Object.hasOwn(
    observation.properties,
    "requested_members",
  );
  const membersPresent = Object.hasOwn(observation.properties, "members");
  const validList = (value: unknown): boolean =>
    Array.isArray(value) && value.every((item) => typeof item === "string");
  return {
    requestedPresent,
    membersPresent,
    valid:
      (!requestedPresent || validList(requested)) &&
      (!membersPresent || validList(members)),
    requested: strings(requested),
    members: strings(members),
    // Labels were the historical fallback, but current labels summarize names
    // or namespace access and must not become requested native symbols.
    label: Array.isArray(requested) ? null : observation.label,
  };
};

/** Correspondence requires every observation to describe the same binding facts. */
export const nativeExportCorrespondenceKey = (
  node: ApplicationNode,
): string | null => {
  const keys = node.observations.map((observation) => {
    const facts = nativeExportObservationFacts(observation);
    if (!facts.valid) return null;
    const specifier = observation.properties.specifier;
    if (typeof specifier !== "string" || specifier === "")
      return observation.label === null ||
        facts.requestedPresent ||
        facts.membersPresent
        ? null
        : compositeKey(["label", observation.label]);
    const flag = (name: string) => {
      const value = observation.properties[name];
      return typeof value === "boolean" ? value : null;
    };
    return compositeKey([
      specifier,
      facts.requestedPresent
        ? ["requested", [...facts.requested].sort(compareUnicodeCodePoints)]
        : ["requested-unknown"],
      facts.membersPresent
        ? ["members", [...facts.members].sort(compareUnicodeCodePoints)]
        : ["members-unknown"],
      facts.label,
      flag("namespace_access"),
      flag("dynamic_member_access"),
    ]);
  });
  if (keys.some((key) => key === null)) return null;
  const unique = new Set(keys);
  return unique.size === 1 ? keys[0]! : null;
};
