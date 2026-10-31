import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  executeWorkflowFixture,
  workflowGit,
} from "../../support/workflowGit.js";

const reporter = fileURLToPath(
  new URL("../../../scripts/ci/job-timings.mjs", import.meta.url),
);

it("merges paginated jobs, reports elapsed metrics, and preserves raw responses", async () => {
  const fixture = await createFixture([
    {
      total_count: 4,
      jobs: [
        {
          name: "Build package",
          workflow_name: "CI",
          status: "completed",
          conclusion: "success",
          created_at: "2026-10-13T00:00:00Z",
          started_at: "2026-10-13T00:00:10Z",
          completed_at: "2026-10-13T00:01:10Z",
          steps: [
            {
              name: "Install dependencies (npm ci)",
              started_at: "2026-10-13T00:00:10Z",
              completed_at: "2026-10-13T00:00:40Z",
            },
            {
              name: "Upload artifact",
              started_at: "2026-10-13T00:00:40Z",
              completed_at: "2026-10-13T00:00:41Z",
            },
          ],
        },
      ],
    },
    {
      total_count: 4,
      jobs: [
        {
          name: "Queued lane",
          status: "queued",
          created_at: "2026-10-13T00:00:00Z",
          started_at: "2026-10-13T00:00:00Z",
          completed_at: null,
          steps: [],
        },
        {
          name: "Running lane",
          status: "in_progress",
          created_at: "2026-10-13T00:00:00Z",
          started_at: "2026-10-13T00:00:15Z",
          completed_at: null,
          steps: [
            {
              name: "Download artifacts",
              started_at: "2026-10-13T00:00:20Z",
              completed_at: "2026-10-13T00:00:22Z",
            },
          ],
        },
        {
          name: "Skipped lane",
          status: "completed",
          conclusion: "skipped",
          created_at: "2026-10-13T00:00:00Z",
          started_at: "2026-10-13T00:00:00Z",
          completed_at: "2026-10-13T00:00:00Z",
          steps: [],
        },
      ],
    },
  ]);
  const result = await runReporter(fixture);
  const report = JSON.parse(
    await readFile(join(fixture.outputDirectory, "report.json"), "utf8"),
  );

  expect(report.run.snapshot).toContain("partial");
  expect(report.counts).toMatchObject({
    jobs: 4,
    completed: 2,
    skipped: 1,
    queueUnknown: 2,
    executionUnknown: 3,
    completedExecutionUnknown: 0,
  });
  expect(report.aggregates.queueSeconds).toMatchObject({
    count: 2,
    p50: 10,
    p95: 15,
  });
  expect(report.aggregates.completedExecutionSeconds).toMatchObject({
    count: 1,
    p50: 60,
    p95: 60,
  });
  expect(report.aggregates.summedCompletedJobElapsedSeconds).toMatchObject({
    value: 60,
    knownCount: 1,
    unknownCount: 0,
    label: expect.stringContaining("not CPU time"),
  });
  expect(report.jobs[1].queue).toEqual({
    seconds: null,
    reason: "job start is not established by its status",
  });
  expect(report.jobs[3].queue).toEqual({
    seconds: null,
    reason: "job was skipped",
  });
  expect(report.jobs[3].execution).toEqual({
    seconds: null,
    reason: "job was skipped",
  });
  expect(report.stepCosts.npmCi[0].duration.seconds).toBe(30);
  expect(report.stepCosts.artifactUpload[0].duration.seconds).toBe(1);
  expect(report.stepCosts.artifactDownload[0].duration.seconds).toBe(2);
  expect(report.stepCostInterpretation).toContain(
    "not total artifact transfer costs",
  );
  expect(report.cpuSeconds).toBeUndefined();
  expect(result.stdout).toContain("4 job timing records");
  expect(
    await readFile(join(fixture.outputDirectory, "jobs.json"), "utf8"),
  ).toBe(fixture.raw);
  const summary = await readFile(fixture.summary, "utf8");
  expect(summary).toContain("point-in-time snapshot");
  expect(summary).toContain("unknown");
  expect(summary).toContain("not CPU time");
  expect(summary).toContain("60 s");
  expect(summary).toContain("not total artifact transfer costs");
  const args = JSON.parse(await readFile(fixture.args, "utf8"));
  expect(args).toEqual([
    "api",
    "--paginate",
    "--slurp",
    "repos/example/rea/actions/runs/42/attempts/2/jobs?per_page=100",
  ]);
});

it("marks invalid and out-of-order timestamps unknown instead of emitting negative durations", async () => {
  const fixture = await createFixture([
    {
      jobs: [
        {
          name: "Invalid dates",
          status: "completed",
          created_at: "not-a-date",
          started_at: "2026-10-13T00:00:10Z",
          completed_at: "2026-10-13T00:00:05Z",
          steps: [],
        },
      ],
    },
  ]);
  await runReporter(fixture);
  const report = JSON.parse(
    await readFile(join(fixture.outputDirectory, "report.json"), "utf8"),
  );

  expect(report.jobs[0].queue).toEqual({
    seconds: null,
    reason: "invalid timestamp",
  });
  expect(report.jobs[0].execution).toEqual({
    seconds: null,
    reason: "timestamps out of order",
  });
  expect(report.counts.completedExecutionUnknown).toBe(1);
  expect(report.aggregates.summedCompletedJobElapsedSeconds).toMatchObject({
    value: null,
    unknownCount: 1,
  });
});

it("fails on malformed pages or a failed GitHub API request", async () => {
  const malformed = await createFixture([{ jobs: "not-an-array" }]);
  await expect(runReporter(malformed)).rejects.toThrow();
  await expect(
    readFile(join(malformed.outputDirectory, "jobs.json"), "utf8"),
  ).resolves.toBe(malformed.raw);

  const failedApi = await createFixture([], { exitCode: 1 });
  await expect(runReporter(failedApi)).rejects.toThrow();
});

async function createFixture(
  pages: unknown[],
  { exitCode = 0 }: { exitCode?: number } = {},
) {
  const directory = await createTestTempDirectory("rea-ci-job-timings-");
  await workflowGit(directory, ["init", "--initial-branch=main"]);
  const fakeBin = join(directory, "bin");
  await mkdir(fakeBin);
  const raw = JSON.stringify(pages);
  const rawPath = join(directory, "gh-response.json");
  const args = join(directory, "gh-args.json");
  await writeFile(rawPath, raw);
  const fakeGh = join(fakeBin, "gh");
  await writeFile(
    fakeGh,
    `#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.CI_GH_ARGS, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(fs.readFileSync(process.env.CI_GH_RESPONSE, "utf8"));\nprocess.exitCode = ${String(exitCode)};\n`,
  );
  await chmod(fakeGh, 0o755);
  const outputDirectory = join(directory, ".cache", "ci-job-timings");
  const summary = join(directory, "summary.md");
  await writeFile(summary, "");
  return {
    directory,
    fakeBin,
    raw,
    rawPath,
    args,
    outputDirectory,
    summary,
  };
}

function runReporter(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return executeWorkflowFixture(process.execPath, [reporter], {
    cwd: fixture.directory,
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      CI_REPOSITORY: "example/rea",
      CI_JOB_TIMINGS_DIRECTORY: fixture.outputDirectory,
      CI_GH_ARGS: fixture.args,
      CI_GH_RESPONSE: fixture.rawPath,
      CI_TIMING_RUN_ID: "42",
      CI_TIMING_RUN_ATTEMPT: "2",
      GITHUB_STEP_SUMMARY: fixture.summary,
    },
  });
}
