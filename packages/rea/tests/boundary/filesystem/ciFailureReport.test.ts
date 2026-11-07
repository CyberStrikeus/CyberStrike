import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { normalizeWorkflowRun } from "../../../scripts/ci/workflow-run.mjs";

import {
  classifyFailure,
  readStaticCheckArtifact,
  selectStaticCheckArtifact,
  type CiRun,
  type CiJob,
} from "../../../scripts/ci/artifacts.mjs";
import {
  createGitHubApi,
  reportCiFailures,
  type FailureReportApi,
} from "../../../scripts/ci/failure-report.mjs";

const sha = (digit: string) => digit.repeat(40);
const diagnostic = {
  kind: "lint",
  path: "src/example.ts",
  code: "no-debugger",
  message: "Unexpected debugger statement.",
  severity: "error",
} as const;
const context = (
  sourceSha: string,
  taskHash = "a".repeat(16),
  prHeadSha?: string,
) => ({
  version: 1 as const,
  sourceSha,
  ...(prHeadSha ? { prHeadSha } : {}),
  sourceClean: true,
  nodeVersion: "v24.18.0",
  npmVersion: "11.16.0",
  turboVersion: "2.11.7",
  platform: "linux",
  architecture: "x64",
  taskHashes: { lint: taskHash },
});
const run = (overrides: Partial<CiRun> = {}) =>
  normalizeWorkflowRun({
    id: 10,
    run_attempt: 1,
    status: "completed",
    conclusion: "failure",
    event: "pull_request",
    path: ".github/workflows/ci.yml@main",
    head_sha: sha("a"),
    head_branch: "feature",
    repository: { full_name: "owner/rea" },
    pull_requests: [
      { base: { sha: sha("b"), repo: { full_name: "owner/rea" } } },
    ],
    ...overrides,
  });
const job = (overrides: Partial<CiJob> = {}) => ({
  name: "Static checks",
  status: "completed",
  conclusion: "failure",
  ...overrides,
});

const comparison = (): Parameters<typeof classifyFailure>[0] => ({
  repository: "owner/rea",
  defaultBranch: "main",
  run: run(),
  job: job(),
  diagnostics: [diagnostic],
  context: context(sha("a")),
  mainRun: run({
    id: 20,
    event: "push",
    head_sha: sha("c"),
    head_branch: "main",
    pull_requests: [],
  }),
  mainJob: job(),
  mainDiagnostics: [diagnostic],
  mainContext: context(sha("c")),
  executionSourcesVerified: true,
  ancestry: { status: "ahead", mergeBaseSha: sha("c") },
  blobs: { "src/example.ts": true },
});

it("attributes a deep duplication failure when both gates record the same jscpd task", () => {
  const duplicate = { kind: "jscpd" as const, paths: ["src/a.ts", "src/b.ts"] };
  const deepContext = (sourceSha: string) => ({
    ...context(sourceSha),
    taskHashes: { jscpd: "c".repeat(16) },
  });
  expect(
    classifyFailure({
      ...comparison(),
      job: job({ name: "Deep static checks" }),
      mainJob: job({ name: "Deep static checks" }),
      diagnostics: [duplicate],
      mainDiagnostics: [duplicate],
      context: deepContext(sha("a")),
      mainContext: deepContext(sha("c")),
      blobs: { "src/a.ts": true, "src/b.ts": true },
    }),
  ).toEqual({
    classification: "matching-main-diagnostics",
    reason:
      "supported_diagnostics_match_failed_task_and_source_on_verified_main_ancestor",
  });
});

it("attributes only an identical structured lint failure with matching task, context, ancestry, and source blob", () => {
  const result = classifyFailure(comparison());
  expect(result).toEqual({
    classification: "matching-main-diagnostics",
    reason:
      "supported_diagnostics_match_failed_task_and_source_on_verified_main_ancestor",
  });
});

it.each(["context", "mainContext"] as const)(
  "keeps mixed legacy and canonical lint receipts unknown when %s uses the old task",
  (side) => {
    const input = comparison();
    const receipt = input[side]!;
    expect(
      classifyFailure({
        ...input,
        [side]: {
          ...receipt,
          taskHashes: { "lint:built": "a".repeat(16) },
        },
      }),
    ).toEqual({
      classification: "unknown",
      reason: "owning_task_hash_differs",
    });
  },
);

