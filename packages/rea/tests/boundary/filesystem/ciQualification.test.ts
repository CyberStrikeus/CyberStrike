import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  executeWorkflowFixture,
  workflowGit,
} from "../../support/workflowGit.js";

const qualificationScript = fileURLToPath(
  new URL("../../../scripts/ci/qualification.mjs", import.meta.url),
);
const requiredScript = fileURLToPath(
  new URL("../../../scripts/ci/required.mjs", import.meta.url),
);
const now = Date.now();
const validSha = "a".repeat(40);
const repository = "example/rea";

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: "ci-full-qualification-v1",
    expired: false,
    created_at: new Date(now - 60_000).toISOString(),
    workflow_run: {
      id: 7,
      repository_id: 1,
      head_repository_id: 1,
      head_branch: "main",
      head_sha: validSha,
    },
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    status: "completed",
    conclusion: "success",
    path: ".github/workflows/ci.yml@main",
    event: "schedule",
    created_at: new Date(now - 120_000).toISOString(),
    head_sha: validSha,
    head_branch: "main",
    head_repository: { full_name: repository },
    ...overrides,
  };
}

async function admissionFixture(
  candidate: Record<string, unknown> = artifact(),
  candidateRun: Record<string, unknown> = run(),
  options: { apiError?: boolean; malformed?: boolean; force?: boolean } = {},
) {
  const directory = await createTestTempDirectory("rea-ci-qualification-");
  const bin = join(directory, "bin");
  await mkdir(bin);
  const fixturePath = join(directory, "api.json");
  await writeFile(
    fixturePath,
    options.malformed
      ? "not-json"
      : JSON.stringify({ artifacts: [candidate], run: candidateRun }),
  );
  const gh = join(bin, "gh");
  await writeFile(
    gh,
    [
      "#!/bin/sh",
      'if [ "$GH_API_ERROR" = "true" ]; then exit 1; fi',
      'case "$*" in',
      '  *actions/artifacts*) cat "$GH_FIXTURE_RESPONSE" ;;',
      "  *actions/runs/7*) node -e 'const x=require(process.env.GH_FIXTURE_RESPONSE); process.stdout.write(JSON.stringify(x.run))' ;;",
      "  *) exit 2 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  await chmod(gh, 0o755);
  const output = join(directory, "github-output");
  await writeFile(output, "");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    GH_FIXTURE_RESPONSE: fixturePath,
    GH_API_ERROR: String(options.apiError ?? false),
    CI_REPOSITORY: repository,
    CI_REPOSITORY_ID: "1",
    CI_DEFAULT_BRANCH: "main",
    HEAD_SHA: validSha,
    GITHUB_RUN_ID: "100",
    GITHUB_OUTPUT: output,
    ...(options.force ? { CI_FORCE_FULL: "true" } : {}),
  };
  return { directory, output, env };
}

async function decide(
  candidate?: Record<string, unknown>,
  candidateRun?: Record<string, unknown>,
  options?: { apiError?: boolean; malformed?: boolean; force?: boolean },
) {
  const fixture = await admissionFixture(candidate, candidateRun, options);
  const result = await executeWorkflowFixture(
    process.execPath,
    [qualificationScript],
    {
      cwd: fixture.directory,
      env: fixture.env,
    },
  );
  return {
    ...fixture,
    decision: z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(result.stdout)),
    outputText: await readFile(fixture.output, "utf8"),
  };
}

it("reuses only a recent trusted full qualification for the exact default-branch SHA", async () => {
  const { decision, outputText } = await decide();
  expect(decision).toMatchObject({ run_full: false, run_id: 7 });
  expect(Object.keys(decision).sort()).toEqual([
    "reason",
    "run_full",
    "run_id",
  ]);
  expect(outputText).toContain("run_full=false\n");
  expect(outputText).toContain("run_id=7\n");
});

const rejectedCandidates: Array<
  [string, () => Record<string, unknown>, () => Record<string, unknown>]
