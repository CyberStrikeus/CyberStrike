import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  classifyPrCi,
  collectPrCiHealth,
  matchRunToPullRequest,
  writePrCiHealthReport,
} from "../../../scripts/ci/pr-ci-health.mjs";
import { createGhApiRequest } from "../../../scripts/ci/github-api.mjs";
import type {
  PrCiPullRequest,
  PrCiWorkflowRun,
} from "../../../scripts/ci/pr-ci-health.mjs";
import { executeWorkflowFixture } from "../../support/workflowGit.js";

const reporter = fileURLToPath(
  new URL("../../../scripts/ci/pr-ci-health.mjs", import.meta.url),
);
const observedAt = Date.parse("2026-10-14T00:00:00Z");
const headSha = "a".repeat(40);
const mergeSha = "b".repeat(40);

it("classifies workflow states without confusing absent, pending, and completed CI", () => {
  const pull = validPull();
  const cases = [
    [
      "startup_failure",
      run({ status: "completed", conclusion: "startup_failure" }),
    ],
    [
      "queued_pending_executing",
      run({ status: "in_progress", conclusion: null }),
    ],
    ["approval_required", run({ status: "waiting", conclusion: null })],
    ["completed_failure", run({ status: "completed", conclusion: "failure" })],
    [
      "completed_canceled",
      run({ status: "completed", conclusion: "cancelled" }),
    ],
    ["completed_success", run({ status: "completed", conclusion: "success" })],
    ["completed_other", run({ status: "completed", conclusion: "neutral" })],
    [
      "completed_other",
      run({ status: "completed", conclusion: "constructor" }),
    ],
  ] as const;
  for (const [category, evidence] of cases) {
    for (const runsComplete of [true, false]) {
      const result = classifyPrCi({
        pull,
        runs: [
          {
            run: { ...evidence, run_attempt: 1 },
            basis: "event_pr_number_and_head_sha",
          },
        ],
        runsComplete,
        pullRequestInventoryComplete: true,
        ambiguousRuns: [],
      });
      expect(result).toMatchObject({
        category: runsComplete ? category : "unknown",
        ...(runsComplete
          ? {}
          : { reason: "workflow_run_inventory_incomplete" }),
        runs: [
          {
            id: 77,
            attempt: 1,
            status: evidence.status,
            conclusion: evidence.conclusion,
          },
        ],
      });
    }
  }
  for (const runsComplete of [true, false]) {
    expect(
      classifyPrCi({
        pull: { ...pull, mergeable: false },
        runs: [],
        runsComplete,
        pullRequestInventoryComplete: true,
        ambiguousRuns: [],
      }).category,
    ).toBe("merge_conflict");
  }
});

it("requires complete inventories, known mergeability, and immutable head identity to report missing", () => {
  const pull = validPull({ mergeable: true });
  const classify = (overrides = {}) =>
    classifyPrCi({
      pull,
      runs: [],
      runsComplete: true,
      pullRequestInventoryComplete: true,
      ambiguousRuns: [],
      ...overrides,
    });

  expect(classify().category).toBe("missing");
  expect(classify({ runsComplete: false })).toMatchObject({
    category: "deferred",
    reason: "lookup_inventory_incomplete",
  });
  expect(classify({ pullRequestInventoryComplete: false }).category).toBe(
    "deferred",
  );
  expect(
    classify({
      ambiguousRuns: [{ run: run(), basis: "ambiguous_head_identity" }],
    }).category,
  ).toBe("unknown");
  expect(classify({ pull: { ...pull, mergeable: undefined } }).category).toBe(
    "unknown",
  );
  expect(classify({ pull: { ...pull, identityValid: false } }).category).toBe(
    "unknown",
  );
});