it.each([
  ...[
    "nodeVersion",
    "npmVersion",
    "turboVersion",
    "platform",
    "architecture",
  ].map((field) => [field, { [field]: "" }] as const),
  ["optional head hash", { prHeadSha: "bad" }],
  [
    "unrelated task hash",
    { taskHashes: { lint: "a".repeat(16), typecheck: "bad" } },
  ],
] as const)(
  "keeps malformed %s provenance unknown on either side",
  (_label, invalid) => {
    for (const side of ["context", "mainContext"] as const) {
      const input = comparison();
      expect(
        classifyFailure({
          ...input,
          [side]: { ...input[side], ...invalid },
        }),
      ).toEqual({
        classification: "unknown",
        reason: "static_task_context_missing_or_invalid",
      });
    }
  },
);

it.each(["path", "code"] as const)(
  "keeps applicability unknown when the lint %s is unavailable on both runs",
  (missing) => {
    const { [missing]: _omitted, ...retained } = diagnostic;
    expect(
      classifyFailure({
        ...comparison(),
        diagnostics: [retained],
        mainDiagnostics: [retained],
      }),
    ).toEqual({
      classification: "unknown",
      reason: "diagnostic_shape_not_supported",
    });
  },
);

it.each([
  ["task hash", { mainContext: context(sha("c"), "b".repeat(16)) }],
  ["dirty source", { context: { ...context(sha("a")), sourceClean: false } }],
  [
    "toolchain",
    { mainContext: { ...context(sha("c")), turboVersion: "other" } },
  ],
  [
    "source sha",
    { context: context(sha("d")), executionSourcesVerified: false },
  ],
  [
    "diagnostic",
    { mainDiagnostics: [{ ...diagnostic, message: "different message" }] },
  ],
  ["content", { blobs: { "src/example.ts": false } }],
  ["ancestry", { ancestry: { status: "diverged", mergeBaseSha: sha("e") } }],
  ["canceled job", { job: job({ conclusion: "cancelled" }) }],
  ["not a static job", { job: job({ name: "Test shard (1)" }) }],
  [
    "deep gate compared with the fast gate",
    { job: job({ name: "Deep static checks" }) },
  ],
] as const)("does not attribute on mismatched %s", (_label, overrides) => {
  const result = classifyFailure({ ...comparison(), ...overrides });
  expect(result.classification).toBe("unknown");
});

it.each([
  [{}, "diagnostic_source_blob_identity_unavailable"],
  [
    { "src/example.ts": false },
    "diagnostic_source_content_not_identical_at_main_and_tested_base",
  ],
] as const)(
  "distinguishes unavailable blob identity from verified differences (%s)",
  (blobs, reason) => {
    expect(classifyFailure({ ...comparison(), blobs })).toEqual({
      classification: "unknown",
      reason,
    });
  },
);

it("writes informational JSON and Markdown from the supplied manifest using only read API calls", async () => {
  const directory = await createTestTempDirectory("rea-ci-failure-test-");
  const calls: string[] = [];
  const manifest = {
    repository: "owner/rea",
    truncation: [],
    coverage: { exhaustive: false },
    runs: [
      {
        id: 10,
        runAttempt: 1,
        workflow: "CI",
        event: "pull_request",
        conclusion: "failure",
        status: "collected",
      },
      {
        id: 11,
        runAttempt: 1,
        workflow: "CI",
        event: "pull_request",
        conclusion: "success",
        status: "collected",
      },
    ],
  };
  const failedRun = run();
  const api: FailureReportApi = {
    async getRun(_repository, id) {
      calls.push(`run:${id}`);
      return failedRun;
    },
    async getJobs(_repository, id) {
      calls.push(`jobs:${id}`);
      return [{ ...job(), run_id: Number(id), run_attempt: 1 }];
    },
    async getStaticEvidence() {
      calls.push("artifact");
      return null;
    },
    async getAncestry() {
      throw new Error("must not compare without evidence");
    },
    async verifyExecutionSource() {
      throw new Error("must not verify source without evidence");
    },
    async getBlobIdentity() {
      throw new Error("must not inspect blobs without evidence");
    },
  };
  const report = await reportCiFailures({
    repository: "owner/rea",
    defaultBranch: "main",
    batchManifest: manifest,
    api,
    outputDirectory: directory,
  });
  expect(calls).toEqual(["run:10", "jobs:10", "artifact"]);
  expect(report).toMatchObject({
    informationalOnly: true,
    gateEffect: "none; this report never changes CI conclusions",
    counts: { unknown: 1 },
  });
  const json = JSON.parse(
    await readFile(join(directory, "report.json"), "utf8"),
  );
  const markdown = await readFile(join(directory, "report.md"), "utf8");
  expect(json.failures[0]).toMatchObject({
    classification: "unknown",
    reason: "no_matching_verified_main_failure",
  });
  expect(markdown).toContain("Informational only");
  expect(markdown).toContain("Unknown means evidence was incomplete");
});

