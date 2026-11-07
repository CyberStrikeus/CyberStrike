import { execFile } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { collectJobTimings } from "./job-timings.mjs";

const execFileAsync = promisify(execFile);
const OUTPUT_DIRECTORY = join(".cache", "ci-job-timings");
const MAX_BUFFER = 16 * 1024 * 1024;
const API_TIMEOUT_MS = 30_000;
const WORKFLOWS = [
  { id: "ci.yml", name: "CI" },
  { id: "release.yml", name: "Release" },
];
const LOOKBACK_MS = 24 * 60 * 60 * 1_000;
const MAX_RUNS_PER_WORKFLOW = 100;
const TIME_BUDGET_MS = 240_000;

/** Collect a bounded recent sample of completed CI and Release attempts. */
export async function collectJobTimingsBatch({
  repository,
  outputDirectory = OUTPUT_DIRECTORY,
  observedAt = new Date().toISOString(),
  env = process.env,
  now = Date.now,
  collect = collectJobTimings,
} = {}) {
  const identity = validateRepository(repository);
  const started = now();
  const cutoff = new Date(started - LOOKBACK_MS).toISOString();
  const manifest = {
    schemaVersion: 1,
    observedAt,
    repository: identity,
    selection: {
      workflows: WORKFLOWS,
      status: "completed",
      createdAfter: cutoff,
      lookbackHours: 24,
      overlap: "Each hourly run re-reads the preceding 24 hours.",
      pagination:
        "Run listings use the first 100; jobs are paginated within the remaining time and 16 MiB response limits.",
      maxRunsPerWorkflow: MAX_RUNS_PER_WORKFLOW,
      timeBudgetMs: TIME_BUDGET_MS,
      exhaustive: false,
    },
    coverage: {
      workflowsQueried: [],
      runsListed: 0,
      selectedRuns: 0,
      collectedRuns: 0,
    },
    truncation: [],
    errors: [],
    runs: [],
    elapsedMs: 0,
  };
  const budgetExpired = () => now() - started >= TIME_BUDGET_MS;

  const selected = [];
  for (const workflow of WORKFLOWS) {
    if (budgetExpired()) {
      manifest.truncation.push("Time budget reached while listing workflows.");
      break;
    }
    try {
      const response = await apiJson(
        `repos/${identity}/actions/workflows/${workflow.id}/runs?status=completed&created=%3E%3D${encodeURIComponent(cutoff)}&per_page=${String(MAX_RUNS_PER_WORKFLOW)}&page=1`,
        env,
        started,
        now,
      );
      if (!Array.isArray(response.workflow_runs))
        throw new Error("run listing must contain a workflow_runs array");
      manifest.coverage.workflowsQueried.push(workflow.name);
      manifest.coverage.runsListed += response.workflow_runs.length;
      if (response.workflow_runs.length >= MAX_RUNS_PER_WORKFLOW)
        manifest.truncation.push(
          `${workflow.name} run listing reached the 100-run first-page limit.`,
        );
      for (const run of response.workflow_runs.slice(
        0,
        MAX_RUNS_PER_WORKFLOW,
      )) {
        if (
          run.status !== "completed" ||
          !Number.isSafeInteger(run.id) ||
          !Number.isSafeInteger(run.run_attempt)
        ) {
          manifest.errors.push({
            scope: `workflow:${workflow.name}`,
            runId: run.id ?? null,
            message:
              "Run record missing completed status, numeric id, or numeric latest attempt.",
          });
          continue;
        }
        if (run.created_at && Date.parse(run.created_at) < Date.parse(cutoff))
          continue;
        selected.push({
          id: run.id,
          runAttempt: run.run_attempt,
          workflow: workflow.name,
          event: typeof run.event === "string" ? run.event : null,
          headBranch:
            typeof run.head_branch === "string" ? run.head_branch : null,
          conclusion: run.conclusion ?? null,
          createdAt: run.created_at ?? null,
        });
      }
    } catch (cause) {
      manifest.errors.push({
        scope: `workflow:${workflow.name}`,
        message: errorMessage(cause),
      });
    }
  }

  selected.sort(
    (left, right) =>
      (Date.parse(right.createdAt ?? "") || 0) -
      (Date.parse(left.createdAt ?? "") || 0),
  );
  manifest.coverage.selectedRuns = selected.length;
  for (const run of selected) {
    if (budgetExpired()) {
      manifest.truncation.push(
        "Time budget reached before all selected runs were collected.",
      );
      break;
    }
    const runRecord = {
      ...run,
      status: "pending",
      rawPath: null,
      reportPath: null,
      error: null,
    };
    manifest.runs.push(runRecord);
    const runDirectory = join(
      outputDirectory,
      "runs",
      `${String(run.id)}-${String(run.runAttempt)}`,
    );
    try {
      const result = await collect({
        repository: identity,
        runId: String(run.id),
        runAttempt: String(run.runAttempt),
        outputDirectory: runDirectory,
        env,
        timeoutMs: Math.max(
          1,
          Math.min(API_TIMEOUT_MS, TIME_BUDGET_MS - (now() - started)),
        ),
      });
      runRecord.status = "collected";
      runRecord.rawPath = result.rawPath;
      runRecord.reportPath = result.reportPath;
      manifest.coverage.collectedRuns += 1;
    } catch (cause) {
      runRecord.status = "error";
      runRecord.error = errorMessage(cause);
      manifest.errors.push({
        scope: "run",
        runId: run.id,
        runAttempt: run.runAttempt,
        message: runRecord.error,
      });
    }
  }
  if (budgetExpired() && manifest.runs.length < manifest.coverage.selectedRuns)
    manifest.truncation.push(
      "Time budget reached; selected runs remain unattempted.",
    );
  return await writeManifest(outputDirectory, manifest, started, now, env);
}

