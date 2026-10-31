import { expect, it } from "vitest";
import { z } from "zod";
import { Ajv2020 } from "ajv/dist/2020.js";

import { SESSION_TOOL_CONTRACTS } from "../../contracts/sessionToolContracts.js";
import { projectInputIssues } from "../inputIssueProjection.js";
import { nativeCallObservationInputSchema } from "../native/nativeCallObservation.js";
import {
  digestProcessCommitment,
  PROCESS_TERMINAL_CELL_BUDGET,
  processComparisonContract,
  processScenarioCommitment,
  processScenarioSchema,
} from "./processScenario.js";

const baseScenario = { executable: "/usr/bin/true" };

it("advertises the same unsupported PTY environment name as runtime admission", () => {
  const schema = z.toJSONSchema(processScenarioSchema.shape.environment, {
    io: "input",
  });
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(schema);
  expect(validate(Object.fromEntries([["__proto__", "selected"]]))).toBe(false);
  expect(
    validate({
      constructor: "ordinary",
      prototype: "ordinary",
      NORMAL_CAPTURE_KEY: "control",
    }),
  ).toBe(true);
  expect(validate({ REA_PROCESS_RUN_ID: "reserved" })).toBe(false);
});

it("defaults the finalization interval to zero without changing committed identity", () => {
  const scenario = processScenarioSchema.parse(baseScenario);

  expect(scenario, "parsed scenario carries the default").toMatchObject({
    finalization_ms: 0,
  });
  expect(
    Object.hasOwn(processScenarioCommitment(scenario), "finalization_ms"),
    "full scenario commitment omits a zero interval",
  ).toBe(false);
  expect(
    Object.hasOwn(processComparisonContract(scenario), "finalization_ms"),
    "comparison contract omits a zero interval",
  ).toBe(false);
});

it("accepts an explicit zero finalization interval", () => {
  expect(
    processScenarioSchema.parse({ ...baseScenario, finalization_ms: 0 }),
    "zero is the immediate-kill default, not an invalid budget",
  ).toMatchObject({ finalization_ms: 0 });
});

it("commits a positive finalization interval in both identity projections", () => {
  const scenario = processScenarioSchema.parse({
    ...baseScenario,
    finalization_ms: 500,
  });

  expect(
    processScenarioCommitment(scenario),
    "full scenario commitment records the interval",
  ).toMatchObject({ finalization_ms: 500 });
  expect(
    processComparisonContract(scenario),
    "comparison contract records the interval",
  ).toMatchObject({ finalization_ms: 500 });
});

it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects the finalization interval %j",
  (finalization_ms) => {
    expect(() =>
      processScenarioSchema.parse({ ...baseScenario, finalization_ms }),
    ).toThrow();
  },
);

it("accepts a combined lifecycle budget up to the safe-integer limit", () => {
  const limit = Number.MAX_SAFE_INTEGER;
  const accepted = processScenarioSchema.parse({
    ...baseScenario,
    timeout_ms: limit - 100,
    idle_timeout_ms: 1,
    settle_ms: 90,
    finalization_ms: 10,
  });

  expect(
    accepted.timeout_ms + accepted.finalization_ms + accepted.settle_ms,
    "a total exactly at the representable limit is accepted",
  ).toBe(limit);
  expect(
    processScenarioSchema.parse(baseScenario),
    "the default scenario stays far below the limit",
  ).toMatchObject({ timeout_ms: 30_000, settle_ms: 100, finalization_ms: 0 });
});

it.each([
  ["timeout alone over the sum", { timeout_ms: Number.MAX_SAFE_INTEGER }],
  [
    "components that only overflow together",
    {
      timeout_ms: Number.MAX_SAFE_INTEGER - 10,
      settle_ms: 6,
      finalization_ms: 5,
    },
  ],
  [
    "a large settle and finalization",
    {
      timeout_ms: 5,
      settle_ms: Number.MAX_SAFE_INTEGER,
      finalization_ms: 1,
    },
  ],
])("rejects %s with a representability message", (_label, budget) => {
  const parse = () =>
    processScenarioSchema.parse({
      ...baseScenario,
      idle_timeout_ms: 1,
      ...budget,
    });

  expect(parse, "the combined budget is rejected").toThrow(
    "timeout_ms + finalization_ms + settle_ms",
  );
  expect(parse, "the message names the representability limit").toThrow(
    "exactly representable",
  );
});

it("keeps scenario identity without finalization while versioning corrected port semantics", () => {
  const scenario = processScenarioSchema.parse({
    executable: "/usr/bin/true",
    arguments: ["-x"],
    working_directory: "/tmp",
    environment: { A: "b" },
    filesystem_observation_paths: ["/tmp"],
    timeout_ms: 5_000,
    idle_timeout_ms: 2_000,
    settle_ms: 50,
  });

  // Digests computed from the compiled base commit before finalization_ms existed.
  expect(
    digestProcessCommitment(processScenarioCommitment(scenario)),
    "the full scenario commitment is unchanged",
  ).toBe("b50005d26269bd1db4a49c79e05bca67c3a18d837b45cd1c8ff591c01eb7623a");
  const comparison = processComparisonContract(scenario);
  expect(comparison.port_normalization_version).toBe("contextual-endpoints-v3");
  const {
    pid_normalization_version: pidVersion,
    terminal_observation_version: terminalVersion,
    ...rootOnlyComparison
  } = comparison;
  expect(terminalVersion).toBe("deferred-rendered-journal-v1");
  expect(pidVersion).toBe("sampled-identifiers-v2");
  expect(
    digestProcessCommitment({
      ...rootOnlyComparison,
      port_normalization_version: "contextual-endpoints-v2",
    }),
    "the earlier comparison contract had no finalization field",
  ).toBe("675b759347a737a4f1cbfbf2fc759258d9c877216513f2f4dad3ed1e9e6e7631");
  expect(
    digestProcessCommitment(rootOnlyComparison),
    "corrected endpoint normalization has its own comparison commitment",
  ).toBe("301f70ed68bd81b67d07c88b44c85ed0cf7d583967d2f769e2cb193d4db61c20");
  expect(digestProcessCommitment(comparison)).not.toBe(
    digestProcessCommitment(rootOnlyComparison),
  );
});