it.each([
  [22, false],
  [6, true],
] as const)(
  "finds verified main evidence after %s newer PR runs (extra incorrect main hint: %s)",
  async (prCount, incorrectMainHints) => {
    const directory = await createTestTempDirectory("rea-ci-main-proof-");
    const mainSha = sha("c");
    const prHeadSha = sha("a");
    const mergeSha = sha("d");
    const mainRun = run({
      id: 20,
      event: "push",
      head_sha: mainSha,
      head_branch: "main",
      pull_requests: [],
    });
    const prRun = run({
      head_sha: prHeadSha,
      pull_requests: [
        { base: { sha: mainSha, repo: { full_name: "owner/rea" } } },
      ],
    });
    const evidence = (sourceSha: string, prHead?: string) => ({
      context: context(sourceSha, undefined, prHead),
      diagnostics: [diagnostic],
    });
    const lookups: number[] = [];
    const api: FailureReportApi = {
      async getRun(_repository, id) {
        lookups.push(Number(id));
        return Number(id) === 20 ? mainRun : { ...prRun, id };
      },
      async getJobs(_repository, id) {
        return [{ ...job(), run_id: Number(id), run_attempt: 1 }];
      },
      async getStaticEvidence(_repository, selectedRun) {
        return Number(selectedRun.id) === 20
          ? evidence(mainSha)
          : evidence(mergeSha, prHeadSha);
      },
      async verifyExecutionSource(_repository, selectedRun, sourceContext) {
        return selectedRun.event === "pull_request"
          ? sourceContext.sourceSha === mergeSha &&
              sourceContext.prHeadSha === selectedRun.head_sha
          : sourceContext.sourceSha === selectedRun.head_sha;
      },
      async getAncestry() {
        return { status: "ahead", mergeBaseSha: mainSha };
      },
      async getBlobIdentity() {
        return { "src/example.ts": true };
      },
    };
    const result = await reportCiFailures({
      repository: "owner/rea",
      defaultBranch: "main",
      batchManifest: {
        repository: "owner/rea",
        runs: [
          ...(incorrectMainHints
            ? [
                {
                  id: 30,
                  runAttempt: 1,
                  workflow: "CI",
                  event: "push",
                  headBranch: "main",
                  conclusion: "failure",
                  status: "collected",
                },
              ]
            : []),
          ...Array.from({ length: prCount }, (_, index) => ({
            id: 100 + index,
            runAttempt: 1,
            workflow: "CI",
            event: "pull_request",
            headBranch: "feature",
            conclusion: "failure",
            status: "collected",
          })),
          {
            id: 20,
            runAttempt: 1,
            workflow: "CI",
            event: "push",
            headBranch: "main",
            conclusion: "failure",
            status: "collected",
          },
        ],
      },
      api,
      outputDirectory: directory,
    });
    expect(result.failures[0]).toMatchObject({
      runId: 100,
      classification: "matching-main-diagnostics",
      reason:
        "supported_diagnostics_match_failed_task_and_source_on_verified_main_ancestor",
    });
    expect(lookups).toHaveLength(
      Math.min(prCount, 20) + 1 + Number(incorrectMainHints),
    );
    expect(lookups[0]).toBe(incorrectMainHints ? 30 : 20);
    expect(new Set(lookups).size).toBe(lookups.length);
    expect(result.boundedInput.mainCandidateRuns).toBe(1);
    expect(result.failures).toHaveLength(Math.min(prCount, 20));
  },
);

it("proves checkout merge parents in base-then-PR-head order and rejects false identities", async () => {
  const baseSha = sha("b");
  const headSha = sha("a");
  const mergeSha = sha("c");
  const prRun = run({
    head_sha: headSha,
    pull_requests: [
      { base: { sha: baseSha, repo: { full_name: "owner/rea" } } },
    ],
  });
  let parents = [baseSha, headSha];
  const calls: string[] = [];
  const api = createGitHubApi({
    token: "fixture-token",
    apiRequest: async (_method, endpoint) => {
      calls.push(endpoint);
      return {
        sha: mergeSha,
        parents: parents.map((parentSha) => ({ sha: parentSha })),
      };
    },
  });
  const mergeContext = context(mergeSha, undefined, headSha);
  expect(
    await api.verifyExecutionSource("owner/rea", prRun, mergeContext),
  ).toBe(true);
  expect(calls).toEqual([`repos/owner/rea/commits/${mergeSha}`]);

  parents = [headSha, baseSha];
  expect(
    await api.verifyExecutionSource("owner/rea", prRun, mergeContext),
  ).toBe(false);
  expect(
    await api.verifyExecutionSource("owner/rea", prRun, {
      ...mergeContext,
      prHeadSha: sha("e"),
    }),
  ).toBe(false);
});

