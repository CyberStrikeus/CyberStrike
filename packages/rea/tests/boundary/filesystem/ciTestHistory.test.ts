import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { executeWorkflowFixture } from "../../support/workflowGit.js";

const script = fileURLToPath(
  new URL("../../../scripts/ci/test-history.mjs", import.meta.url),
);
const repository = "example/rea";
const repositoryId = 1;
const now = Date.now();

function artifact(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id: id + 100,
    name: "test-timings-full",
    expired: false,
    created_at: new Date(now - 60_000).toISOString(),
    workflow_run: {
      id,
      repository_id: repositoryId,
      head_repository_id: repositoryId,
      head_branch: "main",
    },
    ...overrides,
  };
}

function run(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "completed",
    conclusion: "success",
    path: ".github/workflows/ci.yml@main",
    event: "schedule",
    created_at: new Date(now - 120_000).toISOString(),
    head_branch: "main",
    head_repository: { full_name: repository },
    ...overrides,
  };
}

async function invoke(
  artifacts: unknown[],
  runs: Record<number, unknown>,
  options: {
    apiError?: boolean;
    repository?: string;
    repositoryId?: string;
    tier?: string;
  } = {},
) {
  const directory = await createTestTempDirectory("rea-ci-test-history-");
  const fakeBin = join(directory, "bin");
  await mkdir(fakeBin);
  const fixture = join(directory, "api.json");
  const calls = join(directory, "api-calls");
  const output = join(directory, "github-output");
  await writeFile(fixture, JSON.stringify({ artifacts, runs }));
  await writeFile(output, "");
  await writeFile(calls, "");
  const fakeGh = join(fakeBin, "gh");
  await writeFile(
    fakeGh,
    [
      "#!/bin/sh",
      'printf \'%s\\n\' "$*" >> "$GH_API_CALLS"',
      'if [ "$GH_API_ERROR" = "true" ]; then exit 1; fi',
      'if [ "$4" = "repos/example/rea/actions/artifacts" ]; then',
      '  node -e \'const fs=require("node:fs"); const x=JSON.parse(fs.readFileSync(process.env.GH_FIXTURE_RESPONSE,"utf8")); process.stdout.write(JSON.stringify({artifacts:x.artifacts}));\'',
      "else",
      '  run_id="${4##*/}"',
      '  node -e \'const fs=require("node:fs"); const x=JSON.parse(fs.readFileSync(process.env.GH_FIXTURE_RESPONSE,"utf8")); process.stdout.write(JSON.stringify(x.runs[Number(process.argv[1])] ?? {}));\' "$run_id"',
      "fi",
      "",
    ].join("\n"),
  );
  await chmod(fakeGh, 0o755);
  const node24 = dirname(process.execPath);
  const result = await executeWorkflowFixture(process.execPath, [script], {
    cwd: directory,
    env: {
      ...process.env,
      PATH: [fakeBin, node24, process.env.PATH ?? ""].join(delimiter),
      GH_FIXTURE_RESPONSE: fixture,
      GH_API_CALLS: calls,
      GH_API_ERROR: String(options.apiError ?? false),
      GH_TOKEN: "fixture-token",
      CI_REPOSITORY: options.repository ?? repository,
      CI_REPOSITORY_ID: options.repositoryId ?? String(repositoryId),
      CI_DEFAULT_BRANCH: "main",
      CI_TIMING_TIER: options.tier ?? "",
      GITHUB_OUTPUT: output,
    },
  });
  return {
    result,
    output: await readFile(output, "utf8"),
    calls: await readFile(calls, "utf8"),
  };
}

