import { expect, it } from "vitest";

import {
  compareTestSelection,
  planTestSelection,
} from "../../scripts/ci/test-selection.mjs";

const sqliteSource = "src/sqlite/SqliteDatabaseProvider.test.ts";
const sqliteBoundary = "tests/boundary/sqlite/sqliteDatabaseProvider.test.ts";
const adbSource = "src/adb/AdbProvider.test.ts";
const adbBoundary =
  "tests/boundary/providers/adb/adbBugreportPublication.test.ts";
const cliBoundary = "tests/boundary/cli/apktoolCli.test.ts";
const mcpBoundary = "tests/boundary/mcp/apktoolMcp.test.ts";
const processBoundary =
  "tests/boundary/process/processCaptureLifecycle.test.ts";
const acceptance = "tests/acceptance/tools/localToolContracts.test.ts";
const composition = "tests/composition/directAnalysisCleanup.test.ts";
const evaluation = "tests/evaluation/testDiscovery.test.ts";

const passed = (name: string) => ({ name, durationMs: 10, state: "passed" });

it("unions affected leaf owners, keeps changed tests and retains unowned integration tests", () => {
  const plan = planTestSelection(
    ["src/sqlite/SqliteDatabaseProvider.ts", adbBoundary],
    "pull_request",
    "fast",
  );
  const inventory = [
    sqliteSource,
    sqliteBoundary,
    adbSource,
    adbBoundary,
    cliBoundary,
    mcpBoundary,
    processBoundary,
    acceptance,
    composition,
    evaluation,
  ];
  const report = compareTestSelection(plan, inventory, inventory.map(passed));

  expect(plan).toMatchObject({
    mode: "candidate",
    owners: ["adb", "sqlite"],
  });
  expect(report.selected).toEqual(
    expect.arrayContaining([
      sqliteSource,
      sqliteBoundary,
      adbSource,
      adbBoundary,
      cliBoundary,
      mcpBoundary,
      processBoundary,
      acceptance,
      composition,
      evaluation,
    ]),
  );
  expect(report.omitted).toEqual([]);
});

it("omits only unrelated owned tests while retaining dynamic boundary suites", () => {
  const plan = planTestSelection(
    ["src/sqlite/SqliteDatabaseProvider.ts"],
    "pull_request",
    "fast",
  );
  const inventory = [
    sqliteSource,
    sqliteBoundary,
    adbSource,
    adbBoundary,
    cliBoundary,
    mcpBoundary,
    processBoundary,
    acceptance,
    composition,
    evaluation,
  ];
  const report = compareTestSelection(plan, inventory, inventory.map(passed));

  expect(report.selected).toEqual(
    expect.arrayContaining([
      sqliteSource,
      sqliteBoundary,
      cliBoundary,
      mcpBoundary,
      processBoundary,
      acceptance,
      composition,
      evaluation,
    ]),
  );
  expect(report.omitted).toEqual([adbSource, adbBoundary]);
  expect(report.complete).toBe(true);
});

it.each([
  ["unowned shared source", "src/application/Workflow.ts"],
  ["fixture input", "tests/conformance/c/fixture.c"],
  ["configuration", "vitest.config.ts"],
  ["documentation", "README.md"],
  ["CLI implementation", "src/cli/apktoolCommands.ts"],
  ["MCP implementation", "src/server/registerSqliteTools.ts"],
  ["process ownership", "src/process/ProcessOwnership.ts"],
  ["acceptance test", acceptance],
  ["composition test", composition],
])("uses full fallback for %s changes", (_description, path) => {
  expect(planTestSelection([path], "pull_request", "fast")).toMatchObject({
    mode: "full",
    owners: [],
    changedTests: [],
  });
});

