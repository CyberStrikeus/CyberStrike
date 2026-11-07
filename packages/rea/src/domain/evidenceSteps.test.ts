import { describe, expect, it } from "vitest";
import { createAnalysisProfile } from "./analysisProfile.js";
import {
  createEvidence,
  createImmutableEvidenceSteps,
  isImmutableEvidence,
  parseEvidence,
} from "./evidence.js";
import { freezeJsonSnapshot } from "./immutableJson.js";
import {
  jsonValueValidationSteps,
  MAX_JSON_DEPTH,
  type JsonValue,
} from "./jsonValue.js";

const provider = {
  id: "cooperative",
  name: "Cooperative fixture",
  version: "1",
};
const target = {
  path: "/artifact",
  sha256: "a".repeat(64),
  format: "file",
} as const;

const finish = <Value>(steps: Iterator<void, Value, void>): Value => {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
};

describe("cooperative immutable Evidence", () => {
  it.each([false, true])(
    "preserves the complete envelope and identifier (profile: %s)",
    (profiled) => {
      const result = freezeJsonSnapshot({
        ["__proto__"]: { preserved: [1, "\ud800", "😀", null] },
        constructor: "ordinary member",
        long: 'quote"\\\n😀'.repeat(5000),
      });
      const observation = {
        operation: "inspect",
        parameters: { ["__proto__"]: "caller-selected" },
        result,
        rawResult: { retained: true },
        ...(profiled
          ? { analysisProfile: createAnalysisProfile(provider, {}) }
          : {}),
      };
      const ordinary = createEvidence(target, provider, observation);
      const cooperative = finish(
        createImmutableEvidenceSteps(target, provider, observation),
      );
      expect(JSON.stringify(cooperative)).toBe(JSON.stringify(ordinary));
      expect(cooperative.normalized_result).toBe(result);
      expect(isImmutableEvidence(cooperative)).toBe(true);
      expect(parseEvidence(cooperative)).toBe(cooperative);
      expect(parseEvidence(JSON.parse(JSON.stringify(cooperative)))).toEqual(
        ordinary,
      );
    },
  );

  it("retains scalar results and unavailable-subject limitations", () => {
    const observation = { operation: "inspect", parameters: {}, result: null };
    expect(
      finish(createImmutableEvidenceSteps(undefined, provider, observation)),
    ).toEqual(createEvidence(undefined, provider, observation));
  });

  it("rejects mutable results and mismatched producer profiles", () => {
    expect(() =>
      finish(
        createImmutableEvidenceSteps(target, provider, {
          operation: "inspect",
          parameters: {},
          result: { borrowed: true },
        }),
      ),
    ).toThrow("authenticated immutable result");
    expect(() =>
      finish(
        createImmutableEvidenceSteps(target, provider, {
          operation: "inspect",
          parameters: {},
          result: freezeJsonSnapshot({ value: true }),
          analysisProfile: createAnalysisProfile(
            { ...provider, id: "different" },
            {},
          ),
        }),
      ),
    ).toThrow("profile provider");
  });

  it("does not cache an interrupted depth validation as successful", () => {
    let nested: JsonValue = 1;
    for (let index = 0; index <= MAX_JSON_DEPTH; index += 1)
      nested = { nested };
    // Enough members before the over-deep one that validation yields first.
    const result = freezeJsonSnapshot([
      ...Array<JsonValue>(5000).fill(null),
      nested,
    ]);
    const validation = jsonValueValidationSteps(result);
    expect(validation.next().done).toBe(false);
    validation.return(undefined);
    const observation = { operation: "inspect", parameters: {}, result };
    expect(() =>
      finish(createImmutableEvidenceSteps(target, provider, observation)),
    ).toThrow("maximum nesting depth");
    expect(() => createEvidence(target, provider, observation)).toThrow(
      "maximum nesting depth",
    );
  });
});