it("selects the latest trusted full run that actually published timing history", async () => {
  const { result, output, calls } = await invoke(
    [
      artifact(15),
      artifact(14),
      artifact(13, {
        workflow_run: { ...artifact(13).workflow_run, head_repository_id: 2 },
      }),
      artifact(12, {
        workflow_run: { ...artifact(12).workflow_run, head_branch: "feature" },
      }),
      artifact(11),
    ],
    {
      15: run(15, { conclusion: "failure" }),
      14: run(14, { path: ".github/workflows/release.yml" }),
      11: run(11, { event: "workflow_dispatch" }),
    },
    { tier: "full" },
  );

  expect(JSON.parse(result.stdout)).toEqual({
    run_id: "11",
    artifact_name: "test-timings-full",
  });
  expect(output).toBe("run-id=11\nartifact-name=test-timings-full\n");
  expect(calls).toContain("name=test-timings-full");
  expect(calls).toContain("per_page=100");
  expect(calls.match(/actions\/runs\//gu)).toHaveLength(3);
  expect(calls).not.toContain("actions/workflows");
});

it("rejects expired, foreign, old, and pull-request candidates", async () => {
  const { result, output } = await invoke(
    [
      artifact(15, { expired: true }),
      artifact(14, {
        workflow_run: { ...artifact(14).workflow_run, head_repository_id: 2 },
      }),
      artifact(13, {
        created_at: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      artifact(12),
    ],
    {
      12: run(12, { event: "pull_request" }),
    },
    { tier: "full" },
  );

  expect(JSON.parse(result.stdout)).toEqual({
    run_id: "",
    artifact_name: "",
  });
  expect(output).toBe("run-id=\nartifact-name=\n");
});

it("writes an empty run id when GitHub history is unavailable", async () => {
  const { result, output } = await invoke(
    [],
    {},
    {
      apiError: true,
      tier: "full",
    },
  );
  expect(JSON.parse(result.stdout)).toEqual({
    run_id: "",
    artifact_name: "",
  });
  expect(output).toBe("run-id=\nartifact-name=\n");
});

it("bounds run lookups to five artifacts even when inventory has more", async () => {
  const ids = [25, 24, 23, 22, 21, 20, 19];
  const { result, calls } = await invoke(
    ids.map((id) => artifact(id)),
    Object.fromEntries(
      ids.map((id, index) => [
        id,
        run(id, index < 5 ? { conclusion: "failure" } : {}),
      ]),
    ),
    { tier: "full" },
  );

  expect(JSON.parse(result.stdout)).toEqual({
    run_id: "",
    artifact_name: "",
  });
  expect(calls.match(/actions\/runs\//gu)).toHaveLength(5);
});

it("returns empty history without querying for an invalid repository identity", async () => {
  const { result, output, calls } = await invoke(
    [],
    {},
    {
      repository: "owner/repo?per_page=100",
      repositoryId: "not-an-id",
    },
  );
  expect(JSON.parse(result.stdout)).toEqual({
    run_id: "",
    artifact_name: "",
  });
  expect(output).toBe("run-id=\nartifact-name=\n");
  expect(calls).toBe("");
});

it("selects fast history without reading the full-tier artifact", async () => {
  const { result, calls } = await invoke(
    [
      artifact(32, {
        created_at: new Date(now - 30_000).toISOString(),
      }),
      artifact(31, {
        name: "test-timings-fast",
        created_at: new Date(now - 90_000).toISOString(),
      }),
      artifact(30, {
        name: "test-timings-fast",
        created_at: new Date(now - 20_000).toISOString(),
        workflow_run: {
          ...artifact(30).workflow_run,
          head_branch: "feature",
        },
      }),
    ],
    {
      32: run(32, { event: "schedule" }),
      31: run(31, { event: "push" }),
    },
    { tier: "fast" },
  );

  expect(JSON.parse(result.stdout)).toEqual({
    run_id: "31",
    artifact_name: "test-timings-fast",
  });
  expect(calls).toContain("name=test-timings-fast");
  expect(calls).not.toContain("name=test-timings-full");
  expect(calls.match(/actions\/runs\//gu)).toHaveLength(1);
});

it("ignores pull-request fast history instead of borrowing another artifact", async () => {
  const { result, calls } = await invoke(
    [artifact(41, { name: "test-timings-fast" }), artifact(40)],
    {
      41: run(41, { event: "pull_request" }),
      40: run(40, { event: "workflow_dispatch" }),
    },
    { tier: "fast" },
  );

  expect(JSON.parse(result.stdout)).toEqual({
    run_id: "",
    artifact_name: "",
  });
  expect(calls).toContain("name=test-timings-fast");
  expect(calls).not.toContain("name=test-timings-full");
  expect(calls.match(/actions\/runs\//gu)).toHaveLength(1);
});

it("leaves fast history empty when only full-tier history was published", async () => {
  const { result, output, calls } = await invoke(
    [artifact(70)],
    { 70: run(70, { event: "schedule" }) },
    { tier: "fast" },
  );

  expect(JSON.parse(result.stdout)).toEqual({
    run_id: "",
    artifact_name: "",
  });
  expect(output).toBe("run-id=\nartifact-name=\n");
  expect(calls).toContain("name=test-timings-fast");
  expect(calls).not.toContain("name=test-timings-full");
  expect(calls).not.toMatch(/actions\/runs\//u);
});

it("does not query when the tier has no timing artifact", async () => {
  const { result, output, calls } = await invoke([artifact(71)], {
    71: run(71, { event: "schedule" }),
  });

  expect(JSON.parse(result.stdout)).toEqual({
    run_id: "",
    artifact_name: "",
  });
  expect(output).toBe("run-id=\nartifact-name=\n");
  expect(calls).toBe("");
});

it("selects full-tier history without using a newer fast artifact", async () => {
  const { result } = await invoke(
    [
      artifact(61, {
        name: "test-timings-fast",
        created_at: new Date(now - 10_000).toISOString(),
      }),
      artifact(60, {
        name: "test-timings-full",
        created_at: new Date(now - 80_000).toISOString(),
      }),
    ],
    {
      61: run(61, { event: "push" }),
      60: run(60, { event: "schedule" }),
    },
    { tier: "full" },
  );

  expect(JSON.parse(result.stdout)).toEqual({
    run_id: "60",
    artifact_name: "test-timings-full",
  });
});