> = [
  [
    "old",
    () =>
      artifact({
        created_at: new Date(now - 24 * 60 * 60 * 1000 - 1).toISOString(),
      }),
    run,
  ],
  [
    "future",
    () => artifact({ created_at: new Date(now + 60_000).toISOString() }),
    run,
  ],
  ["expired", () => artifact({ expired: true }), run],
  [
    "foreign repository",
    () =>
      artifact({
        workflow_run: { ...artifact().workflow_run, repository_id: 2 },
      }),
    run,
  ],
  [
    "foreign branch",
    () =>
      artifact({
        workflow_run: { ...artifact().workflow_run, head_branch: "other" },
      }),
    run,
  ],
  [
    "foreign SHA",
    () =>
      artifact({
        workflow_run: { ...artifact().workflow_run, head_sha: "b".repeat(40) },
      }),
    run,
  ],
  [
    "untrusted workflow",
    artifact,
    () => run({ path: ".github/workflows/release.yml" }),
  ],
  ["failed run", artifact, () => run({ conclusion: "failure" })],
  [
    "old producer rerun with a fresh artifact",
    artifact,
    () =>
      run({ created_at: new Date(now - 25 * 60 * 60 * 1000).toISOString() }),
  ],
  ["wrong workflow event", artifact, () => run({ event: "push" })],
];

it.each(rejectedCandidates)(
  "runs full qualification for a %s candidate",
  async (_name, makeArtifact, makeRun) => {
    const { decision } = await decide(makeArtifact(), makeRun());
    expect(decision.run_full).toBe(true);
  },
);

it.each([
  ["API error", { apiError: true }],
  ["malformed query response", { malformed: true }],
] as const)("fails closed on %s", async (_name, options) => {
  const { decision } = await decide(undefined, undefined, options);
  expect(decision.run_full).toBe(true);
});

it("lets the daily force-full setting bypass the GitHub API", async () => {
  const { decision } = await decide(undefined, undefined, {
    force: true,
    apiError: true,
  });
  expect(decision).toMatchObject({ run_full: true });
  expect(decision.reason).toContain("Forced");
});

async function workflowContract() {
  const workflowPath = new URL(
    "../../../.github/workflows/ci.yml",
    import.meta.url,
  );
  const parsed = parse(await readFile(workflowPath, "utf8"));
  return z
    .object({
      jobs: z.record(
        z.string(),
        z.object({ needs: z.unknown().optional() }).passthrough(),
      ),
    })
    .parse(parsed).jobs;
}

async function requiredRun(
  changes: Record<string, string>,
  overrides: { failed?: string; runAttempt?: string; event?: string } = {},
) {
  const directory = await createTestTempDirectory("rea-ci-receipt-");
  await workflowGit(directory, ["init", "--initial-branch=main"]);
  await writeFile(join(directory, "fixture.txt"), "qualified source\n");
  await workflowGit(directory, ["add", "."]);
  await workflowGit(directory, ["commit", "-m", "fixture source"]);
  const head = await workflowGit(directory, ["rev-parse", "HEAD"]);
  const jobs = await workflowContract();
  const results: Record<
    string,
    { result: string; outputs?: Record<string, string> }
  > = {};
  for (const name of z.array(z.string()).parse(jobs.required?.needs)) {
    results[name] = {
      result:
        name === overrides.failed
          ? "failure"
          : changes.tier === "reused"
            ? "skipped"
            : "success",
    };
  }
  results.changes = { result: "success", outputs: changes };
  const receiptDirectory = join(directory, ".cache", "receipt");
  const output = join(directory, "github-output");
  await writeFile(output, "");
  const env = {
    ...process.env,
    CI_JOBS: JSON.stringify(results),
    CI_QUALIFICATION_DIRECTORY: receiptDirectory,
    GITHUB_EVENT_NAME: overrides.event ?? "schedule",
    GITHUB_SHA: head,
    GITHUB_RUN_ID: "100",
    GITHUB_RUN_ATTEMPT: overrides.runAttempt ?? "1",
    GITHUB_REPOSITORY: repository,
    GITHUB_OUTPUT: output,
  };
  const result = executeWorkflowFixture(process.execPath, [requiredScript], {
    cwd: directory,
    env,
  });
  return { directory, head, output, result };
}

