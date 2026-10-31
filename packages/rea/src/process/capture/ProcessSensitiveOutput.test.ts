import { expect, it } from "vitest";
import {
  processScenarioSchema,
  processComparisonContract,
  processScenarioCommitment,
} from "../../domain/process/processScenario.js";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { createProcessSensitiveOutput } from "./ProcessSensitiveOutput.js";

const matcher = (...values: string[]) => {
  const result = createProcessSensitiveOutput(
    processScenarioSchema.parse({
      executable: "unused",
      events: values.map((data) => ({
        type: "input",
        at_ms: 0,
        data,
        sensitive: true,
      })),
    }),
  );
  if (!result.ok) throw result.error;
  if (result.value === undefined) throw new Error("Expected private literals");
  return result.value;
};

it.each([
  [["abc"], ["public:a", "b", "c:tail"], ["public:", "", ":tail"]],
  [["aba", "bab"], ["ababa!"], ["!"]],
  [["界🙂"], ["界", "🙂!"], ["", "!"]],
  [["alpha\r\nbeta\r"], ["alpha\r\nbeta\r\npublic"], ["\r\n\r\npublic"]],
  [["secret"], ["se\u001b[31mcr", "et\u001b[0m!"], ["", "\u001b[0m!"]],
  [["secret"], ["se\u001b]0;ignored title\u0007cret!"], ["!"]],
  [["redacted", "pass"], ["public:redacted!pass"], ["public:!"]],
  [["abc", "x"], ["axbc"], [""]],
] as const)(
  "projects literals %j without expanding chunks",
  (values, parts, expected) => {
    const result = matcher(...values).project(parts);
    expect(result).toEqual({ ok: true, value: expected });
  },
);

it("withholds incomplete trailing echoes and newly joined prefixes", () => {
  expect(matcher("secret").project(["public:sec"], true)).toEqual({
    ok: true,
    value: ["public:"],
  });
  expect(matcher("secret").project(["secsecret"], true)).toEqual({
    ok: true,
    value: [""],
  });
});

it("preserves unmarked input and empty private events without creating a matcher", () => {
  for (const event of [
    { sensitive: false, data: "secret" },
    { sensitive: true, data: "\r\n" },
  ]) {
    expect(
      createProcessSensitiveOutput(
        processScenarioSchema.parse({
          executable: "unused",
          events: [{ type: "input", at_ms: 0, ...event }],
        }),
      ),
    ).toEqual({ ok: true, value: undefined });
  }
});

it("rejects matcher and projection capacity before an oversized index allocation", () => {
  expect(() => matcher("x".repeat(65_536))).toThrow(
    AnalysisResourceConstraintError,
  );
  const privateOutput = matcher("secret");
  const projected = privateOutput.project(["p".repeat(8_388_608)]);
  if (projected.ok) throw new Error("Expected bounded projection refusal");
  expect(projected.error).toBeInstanceOf(AnalysisResourceConstraintError);
  expect(projected.error).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    resource: "capacity",
    retryable: false,
    reportedLimits: {
      boundary: "terminal-sensitive-input",
      limit: "projection_index_bytes",
      maximum: 33_554_432,
    },
  });
  expect(privateOutput.project(["small"])).toEqual(projected);
});

it("commits precise private facts and separates legacy comparison policy", () => {
  const scenario = processScenarioSchema.parse({
    executable: "unused",
    events: [{ type: "input", at_ms: 0, data: "redacted\r", sensitive: true }],
  });
  expect(processScenarioCommitment(scenario)["events"]).toEqual([
    { type: "input", at_ms: 0, data: "", sensitive: true, input_bytes: 9 },
  ]);
  expect(processComparisonContract(scenario)).toMatchObject({
    sensitive_input_redaction_version: "literal-terminal-input-v1",
  });
  expect(processComparisonContract(scenario)["events"]).toEqual([
    { type: "input", at_ms: 0, data: "", sensitive: true },
  ]);
});
