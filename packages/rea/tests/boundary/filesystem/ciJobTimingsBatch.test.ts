import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { executeWorkflowFixture } from "../../support/workflowGit.js";

const batchScript = fileURLToPath(
  new URL("../../../scripts/ci/job-timings-batch.mjs", import.meta.url),
);

it("collects the latest attempt for recent completed CI and Release runs into a bounded manifest", async () => {
  const recent = new Date().toISOString();
  const fixture = await createFixture([
    {
      workflow_runs: [
        {
          id: 42,
          event: "push",
          head_branch: "main",
          run_attempt: 3,
          status: "completed",
          conclusion: "failure",
          created_at: new Date(Date.parse(recent) + 1_000).toISOString(),
        },
        {
          id: 41,
          run_attempt: 1,
          status: "completed",
          conclusion: "cancelled",
          created_at: recent,
        },
      ],
    },
    {
      workflow_runs: [
        {
          id: 43,
          run_attempt: 2,
          status: "completed",
          conclusion: "success",
          created_at: new Date(Date.parse(recent) + 2_000).toISOString(),
        },
      ],
    },
    completedJobs("Release lane", "success", recent, 50),
    completedJobs("Failed lane", "failure", recent, 55),
    completedJobs("Cancelled lane", "cancelled", recent, 30),
  ]);
  const result = await runBatch(fixture);
  const manifest = JSON.parse(
    await readFile(
      join(fixture.outputDirectory, "batch-manifest.json"),
      "utf8",
    ),
  );
  const calls = JSON.parse(await readFile(fixture.calls, "utf8"));

  expect(result.stdout).toContain("3 collected runs");
  expect(
    await readFile(join(fixture.directory, "summary.md"), "utf8"),
  ).toContain("collected 3 of 3");
  expect(manifest.selection).toMatchObject({
    lookbackHours: 24,
    maxRunsPerWorkflow: 100,
    exhaustive: false,
  });
  expect(manifest.coverage).toMatchObject({
    workflowsQueried: ["CI", "Release"],
    selectedRuns: 3,
    collectedRuns: 3,
  });
  expect(manifest.truncation).toEqual([]);
  expect(manifest.errors).toEqual([]);
  expect(manifest.runs).toMatchObject([
    { id: 43, runAttempt: 2, conclusion: "success" },
    {
      id: 42,
      runAttempt: 3,
      conclusion: "failure",
      event: "push",
      headBranch: "main",
    },
    {
      id: 41,
      runAttempt: 1,
      conclusion: "cancelled",
      event: null,
      headBranch: null,
    },
  ]);
  expect(manifest.runs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        status: "collected",
        rawPath: expect.any(String),
        reportPath: expect.any(String),
      }),
    ]),
  );
  expect(calls).toContainEqual([
    "api",
    "--paginate",
    "--slurp",
    "repos/example/rea/actions/runs/42/attempts/3/jobs?per_page=100",
  ]);
  expect(calls).toContainEqual([
    "api",
    "--paginate",
    "--slurp",
    "repos/example/rea/actions/runs/41/attempts/1/jobs?per_page=100",
  ]);
  const failedReport = JSON.parse(
    await readFile(
      join(fixture.outputDirectory, "runs/42-3/report.json"),
      "utf8",
    ),
  );
  expect(failedReport.jobs[0].conclusion).toBe("failure");
  expect(failedReport.jobs[0].execution.seconds).toBe(55);
});

it("records listing and per-run errors without claiming complete coverage", async () => {
  const recent = new Date().toISOString();
  const fixture = await createFixture([
    {
      workflow_runs: [
        {
          id: 7,
          run_attempt: 2,
          status: "completed",
          conclusion: "success",
          created_at: recent,
        },
      ],
    },
    { error: true },
    { jobs: "malformed" },
  ]);
  await runBatch(fixture);
  const manifest = JSON.parse(
    await readFile(
      join(fixture.outputDirectory, "batch-manifest.json"),
      "utf8",
    ),
  );
  expect(manifest.selection.exhaustive).toBe(false);
  expect(manifest.errors).toMatchObject([
    { scope: "workflow:Release" },
    { scope: "run" },
  ]);
  expect(manifest.runs[0]).toMatchObject({
    id: 7,
    runAttempt: 2,
    status: "error",
  });
});

