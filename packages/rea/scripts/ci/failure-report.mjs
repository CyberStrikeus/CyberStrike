import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyFailure,
  diagnosticPaths,
  isEligibleMainRun,
  isFailedConclusion,
  pullRequestBaseSha,
  readStaticCheckArtifact,
  safeSha,
  selectStaticCheckArtifact,
  STATIC_EVIDENCE_ARTIFACTS,
  validRepoPath,
} from "./artifacts.mjs";
import { createGhApiRequest } from "./github-api.mjs";
import { normalizeWorkflowRun } from "./workflow-run.mjs";

const OUTPUT_DIRECTORY = join(".cache", "ci-failures");
const BATCH_DIRECTORY = join(".cache", "ci-job-timings");
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_FAILED_RUNS = 20;
const MAX_MAIN_CANDIDATES = 5;
const MAX_MAIN_RUN_LOOKUPS = 100;
const MAX_PATHS_PER_COMPARISON = 50;
const MAX_API_REQUESTS = 250;

/** Uses only failed CI candidates present in the supplied bounded timing manifest. */
export async function reportCiFailures({
  repository,
  defaultBranch,
  batchManifest,
  api,
  outputDirectory = OUTPUT_DIRECTORY,
  summaryPath,
  observedAt = new Date().toISOString(),
}) {
  validateRepository(repository);
  if (typeof defaultBranch !== "string" || defaultBranch.length === 0)
    throw new Error("defaultBranch is required");
  if (
    !batchManifest ||
    batchManifest.repository !== repository ||
    !Array.isArray(batchManifest.runs)
  )
    throw new Error("timing manifest repository or runs are invalid");

  const failedRuns = batchManifest.runs.filter(
    (entry) =>
      entry.workflow === "CI" &&
      entry.status === "collected" &&
      isFailedConclusion(entry.conclusion),
  );
  const prRuns = failedRuns.filter((entry) => entry.event === "pull_request");
  const candidates = prRuns.slice(0, MAX_FAILED_RUNS);
  const mainEntries = failedRuns.filter(
    (entry) =>
      entry.headBranch === defaultBranch &&
      ["push", "schedule", "workflow_dispatch"].includes(entry.event),
  );
  const lookupRun = verifiedRunLookup(repository, api);
  const mainCandidates = [];
  for (const entry of mainEntries.slice(0, MAX_MAIN_RUN_LOOKUPS)) {
    try {
      const run = await lookupRun(entry);
      if (isEligibleMainRun(run, defaultBranch, repository))
        mainCandidates.push({
          run,
          getEvidence: mainEvidenceLookup(repository, api, entry, run),
        });
      if (mainCandidates.length === MAX_MAIN_CANDIDATES) break;
    } catch {
      // Unverified metadata cannot consume the eligible-main candidate budget.
    }
  }
  const entries = [];
  for (const entry of candidates) {
    try {
      entries.push(
        ...(await analyzeFailedRun({
          repository,
          defaultBranch,
          entry,
          run: await lookupRun(entry),
          mainCandidates,
          api,
        })),
      );
    } catch (error) {
      entries.push({
        runId: entry.id,
        runAttempt: entry.runAttempt,
        classification: "unknown",
        reason: errorCode(error),
      });
    }
  }
  const report = {
    version: 1,
    observedAt,
    repository,
    defaultBranch,
    informationalOnly: true,
    gateEffect: "none; this report never changes CI conclusions",
    boundedInput: {
      candidateRuns: candidates.length,
      limit: MAX_FAILED_RUNS,
      mainCandidateLimit: MAX_MAIN_CANDIDATES,
      mainCandidateRuns: mainCandidates.length,
      mainRunLookupLimit: MAX_MAIN_RUN_LOOKUPS,
      manifestTruncated:
        prRuns.length > MAX_FAILED_RUNS ||
        batchManifest.truncation?.length > 0 ||
        batchManifest.selection?.exhaustive === false ||
        batchManifest.coverage?.exhaustive === false,
    },
    counts: Object.fromEntries(
      ["matching-main-diagnostics", "unknown"].map((category) => [
        category,
        entries.filter((item) => item.classification === category).length,
      ]),
    ),
    failures: entries,
  };
  await writeFailureReport(report, outputDirectory, summaryPath);
  return report;
}

