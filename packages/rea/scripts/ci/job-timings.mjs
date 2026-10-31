import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 16 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const OUTPUT_DIRECTORY = join(".cache", "ci-job-timings");
const STEP_COSTS = [
  { key: "npmCi", pattern: /\bnpm ci\b/iu },
  { key: "artifactUpload", pattern: /upload.*artifact/iu },
  { key: "artifactDownload", pattern: /download.*artifact/iu },
];

/** Fetch and summarize one workflow attempt without turning telemetry into a gate. */
export async function collectJobTimings({
  repository,
  runId,
  runAttempt,
  outputDirectory = OUTPUT_DIRECTORY,
  summaryPath,
  observedAt = new Date().toISOString(),
  env = process.env,
  timeoutMs = TIMEOUT_MS,
}) {
  const identity = validateIdentity({ repository, runId, runAttempt });
  const endpoint = `repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}/jobs?per_page=100`;
  const { stdout } = await execFileAsync(
    "gh",
    ["api", "--paginate", "--slurp", endpoint],
    { env, encoding: "utf8", maxBuffer: MAX_BUFFER, timeout: timeoutMs },
  );
  const rawPath = join(outputDirectory, "jobs.json");
  const reportPath = join(outputDirectory, "report.json");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(rawPath, stdout, "utf8");
  const pages = parsePages(stdout);
  const jobs = pages.flatMap(({ jobs: pageJobs }, index) =>
    validateJobs(pageJobs, index),
  );
  const report = normalizeReport({ identity, jobs, observedAt });

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (summaryPath !== undefined)
    await appendSummary(summaryPath, report, rawPath, reportPath);
  return { rawPath, reportPath, report };
}

function validateIdentity({ repository, runId, runAttempt }) {
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
  )
    throw new Error(
      "CI_REPOSITORY must be an owner/name repository identifier",
    );
  return {
    repository,
    runId: parsePositiveInteger(runId, "CI_TIMING_RUN_ID"),
    runAttempt: parsePositiveInteger(runAttempt, "CI_TIMING_RUN_ATTEMPT"),
  };
}

