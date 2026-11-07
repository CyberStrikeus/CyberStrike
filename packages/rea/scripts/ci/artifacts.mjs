import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import { parseStaticTaskContext } from "./static-task-context.mjs";

const execute = promisify(execFile);
/** Job display name owns the artifact that contains that gate's diagnostics. */
export const STATIC_EVIDENCE_ARTIFACTS = {
  "Static checks": "static-check-reports",
  "Deep static checks": "static-deep-check-reports",
};
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_MEMBER_BYTES = 4 * 1024 * 1024;
const MAX_DIAGNOSTICS = 10_000;
const API_ROOT = "https://api.github.com/repos";
const SHA = /^[0-9a-f]{40}$/iu;
const TASK_HASH = /^[a-f0-9]{16}$/u;

/** Compare parsed static diagnostics only after source, task, host, and ancestry proof. */
export function classifyFailure({
  repository,
  defaultBranch,
  run,
  job,
  diagnostics,
  context,
  mainRun,
  mainJob,
  mainDiagnostics,
  mainContext,
  executionSourcesVerified,
  ancestry,
  blobs,
}) {
  const failedGate = firstFailure([
    () => [
      !isCompletedFailure(run) ||
        job?.status !== "completed" ||
        !isFailedConclusion(job?.conclusion),
      "run_or_job_not_a_completed_failure",
    ],
    () => [
      !isEligiblePullRun(run, repository) ||
        !isEligibleMainRun(mainRun, defaultBranch, repository),
      "run_event_or_repository_identity_unverified",
    ],
    () => [
      job?.name !== mainJob?.name ||
        !Object.hasOwn(STATIC_EVIDENCE_ARTIFACTS, job?.name ?? ""),
      "failed_job_not_the_same_static_gate",
    ],
    () => [
      !Array.isArray(diagnostics) ||
        diagnostics.length === 0 ||
        !Array.isArray(mainDiagnostics),
      "structured_diagnostics_missing_or_invalid",
    ],
    () => [
      !validContext(context) || !validContext(mainContext),
      "static_task_context_missing_or_invalid",
    ],
    () => [
      executionSourcesVerified !== true,
      "checkout_sources_not_verified_against_api_commits",
    ],
    () => [
      !sameExecutionContext(context, mainContext),
      "task_or_toolchain_identity_differs",
    ],
    () => [
      ancestry?.status !== "ahead" && ancestry?.status !== "identical",
      "main_head_not_proven_ancestor_of_tested_base",
    ],
    () => [
      ancestry?.mergeBaseSha !== mainRun?.head_sha,
      "main_head_is_not_the_verified_merge_base",
    ],
    () => [
      !sameTaskHashes(diagnostics, context, mainContext),
      "owning_task_hash_differs",
    ],
  ]);
  if (failedGate) return outcome("unknown", failedGate.reason);
  const keys = diagnostics.map(diagnosticKey);
  const mainKeys = new Set(mainDiagnostics.map(diagnosticKey).filter(Boolean));
  if (keys.some((key) => key === null))
    return outcome("unknown", "diagnostic_shape_not_supported");
  if (!keys.every((key) => mainKeys.has(key)))
    return outcome(
      "unknown",
      "main_run_does_not_contain_the_same_structured_diagnostic",
    );
  const blobStatus = blobIdentityStatus(diagnostics, blobs);
  if (blobStatus !== "identical")
    return outcome(
      "unknown",
      blobStatus === "different"
        ? "diagnostic_source_content_not_identical_at_main_and_tested_base"
        : "diagnostic_source_blob_identity_unavailable",
    );
  return outcome(
    "matching-main-diagnostics",
    "supported_diagnostics_match_failed_task_and_source_on_verified_main_ancestor",
  );
}