it("accepts event PR/head evidence for merge-SHA runs and refuses ambiguous branch identities", () => {
  const pull = validPull();
  const associatedMergeRun = run({
    head_sha: mergeSha,
    pull_requests: [
      {
        number: pull.number!,
        head: { sha: headSha, repo: { id: pull.head.repositoryId } },
      },
    ],
  });
  expect(
    matchRunToPullRequest({
      run: associatedMergeRun,
      pull,
      identityCounts: new Map([["73\u0000feature", 1]]),
    }),
  ).toEqual({ kind: "match", basis: "event_pr_number_and_head_sha" });
  expect(
    matchRunToPullRequest({
      run: run({
        pull_requests: [
          { number: pull.number!, head: { sha: "c".repeat(40) } },
        ],
      }),
      pull,
      identityCounts: new Map([["73\u0000feature", 1]]),
    }).kind,
  ).toBe("none");

  const branchRun = run({ pull_requests: [] });
  expect(
    matchRunToPullRequest({
      run: branchRun,
      pull,
      identityCounts: new Map([["73\u0000feature", 1]]),
      inventoryComplete: false,
    }).kind,
  ).toBe("ambiguous");
  expect(
    matchRunToPullRequest({
      run: branchRun,
      pull,
      identityCounts: new Map([["73\u0000feature", 1]]),
    }),
  ).toEqual({
    kind: "match",
    basis: "event_unique_head_ref_and_repository_id",
  });
  expect(
    matchRunToPullRequest({
      run: run({ head_sha: mergeSha, pull_requests: [] }),
      pull,
      identityCounts: new Map([["73\u0000feature", 1]]),
    }).kind,
  ).toBe("none");
  expect(
    matchRunToPullRequest({
      run: run({
        pull_requests: [{ number: pull.number!, head: { sha: headSha } }],
      }),
      pull,
      identityCounts: new Map([["73\u0000feature", 1]]),
    }).kind,
  ).toBe("ambiguous");
  expect(
    matchRunToPullRequest({
      run: branchRun,
      pull,
      identityCounts: new Map([["73\u0000feature", 2]]),
    }).kind,
  ).toBe("ambiguous");
  expect(
    matchRunToPullRequest({
      run: run({ event: "workflow_dispatch" }),
      pull,
      identityCounts: new Map([["73\u0000feature", 1]]),
    }).kind,
  ).toBe("none");
});

it("scans target-branch PRs through public gh GET requests and writes JSON and Markdown", async () => {
  const fixture = await createFixture();
  const calls: string[] = [];
  const apiRequest: NonNullable<
    Parameters<typeof collectPrCiHealth>[0]["apiRequest"]
  > = async (method, endpoint) => {
    calls.push(`${method} ${endpoint}`);
    if (method !== "GET") throw new Error("fixture rejected a non-GET request");
    if (endpoint.includes("/pulls?"))
      return [
        rawPull(42, { mergeable: true }),
        rawPull(43, { mergeable: false }),
        rawPull(44, {
          base: { ref: "release", repo: { id: 11 } },
          mergeable: true,
        }),
        rawPull(45, { draft: true, mergeable: true }),
      ];
    if (endpoint.includes("/actions/workflows/ci.yml/runs?"))
      return {
        total_count: 1,
        workflow_runs: [
          run({
            id: 9001,
            event: "pull_request",
            status: "completed",
            conclusion: "failure",
            head_sha: mergeSha,
            pull_requests: [
              {
                number: 42,
                head: { sha: headSha, repo: { id: 73 } },
              },
            ],
          }),
        ],
      };
    throw new Error(`unexpected GET endpoint: ${endpoint}`);
  };
  const report = await collectPrCiHealth({
    repository: "owner/rea",
    repositoryId: 11,
    defaultBranch: "main",
    now: observedAt,
    apiRequest,
  });
  expect(calls).toHaveLength(2);
  expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
  expect(calls[0]).toContain("state=open");
  expect(calls[0]).not.toContain("base=");
  expect(calls[1]).toContain("event=pull_request");
  expect(report.pullRequests).toHaveLength(2);
  expect(report.pullRequests.map(({ number }) => number)).toEqual([42, 43]);
  expect(report.pullRequests.map(({ ci }) => ci.category)).toEqual([
    "completed_failure",
    "merge_conflict",
  ]);
  expect(report.scan).toMatchObject({
    status: "complete",
    pullRequestInventoryComplete: true,
    workflowRunInventoryComplete: true,
    apiRequests: 2,
  });

  const output = join(fixture.directory, ".cache", "ci-pr-health");
  const paths = await writePrCiHealthReport(report, output);
  const written = JSON.parse(await readFile(paths.jsonPath, "utf8"));
  const markdown = await readFile(paths.markdownPath, "utf8");
  expect(written.counts.completed_failure).toBe(1);
  expect(markdown).toContain("# Pull request CI health snapshot");
  expect(markdown).toContain("#42");
  expect(markdown).toContain("completed_failure");
});