it("retains a partial manifest when its collection budget is exhausted", async () => {
  const fixture = await createFixture([
    {
      workflow_runs: [8, 9].map((id) => ({
        id,
        run_attempt: 1,
        status: "completed",
        created_at: new Date().toISOString(),
      })),
    },
    { workflow_runs: [] },
  ]);
  await executeWorkflowFixture(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const { collectJobTimingsBatch } = await import(${JSON.stringify(pathToFileURL(batchScript).href)});
    let clock = Date.now();
    await collectJobTimingsBatch({
      repository: "example/rea",
      outputDirectory: process.env.CI_JOB_TIMINGS_DIRECTORY,
      now: () => clock,
      collect: async () => {
        clock += 240001;
        throw new Error("fixture request exhausted the remaining budget");
      },
    });
  `,
    ],
    { cwd: fixture.directory, env: fixtureEnvironment(fixture) },
  );
  const manifest = JSON.parse(
    await readFile(
      join(fixture.outputDirectory, "batch-manifest.json"),
      "utf8",
    ),
  );
  expect(manifest.coverage).toMatchObject({
    selectedRuns: 2,
    collectedRuns: 0,
  });
  expect(manifest.runs).toHaveLength(1);
  expect(manifest.runs[0]).toMatchObject({ status: "error" });
  expect(manifest.truncation.join(" ")).toContain("Time budget");
});

function completedJobs(
  name: string,
  conclusion: string,
  startedAt: string,
  seconds: number,
) {
  return [
    {
      jobs: [
        {
          name,
          status: "completed",
          conclusion,
          created_at: startedAt,
          started_at: startedAt,
          completed_at: new Date(
            Date.parse(startedAt) + seconds * 1000,
          ).toISOString(),
          steps: [],
        },
      ],
    },
  ];
}

async function createFixture(responses: unknown[]) {
  const directory = await createTestTempDirectory("rea-ci-job-timings-batch-");
  const fakeBin = join(directory, "bin");
  await mkdir(fakeBin);
  const responsePath = join(directory, "responses.json");
  const calls = join(directory, "calls.json");
  await writeFile(responsePath, JSON.stringify(responses));
  await writeFile(calls, "[]");
  const fakeGh = join(fakeBin, "gh");
  await writeFile(
    fakeGh,
    `#!/usr/bin/env node
const fs = require("node:fs");
const calls = JSON.parse(fs.readFileSync(process.env.CI_GH_CALLS, "utf8"));
calls.push(process.argv.slice(2));
fs.writeFileSync(process.env.CI_GH_CALLS, JSON.stringify(calls));
const responses = JSON.parse(fs.readFileSync(process.env.CI_GH_RESPONSES, "utf8"));
const response = responses[calls.length - 1];
if (response && response.error) { process.stderr.write("fixture API error"); process.exitCode = 1; }
else process.stdout.write(JSON.stringify(response));
`,
  );
  await chmod(fakeGh, 0o755);
  return {
    directory,
    fakeBin,
    responses: responsePath,
    calls,
    outputDirectory: join(directory, ".cache", "ci-job-timings"),
  };
}

function runBatch(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return executeWorkflowFixture(process.execPath, [batchScript], {
    cwd: fixture.directory,
    env: fixtureEnvironment(fixture),
  });
}

function fixtureEnvironment(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  return {
    ...process.env,
    PATH: `${fixture.fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    CI_REPOSITORY: "example/rea",
    CI_JOB_TIMINGS_DIRECTORY: fixture.outputDirectory,
    CI_GH_CALLS: fixture.calls,
    CI_GH_RESPONSES: fixture.responses,
    GITHUB_STEP_SUMMARY: join(fixture.directory, "summary.md"),
  };
}