export function diagnosticPaths(item) {
  return item.kind === "jscpd"
    ? item.paths
    : item.path === undefined
      ? []
      : [item.path];
}
export function isFailedConclusion(value) {
  return value === "failure" || value === "timed_out";
}
export function isEligibleMainRun(run, defaultBranch, repository) {
  return (
    isEligibleStaticRun(run) &&
    run.repository.full_name === repository &&
    run.head_branch === defaultBranch &&
    ["push", "schedule", "workflow_dispatch"].includes(run.event)
  );
}
export function pullRequestBaseSha(run, repository) {
  if (
    run?.event !== "pull_request" ||
    run.repository?.full_name !== repository ||
    !Array.isArray(run.pull_requests) ||
    run.pull_requests.length !== 1
  )
    return null;
  const base = run.pull_requests[0].base;
  return base?.repo?.full_name === repository && SHA.test(base?.sha ?? "")
    ? base.sha
    : null;
}

export function safeSha(value) {
  return typeof value === "string" && SHA.test(value)
    ? value.toLowerCase()
    : null;
}
export function selectStaticCheckArtifact(
  page,
  run,
  runAttempt,
  name = STATIC_EVIDENCE_ARTIFACTS["Static checks"],
) {
  if (runAttempt !== 1) return null;
  if (
    !Array.isArray(page?.artifacts) ||
    !Number.isSafeInteger(page.total_count) ||
    page.total_count !== page.artifacts.length ||
    page.artifacts.length >= 100
  )
    return null;
  const matches = page.artifacts.filter((artifact) => artifact.name === name);
  if (matches.length !== 1) return null;
  const [artifact] = matches;
  if (
    artifact.expired !== false ||
    String(artifact.workflow_run?.id) !== String(run.id) ||
    artifact.workflow_run?.head_sha !== run.head_sha
  )
    return null;
  return artifact;
}
export function validRepoPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.includes("\\") &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..") &&
    !value.startsWith("/")
  );
}