it("counts older open PRs when deciding whether a branch/ref fallback is unique", async () => {
  const olderPull = rawPull(63, {
    created_at: "2026-09-01T00:00:00Z",
    head: { ...rawPull(63).head, ref: "shared-feature" },
  });
  const currentPull = rawPull(64, {
    mergeable: true,
    head: { ...olderPull.head },
  });
  const apiRequest: NonNullable<
    Parameters<typeof collectPrCiHealth>[0]["apiRequest"]
  > = async (_method, endpoint) => {
    if (endpoint.includes("/pulls?")) return [currentPull, olderPull];
    if (endpoint.includes("/actions/workflows/ci.yml/runs?"))
      return {
        workflow_runs: [
          run({
            head_branch: "shared-feature",
            pull_requests: [],
          }),
        ],
      };
    throw new Error(`unexpected GET endpoint: ${endpoint}`);
  };
  const report = await collectPrCiHealth({
    repository: "owner/rea",
    repositoryId: 11,
    defaultBranch: "main",
    now: observedAt,
    apiRequest,
  });
  expect(report.scan.pullRequestInventoryComplete).toBe(true);
  expect(report.pullRequests.map(({ number }) => number)).toEqual([64]);
  expect(report.pullRequests[0]?.ci).toMatchObject({
    category: "unknown",
    reason: "workflow_run_identity_ambiguous",
  });
});

it.each([false, true])(
  "keeps page-capped scans uncertain (observed success: %s)",
  async (observedSuccess) => {
    const pull = rawPull(62, { mergeable: true });
    const apiRequest: NonNullable<
      Parameters<typeof collectPrCiHealth>[0]["apiRequest"]
    > = async (_method, endpoint) => {
      if (endpoint.includes("/pulls?")) return [pull];
      const page = Number(
        new URL(`https://fixture.invalid/${endpoint}`).searchParams.get("page"),
      );
      return {
        workflow_runs: Array.from({ length: 100 }, (_item, index) =>
          observedSuccess && page === 1 && index === 0
            ? run({
                run_attempt: 1,
                pull_requests: [
                  { number: 62, head: { sha: headSha, repo: { id: 73 } } },
                ],
              })
            : run({
                id: page * 100 + index,
                head_branch: "different-branch",
                head_repository: { id: 999 },
                pull_requests: [],
              }),
        ),
      };
    };
    const report = await collectPrCiHealth({
      repository: "owner/rea",
      repositoryId: 11,
      defaultBranch: "main",
      now: observedAt,
      apiRequest,
    });
    expect(report.scan.workflowRunPages).toBe(5);
    expect(report.scan.workflowRunInventoryComplete).toBe(false);
    const firstPull = report.pullRequests[0];
    if (firstPull === undefined) throw new Error("fixture PR was not scanned");
    expect(firstPull.ci).toMatchObject({
      category: observedSuccess ? "unknown" : "deferred",
      reason: observedSuccess
        ? "workflow_run_inventory_incomplete"
        : "lookup_inventory_incomplete",
    });
    expect(firstPull.ci.runs).toHaveLength(observedSuccess ? 1 : 0);
  },
);