async function analyzeFailedRun({
  repository,
  defaultBranch,
  entry,
  run,
  mainCandidates,
  api,
}) {
  const jobs = await api.getJobs(repository, entry.id, entry.runAttempt);
  if (jobs.some((job) => !hasJobIdentity(job, entry)))
    throw new Error("workflow_job_identity_mismatch");
  const failedJobs = jobs.filter(
    (job) => job.status === "completed" && isFailedConclusion(job.conclusion),
  );
  if (failedJobs.length === 0)
    return [
      {
        runId: entry.id,
        runAttempt: entry.runAttempt,
        classification: "unknown",
        reason: "failed_jobs_not_present_in_api_snapshot",
      },
    ];
  const failures = [];
  for (const job of failedJobs) {
    let classification;
    try {
      const evidence = await api.getStaticEvidence(repository, run, job);
      classification = await attributeToMain({
        repository,
        defaultBranch,
        run,
        job,
        evidence,
        mainCandidates,
        api,
      });
    } catch (error) {
      classification = outcome("unknown", errorCode(error));
    }
    failures.push({
      runId: entry.id,
      runAttempt: entry.runAttempt,
      runHead: safeSha(run.head_sha),
      event: run.event ?? null,
      job: job.name,
      conclusion: job.conclusion,
      ...classification,
    });
  }
  return failures;
}

async function attributeToMain({
  repository,
  defaultBranch,
  run,
  job,
  evidence,
  mainCandidates,
  api,
}) {
  const baseSha = pullRequestBaseSha(run, repository);
  if (baseSha === null || evidence === null)
    return outcome("unknown", "no_matching_verified_main_failure");
  let result = outcome("unknown", "no_matching_verified_main_failure");
  const candidateFailures = [];
  for (const candidate of mainCandidates) {
    try {
      const main = await compareCandidate({
        repository,
        defaultBranch,
        run,
        job,
        evidence,
        baseSha,
        candidate,
        api,
      });
      if (main !== null) result = main;
      if (main?.classification === "matching-main-diagnostics") break;
    } catch (error) {
      candidateFailures.push({
        runId: candidate.run.id,
        runAttempt: candidate.run.run_attempt,
        reason: errorCode(error),
      });
    }
  }
  return {
    ...result,
    ...(candidateFailures.length > 0 ? { candidateFailures } : {}),
  };
}

async function compareCandidate({
  repository,
  defaultBranch,
  run,
  job,
  evidence,
  baseSha,
  candidate,
  api,
}) {
  const mainRun = candidate.run;
  const main = await candidate.getEvidence(job.name);
  if (!main?.evidence) return null;
  const { job: mainJob, evidence: mainEvidence } = main;
  const ancestry = await api.getAncestry(repository, mainRun.head_sha, baseSha);
  const paths = [
    ...new Set(evidence.diagnostics.flatMap(diagnosticPaths)),
  ].slice(0, MAX_PATHS_PER_COMPARISON);
  const blobs = await api.getBlobIdentity(
    repository,
    mainRun.head_sha,
    baseSha,
    paths,
  );
  const executionSourcesVerified =
    (await api.verifyExecutionSource(repository, run, evidence.context)) &&
    (await api.verifyExecutionSource(
      repository,
      mainRun,
      mainEvidence.context,
    ));
  return classifyFailure({
    repository,
    defaultBranch,
    run,
    job,
    diagnostics: evidence.diagnostics,
    context: evidence.context,
    mainRun,
    mainJob,
    mainDiagnostics: mainEvidence.diagnostics,
    mainContext: mainEvidence.context,
    executionSourcesVerified,
    ancestry,
    blobs,
  });
}