it("uses full fallback outside ordinary fast pull requests or without diff paths", () => {
  expect(
    planTestSelection(["src/sqlite/SqliteDatabaseProvider.ts"], "push", "fast")
      .mode,
  ).toBe("full");
  expect(
    planTestSelection(
      ["src/sqlite/SqliteDatabaseProvider.ts"],
      "pull_request",
      "full",
    ).mode,
  ).toBe("full");
  expect(planTestSelection([], "pull_request", "fast").mode).toBe("full");
});

it("keeps new changed tests and falls back when a changed test was removed", () => {
  const addedTest = "src/sqlite/NewDatabaseRule.test.ts";
  const candidate = planTestSelection([addedTest], "pull_request", "fast");
  expect(candidate.changedTests).toEqual([addedTest]);
  const inventory = [addedTest, adbSource];
  expect(
    compareTestSelection(candidate, inventory, inventory.map(passed)).selected,
  ).toContain(addedTest);

  const removedTest = "src/sqlite/RemovedDatabaseRule.test.ts";
  const report = compareTestSelection(
    planTestSelection([removedTest], "pull_request", "fast"),
    [sqliteSource, adbSource],
    [passed(sqliteSource), passed(adbSource)],
  );
  expect(report.plan.mode).toBe("full");
  expect(report.selected).toEqual([adbSource, sqliteSource]);
  expect(report.omitted).toEqual([]);
});

it("marks incomplete inventories and nonterminal outcomes as incomplete", () => {
  const plan = planTestSelection(
    ["src/sqlite/SqliteDatabaseProvider.ts"],
    "pull_request",
    "fast",
  );
  const inventory = [sqliteSource, adbSource];
  const completeResults = inventory.map(passed);

  expect(
    compareTestSelection(plan, inventory, [passed(sqliteSource)]).complete,
  ).toBe(false);
  expect(
    compareTestSelection(plan, inventory, [
      ...completeResults,
      passed("tests/evaluation/unexpected.test.ts"),
    ]),
  ).toMatchObject({
    complete: false,
    unexpected: ["tests/evaluation/unexpected.test.ts"],
  });
  expect(
    compareTestSelection(plan, inventory, [
      ...completeResults,
      passed(adbSource),
    ]),
  ).toMatchObject({ complete: false, duplicateFiles: 1 });
  for (const state of ["pending", "skipped"])
    expect(
      compareTestSelection(plan, inventory, [
        passed(sqliteSource),
        { name: adbSource, durationMs: 0, state },
      ]),
    ).toMatchObject({ complete: false, unobserved: [adbSource] });
});

it("reports a failure from an omitted test, including collection or module failures", () => {
  const plan = planTestSelection(
    ["src/sqlite/SqliteDatabaseProvider.ts"],
    "pull_request",
    "fast",
  );
  const report = compareTestSelection(
    plan,
    [sqliteSource, adbSource],
    [passed(sqliteSource), { name: adbSource, durationMs: 1, state: "failed" }],
  );

  expect(report.omitted).toContain(adbSource);
  expect(report.missedFailures).toEqual([adbSource]);
});

it("rejects plans that name unowned owners or malformed changed tests", () => {
  const plan = planTestSelection(
    ["src/sqlite/SqliteDatabaseProvider.ts"],
    "pull_request",
    "fast",
  );
  expect(() =>
    compareTestSelection(
      { ...plan, owners: ["unknown"] },
      [sqliteSource],
      [passed(sqliteSource)],
    ),
  ).toThrow("Invalid observational test selection plan");
  expect(() =>
    compareTestSelection(
      { ...plan, changedTests: ["src/sqlite/not-a-test.ts"] },
      [sqliteSource],
      [passed(sqliteSource)],
    ),
  ).toThrow("Invalid observational test selection plan");
});

it("uses full fallback when a changed owner has no executable tests", () => {
  const report = compareTestSelection(
    planTestSelection(
      ["src/sqlite/SqliteDatabaseProvider.ts"],
      "pull_request",
      "fast",
    ),
    [adbSource],
    [passed(adbSource)],
  );

  expect(report.plan.mode).toBe("full");
  expect(report.omitted).toEqual([]);
});