function validateRepository(repository) {
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
  )
    throw new Error(
      "CI_REPOSITORY must be an owner/name repository identifier",
    );
  return repository;
}

async function apiJson(endpoint, env, started, now) {
  const timeout = Math.max(
    1,
    Math.min(API_TIMEOUT_MS, TIME_BUDGET_MS - (now() - started)),
  );
  const { stdout } = await execFileAsync("gh", ["api", endpoint], {
    env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout,
  });
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new Error("GitHub Actions API returned malformed JSON", { cause });
  }
}

async function writeManifest(outputDirectory, manifest, started, now, env) {
  manifest.elapsedMs = Math.max(0, now() - started);
  if (
    manifest.elapsedMs >= TIME_BUDGET_MS &&
    !manifest.truncation.some((item) => item.includes("Time budget"))
  )
    manifest.truncation.push("Time budget reached.");
  await mkdir(outputDirectory, { recursive: true });
  const manifestPath = join(outputDirectory, "batch-manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  if (env.GITHUB_STEP_SUMMARY)
    await appendBatchSummary(env.GITHUB_STEP_SUMMARY, manifest, manifestPath);
  return { manifestPath, manifest };
}

async function appendBatchSummary(summaryPath, manifest, manifestPath) {
  const collected = manifest.runs.filter(
    ({ status }) => status === "collected",
  ).length;
  const failed = manifest.runs.filter(
    ({ status }) => status === "error",
  ).length;
  const lines = [
    "### Batched CI timing snapshot",
    "",
    `Observed ${manifest.observedAt}; collected ${String(collected)} of ${String(manifest.coverage.selectedRuns)} selected recent completed runs (${String(failed)} run errors).`,
    `Coverage uses the first ${String(MAX_RUNS_PER_WORKFLOW)} runs per workflow created in the preceding 24 hours and a ${String(TIME_BUDGET_MS / 1_000)} second total budget. This sample is bounded and is not exhaustive.`,
    `Manifest: \`${manifestPath}\`.`,
    ...manifest.truncation.map((message) => `- Truncated: ${message}`),
    ...manifest.errors.map(
      ({ scope, message }) => `- Error (${scope}): ${message}`,
    ),
    "",
  ];
  await appendFile(summaryPath, lines.join("\n"), "utf8");
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await collectJobTimingsBatch({
      repository: process.env.CI_REPOSITORY,
      outputDirectory: process.env.CI_JOB_TIMINGS_DIRECTORY ?? OUTPUT_DIRECTORY,
    });
    process.stdout.write(
      `Wrote batch manifest for ${String(result.manifest.coverage.collectedRuns)} collected runs to ${result.manifestPath}\n`,
    );
  } catch (cause) {
    process.stderr.write(`CI timing batch failed: ${errorMessage(cause)}\n`);
    process.exitCode = 1;
  }
}