// Each verified main run/attempt owns its lazy jobs and parsed evidence for this
// report only. Cache nulls and rejected reads too; retries cannot spend the budget
// repeatedly on an immutable observation that was unavailable or invalid.
function mainEvidenceLookup(repository, api, entry, run) {
  let jobs;
  const evidence = new Map();
  return (name) => {
    jobs ??= Promise.resolve().then(async () => {
      const items = await api.getJobs(repository, entry.id, entry.runAttempt);
      return items.some((item) => !hasJobIdentity(item, entry)) ? [] : items;
    });
    if (!evidence.has(name))
      evidence.set(
        name,
        jobs.then(async (items) => {
          const job = items.find(
            (item) =>
              item.name === name &&
              item.status === "completed" &&
              isFailedConclusion(item.conclusion),
          );
          if (!job) return null;
          return {
            job,
            evidence: await api.getStaticEvidence(repository, run, job),
          };
        }),
      );
    return evidence.get(name);
  };
}

// Selection and attribution share one immutable API observation per run/attempt.
function verifiedRunLookup(repository, api) {
  const runs = new Map();
  return (entry) => {
    const key = `${positiveId(entry.id)}:${positiveId(entry.runAttempt)}`;
    if (!runs.has(key))
      runs.set(
        key,
        Promise.resolve().then(async () => {
          const run = normalizeWorkflowRun(
            await api.getRun(repository, entry.id),
          );
          if (!hasRunIdentity(run, entry))
            throw new Error("workflow_run_identity_mismatch");
          return run;
        }),
      );
    return runs.get(key);
  };
}

function hasRunIdentity(run, entry) {
  return (
    String(run?.id) === String(entry.id) &&
    Number(run.run_attempt) === Number(entry.runAttempt) &&
    run.workflowPath?.file === ".github/workflows/ci.yml"
  );
}
function hasJobIdentity(job, entry) {
  return (
    String(job.run_id) === String(entry.id) &&
    Number(job.run_attempt) === Number(entry.runAttempt)
  );
}

export function createGitHubApi({
  token = process.env.GH_TOKEN,
  fetchImpl = fetch,
  apiRequest = createGhApiRequest(),
} = {}) {
  if (!token) throw new Error("GH_TOKEN is required");
  const budget = { requests: 0, startedAt: Date.now(), limitMs: 60_000 };
  const request = async (endpoint) => {
    if (budget.requests >= MAX_API_REQUESTS)
      throw new Error("github_api_request_budget_exhausted");
    budget.requests += 1;
    return await apiRequest("GET", endpoint, budget);
  };
  return {
    async getRun(repository, id) {
      return await request(
        `repos/${repository}/actions/runs/${positiveId(id)}`,
      );
    },
    async getJobs(repository, id, attempt) {
      const page = await request(
        `repos/${repository}/actions/runs/${positiveId(id)}/attempts/${positiveId(attempt)}/jobs?per_page=100&page=1`,
      );
      if (!Array.isArray(page.jobs) || page.jobs.length >= 100)
        throw new Error("job_list_incomplete_or_malformed");
      return page.jobs;
    },
    async getStaticEvidence(repository, run, job) {
      const artifactName = STATIC_EVIDENCE_ARTIFACTS[job.name];
      if (!artifactName) return null;
      if (run.run_attempt !== 1) return null;
      const page = await request(
        `repos/${repository}/actions/runs/${positiveId(run.id)}/artifacts?per_page=100&page=1`,
      );
      const artifact = selectStaticCheckArtifact(
        page,
        run,
        run.run_attempt,
        artifactName,
      );
      if (!artifact) return null;
      return await readStaticCheckArtifact({
        repository,
        artifactId: artifact.id,
        token,
        fetchImpl,
      });
    },
    async getAncestry(repository, ancestor, descendant) {
      const comparison = await request(
        `repos/${repository}/compare/${safeSha(ancestor)}...${safeSha(descendant)}`,
      );
      return {
        status: comparison.status,
        mergeBaseSha: safeSha(comparison.merge_base_commit?.sha),
      };
    },
    async verifyExecutionSource(repository, run, context) {
      const sourceSha = safeSha(context.sourceSha);
      if (!sourceSha) return false;
      const pr =
        run.event === "pull_request"
          ? pullRequestBaseSha(run, repository)
          : null;
      if (
        run.event === "pull_request" &&
        (pr === null || context.prHeadSha !== run.head_sha)
      )
        return false;
      const commit = await request(`repos/${repository}/commits/${sourceSha}`);
      if (safeSha(commit.sha) !== sourceSha) return false;
      if (sourceSha === run.head_sha) return true;
      if (
        pr === null ||
        !Array.isArray(commit.parents) ||
        commit.parents.length !== 2
      )
        return false;
      return (
        safeSha(commit.parents[0]?.sha) === pr &&
        safeSha(commit.parents[1]?.sha) === run.head_sha
      );
    },
    async getBlobIdentity(repository, ancestor, descendant, paths) {
      const result = {};
      for (const path of paths) {
        if (!validRepoPath(path)) continue;
        const [left, right] = await Promise.all([
          getContentBlobSha(repository, ancestor, path, request),
          getContentBlobSha(repository, descendant, path, request),
        ]);
        result[path] = left === right;
      }
      return result;
    },
  };
}