it("keeps the result unknown when the head changes between API snapshots", async () => {
  const apiRequest: NonNullable<
    Parameters<typeof collectPrCiHealth>[0]["apiRequest"]
  > = async (_method, endpoint) => {
    if (endpoint.includes("/pulls?")) return [rawPull(63)];
    if (endpoint.includes("/actions/workflows/ci.yml/runs?"))
      return { workflow_runs: [] };
    return {
      ...rawPull(63, { mergeable: true }),
      head: {
        ...rawPull(63).head,
        sha: mergeSha,
      },
    };
  };
  const report = await collectPrCiHealth({
    repository: "owner/rea",
    repositoryId: 11,
    defaultBranch: "main",
    now: observedAt,
    apiRequest,
  });
  expect(report.pullRequests[0]).toMatchObject({
    identityChangedDuringScan: true,
    ci: { category: "unknown", reason: "pull_request_head_identity_invalid" },
  });
  expect(report.scan).toMatchObject({
    status: "partial",
    errors: ["pull_request_identity_changed_during_scan"],
  });
});

it("public CLI uses only GET and produces a report from fixture GitHub responses", async () => {
  const fixture = await createFixture();
  const ghCalls = join(fixture.directory, "gh-calls.jsonl");
  const ghResponse = join(fixture.directory, "gh-response.json");
  const fakeGh = join(fixture.fakeBin, "gh");
  await writeFile(
    ghResponse,
    JSON.stringify([
      [rawPull(51, { mergeable: true, created_at: new Date().toISOString() })],
      { total_count: 0, workflow_runs: [] },
    ]),
  );
  await writeFile(
    fakeGh,
    `#!/usr/bin/env node\nconst fs=require("node:fs");\nconst args=process.argv.slice(2);\nfs.appendFileSync(process.env.CI_GH_CALLS, JSON.stringify(args)+"\\n");\nif(args[0]!=="api"||args[1]!=="--method"||args[2]!=="GET")process.exit(41);\nconst page=Number(new URL("https://fixture.invalid/"+args.at(-1)).searchParams.get("page"));\nconst responses=JSON.parse(fs.readFileSync(process.env.CI_GH_RESPONSE,"utf8"));\nprocess.stdout.write(JSON.stringify(responses[page===1&&args.at(-1).includes("/pulls?")?0:1]));\n`,
  );
  await chmod(fakeGh, 0o755);
  const outputDirectory = join(fixture.directory, ".cache", "ci-pr-health");
  await executeWorkflowFixture(process.execPath, [reporter], {
    cwd: fixture.directory,
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      CI_REPOSITORY: "owner/rea",
      CI_REPOSITORY_ID: "11",
      CI_DEFAULT_BRANCH: "main",
      CI_PR_HEALTH_DIRECTORY: outputDirectory,
      CI_GH_CALLS: ghCalls,
      CI_GH_RESPONSE: ghResponse,
    },
  });
  const calls = (await readFile(ghCalls, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(calls).toHaveLength(2);
  expect(
    calls.every(
      (args: string[]) => args[1] === "--method" && args[2] === "GET",
    ),
  ).toBe(true);
  const report = JSON.parse(
    await readFile(join(outputDirectory, "report.json"), "utf8"),
  );
  expect(report.pullRequests[0].ci.category).toBe("missing");
  await expect(
    readFile(join(outputDirectory, "summary.md"), "utf8"),
  ).resolves.toContain("missing");
});

it("rejects non-GET methods before launching the GitHub client", async () => {
  const fixture = await createFixture();
  const request = createGhApiRequest({
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      CI_GH_CALLS: join(fixture.directory, "should-not-exist"),
    },
  });
  await expect(
    request("POST", "repos/owner/rea/pulls", {
      requests: 0,
      startedAt: observedAt,
      limitMs: 1_000,
    }),
  ).rejects.toThrow("read-only GET");
  await expect(
    readFile(join(fixture.directory, "should-not-exist")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

function validPull(overrides: Partial<PrCiPullRequest> = {}): PrCiPullRequest {
  return {
    number: 42,
    identityValid: true,
    mergeable: true,
    head: { repositoryId: 73, ref: "feature", sha: headSha },
    ...overrides,
  };
}

it.each([
  ["newer run", { id: 78, created_at: "2026-10-13T01:00:00Z" }, "unknown"],
  [
    "older run",
    { id: 78, created_at: "2026-10-12T23:00:00Z" },
    "completed_success",
  ],
  ["equal timestamps", { id: 78 }, "unknown"],
  [
    "retry of an older run",
    { id: 78, created_at: "2026-10-12T23:00:00Z", run_attempt: 2 },
    "unknown",
  ],
  ["unknown timestamp", { id: 78, created_at: "invalid" }, "unknown"],
  ["newer attempt", { run_attempt: 3 }, "unknown"],
  ["older attempt", { run_attempt: 1 }, "completed_success"],
] as const)(
  "retains ambiguity evidence for a %s without reporting a stale completion",
  (_label, overrides, category) => {
    const currentAttempt = "id" in overrides ? 1 : 2;
    const result = classifyPrCi({
      pull: validPull(),
      runs: [
        {
          run: run({ run_attempt: currentAttempt }),
          basis: "event_pr_number_and_head_sha",
        },
      ],
      ambiguousRuns: [
        {
          run: run({ run_attempt: currentAttempt, ...overrides }),
          basis: "ambiguous_head_identity",
        },
      ],
      runsComplete: true,
      pullRequestInventoryComplete: true,
    });
    expect(result.category).toBe(category);
    expect(result.runs).toHaveLength(2);
  },
);

it("does not let an older proven run hide a newer run with an unverified repository ID", async () => {
  const pull = rawPull(42);
  const older = run({
    id: 70,
    created_at: "2026-10-13T00:00:00Z",
    pull_requests: [{ number: 42, head: { sha: headSha, repo: { id: 73 } } }],
  });
  const newer = run({
    id: 71,
    created_at: "2026-10-13T01:00:00Z",
    status: "in_progress",
    conclusion: null,
    pull_requests: [{ number: 42, head: { sha: headSha } }],
  });
  const report = await collectPrCiHealth({
    repository: "owner/rea",
    repositoryId: 11,
    defaultBranch: "main",
    now: observedAt,
    apiRequest: async (_method, endpoint) => {
      if (endpoint.includes("/pulls?")) return [pull];
      if (endpoint.endsWith("/pulls/42")) return { ...pull, mergeable: true };
      return { workflow_runs: [newer, older] };
    },
  });
  expect(report.pullRequests[0]?.ci).toMatchObject({
    category: "unknown",
    reason: "workflow_run_identity_ambiguous",
  });
  expect(report.pullRequests[0]?.ci.runs).toHaveLength(2);
});

it("keeps a proven newest run even when two older matched runs have equal timestamps", () => {
  const result = classifyPrCi({
    pull: validPull(),
    runs: [
      run({ id: 70, run_attempt: 1 }),
      run({ id: 71, run_attempt: 1, conclusion: "failure" }),
      run({
        id: 72,
        run_attempt: 1,
        created_at: "2026-10-13T01:00:00Z",
        status: "in_progress",
        conclusion: null,
      }),
    ].map((run) => ({ run, basis: "event_pr_number_and_head_sha" })),
    ambiguousRuns: [],
    runsComplete: true,
    pullRequestInventoryComplete: true,
  });
  expect(result.category).toBe("queued_pending_executing");
  expect(result.runs).toHaveLength(3);
});

function run(overrides: Partial<PrCiWorkflowRun> = {}): PrCiWorkflowRun {
  return {
    id: 77,
    event: "pull_request",
    head_branch: "feature",
    head_repository: { id: 73 },
    head_sha: headSha,
    status: "completed",
    conclusion: "success",
    created_at: "2026-10-13T00:00:00Z",
    pull_requests: [],
    ...overrides,
  };
}

function rawPull(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    draft: false,
    created_at: "2026-10-13T00:00:00Z",
    html_url: `https://github.com/owner/rea/pull/${String(number)}`,
    base: { ref: "main", repo: { id: 11 } },
    head: {
      ref: `feature-${String(number)}`,
      sha: headSha,
      repo: { id: 73, full_name: "contributor/rea" },
    },
    ...overrides,
  };
}

async function createFixture() {
  const directory = await createTestTempDirectory("rea-ci-pr-health-");
  const fakeBin = join(directory, "bin");
  await mkdir(fakeBin);
  return { directory, fakeBin };
}
