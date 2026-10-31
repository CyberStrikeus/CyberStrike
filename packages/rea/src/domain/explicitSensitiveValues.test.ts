import { expect, it } from "vitest";
import { redactExplicitText } from "./explicitSensitiveValues.js";

it.each([
  ["secret context", ["secret"]],
  ["secret context", ["secret", "REDACTED"]],
  ["secret context", ["secret", "[", "…"]],
  ["secretable context", ["secret", "able", "table"]],
  ["secretsecret context", ["secret", "…", "REDACTED"]],
] as const)(
  "keeps declared literals out of replacement text: %s",
  (input, values) => {
    const result = redactExplicitText(input, values);
    for (const value of values) expect(result).not.toContain(value);
  },
);

it("does not guess sensitivity or treat empty declarations as matches", () => {
  expect(redactExplicitText("API_SECRET ordinary evidence", [""])).toBe(
    "API_SECRET ordinary evidence",
  );
});