it("admits the default and the exact combined terminal-cell budget", () => {
  expect(
    processScenarioSchema.parse({ executable: "/bin/true" }).terminal,
  ).toEqual({
    columns: 80,
    rows: 24,
    scrollback: 1_000,
  });

  expect(
    processScenarioSchema.safeParse({
      executable: "/bin/true",
      terminal: {
        columns: 2,
        rows: 1,
        scrollback: PROCESS_TERMINAL_CELL_BUDGET / 2 - 1,
      },
    }).success,
  ).toBe(true);
});

it("tells the agent the terminal cell budget has no runtime override", () => {
  const description = SESSION_TOOL_CONTRACTS.find(
    (tool) => tool.name === "capture_process_scenario",
  )?.description;
  expect(PROCESS_TERMINAL_CELL_BUDGET).toBe(1_000_000);
  expect(description).toContain("1,000,000 combined terminal cells");
  expect(description).toContain(
    "This release has no runtime override for that cell budget.",
  );
  expect(processScenarioSchema.shape.terminal.unwrap().description).toContain(
    "This release has no runtime override.",
  );
});

it("rejects an oversized initial buffer without clamping caller dimensions", () => {
  const input = {
    executable: "/bin/true",
    terminal: { columns: 1_000, rows: 1, scrollback: 1_000 },
  };
  const parsed = processScenarioSchema.safeParse(input);

  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error("expected terminal capacity rejection");
  expect(parsed.error.issues).toContainEqual(
    expect.objectContaining({
      code: "custom",
      path: ["terminal"],
      message: expect.stringContaining(
        `${String(PROCESS_TERMINAL_CELL_BUDGET)} renderer cells. This release has no runtime override.`,
      ),
    }),
  );
});

it("applies the selected scrollback budget to every scheduled resize", () => {
  const parsed = processScenarioSchema.safeParse({
    executable: "/bin/true",
    events: [{ type: "resize", at_ms: 10, columns: 1_000, rows: 1 }],
  });

  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error("expected resize capacity rejection");
  expect(parsed.error.issues).toContainEqual(
    expect.objectContaining({
      code: "custom",
      path: ["events", 0],
      message: expect.stringContaining("resize event at 10 ms"),
    }),
  );

  expect(
    processScenarioSchema.safeParse({
      executable: "/bin/true",
      terminal: { columns: 2, rows: 1, scrollback: 0 },
      events: [{ type: "resize", at_ms: 10, columns: 1_000, rows: 1 }],
    }).success,
  ).toBe(true);
});

it("identifies each event scheduled after the scenario timeout", () => {
  const parsed = processScenarioSchema.safeParse({
    executable: "/bin/true",
    timeout_ms: 1_000,
    events: [
      { type: "input", at_ms: 1_000, data: "a" },
      { type: "input", at_ms: 1_500, data: "b" },
      { type: "signal", at_ms: 2_000, signal: "SIGINT" },
    ],
  });

  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error("expected late event rejection");
  expect(parsed.error.issues).toEqual([
    expect.objectContaining({
      code: "custom",
      path: ["events", 1],
      message: "event at 1500 ms occurs after the 1000 ms scenario timeout",
    }),
    expect.objectContaining({
      code: "custom",
      path: ["events", 2],
      message: "event at 2000 ms occurs after the 1000 ms scenario timeout",
    }),
  ]);
});

it.each(["selected-value", 7])(
  "rejects a selected __proto__ PTY environment value instead of omitting %j",
  (value) => {
    const environment = Object.fromEntries([
      ["__proto__", value],
      ["NORMAL_CAPTURE_KEY", "control"],
    ]);
    const parsed = processScenarioSchema.safeParse({
      ...baseScenario,
      environment,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success)
      throw new Error("Expected the unsupported PTY name to be rejected");
    expect(
      projectInputIssues(parsed.error.issues, { ...baseScenario, environment }),
    ).toContainEqual(
      expect.objectContaining({
        path: ["environment", "__proto__"],
        message: expect.stringContaining("PTY backend cannot preserve"),
      }),
    );
  },
);

it("keeps native and PTY environment admission distinct through Standard Schema export", () => {
  const environment = Object.fromEntries([
    ["__proto__", "selected"],
    ["constructor", "ordinary"],
  ]);
  const native = nativeCallObservationInputSchema.shape.environment;
  const parsed = native.parse(environment);
  expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
  expect(JSON.stringify(parsed)).toBe(JSON.stringify(environment));
  const ajv = new Ajv2020({ strict: false });
  const options = { target: "draft-2020-12" as const };
  const nativePublished = native["~standard"].jsonSchema.input(options);
  const ptyPublished =
    processScenarioSchema.shape.environment["~standard"].jsonSchema.input(
      options,
    );
  expect(ajv.compile(nativePublished)(environment)).toBe(true);
  expect(ajv.compile(ptyPublished)(environment)).toBe(false);
});