async function getContentBlobSha(repository, ref, path, request) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const value = await request(
    `repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
  );
  const sha = safeSha(value?.sha);
  if (value?.type !== "file" || sha === null)
    throw new Error("github_content_blob_identity_unavailable");
  return sha;
}

function outcome(classification, reason) {
  return { classification, reason };
}
function validateRepository(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)
  )
    throw new Error("repository must be owner/name");
}
function positiveId(value) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1)
    throw new Error(
      "GitHub run and attempt IDs must be positive safe integers",
    );
  return String(Number(value));
}
function errorCode(error) {
  return error instanceof Error ? error.message.slice(0, 160) : "unknown_error";
}

export async function writeFailureReport(
  report,
  outputDirectory = OUTPUT_DIRECTORY,
  summaryPath,
) {
  await mkdir(outputDirectory, { recursive: true });
  const jsonPath = join(outputDirectory, "report.json");
  const markdownPath = join(outputDirectory, "report.md");
  const matchedDiagnostics = report.failures.filter(
    (item) => item.classification === "matching-main-diagnostics",
  );
  const lines = [
    "# CI failure attribution",
    "",
    "Informational only. This report never changes a CI conclusion or required gate.",
    "",
    `Observed ${report.observedAt}; ${String(matchedDiagnostics.length)} of ${String(report.failures.length)} failure reports contain supported diagnostics matching a failed static task on an ancestor main revision. This does not attribute other failures in the same job. Unknown means evidence was incomplete or did not match.`,
    "",
  ];
  for (const item of report.failures)
    lines.push(
      `- Run ${item.runId} attempt ${item.runAttempt}${item.job ? `, ${item.job}` : ""}: **${item.classification}** — ${item.reason}.`,
    );
  if (report.failures.length === 0)
    lines.push(
      "- No completed failed CI attempts were present in the supplied timing snapshot.",
    );
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${lines.join("\n")}\n`, "utf8");
  if (summaryPath)
    await appendFile(summaryPath, `${lines.join("\n")}\n`, "utf8");
  return { jsonPath, markdownPath };
}

async function main() {
  const repository = process.env.CI_REPOSITORY;
  const defaultBranch = process.env.CI_DEFAULT_BRANCH;
  const batchPath =
    process.env.CI_TIMING_MANIFEST ??
    join(BATCH_DIRECTORY, "batch-manifest.json");
  const batchManifest = JSON.parse(await readBoundedFile(batchPath));
  const api = createGitHubApi();
  await reportCiFailures({
    repository,
    defaultBranch,
    batchManifest,
    api,
    outputDirectory: process.env.CI_FAILURES_DIRECTORY ?? OUTPUT_DIRECTORY,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
  });
}
async function readBoundedFile(path) {
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_JSON_BYTES)
    throw new Error("timing manifest exceeds size limit");
  return bytes.toString("utf8");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
