import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import type {
  CiRun,
  StaticDiagnostic,
  StaticEvidence,
} from "../../../scripts/ci/artifacts.mjs";
import {
  reportCiFailures,
  createGitHubApi,
  type FailureReportApi,
} from "../../../scripts/ci/failure-report.mjs";

const repository = "owner/rea";
const mainSha = "c".repeat(40);
const prSha = "a".repeat(40);
const diagnostic: StaticDiagnostic = {
  kind: "lint",
  path: "src/example.ts",
  code: "no-debugger",
  message: "Unexpected debugger statement.",
  severity: "error",
};
const evidence = (
  run: CiRun,
  diagnostics: readonly StaticDiagnostic[],
): StaticEvidence => ({
  context: {
    version: 1,
    sourceSha: run.head_sha!,
    sourceClean: true,
    nodeVersion: "v24.18.0",
    npmVersion: "11.16.0",
    turboVersion: "2.11.7",
    platform: "linux",
    architecture: "x64",
    taskHashes: { lint: "a".repeat(16) },
  },
  diagnostics,
});
const entry = (id: number, event = "pull_request", runAttempt = 1) => ({
  id,
  runAttempt,
  workflow: "CI",
  event,
  headBranch: event === "pull_request" ? "feature" : "main",
  status: "collected",
  conclusion: "failure",
});

function fixture(mainIds: readonly number[], prCount: number) {
  const jobs: number[] = [];
  const artifacts: number[] = [];
  const paths: (readonly string[])[] = [];
  const runs: Array<
    Omit<ReturnType<typeof entry>, "event"> & { event?: string }
  > = [
    ...mainIds.map((id) => entry(id, "schedule")),
    ...Array.from({ length: prCount }, (_, index) => entry(100 + index)),
  ];
  const api: FailureReportApi = {
    async getRun(_repository, id) {
      const selected = runs.find((run) => run.id === Number(id))!;
      return {
        id,
        run_attempt: selected.runAttempt,
        status: "completed",
        conclusion: "failure",
        ...(selected.event ? { event: selected.event } : {}),
        head_branch: selected.headBranch,
        path: ".github/workflows/ci.yml@main",
        head_sha: mainIds.includes(Number(id)) ? mainSha : prSha,
        repository: { full_name: repository },
        pull_requests:
          selected.event === "pull_request"
            ? [{ base: { sha: mainSha, repo: { full_name: repository } } }]
            : [],
      };
    },
    async getJobs(_repository, id, attempt) {
      jobs.push(Number(id));
      return [
        {
          name: "Static checks",
          status: "completed",
          conclusion: "failure",
          run_id: Number(id),
          run_attempt: attempt,
        },
      ];
    },
    async getStaticEvidence(_repository, run) {
      artifacts.push(Number(run.id));
      return evidence(run, [diagnostic]);
    },
    async getAncestry() {
      return { status: "identical", mergeBaseSha: mainSha };
    },
    async getBlobIdentity(_repository, _ancestor, _descendant, requested) {
      paths.push(requested);
      return Object.fromEntries(requested.map((path) => [path, true]));
    },
    async verifyExecutionSource() {
      return true;
    },
  };
  return { api, runs, jobs, artifacts, paths };
}

async function report(input: ReturnType<typeof fixture>) {
  return await reportCiFailures({
    repository,
    defaultBranch: "main",
    batchManifest: { repository, runs: input.runs },
    api: input.api,
    outputDirectory: await createTestTempDirectory("rea-ci-budget-"),
  });
}

it("selects PR failures before the cap even after a day of scheduled main failures", async () => {
  const input = fixture(
    Array.from({ length: 24 }, (_, index) => 20 + index),
    1,
  );
  input.runs.push({
    id: 200,
    runAttempt: 1,
    workflow: "CI",
    headBranch: "feature",
    status: "collected",
    conclusion: "failure",
  });
  const result = await report(input);
  expect(result.failures).toMatchObject([
    { runId: 100, classification: "matching-main-diagnostics" },
  ]);
  expect(result.boundedInput).toMatchObject({
    candidateRuns: 1,
    mainCandidateRuns: 5,
    manifestTruncated: false,
  });
  expect(input.jobs).toEqual([100, 20]);
});