/** Download one named static report archive and parse only whitelisted JSON members. */
export async function readStaticCheckArtifact({
  repository,
  artifactId,
  token,
  fetchImpl = fetch,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository ?? ""))
    throw new Error("artifact repository identity is invalid");
  if (!token) throw new Error("artifact download requires a GitHub token");
  const url = `${API_ROOT}/${repository}/actions/artifacts/${positiveId(artifactId)}/zip`;
  let response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
    redirect: "manual",
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location || new URL(location).protocol !== "https:")
      throw new Error("static_artifact_redirect_invalid");
    response = await fetchImpl(location, {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  }
  if (!response.ok) throw new Error(`github_http_${response.status}`);
  const bytes = await readLimitedBytes(response, MAX_ARCHIVE_BYTES);
  const directory = await mkdtemp(join(tmpdir(), "rea-ci-static-artifact-"));
  const archive = join(directory, "artifact.zip");
  try {
    await writeFile(archive, bytes, { flag: "wx" });
    return await parseStaticArchive(archive);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Accept only the three named producer outputs; no archive paths are written to disk. */
export async function parseStaticArchive(archivePath) {
  const { stdout: listing } = await execute("unzip", ["-Z1", archivePath], {
    encoding: "utf8",
    maxBuffer: 128 * 1024,
    timeout: 5_000,
  });
  const allowed = new Set([
    "oxlint.json",
    "jscpd/jscpd-report.json",
    "static-task-context.json",
  ]);
  const members = new Map();
  for (const name of listing.split(/\r?\n/u).filter(Boolean)) {
    const prefix = ".cache/static-checks/";
    const member = name.startsWith(prefix) ? name.slice(prefix.length) : name;
    if (!allowed.has(member)) continue;
    if (members.has(member))
      throw new Error("static artifact contains duplicate report members");
    const { stdout } = await execute("unzip", ["-p", archivePath, name], {
      encoding: "buffer",
      maxBuffer: MAX_MEMBER_BYTES,
      timeout: 5_000,
    });
    members.set(member, JSON.parse(stdout.toString("utf8")));
  }
  const context = parseStaticTaskContext(
    members.get("static-task-context.json"),
  );
  const diagnostics = normalizeDiagnostics(
    members.get("oxlint.json"),
    members.get("jscpd/jscpd-report.json"),
  );
  if (diagnostics.length > MAX_DIAGNOSTICS)
    throw new Error("static diagnostic count exceeds the reporting limit");
  return { context, diagnostics };
}

function normalizeDiagnostics(lint, duplicate) {
  return [...normalizeLint(lint), ...normalizeDuplicates(duplicate)];
}

function normalizeLint(report) {
  if (report === undefined) return [];
  if (!Array.isArray(report?.diagnostics))
    throw new Error("oxlint diagnostics are malformed");
  return report.diagnostics
    .filter((item) => item.severity === "error")
    .map((item) => {
      if (
        (item.filename !== undefined && !validRepoPath(item.filename)) ||
        (item.code !== undefined && typeof item.code !== "string") ||
        typeof item.message !== "string"
      )
        throw new Error("oxlint error diagnostic is malformed");
      return {
        kind: "lint",
        ...(item.filename === undefined ? {} : { path: item.filename }),
        ...(item.code === undefined ? {} : { code: item.code }),
        message: item.message,
        severity: "error",
      };
    });
}

function normalizeDuplicates(report) {
  if (report === undefined) return [];
  if (
    !Array.isArray(report?.duplicates) ||
    !Number.isFinite(report.statistics?.total?.percentage) ||
    report.statistics.total.percentage < 0
  )
    throw new Error("jscpd report is malformed");
  // The producer owns the checker outcome; do not copy or infer its threshold.
  const exitCode = report.reaCheck?.exitCode;
  if (exitCode === undefined || exitCode === 0) return [];
  if (!Number.isSafeInteger(exitCode) || exitCode < 0)
    throw new Error("jscpd checker outcome is malformed");
  if (exitCode !== 1) return [];
  return report.duplicates.map((item) => {
    const paths = [item.firstFile?.name, item.secondFile?.name].sort();
    if (paths.some((path) => !validRepoPath(path)))
      throw new Error("jscpd duplicate paths are malformed");
    return { kind: "jscpd", paths };
  });
}

async function readLimitedBytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("static artifact response has no body");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("static artifact exceeds the download limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("artifact ID must be a positive integer");
  return String(id);
}

function diagnosticKey(item) {
  if (
    item?.kind === "lint" &&
    validRepoPath(item.path) &&
    typeof item.code === "string" &&
    typeof item.message === "string" &&
    item.severity === "error"
  )
    return JSON.stringify([
      item.kind,
      item.path,
      item.code,
      item.message,
      item.severity,
    ]);
  if (
    item?.kind === "jscpd" &&
    Array.isArray(item.paths) &&
    item.paths.length === 2 &&
    item.paths.every(validRepoPath)
  )
    return JSON.stringify([item.kind, ...[...item.paths].sort()]);
  return null;
}
function blobIdentityStatus(diagnostics, blobs) {
  const paths = [...new Set(diagnostics.flatMap(diagnosticPaths))];
  if (paths.some((path) => blobs?.[path] === false)) return "different";
  return paths.length > 0 && paths.every((path) => blobs?.[path] === true)
    ? "identical"
    : "unavailable";
}
function sameTaskHashes(diagnostics, left, right) {
  return diagnostics.every((diagnostic) => {
    const task = diagnostic.kind === "jscpd" ? "jscpd" : "lint";
    return (
      TASK_HASH.test(left.taskHashes[task] ?? "") &&
      left.taskHashes[task] === right.taskHashes[task]
    );
  });
}
function validContext(value) {
  try {
    return parseStaticTaskContext(value).sourceClean;
  } catch {
    return false;
  }
}
function sameExecutionContext(left, right) {
  return [
    "nodeVersion",
    "npmVersion",
    "turboVersion",
    "platform",
    "architecture",
  ].every((key) => left[key] === right[key]);
}
function isEligiblePullRun(run, repository) {
  return (
    isEligibleStaticRun(run) && pullRequestBaseSha(run, repository) !== null
  );
}
function isEligibleStaticRun(run) {
  return (
    isRecord(run) &&
    run.status === "completed" &&
    isFailedConclusion(run.conclusion) &&
    SHA.test(run.head_sha ?? "") &&
    typeof run.repository?.full_name === "string" &&
    run.workflowPath?.file === ".github/workflows/ci.yml"
  );
}
function isCompletedFailure(run) {
  return run?.status === "completed" && isFailedConclusion(run.conclusion);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function firstFailure(checks) {
  for (const check of checks) {
    const [failed, reason] = check();
    if (failed) return { reason };
  }
  return null;
}
function outcome(classification, reason) {
  return { classification, reason };
}