it("uses static artifacts only when listing is complete, unique, and tied to this run attempt", () => {
  const artifact = {
    id: 12,
    name: "static-check-reports",
    expired: false,
    workflow_run: { id: 10, head_sha: sha("a") },
  };
  const runRecord = { id: 10, head_sha: sha("a") };
  expect(
    selectStaticCheckArtifact(
      { total_count: 1, artifacts: [artifact] },
      runRecord,
      1,
    ),
  ).toBe(artifact);
  expect(
    selectStaticCheckArtifact(
      { total_count: 2, artifacts: [artifact] },
      runRecord,
      1,
    ),
  ).toBeNull();
  expect(
    selectStaticCheckArtifact(
      { total_count: 2, artifacts: [artifact, artifact] },
      runRecord,
      1,
    ),
  ).toBeNull();
  expect(
    selectStaticCheckArtifact(
      {
        total_count: 1,
        artifacts: [
          { ...artifact, workflow_run: { id: 11, head_sha: sha("a") } },
        ],
      },
      runRecord,
      1,
    ),
  ).toBeNull();
  expect(
    selectStaticCheckArtifact(
      { total_count: 1, artifacts: [artifact] },
      runRecord,
      2,
    ),
  ).toBeNull();
  const deep = { ...artifact, id: 13, name: "static-deep-check-reports" };
  expect(
    selectStaticCheckArtifact(
      { total_count: 2, artifacts: [artifact, deep] },
      runRecord,
      1,
      "static-deep-check-reports",
    ),
  ).toBe(deep);
  expect(
    selectStaticCheckArtifact(
      { total_count: 2, artifacts: [artifact, deep] },
      runRecord,
      1,
    ),
  ).toBe(artifact);
  expect(
    selectStaticCheckArtifact(
      { total_count: 2, artifacts: [deep, deep] },
      runRecord,
      1,
      "static-deep-check-reports",
    ),
  ).toBeNull();
});

it("loads each static gate from its own artifact", async () => {
  const downloads: string[] = [];
  const api = createGitHubApi({
    token: "fixture-token",
    fetchImpl: async (url) => {
      downloads.push(String(url));
      throw new Error("stop-before-download");
    },
    apiRequest: async () => ({
      total_count: 2,
      artifacts: [
        {
          id: 1,
          name: "static-check-reports",
          expired: false,
          workflow_run: { id: 10, head_sha: sha("a") },
        },
        {
          id: 2,
          name: "static-deep-check-reports",
          expired: false,
          workflow_run: { id: 10, head_sha: sha("a") },
        },
      ],
    }),
  });
  const runRecord = { id: 10, run_attempt: 1, head_sha: sha("a") };
  await expect(
    api.getStaticEvidence("owner/rea", runRecord, {
      name: "Deep static checks",
    }),
  ).rejects.toThrow("stop-before-download");
  await expect(
    api.getStaticEvidence("owner/rea", runRecord, { name: "Static checks" }),
  ).rejects.toThrow("stop-before-download");
  expect(
    await api.getStaticEvidence("owner/rea", runRecord, {
      name: "Test shard (1)",
    }),
  ).toBeNull();
  expect(downloads).toEqual([
    "https://api.github.com/repos/owner/rea/actions/artifacts/2/zip",
    "https://api.github.com/repos/owner/rea/actions/artifacts/1/zip",
  ]);
});

it("rejects artifact redirects that could send the bearer token to a non-HTTPS host", async () => {
  const calls: string[] = [];
  await expect(
    readStaticCheckArtifact({
      repository: "owner/rea",
      artifactId: 12,
      token: "fixture-token",
      fetchImpl: (async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(null, {
          status: 302,
          headers: { location: "http://untrusted.example/artifact.zip" },
        });
      }) as typeof fetch,
    }),
  ).rejects.toThrow("static_artifact_redirect_invalid");
  expect(calls).toEqual([
    "https://api.github.com/repos/owner/rea/actions/artifacts/12/zip",
  ]);
});