it("reuses five main job/artifact observations across twenty completed PR comparisons", async () => {
  const input = fixture([20, 21, 22, 23, 24], 20);
  const load = input.api.getStaticEvidence;
  input.api.getStaticEvidence = async (...args) => {
    const result = await load(...args);
    return Number(args[1].id) < 24
      ? evidence(args[1], [{ ...diagnostic, message: "different" }])
      : result;
  };
  const result = await report(input);
  expect(result.counts).toEqual({
    "matching-main-diagnostics": 20,
    unknown: 0,
  });
  expect(input.paths).toHaveLength(100);
  expect(input.jobs).toHaveLength(25);
  expect(input.artifacts).toHaveLength(25);
  for (const id of [20, 21, 22, 23, 24]) {
    expect(input.jobs.filter((item) => item === id)).toHaveLength(1);
    expect(input.artifacts.filter((item) => item === id)).toHaveLength(1);
  }
});

it.each(["missing", "artifact error", "job error", "wrong job attempt"])(
  "reuses unavailable main evidence without retries: %s",
  async (failure) => {
    const input = fixture([20], 3);
    const load = input.api.getStaticEvidence;
    const jobs = input.api.getJobs;
    input.api.getJobs = async (...args) => {
      const result = await jobs(...args);
      if (Number(args[1]) !== 20) return result;
      if (failure === "job error") throw new Error("job_snapshot_unavailable");
      return failure === "wrong job attempt"
        ? result.map((job) => ({ ...job, run_attempt: 2 }))
        : result;
    };
    input.api.getStaticEvidence = async (...args) => {
      const result = await load(...args);
      if (Number(args[1].id) !== 20) return result;
      if (failure === "artifact error") throw new Error("artifact_unavailable");
      return null;
    };
    const result = await report(input);
    expect(result.counts.unknown).toBe(3);
    expect(input.jobs.filter((id) => id === 20)).toHaveLength(1);
    expect(input.artifacts.filter((id) => id === 20)).toHaveLength(
      failure === "job error" || failure === "wrong job attempt" ? 0 : 1,
    );
  },
);

it.each([1, 2])(
  "refreshes unavailable main evidence in the next report (attempt %s)",
  async (attempt) => {
    const input = fixture([20], 1);
    expect((await report(input)).counts["matching-main-diagnostics"]).toBe(1);
    input.runs[0]!.runAttempt = attempt;
    const load = input.api.getStaticEvidence;
    input.api.getStaticEvidence = async (...args) => {
      const result = await load(...args);
      return Number(args[1].id) === 20 ? null : result;
    };
    expect((await report(input)).counts.unknown).toBe(1);
    expect(input.jobs.filter((id) => id === 20)).toHaveLength(2);
    expect(input.artifacts.filter((id) => id === 20)).toHaveLength(2);
  },
);

it.each([1, 51])(
  "fetches only PR paths with %s PR diagnostics and noisy main evidence",
  async (count) => {
    const input = fixture([20], 1);
    const load = input.api.getStaticEvidence;
    const diagnostics = Array.from({ length: count }, (_, index) => ({
      ...diagnostic,
      path: `src/pr-${index}.ts`,
    }));
    input.api.getStaticEvidence = async (...args) => {
      await load(...args);
      const noise =
        Number(args[1].id) === 20
          ? Array.from({ length: 60 }, (_, index) => ({
              ...diagnostic,
              path: `src/main-${index}.ts`,
            }))
          : [];
      return evidence(args[1], [...noise, ...diagnostics]);
    };
    const result = await report(input);
    expect(input.paths).toEqual([
      diagnostics.slice(0, 50).map((item) => item.path),
    ]);
    expect(result.failures[0]!.classification).toBe(
      count === 1 ? "matching-main-diagnostics" : "unknown",
    );
    if (count > 50)
      expect(result.failures[0]!.reason).toBe(
        "diagnostic_source_blob_identity_unavailable",
      );
  },
);