function parsePositiveInteger(value, name) {
  if (typeof value === "string" && /^[1-9]\d*$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error(`${name} must be a positive safe integer`);
}

function parsePages(stdout) {
  let pages;
  try {
    pages = JSON.parse(stdout);
  } catch (cause) {
    throw new Error("GitHub jobs API returned malformed JSON", { cause });
  }
  if (!Array.isArray(pages) || pages.length === 0)
    throw new Error("GitHub jobs API slurp must contain a nonempty page array");
  for (const page of pages)
    if (
      typeof page !== "object" ||
      page === null ||
      Array.isArray(page) ||
      !Array.isArray(page.jobs)
    )
      throw new Error("GitHub jobs API page must contain a jobs array");
  return pages;
}

function validateJobs(jobs, pageIndex) {
  return jobs.map((job, jobIndex) => {
    if (
      typeof job !== "object" ||
      job === null ||
      Array.isArray(job) ||
      typeof job.name !== "string" ||
      job.name.length === 0 ||
      typeof job.status !== "string"
    )
      throw new Error(
        `GitHub jobs API page ${String(pageIndex + 1)} job ${String(jobIndex + 1)} is malformed`,
      );
    return job;
  });
}

function normalizeReport({ identity, jobs, observedAt }) {
  const normalizedJobs = jobs.map(normalizeJob);
  const queues = normalizedJobs
    .map(({ queue }) => queue.seconds)
    .filter((value) => value !== null);
  const completedExecutions = normalizedJobs
    .filter(
      ({ status, conclusion }) =>
        status === "completed" && conclusion !== "skipped",
    )
    .map(({ execution }) => execution.seconds)
    .filter((value) => value !== null);
  const completedDurationSumSeconds = completedExecutions.reduce(
    (sum, seconds) => sum + seconds,
    0,
  );
  const completedExecutionUnknown = normalizedJobs.filter(
    ({ status, conclusion, execution }) =>
      status === "completed" &&
      conclusion !== "skipped" &&
      execution.seconds === null,
  ).length;
  const skipped = normalizedJobs.filter(
    ({ conclusion }) => conclusion === "skipped",
  ).length;
  const costs = Object.fromEntries(STEP_COSTS.map(({ key }) => [key, []]));
  for (const job of normalizedJobs)
    for (const step of job.steps)
      if (step.costKey !== null)
        costs[step.costKey].push({ job: job.name, ...step });

  return {
    schemaVersion: 1,
    run: {
      ...identity,
      observedAt,
      snapshot:
        normalizedJobs.length > 0 &&
        normalizedJobs.every(({ status }) => status === "completed")
          ? "completed job status snapshot; unknown timestamps remain unmeasured"
          : "partial; job statuses may still be queued or in progress",
    },
    counts: {
      jobs: normalizedJobs.length,
      completed: normalizedJobs.filter(({ status }) => status === "completed")
        .length,
      skipped,
      queueUnknown: normalizedJobs.filter(({ queue }) => queue.seconds === null)
        .length,
      executionUnknown: normalizedJobs.filter(
        ({ execution }) => execution.seconds === null,
      ).length,
      completedExecutionUnknown,
    },
    aggregates: {
      queueSeconds: percentileSummary(queues),
      completedExecutionSeconds: percentileSummary(completedExecutions),
      summedCompletedJobElapsedSeconds: {
        value:
          completedExecutions.length === 0
            ? null
            : round(completedDurationSumSeconds),
        knownCount: completedExecutions.length,
        unknownCount: completedExecutionUnknown,
        label:
          "sum of known completed job elapsed durations; incomplete when timestamps are unknown; not CPU time, billing, or workflow wall time",
      },
    },
    jobs: normalizedJobs,
    stepCostInterpretation:
      "Matched install/artifact steps by step name; these are not total artifact transfer costs.",
    stepCosts: costs,
  };
}

function normalizeJob(job) {
  const skipped = job.conclusion === "skipped";
  const hasStarted = ["in_progress", "completed"].includes(job.status);
  const queue = skipped
    ? unknownDuration("job was skipped")
    : !hasStarted
      ? unknownDuration("job start is not established by its status")
      : duration(job.created_at, job.started_at);
  const execution = skipped
    ? unknownDuration("job was skipped")
    : job.status === "completed"
      ? duration(job.started_at, job.completed_at)
      : unknownDuration("job is not completed");
  const steps = Array.isArray(job.steps) ? job.steps.map(normalizeStep) : [];
  return {
    id: Number.isSafeInteger(job.id) && job.id > 0 ? job.id : null,
    url: stringOrNull(job.html_url),
    name: job.name,
    workflowName: stringOrNull(job.workflow_name),
    status: job.status,
    conclusion: stringOrNull(job.conclusion),
    createdAt: stringOrNull(job.created_at),
    startedAt: stringOrNull(job.started_at),
    completedAt: stringOrNull(job.completed_at),
    queue,
    execution,
    steps,
  };
}

function normalizeStep(step) {
  if (
    typeof step !== "object" ||
    step === null ||
    Array.isArray(step) ||
    typeof step.name !== "string"
  )
    throw new Error("GitHub jobs API contains a malformed job step");
  const cost = STEP_COSTS.find(({ pattern }) => pattern.test(step.name));
  return {
    name: step.name,
    costKey: cost?.key ?? null,
    duration: duration(step.started_at, step.completed_at),
  };
}

function duration(startValue, endValue) {
  if (typeof startValue !== "string" || typeof endValue !== "string")
    return unknownDuration("timestamp unavailable");
  const start = Date.parse(startValue);
  const end = Date.parse(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return unknownDuration("invalid timestamp");
  const milliseconds = end - start;
  if (!Number.isFinite(milliseconds) || milliseconds < 0)
    return unknownDuration("timestamps out of order");
  return { seconds: round(milliseconds / 1_000), reason: null };
}

function unknownDuration(reason) {
  return { seconds: null, reason };
}

function percentileSummary(values) {
  return {
    count: values.length,
    p50: nearestRank(values, 0.5),
    p95: nearestRank(values, 0.95),
    unit: "seconds",
  };
}

function nearestRank(values, percentile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.ceil(percentile * sorted.length) - 1]);
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

async function appendSummary(summaryPath, report, rawPath, reportPath) {
  await mkdir(dirname(summaryPath), { recursive: true });
  const rows = [
    ["Queue", report.aggregates.queueSeconds],
    ["Completed execution", report.aggregates.completedExecutionSeconds],
  ]
    .map(
      ([label, item]) =>
        `| ${label} | ${display(item.p50)} | ${display(item.p95)} | ${String(item.count)} |`,
    )
    .join("\n");
  const jobRows = report.jobs
    .map(
      (job) =>
        `| ${escapeCell(job.name)} | ${job.status} | ${job.conclusion ?? "unknown"} | ${display(job.queue.seconds)} | ${job.queue.seconds === null ? job.queue.reason : ""} | ${display(job.execution.seconds)} | ${job.execution.seconds === null ? job.execution.reason : ""} |`,
    )
    .join("\n");
  const costRows = STEP_COSTS.map(({ key }) => {
    const samples = report.stepCosts[key];
    const values = samples
      .map(({ duration: item }) => item.seconds)
      .filter((value) => value !== null);
    return `| ${key} | ${String(samples.length)} | ${display(nearestRank(values, 0.5))} | ${samples.filter(({ duration: item }) => item.seconds === null).length} |`;
  }).join("\n");
  const text = [
    "### CI job timing snapshot",
    "",
    `Observed at ${report.run.observedAt} for run ${String(report.run.runId)}, attempt ${String(report.run.runAttempt)}. This is a point-in-time snapshot of fetched jobs. Queue starts at job creation and excludes preceding dependency waiting. Missing, queued, in-progress, invalid, or out-of-order timestamps are reported as unknown. Elapsed durations are not CPU time or billing data.`,
    "",
    `Fetched ${String(report.counts.jobs)} jobs; ${String(report.counts.completed)} are completed (${String(report.counts.skipped)} skipped); ${String(report.counts.queueUnknown)} queue durations and ${String(report.counts.executionUnknown)} execution durations (${String(report.counts.completedExecutionUnknown)} for non-skipped completed jobs) are unknown.`,
    "",
    "| Metric | p50 (s) | p95 (s) | Samples |",
    "| --- | ---: | ---: | ---: |",
    rows,
    "",
    "| Job | Status | Conclusion | Queue (s) | Queue detail | Execution (s) | Execution detail |",
    "| --- | --- | --- | ---: | --- | ---: | --- |",
    jobRows,
    "",
    `Sum of known completed job elapsed durations: **${display(report.aggregates.summedCompletedJobElapsedSeconds.value)} s** across ${String(report.aggregates.summedCompletedJobElapsedSeconds.knownCount)} known and ${String(report.aggregates.summedCompletedJobElapsedSeconds.unknownCount)} unknown jobs; this is not CPU time, billing, or workflow wall time.`,
    "",
    "Matched install/artifact steps by name; these are not total artifact transfer costs.",
    "",
    "| Matched step group | Samples | p50 (s) | Unknown |",
    "| --- | ---: | ---: | ---: |",
    costRows,
    "",
    `Reports: \`${rawPath}\`, \`${reportPath}\`.`,
    "",
  ].join("\n");
  await writeFile(summaryPath, text, { encoding: "utf8", flag: "a" });
}

function display(value) {
  return value === null ? "unknown" : String(value);
}

function escapeCell(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await collectJobTimings({
      repository: process.env.CI_REPOSITORY,
      runId: process.env.CI_TIMING_RUN_ID,
      runAttempt: process.env.CI_TIMING_RUN_ATTEMPT,
      outputDirectory: process.env.CI_JOB_TIMINGS_DIRECTORY ?? OUTPUT_DIRECTORY,
      summaryPath: process.env.GITHUB_STEP_SUMMARY,
    });
    process.stdout.write(
      `Wrote ${result.report.jobs.length} job timing records to ${result.reportPath}\n`,
    );
  } catch (cause) {
    process.stderr.write(
      `CI timing telemetry failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exitCode = 1;
  }
}