it("writes a full receipt only after every canonical flag and workflow need pass", async () => {
  const scopesPath = new URL("../../../scripts/ci/scopes.mjs", import.meta.url);
  const { CI_FLAGS } = await import(scopesPath.href);
  const changes = Object.fromEntries(
    CI_FLAGS.map((flag: string) => [flag, "true"]),
  );
  changes.tier = "full";
  const { directory, head, output, result } = await requiredRun(changes);
  await expect(result).resolves.toMatchObject({ stderr: "" });
  const receiptPath = join(directory, ".cache", "receipt", "receipt.json");
  const receipt = z
    .object({
      sourceSha: z.string(),
      runId: z.number(),
      runAttempt: z.number(),
    })
    .parse(JSON.parse(await readFile(receiptPath, "utf8")));
  expect(receipt).toMatchObject({ sourceSha: head, runId: 100, runAttempt: 1 });
  expect(await readFile(output, "utf8")).toContain(
    `receipt_path=${receiptPath}\n`,
  );
  expect(await readFile(output, "utf8")).toContain(
    "receipt_name=ci-full-qualification-v1\n",
  );
});

it.each([
  ["failed selected lane", { failed: "sqlite-runtime" }],
  ["partial full scope", {}],
] as const)(
  "does not issue a receipt after %s",
  async (caseName, overrides) => {
    const scopesPath = new URL(
      "../../../scripts/ci/scopes.mjs",
      import.meta.url,
    );
    const { CI_FLAGS } = await import(scopesPath.href);
    const changes = Object.fromEntries(
      CI_FLAGS.map((flag: string) => [flag, "true"]),
    );
    changes.tier = "full";
    if (caseName === "partial full scope") changes.sqlite = "false";
    const outcome = await requiredRun(changes, overrides);
    await expect(outcome.result).rejects.toMatchObject({ code: 1 });
    await expect(
      readFile(join(outcome.directory, ".cache", "receipt", "receipt.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(outcome.output, "utf8")).not.toContain("receipt_");
  },
);

it("never writes a fresh receipt for a reused scheduled qualification", async () => {
  const scopesPath = new URL("../../../scripts/ci/scopes.mjs", import.meta.url);
  const { CI_FLAGS } = await import(scopesPath.href);
  const changes = Object.fromEntries(
    CI_FLAGS.map((flag: string) => [flag, "false"]),
  );
  changes.tier = "reused";
  changes.qualification_run_id = "7";
  const outcome = await requiredRun(changes);
  const result = await outcome.result;
  await expect(
    readFile(join(outcome.directory, ".cache", "receipt", "receipt.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(result.stdout).toContain("Qualification reused from run 7");
  expect(await readFile(outcome.output, "utf8")).not.toContain("receipt_");
});

it.each([
  ["missing receipt run", { qualification_run_id: "" }, "schedule"],
  ["selected validation lane", { sqlite: "true" }, "schedule"],
  ["manual dispatch", {}, "workflow_dispatch"],
] as const)(
  "rejects qualification reuse with %s",
  async (_name, override, event) => {
    const { CI_FLAGS } = await import(
      new URL("../../../scripts/ci/scopes.mjs", import.meta.url).href
    );
    const changes: Record<string, string> = {
      ...Object.fromEntries(CI_FLAGS.map((flag: string) => [flag, "false"])),
      tier: "reused",
      qualification_run_id: "7",
      ...override,
    };
    const outcome = await requiredRun(changes, { event });
    await expect(outcome.result).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("scheduled admission receipt"),
    });
    expect(await readFile(outcome.output, "utf8")).not.toContain("receipt_");
  },
);