it.each(["jobs", "artifact", "comparison"])(
  "continues after an isolated main %s failure and preserves its provenance",
  async (failure) => {
    const input = fixture([20, 21], 3);
    const jobs = input.api.getJobs;
    const load = input.api.getStaticEvidence;
    input.api.getJobs = async (...args) => {
      const result = await jobs(...args);
      if (Number(args[1]) === 20 && failure === "jobs")
        throw new Error("main_jobs_unavailable");
      return result;
    };
    input.api.getStaticEvidence = async (...args) => {
      const result = await load(...args);
      if (Number(args[1].id) === 20 && failure === "artifact")
        throw new Error("main_artifact_unavailable");
      return Number(args[1].id) === 20 && failure === "comparison"
        ? {
            ...result!,
            context: { ...result!.context, sourceSha: "d".repeat(40) },
          }
        : result;
    };
    input.api.verifyExecutionSource = async (_repository, run, context) => {
      if (Number(run.id) === 20 && context.sourceSha !== run.head_sha)
        throw new Error("main_comparison_unavailable");
      return true;
    };
    const result = await report(input);
    expect(result.counts).toEqual({
      "matching-main-diagnostics": 3,
      unknown: 0,
    });
    for (const item of result.failures) {
      expect(item.candidateFailures).toEqual([
        {
          runId: 20,
          runAttempt: 1,
          reason: `main_${failure}_unavailable`,
        },
      ]);
    }
    expect(input.jobs.filter((id) => id === 20)).toHaveLength(1);
    expect(input.jobs.filter((id) => id === 21)).toHaveLength(1);
    expect(input.artifacts.filter((id) => id === 20)).toHaveLength(
      failure === "jobs" ? 0 : 1,
    );
    expect(input.artifacts.filter((id) => id === 21)).toHaveLength(1);
  },
);

it.each([0, 1, 2])(
  "preserves every failed job when artifact analysis fails at position %s",
  async (position) => {
    const input = fixture([20], 1);
    const jobs = [
      { name: "Python producer", conclusion: "failure" },
      { name: "Test shard (1)", conclusion: "timed_out" },
    ];
    jobs.splice(position, 0, { name: "Static checks", conclusion: "failure" });
    input.api.getJobs = async (_repository, id, attempt) =>
      jobs.map((job) => ({
        ...job,
        status: "completed",
        run_id: Number(id),
        run_attempt: attempt,
      }));
    input.api.getStaticEvidence = async (_repository, _run, job) => {
      if (job.name === "Static checks")
        throw new Error("static_artifact_unavailable");
      return null;
    };
    const result = await report(input);
    expect(result.counts.unknown).toBe(3);
    expect(result.failures).toEqual(
      jobs.map((job) => ({
        runId: 100,
        runAttempt: 1,
        runHead: prSha,
        event: "pull_request",
        job: job.name,
        conclusion: job.conclusion,
        classification: "unknown",
        reason:
          job.name === "Static checks"
            ? "static_artifact_unavailable"
            : "no_matching_verified_main_failure",
      })),
    );
  },
);

it("keeps unavailable job inventories at run scope", async () => {
  const input = fixture([], 1);
  input.api.getJobs = async () => {
    throw new Error("job_inventory_unavailable");
  };
  expect((await report(input)).failures).toEqual([
    {
      runId: 100,
      runAttempt: 1,
      classification: "unknown",
      reason: "job_inventory_unavailable",
    },
  ]);
});

it.each([
  ["request", "github_api_temporarily_unavailable"],
  ["budget", "github_api_request_budget_exhausted"],
  ["missing sha", "github_content_blob_identity_unavailable"],
  ["invalid sha", "github_content_blob_identity_unavailable"],
  ["directory", "github_content_blob_identity_unavailable"],
] as const)(
  "retains unavailable blob evidence as a comparison error: %s",
  async (failure, reason) => {
    const input = fixture([20], 1);
    const contentApi = createGitHubApi({
      token: "fixture-token",
      apiRequest: async () => {
        if (failure === "request") throw new Error(reason);
        if (failure === "missing sha") return { type: "file" };
        if (failure === "invalid sha")
          return { type: "file", sha: "not-a-sha" };
        if (failure === "directory") return [];
        return { type: "file", sha: "e".repeat(40) };
      },
    });
    if (failure === "budget") {
      for (let id = 1; id <= 250; id++) await contentApi.getRun(repository, id);
    }
    input.api.getBlobIdentity = contentApi.getBlobIdentity;
    const result = await report(input);
    expect(result.failures).toMatchObject([
      {
        job: "Static checks",
        classification: "unknown",
        reason: "no_matching_verified_main_failure",
        candidateFailures: [{ runId: 20, runAttempt: 1, reason }],
      },
    ]);
  },
);

it.each([true, false])(
  "reports blob equality only from verified file SHAs (equal: %s)",
  async (equal) => {
    const api = createGitHubApi({
      token: "fixture-token",
      apiRequest: async (_method, endpoint) => ({
        type: "file",
        sha:
          equal || endpoint.includes(`ref=${mainSha}`)
            ? "e".repeat(40)
            : "f".repeat(40),
      }),
    });
    expect(
      await api.getBlobIdentity(repository, mainSha, prSha, ["src/example.ts"]),
    ).toEqual({ "src/example.ts": equal });
  },
);
