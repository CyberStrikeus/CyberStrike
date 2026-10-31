import { digestCanonicalValue } from "./canonicalDigest.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";

import {
  BROWSER_SCENARIO_BUILT_IN_NORMALIZATION_RULES,
  type BrowserScenarioArtifactKind,
  type BrowserScenarioDiff,
  type BrowserScenarioNormalization,
  type BrowserScenarioNormalizationRule,
} from "./browserScenarioDiffValues.js";

/** Canonically order and commit a parsed browser scenario normalization policy. */
export const commitBrowserScenarioNormalization = (
  input: BrowserScenarioNormalization,
): BrowserScenarioDiff["normalization"] => {
  const rules = [...input.rules]
    .map((rule) => ({
      ...rule,
      artifacts: [...rule.artifacts].sort(),
    }))
    .sort((left, right) =>
      left.rule_id < right.rule_id ? -1 : left.rule_id > right.rule_id ? 1 : 0,
    );
  const commitment = {
    built_in_rules: [...BROWSER_SCENARIO_BUILT_IN_NORMALIZATION_RULES],
    rules,
  };
  return {
    ...commitment,
    sha256: digestCanonicalValue(commitment, "Browser scenario"),
  };
};

/** Digest one artifact after applying committed exact-literal rules, then any artifact ordering. */
export const digestNormalizedScenarioValue = (
  value: unknown,
  artifact: BrowserScenarioArtifactKind,
  rules: readonly BrowserScenarioNormalizationRule[],
  order: (normalized: unknown) => unknown = (normalized) => normalized,
): string =>
  digestCanonicalValue(
    order(normalizeScenarioValue(value, artifact, rules)),
    "Browser scenario",
  );

export const normalizeScenarioValue = (
  value: unknown,
  artifact: BrowserScenarioArtifactKind,
  rules: readonly BrowserScenarioNormalizationRule[],
): unknown => {
  if (artifact === "screenshot") return value;
  if (typeof value === "string")
    return rules
      .filter(({ artifacts }) => artifacts.includes(artifact))
      .reduce(
        (normalized, rule) =>
          normalized.split(rule.match).join(rule.replacement),
        value,
      );
  if (Array.isArray(value)) {
    const normalized = value.map((item) =>
      normalizeScenarioValue(item, artifact, rules),
    );
    // Storage arrays are inventories, not ordered events. Sort complete entries
    // after literal rules; names alone can collide after redaction/normalization.
    // Keep multiplicity and every cookie attribute or value fingerprint.
    return artifact === "storage"
      ? normalized.sort(compareStorageEntries)
      : normalized;
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      normalizeScenarioValue(item, artifact, rules),
    ]),
  );
};

/** Compare parsed storage records by their fixed fields without serializing them. */
const compareStorageEntries = (left: unknown, right: unknown): number => {
  if (!isStorageRecord(left) || !isStorageRecord(right))
    return compareUnicodeCodePoints(
      digestCanonicalValue(left, "Browser scenario"),
      digestCanonicalValue(right, "Browser scenario"),
    );
  const fields =
    Object.hasOwn(left, "domain") || Object.hasOwn(right, "domain")
      ? [
          "domain",
          "http_only",
          "name",
          "path",
          "same_site",
          "secure",
          "value_sha256",
          "value_state",
        ]
      : ["name", "value_sha256", "value_state"];
  for (const field of fields) {
    const compared = compareStorageField(left[field], right[field]);
    if (compared !== 0) return compared;
  }
  return 0;
};

const isStorageRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const compareStorageField = (left: unknown, right: unknown): number => {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === "string" && typeof right === "string")
    return compareUnicodeCodePoints(left, right);
  if (typeof left === "boolean" && typeof right === "boolean")
    return left ? 1 : -1;
  return compareUnicodeCodePoints(String(left), String(right));
};
