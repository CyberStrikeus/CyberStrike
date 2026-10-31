import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWorkflowRun } from "./workflow-run.mjs";

const ARTIFACT_NAME = "ci-full-qualification-v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const positiveId = (value) =>
  (typeof value === "string" || typeof value === "number") &&
  /^[1-9]\d*$/.test(String(value)) &&
  Number.isSafeInteger(Number(value));
const commitSha = (value) =>
  typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

/** Record only after the required gate has verified every full-tier obligation. */
export function recordQualification(directory) {
  const sourceSha = process.env.GITHUB_SHA;
  const runId = process.env.GITHUB_RUN_ID;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
  const repository = process.env.GITHUB_REPOSITORY;
  if (
    !commitSha(sourceSha) ||
    !positiveId(runId) ||
    !positiveId(runAttempt) ||
    !repository
  )
    throw new Error(
      "Full qualification receipt requires source and workflow identity",
    );
  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (checkoutSha !== sourceSha)
    throw new Error("Qualification checkout differs from workflow source");
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, "receipt.json");
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        tier: "full",
        sourceSha,
        repository,
        runId: Number(runId),
        runAttempt: Number(runAttempt),
        qualifiedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `receipt_name=${ARTIFACT_NAME}\nreceipt_path=${path}\n`,
    );
}

function admit() {
  if (process.env.CI_FORCE_FULL === "true")
    return {
      run_full: true,
      reason: "Forced daily runner and dependency refresh",
    };
  const repository = process.env.CI_REPOSITORY;
  const repositoryId = Number(process.env.CI_REPOSITORY_ID);
  const branch = process.env.CI_DEFAULT_BRANCH;
  const head = process.env.HEAD_SHA;
  if (!repository || !positiveId(repositoryId) || !branch || !commitSha(head))
    return {
      run_full: true,
      reason: "Qualification lookup identity is incomplete",
    };

  const now = Date.now();
  const deadline = now + 20_000;
  const api = (...arguments_) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error("Qualification lookup budget exhausted");
    return JSON.parse(
      execFileSync("gh", ["api", "--method", "GET", ...arguments_], {
        encoding: "utf8",
        timeout: Math.min(15_000, remaining),
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  };
  try {
    const { artifacts } = api(
      `repos/${repository}/actions/artifacts`,
      "-f",
      `name=${ARTIFACT_NAME}`,
      "-F",
      "per_page=100",
    );
    if (!Array.isArray(artifacts))
      throw new Error("Missing qualification artifact inventory");
    const candidates = artifacts.filter((artifact) => {
      const lineage = artifact?.workflow_run;
      const age = now - Date.parse(artifact?.created_at);
      return (
        artifact?.name === ARTIFACT_NAME &&
        artifact?.expired === false &&
        typeof artifact?.created_at === "string" &&
        Number.isFinite(age) &&
        age >= 0 &&
        age < MAX_AGE_MS &&
        positiveId(lineage?.id) &&
        String(lineage.id) !== process.env.GITHUB_RUN_ID &&
        lineage?.repository_id === repositoryId &&
        lineage?.head_repository_id === repositoryId &&
        lineage?.head_branch === branch &&
        lineage?.head_sha === head
      );
    });
    // Artifact metadata narrows the search before run lookups. Never scan an
    // unbounded history or treat a missing receipt as a successful qualification.
    for (const artifact of candidates.slice(0, 3)) {
      const run = normalizeWorkflowRun(
        api(`repos/${repository}/actions/runs/${artifact.workflow_run.id}`),
      );
      // An old run can upload a new artifact when only its gate is rerun.
      // Bound the original run age as well so retries cannot renew stale proof.
      const runAge = Date.now() - Date.parse(run.created_at);
      if (
        typeof run.created_at === "string" &&
        Number.isFinite(runAge) &&
        runAge >= 0 &&
        runAge < MAX_AGE_MS &&
        run.id === artifact.workflow_run.id &&
        run.status === "completed" &&
        run.conclusion === "success" &&
        run.workflowPath?.file === ".github/workflows/ci.yml" &&
        ["schedule", "workflow_dispatch"].includes(run.event) &&
        run.head_sha === head &&
        run.head_branch === branch &&
        run.head_repository?.full_name === repository
      ) {
        return {
          run_full: false,
          run_id: run.id,
          reason: `Reusing full qualification from run ${run.id}; no fresh provider observation`,
        };
      }
    }
    return {
      run_full: true,
      reason: "No trusted full qualification for this SHA within 24 hours",
    };
  } catch {
    return {
      run_full: true,
      reason: "Qualification lookup unavailable; running full validation",
    };
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const decision = admit();
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(decision)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Scheduled qualification\n\n${decision.reason}.\n`,
    );
  console.log(JSON.stringify(decision));
}
