import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";

import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { planTestSelection } from "../../../scripts/ci/test-selection.mjs";

import { parseTestDurations } from "../../ciTestSequencer.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { workflowGit } from "../../support/workflowGit.js";

const execute = promisify(execFile);
const script = new URL("../../../scripts/ci/test-report.mjs", import.meta.url);

// Each report invocation owns its CI state and summary destination. Inherited
// workflow flags must not change fixture outcomes or append to the real job.
const executeTimingReport = async (
  root: string,
  environment: NodeJS.ProcessEnv = {},
) => {
  const summary = join(root, "summary.md");
  await writeFile(summary, "");
  const output = await execute(process.execPath, [fileURLToPath(script)], {
    cwd: root,
    env: {
      ...process.env,
      SHARD_RESULT: "success",
      MERGE_RESULT: "success",
      SOURCE_REQUIRED: "false",
      SOURCE_RESULT: "",
      CI_VERIFY_TEST_INVENTORY: "false",
      CI_TEST_SELECTION: "",
      ...environment,
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  return { ...output, summary: await readFile(summary, "utf8") };
};

const stepsSchema = z.array(
  z.object({
    name: z.string().optional(),
    run: z.string().optional(),
    uses: z.string().optional(),
    if: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  }),
);
const workflow = async () =>
  z
    .object({
      jobs: z.object({
        test: z.object({ steps: stepsSchema }),
        build: z.object({ steps: stepsSchema }),
        docs: z.object({ steps: stepsSchema }),
        python: z.object({ if: z.string(), steps: stepsSchema }),
        static: z.object({ steps: stepsSchema }),
        "static-deep": z.object({
          if: z.string(),
          steps: stepsSchema,
        }),
      }),
    })
    .parse(
      parse(
        await readFile(
          new URL("../../../.github/workflows/ci.yml", import.meta.url),
          "utf8",
        ),
      ),
    ).jobs;

it("merges available failed-shard diagnostics and skips unavailable shard reports", async () => {
  const steps = (await workflow()).test!.steps;
  const download = steps.find(
    (step) => step.with?.pattern === "vitest-report-*",
  );
  const merge = steps.findIndex((step) => step.run?.includes("test:ci:merge"));
  const upload = steps.findIndex((step) => step.with?.name === "test-results");
  const gate = steps.findIndex(
    (step) => step.env?.SHARD_RESULT && step.run?.includes("test "),
  );
  expect(merge).toBeGreaterThan(0);
  expect(download?.if).toContain("!cancelled()");

  expect(upload).toBeGreaterThan(merge);
  expect(gate).toBeGreaterThan(upload);
  const merges = steps.filter((step) => step.run?.includes("--reporter=json"));
  expect(merges).toHaveLength(2);
  for (const step of merges) {
    expect(step.run).toContain(
      "--reporter=./scripts/ci/test-timing-reporter.mjs",
    );
    expect(step.if).toContain("!cancelled()");
  }
  expect(steps[upload]?.with?.path).toContain("test-timings.json");
  expect(steps[upload]?.with).toMatchObject({ "include-hidden-files": true });
  expect(steps[upload]?.with?.path).toContain(
    ".cache/ci-test-selection/report.json",
  );
  const summary = steps.find((step) =>
    step.run?.includes("scripts/ci/test-report.mjs"),
  );
  expect(summary?.env?.CI_TEST_SELECTION).toBe(
    "${{ needs.changes.outputs.test_selection }}",
  );
  const command = steps[gate]?.run;
  if (command === undefined) throw new Error("Missing shard result gate");
  for (const tier of ["fast", "full"]) {
    for (const shard of ["success", "failure", "cancelled", "skipped", ""]) {
      for (const source of ["success", "failure", "cancelled", "skipped", ""]) {
        const check = execute("bash", ["-c", command], {
          env: {
            ...process.env,
            CODE_REQUIRED: "true",
            SHARD_RESULT: shard,
            SOURCE_REQUIRED: String(tier === "fast"),
            SOURCE_RESULT: source,
          },
        });
        if (shard === "success" && (tier !== "fast" || source === "success"))
          await expect(check).resolves.toMatchObject({ stderr: "" });
        else await expect(check).rejects.toMatchObject({ code: 1 });
      }
    }
  }
  await expect(
    execute("bash", ["-c", command], {
      env: { ...process.env, CODE_REQUIRED: "false", SHARD_RESULT: "skipped" },
    }),
  ).resolves.toMatchObject({ stderr: "" });
});

// These workflow conditions use the shared boolean/string expression subset.
// Evaluate the checked-in expressions so failure-state coverage cannot drift
// into a separate test implementation of the collection policy.
function conditionValue(
  condition: string | undefined,
  needs: Record<string, unknown>,
  canceled: boolean,
  timingReportExists = false,
) {
  if (!condition) throw new Error("Missing report collection condition");
  return runInNewContext(
    condition
      .replaceAll("needs.test-shard", 'needs["test-shard"]')
      .replaceAll("needs.test-source", 'needs["test-source"]'),
    {
      needs,
      cancelled: () => canceled,
      hashFiles: () => (timingReportExists ? "timing-report" : ""),
    },
    { timeout: 1_000 },
  );
}

it("collects either fast test group while keeping full reports tied to full shards", async () => {
  const steps = (await workflow()).test.steps;
  const download = steps.find(
    (step) => step.with?.pattern === "vitest-report-*",
  );
  const fast = steps.find(
    (step) => step.name === "Merge fast-suite JUnit and timing reports",
  );
  const full = steps.find(
    (step) => step.name === "Merge coverage, JUnit, and timing reports",
  );
  for (const tier of ["fast", "full"]) {
    for (const shard of ["success", "failure", "cancelled", "skipped", ""]) {
      for (const source of ["success", "failure", "cancelled", "skipped", ""]) {
        for (const [code, canceled] of [
          ["true", false],
          ["true", true],
          ["false", false],
          ["false", true],
        ] as const) {
          const needs = {
            changes: { outputs: { code, tier } },
            "test-shard": { result: shard },
            "test-source": { result: source },
          };
          const builtAvailable = ["success", "failure"].includes(shard);
          const sourceAvailable = ["success", "failure"].includes(source);
          const enabled = code === "true" && !canceled;
          const available =
            builtAvailable || (tier === "fast" && sourceAvailable);
          const expected = enabled
            ? {
                download: available,
                fast: tier === "fast" && available,
                full: tier === "full" && builtAvailable,
              }
            : { download: false, fast: false, full: false };
          expect(conditionValue(download?.if, needs, canceled)).toBe(
            expected.download,
          );
          expect(conditionValue(fast?.if, needs, canceled)).toBe(expected.fast);
          expect(conditionValue(full?.if, needs, canceled)).toBe(expected.full);
        }
      }
    }
  }
  const summary = steps.find((step) =>
    step.run?.includes("scripts/ci/test-report.mjs"),
  );
  expect(summary?.env?.SHARD_RESULT).toBe("${{ needs.test-shard.result }}");
  expect(summary?.env?.SOURCE_RESULT).toBe("${{ needs.test-source.result }}");
  expect(summary?.env?.SOURCE_REQUIRED).toBe(
    "${{ needs.changes.outputs.tier == 'fast' }}",
  );
});

it("requires portable report validation even when the timing report is missing", async () => {
  const summary = (await workflow()).test.steps.find((step) =>
    step.run?.includes("scripts/ci/test-report.mjs"),
  );
  for (const tier of ["fast", "full"]) {
    for (const timingReportExists of [false, true]) {
      for (const code of ["true", "false"]) {
        for (const canceled of [false, true]) {
          expect(
            conditionValue(
              summary?.if,
              { changes: { outputs: { code, tier } } },
              canceled,
              timingReportExists,
            ),
          ).toBe(code === "true" && !canceled);
        }
      }
    }
  }
});

it("keeps diagnosis available after merge failure and publishes only complete successful history", async () => {
  const steps = (await workflow()).test!.steps;
  const diagnosis = steps.find((step) => step.with?.name === "test-results");
  expect(diagnosis?.if).toContain("!cancelled()");
  expect(diagnosis?.if).not.toContain("success()");
  const history = steps.find(
    (step) => step.name === "Publish successful timing history",
  );
  expect(history?.if).toContain("success()");
  expect(history?.if).toContain("needs.test-shard.result == 'success'");
  expect(history?.if).toContain("needs.changes.outputs.tier == 'full'");
  expect(history?.if).toContain(
    "needs.changes.outputs.tier == 'fast' && needs.test-source.result == 'success'",
  );
  expect(history?.if).toContain("github.event_name == 'push'");
  expect(history?.if).toContain(
    "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
  );
  expect(history?.with?.name).toBe(
    "test-timings-${{ needs.changes.outputs.tier }}",
  );
  expect(history?.with?.path).toBe(".cache/ci-test-history/test-results.json");
  const buildSteps = (await workflow()).build!.steps;
  const lookup = buildSteps.find((step) =>
    step.run?.includes("test-history.mjs"),
  );
  expect(lookup?.env).toMatchObject({
    CI_REPOSITORY: "${{ github.repository }}",
    CI_REPOSITORY_ID: "${{ github.repository_id }}",
    CI_DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}",
    CI_TIMING_TIER: "${{ needs.changes.outputs.tier }}",
  });
  const download = buildSteps.find(
    (step) => step.name === "Download previous timing report",
  );
  expect(download?.with?.name).toBe(
    "${{ steps.history.outputs.artifact-name }}",
  );
  expect(download?.with?.["run-id"]).toBe(
    "${{ steps.history.outputs.run-id }}",
  );
});

it("rejects successful shard reports with missing or duplicate portable files", async () => {
  const root = await createTestTempDirectory("rea-ci-report-inventory-");
  await workflowGit(root, ["init"]);
  await mkdir(join(root, "tests"));
  for (const name of ["first", "second"])
    await writeFile(join(root, `tests/${name}.test.ts`), "// fixture\n");
  await workflowGit(root, ["add", "tests"]);
  const run = async (names: readonly string[]) => {
    await writeFile(
      join(root, "test-timings.json"),
      JSON.stringify({
        version: 1,
        success: true,
        files: names.map((name) => ({ name, durationMs: 1 })),
      }),
    );
    return executeTimingReport(root, {
      CI_VERIFY_TEST_INVENTORY: "true",
    });
  };
  await expect(
    run(["tests/first.test.ts", "tests/second.test.ts"]),
  ).resolves.toMatchObject({ stderr: "" });
  for (const names of [
    ["tests/first.test.ts"],
    ["tests/first.test.ts", "tests/second.test.ts", "tests/unplanned.test.ts"],
    ["tests/first.test.ts", "tests/first.test.ts", "tests/second.test.ts"],
  ]) {
    await expect(run(names)).rejects.toMatchObject({
      stderr: expect.stringContaining("Incomplete portable test inventory"),
    });
    await expect(
      readFile(join(root, ".cache/ci-test-history/test-results.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }
  await run(["tests/first.test.ts", "tests/second.test.ts"]);
  await rm(join(root, "test-timings.json"));
  await expect(
    executeTimingReport(root, { CI_VERIFY_TEST_INVENTORY: "true" }),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("ENOENT"),
  });
  await expect(
    readFile(join(root, ".cache/ci-test-history/test-results.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });

  const empty = await createTestTempDirectory("rea-ci-report-empty-");
  await workflowGit(empty, ["init"]);
  await writeFile(
    join(empty, "test-timings.json"),
    JSON.stringify({ version: 1, success: true, files: [] }),
  );
  await expect(
    executeTimingReport(empty, { CI_VERIFY_TEST_INVENTORY: "true" }),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("No portable test modules were reported"),
  });
});

it("reports skipped modules without treating an entirely skipped suite as successful", async () => {
  const root = await createTestTempDirectory("rea-ci-report-skips-");
  await workflowGit(root, ["init"]);
  await mkdir(join(root, "tests"));
  for (const name of ["required", "platform"])
    await writeFile(join(root, `tests/${name}.test.ts`), "// fixture\n");
  await workflowGit(root, ["add", "tests"]);
  const run = async (requiredState: string) => {
    await writeFile(
      join(root, "test-timings.json"),
      JSON.stringify({
        version: 1,
        success: true,
        files: [
          {
            name: "tests/required.test.ts",
            durationMs: 1,
            state: requiredState,
          },
          { name: "tests/platform.test.ts", durationMs: 1, state: "skipped" },
        ],
      }),
    );
    return executeTimingReport(root, { CI_VERIFY_TEST_INVENTORY: "true" });
  };

  const mixed = await run("passed");
  expect(mixed.summary).toContain("Skipped test modules: 1");
  expect(mixed.summary).toContain("- tests/platform.test.ts");
  await expect(run("skipped")).rejects.toMatchObject({
    stderr: expect.stringContaining("Every portable test module was skipped"),
  });
  await expect(
    readFile(join(root, ".cache/ci-test-history/test-results.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("runs the existing onboarding and Python producer guards from their selected CI owners", async () => {
  const jobs = await workflow();
  const scripts = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(
      JSON.parse(
        await readFile(
          new URL("../../../package.json", import.meta.url),
          "utf8",
        ),
      ),
    ).scripts;
  expect(
    jobs.docs.steps.some((step) => step.run === "npm run docs:check"),
  ).toBe(true);
  expect(scripts["docs:check"]).toContain(
    "tests/conformance/readmeConsistency.test.ts",
  );
  expect(
    jobs.static.steps.some((step) => step.run === "npm run test:python"),
  ).toBe(false);
  expect(
    jobs.static.steps.some((step) => step.run === "npm run check:ci:fast"),
  ).toBe(true);
  const deep = jobs["static-deep"];
  expect(deep?.if).toBe(
    "needs.changes.outputs.tier == 'full' && needs.changes.outputs.code == 'true'",
  );
  expect(deep?.steps.some((step) => step.run === "npm run check:ci:deep")).toBe(
    true,
  );
  expect(scripts["check:ci:deep"]).toContain("npm run test:python");
  expect(scripts["check:ci:fast"]).toBe(
    "node scripts/run-exclusive.mjs artifacts npm run check:ci:fast:tasks",
  );
  expect(scripts["check:ci:fast:tasks"]).toBe(
    "node scripts/run-turbo.mjs run typecheck lint format:check",
  );
  expect(scripts["test:python"]).toBe("python3 scripts/run-python-tests.py");
  expect(jobs.python.if).toContain("outputs.python == 'true'");
  expect(jobs.python.if).toContain("tier == 'fast'");
  const downloadCache = jobs.python.steps.findIndex(
    (step) => step.uses === "./.github/actions/npm-cache",
  );
  const install = jobs.python.steps.findIndex((step) => step.run === "npm ci");
  const prepare = jobs.python.steps.findIndex(
    (step) => step.run === "npm run test:prepare",
  );
  const suite = jobs.python.steps.findIndex(
    (step) => step.run === "npm run test:python",
  );
  const cache = jobs.python.steps.findIndex(
    (step) => step.uses === "./.github/actions/portable-build-cache",
  );
  expect(downloadCache).toBeGreaterThanOrEqual(0);
  expect(install).toBeGreaterThan(downloadCache);
  expect(cache).toBeGreaterThan(install);
  expect(prepare).toBeGreaterThan(cache);
  expect(suite).toBeGreaterThan(prepare);
});

it("exports portable timing history and removes it on a failed, partial, or invalid rerun", async () => {
  const root = await createTestTempDirectory("rea-ci-report-");
  const summary = join(root, "summary.md");
  const history = join(root, ".cache/ci-test-history/test-results.json");
  const report = {
    version: 1,
    success: true,
    files: [
      {
        name: join(root, "tests/slow.test.ts"),
        durationMs: 100,
        phases: {
          execution: 20,
          preparation: 20,
          environment: 10,
          imports: 40,
          setup: 10,
        },
      },
      { name: join(root, "tests/fast.test.ts"), durationMs: 10 },
    ],
  };
  const run = async (
    value: unknown,
    shards = "success",
    merge = "success",
    source?: string,
  ) => {
    await writeFile(join(root, "test-timings.json"), JSON.stringify(value));
    return executeTimingReport(root, {
      SHARD_RESULT: shards,
      SOURCE_REQUIRED: String(source !== undefined),
      SOURCE_RESULT: source ?? "",
      MERGE_RESULT: merge,
    });
  };
  await run(report);
  const contents = await readFile(history, "utf8");
  expect(contents).not.toContain("phases");
  expect(contents).not.toContain("startTime");
  expect(contents).not.toContain(root);
  expect(
    parseTestDurations(contents, resolve(root, "different-checkout")),
  ).toEqual(
    new Map([
      ["tests/slow.test.ts", 100],
      ["tests/fast.test.ts", 10],
    ]),
  );
  for (const [value, shards, merge] of [
    [{ ...report, success: false }, "failure", "failure"],
    [report, "cancelled", "success"],
    [report, "success", "failure"],
  ] as const) {
    await run(report);
    await run(value, shards, merge);
    await expect(readFile(history)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(summary, "utf8")).toContain("diagnostic only");
  }
  await run(report, "success", "success", "success");
  expect(await readFile(history, "utf8")).toContain('"success":true');
  for (const [shards, source] of [
    ["skipped", "success"],
    ["success", "skipped"],
    ["success", "cancelled"],
    ["success", "failure"],
    ["success", ""],
  ]) {
    await run(report);
    await run(report, shards, "success", source);
    await expect(readFile(history)).rejects.toMatchObject({ code: "ENOENT" });
    const text = await readFile(summary, "utf8");
    expect(text).toContain(`Source result: ${source}.`);
    expect(text).toContain("diagnostic only");
    if (shards === "skipped" || source !== "failure")
      expect(text).toContain("Partial test diagnostics");
  }
  await run(report);
  await expect(
    run({
      ...report,
      files: [{ name: "../outside.test.ts", durationMs: 2 }],
    }),
  ).rejects.toMatchObject({ code: 1 });
  await expect(readFile(history)).rejects.toMatchObject({ code: "ENOENT" });
  await run(report);
  await expect(
    run({
      ...report,
      files: [{ name: "tests/invalid.test.ts", durationMs: -1 }],
    }),
  ).rejects.toMatchObject({ code: 1 });
  await expect(readFile(history)).rejects.toMatchObject({ code: "ENOENT" });
});

it("recovers complete module costs from real blob reports without executing tests again", async () => {
  const root = await createTestTempDirectory("rea-ci-module-timing-");
  const config = join(root, "vitest.config.mjs");
  await writeFile(
    config,
    'export default { test: { globals: true, include: ["sample.test.js"], maxWorkers: 1 } };',
  );
  await writeFile(
    join(root, "sample.test.js"),
    [
      'import { writeFileSync } from "node:fs";',
      "beforeAll(() => new Promise(resolve => setTimeout(resolve, 80)));",
      "afterAll(() => new Promise(resolve => setTimeout(resolve, 80)));",
      'it("has cheap assertions and expensive outer hooks", () => { writeFileSync("executed", "yes"); expect(1).toBe(1); });',
    ].join("\n"),
  );
  const vitest = fileURLToPath(
    new URL("../../../node_modules/vitest/vitest.mjs", import.meta.url),
  );
  const reporter = fileURLToPath(
    new URL("../../../scripts/ci/test-timing-reporter.mjs", import.meta.url),
  );
  const run = (args: string[]) =>
    execute(process.execPath, [vitest, ...args, "--config", config], {
      cwd: root,
      env: process.env,
      timeout: 20_000,
    });
  await run(["run", "--reporter=blob"]);
  expect(await readFile(join(root, "executed"), "utf8")).toBe("yes");
  await rm(join(root, "executed"));
  await run([
    "--merge-reports",
    `--reporter=${reporter}`,
    "--reporter=json",
    "--outputFile.json=body.json",
  ]);
  await expect(readFile(join(root, "executed"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const report = z
    .object({
      version: z.literal(1),
      success: z.literal(true),
      files: z.array(
        z.object({
          name: z.string(),
          durationMs: z.number(),
          phases: z.record(z.string(), z.number()),
        }),
      ),
    })
    .parse(JSON.parse(await readFile(join(root, "test-timings.json"), "utf8")));
  expect(
    JSON.parse(await readFile(join(root, "test-timings.json"), "utf8")),
  ).toMatchObject({
    reason: "passed",
    unhandledErrors: 0,
    files: [{ state: "passed" }],
  });
  expect(report.files).toHaveLength(1);
  const file = report.files[0]!;
  const json = z
    .object({
      testResults: z.array(
        z.object({ startTime: z.number(), endTime: z.number() }),
      ),
    })
    .parse(JSON.parse(await readFile(join(root, "body.json"), "utf8")));
  const body = json.testResults[0]!;
  expect(
    file.phases.execution! - (body.endTime - body.startTime),
  ).toBeGreaterThan(100);
  expect(file.phases.imports).toBeGreaterThan(0);
  expect(file.phases.preparation).toBeGreaterThan(0);
  expect(file.durationMs).toBeCloseTo(
    Object.values(file.phases).reduce((sum, value) => sum + value, 0),
  );
  const partial = await executeTimingReport(root, {
    SHARD_RESULT: "skipped",
    SOURCE_REQUIRED: "true",
    SOURCE_RESULT: "success",
  });
  expect(partial.summary).toContain("Partial test diagnostics");
  expect(partial.summary).toContain("sample.test.js");
  await expect(
    readFile(join(root, ".cache/ci-test-history/test-results.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await executeTimingReport(root);
  expect(
    parseTestDurations(
      await readFile(
        join(root, ".cache/ci-test-history/test-results.json"),
        "utf8",
      ),
      root,
    )?.get("sample.test.js"),
  ).toBe(file.durationMs);

  await writeFile(
    join(root, "sample.test.js"),
    'it("fails", () => { throw new Error("fixture failure"); });',
  );
  await expect(run(["run", "--reporter=blob"])).rejects.toMatchObject({
    code: 1,
  });
  await expect(
    run(["--merge-reports", `--reporter=${reporter}`]),
  ).rejects.toMatchObject({ code: 1 });
  const failed = JSON.parse(
    await readFile(join(root, "test-timings.json"), "utf8"),
  ) as unknown;
  expect(failed).toMatchObject({
    version: 1,
    success: false,
    reason: "failed",
    unhandledErrors: 0,
    files: [{ state: "failed" }],
  });
  // Even a caller accidentally marking the merge successful cannot publish this report.
  await executeTimingReport(root);
  await expect(
    readFile(join(root, ".cache/ci-test-history/test-results.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("records failed omissions from full reports without treating partial or unhandled outcomes as parity", async () => {
  const root = await createTestTempDirectory("rea-ci-selection-report-");
  await workflowGit(root, ["init"]);
  const paths = [
    "src/sqlite/provider.test.ts",
    "src/evm/provider.test.ts",
    "tests/boundary/mcp/workflow.test.ts",
  ];
  for (const path of paths) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), "// fixture\n");
  }
  await workflowGit(root, ["add", "src", "tests"]);
  const timing = {
    version: 1,
    success: false,
    reason: "failed",
    unhandledErrors: 0,
    files: paths.map((name, index) => ({
      name,
      durationMs: 10,
      state: index === 1 ? "failed" : "passed",
    })),
  };
  const run = async (report: unknown, source = "failure") => {
    await writeFile(join(root, "test-timings.json"), JSON.stringify(report));
    await executeTimingReport(root, {
      SHARD_RESULT: "failure",
      SOURCE_REQUIRED: "true",
      SOURCE_RESULT: source,
      MERGE_RESULT: "failure",
      CI_VERIFY_TEST_INVENTORY: "true",
      CI_TEST_SELECTION: JSON.stringify(
        planTestSelection(["src/sqlite/Provider.ts"], "pull_request", "fast"),
      ),
      GITHUB_SHA: "merge-sha",
      CI_PR_HEAD_SHA: "pr-head-sha",
    });
    return JSON.parse(
      await readFile(
        join(root, ".cache/ci-test-selection/report.json"),
        "utf8",
      ),
    ) as unknown;
  };
  expect(await run(timing)).toMatchObject({
    observational: true,
    complete: true,
    selected: [paths[0], paths[2]],
    omitted: [paths[1]],
    missedFailures: [paths[1]],
    executionSha: "merge-sha",
    prHeadSha: "pr-head-sha",
  });
  for (const report of [
    { ...timing, files: timing.files.slice(0, 1) },
    { ...timing, unhandledErrors: 1 },
    { ...timing, reason: "interrupted" },
  ])
    expect(await run(report)).toMatchObject({ complete: false });
  for (const source of ["skipped", "cancelled", ""])
    expect(await run(timing, source)).toMatchObject({ complete: false });
  await expect(run({ ...timing, files: "invalid" })).rejects.toMatchObject({
    code: 1,
  });
  await expect(
    readFile(join(root, ".cache/ci-test-selection/report.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    readFile(join(root, ".cache/ci-test-history/test-results.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("requires executed Python analysis-efficiency cases while allowing optional skips", async () => {
  const root = await createTestTempDirectory("rea-python-analysis-inventory-");
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(
    join(root, "scripts", "run-python-tests.py"),
    await readFile(
      new URL("../../../scripts/run-python-tests.py", import.meta.url),
    ),
  );
  const passing =
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self): pass\n";
  for (const family of ["mitmproxy", "native", "pwndbg"]) {
    await mkdir(join(root, "bridge", family), { recursive: true });
    await writeFile(join(root, "bridge", family, "test_case.py"), passing);
  }
  const directory = join(root, "tests", "support", "analysis-efficiency");
  await mkdir(directory, { recursive: true });
  const testFile = join(directory, "test_example.py");
  const run = () =>
    execute("python3", ["scripts/run-python-tests.py"], { cwd: root });

  await writeFile(join(root, "checkout_support.py"), "VALUE = 42\n");
  await writeFile(
    testFile,
    "import unittest\nfrom checkout_support import VALUE\nclass Example(unittest.TestCase):\n def test_case(self): self.assertEqual(VALUE, 42)\n",
  );
  expect((await run()).stderr).toContain("OK");

  for (const content of [
    "# A present file can contain no tests.\n",
    "import unittest\nclass Example(unittest.TestCase):\n @unittest.skip('unavailable')\n def test_case(self): pass\n",
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self):\n  for x in range(2):\n   with self.subTest(x=x): self.skipTest('unavailable')\n",
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self):\n  with self.subTest(outer=1):\n   with self.subTest(inner=2): self.skipTest('unavailable')\n",
  ]) {
    await writeFile(testFile, content);
    await expect(run()).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        '"code": "no_executed_analysis_efficiency_tests"',
      ),
    });
  }
  for (const content of [
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self): pass\n @unittest.skip('optional')\n def test_skipped(self): pass\n",
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self):\n  for x in range(2):\n   with self.subTest(x=x):\n    if x == 0: self.skipTest('optional')\n    self.assertEqual(x, 1)\n",
  ]) {
    await writeFile(testFile, content);
    expect((await run()).stderr).toContain("skipped 'optional'");
  }
  await writeFile(
    testFile,
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self):\n  with self.subTest(value=1): self.fail('subtest failed')\n",
  );
  await expect(run()).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("subtest failed"),
  });
});

it("requires executed Python cases in every bridge family", async () => {
  const root = await createTestTempDirectory("rea-python-inventory-");
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "bridge", "example"), { recursive: true });
  await mkdir(join(root, "tests", "support", "analysis-efficiency"), {
    recursive: true,
  });
  await writeFile(
    join(root, "scripts", "run-python-tests.py"),
    await readFile(
      new URL("../../../scripts/run-python-tests.py", import.meta.url),
    ),
  );
  const passing =
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self): pass\n";
  for (const family of ["mitmproxy", "native", "pwndbg"]) {
    await mkdir(join(root, "bridge", family), { recursive: true });
    await writeFile(join(root, "bridge", family, "capture.py"), "VALUE = 1\n");
    await writeFile(join(root, "bridge", family, "test_case.py"), passing);
  }
  await writeFile(join(root, "bridge", "example", "test_first.py"), passing);
  await writeFile(
    join(root, "tests", "support", "analysis-efficiency", "test_example.py"),
    passing,
  );
  const command = ["scripts/run-python-tests.py"];
  const discovered = await execute("python3", command, { cwd: root });
  expect(discovered.stderr).toContain("bridge.mitmproxy.test_case");
  expect(discovered.stderr).toContain("bridge.native.test_case");
  expect(discovered.stderr).toContain("bridge.pwndbg.test_case");
  expect(discovered.stderr).toContain("OK");
  const native = join(root, "bridge", "native", "test_case.py");
  for (const content of [
    "# A present file can contain no tests.\n",
    "import unittest\nclass Example(unittest.TestCase):\n @unittest.skip('unavailable')\n def test_case(self): pass\n",
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self):\n  for x in range(2):\n   with self.subTest(x=x): self.skipTest('unavailable')\n",
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self):\n  with self.subTest(outer=1):\n   with self.subTest(inner=2): self.skipTest('unavailable')\n",
  ]) {
    await writeFile(native, content);
    await expect(
      execute("python3", command, { cwd: root }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('"code": "no_executed_bridge_tests"'),
    });
  }
  await writeFile(
    native,
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self): pass\n @unittest.skip('optional')\n def test_skipped(self): pass\n",
  );
  expect((await execute("python3", command, { cwd: root })).stderr).toContain(
    "skipped 'optional'",
  );
  await writeFile(
    native,
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self):\n  for x in range(2):\n   with self.subTest(x=x):\n    if x == 0: self.skipTest('optional')\n    self.assertEqual(x, 1)\n",
  );
  expect((await execute("python3", command, { cwd: root })).stderr).toContain(
    "skipped 'optional'",
  );
  await writeFile(
    native,
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self):\n  with self.subTest(value=1): self.fail('subtest failed')\n",
  );
  await expect(
    execute("python3", command, { cwd: root }),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("subtest failed"),
  });
  await writeFile(native, passing);
  await writeFile(
    join(root, "bridge", "example", "test_second.py"),
    "import unittest\nclass Example(unittest.TestCase):\n def test_case(self): self.fail('new test executed')\n",
  );
  await expect(
    execute("python3", command, { cwd: root }),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("new test executed"),
  });
  await rm(join(root, "bridge", "mitmproxy", "test_case.py"));
  const missingFamily = await execute("python3", command, { cwd: root }).then(
    () => undefined,
    (error: { code?: unknown; stderr?: unknown }) => error,
  );
  expect(missingFamily).toMatchObject({ code: 1 });
  expect(
    JSON.parse(String(missingFamily?.stderr).trim().split("\n").at(-1)!),
  ).toEqual({
    code: "missing_bridge_family",
    families: ["mitmproxy"],
  });
});
