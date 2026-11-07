import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const repository = process.cwd();
const actionPath = join(repository, ".github/actions/npm-cache/action.yml");
const readAction = async () =>
  z
    .object({
      inputs: z
        .record(
          z.string(),
          z.object({ default: z.string().optional() }).passthrough(),
        )
        .optional(),
      outputs: z.record(z.string(), z.object({ value: z.string() })),
      runs: z.object({
        steps: z.array(
          z.object({
            id: z.string().optional(),
            if: z.string().optional(),
            uses: z.string().optional(),
            with: z.record(z.string(), z.string()).optional(),
            run: z.string().optional(),
            env: z.record(z.string(), z.string()).optional(),
          }),
        ),
      }),
    })
    .parse(parse(await readFile(actionPath, "utf8")));

const readWorkflows = async () => {
  const directory = join(repository, ".github/workflows");
  const files = (await readdir(directory)).filter((file) =>
    /\.ya?ml$/u.test(file),
  );
  return Promise.all(
    files.map(async (file) => ({
      file,
      workflow: z
        .object({
          jobs: z
            .record(
              z.string(),
              z
                .object({
                  steps: z.array(z.record(z.string(), z.unknown())).optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .parse(parse(await readFile(join(directory, file), "utf8"))),
    })),
  );
};

function aggregateHashFilesContent(contents: Buffer[]) {
  const aggregate = createHash("sha256");
  for (const content of contents)
    aggregate.update(createHash("sha256").update(content).digest());
  return aggregate.digest("hex");
}

async function verifyPrefixedHashFiles(
  retentionEnv: Record<string, string>,
  runnerWorkspace: string,
  legacyRoot: string,
) {
  const keyExpressions = [
    retentionEnv.CACHE_KEEP_KEY,
    retentionEnv.CACHE_DEEP_KEEP_KEY,
    retentionEnv.CACHE_KNIP_KEEP_KEY,
  ];
  let targetHash: string | undefined;
  for (const expression of keyExpressions) {
    if (expression === undefined)
      throw new Error("Missing retention cache key");
    const paths = expression.match(/hashFiles\(([^)]*)\)/u)?.[1];
    expect(paths).toBeDefined();
    const targetPaths = paths!.split(", ").map((path) => path.slice(1, -1));
    expect(
      targetPaths.every((path) => path.startsWith("triggering-source/")),
    ).toBe(true);
    const fileNames = targetPaths.map((path) =>
      path.slice("triggering-source/".length),
    );
    const nestedHash = aggregateHashFilesContent(
      await Promise.all(
        targetPaths.map((path) => readFile(join(runnerWorkspace, path))),
      ),
    );
    const flatHash = aggregateHashFilesContent(
      await Promise.all(
        fileNames.map((name) => readFile(join(legacyRoot, name))),
      ),
    );
    expect(nestedHash).toBe(flatHash);
    if (expression === retentionEnv.CACHE_KEEP_KEY) targetHash = nestedHash;
  }
  expect(targetHash).toBeDefined();
  return targetHash!;
}

async function exerciseTrustedRetentionWithLegacyTarget(
  retentionRun: unknown,
  retentionEnv: Record<string, string>,
) {
  const runnerWorkspace = await createTestTempDirectory(
    "rea-ci-retention-trusted-checkout-",
  );
  const legacyTarget = join(runnerWorkspace, "triggering-source");
  const legacyRoot = join(runnerWorkspace, "legacy-root");
  const trustedSource = join(runnerWorkspace, "trusted-retention");
  const inputNames = [
    ".nvmrc",
    ".npmrc",
    "package-lock.json",
    "knip.json",
    "tsconfig.json",
    "package.json",
  ];
  const targetSha = "0123456789abcdef0123456789abcdef01234567";
  await mkdir(legacyTarget, { recursive: true });
  await mkdir(legacyRoot, { recursive: true });
  for (const name of inputNames) {
    const contents = `target-source:${name}\n`;
    await writeFile(join(legacyTarget, name), contents);
    await writeFile(join(legacyRoot, name), contents);
  }
  const trustedHelperPath = join(
    trustedSource,
    "scripts/ci/cache-retention.mjs",
  );
  await mkdir(join(trustedSource, "scripts/ci"), { recursive: true });
  await copyFile(
    join(repository, "scripts/ci/cache-retention.mjs"),
    trustedHelperPath,
  );
  await expect(
    access(join(legacyTarget, "scripts/ci/cache-retention.mjs")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(trustedHelperPath)).resolves.toBeUndefined();

  // Actions hashFiles hashes file bytes, then the ordered per-file digests.
  // A common checkout-directory prefix preserves both file contents and order.
  const targetHash = await verifyPrefixedHashFiles(
    retentionEnv,
    runnerWorkspace,
    legacyRoot,
  );

  const prefix = "rea-static-v1-Linux-X64-";
  const keepKey = `${prefix}${targetHash}-${targetSha}`;
  const cacheFixture = {
    actions_caches: [
      {
        id: 1,
        key: `${prefix}old`,
        created_at: "2026-10-01T00:00:00Z",
        last_accessed_at: "2026-10-01T00:00:00Z",
        size_in_bytes: 10,
        version: "a".repeat(64),
        ref: "refs/heads/main",
      },
      {
        id: 2,
        key: `${prefix}mid`,
        created_at: "2026-10-15T00:00:00Z",
        last_accessed_at: "2026-10-15T00:00:00Z",
        size_in_bytes: 20,
        version: "a".repeat(64),
        ref: "refs/heads/main",
      },
      {
        id: 3,
        key: `${prefix}new`,
        created_at: "2026-10-20T00:00:00Z",
        last_accessed_at: "2026-10-20T00:00:00Z",
        size_in_bytes: 30,
        version: "a".repeat(64),
        ref: "refs/heads/main",
      },
      {
        id: 4,
        key: keepKey,
        created_at: "2026-09-30T00:00:00Z",
        last_accessed_at: "2026-09-30T00:00:00Z",
        size_in_bytes: 40,
        version: "a".repeat(64),
        ref: "refs/heads/main",
      },
    ],
  };
  const ghPath = join(runnerWorkspace, "bin/gh");
  const ghLog = join(runnerWorkspace, "fake-gh.log");
  const cacheInput = join(runnerWorkspace, "cache-list.json");
  await mkdir(join(runnerWorkspace, "bin"), { recursive: true });
  await writeFile(cacheInput, JSON.stringify(cacheFixture));
  await writeFile(
    ghPath,
    `#!${process.execPath}\nconst fs = require("node:fs");\nconst [command, option, method, endpoint] = process.argv.slice(2);\nif (command !== "api" || option !== "--method") process.exit(2);\nfs.appendFileSync(process.env.FAKE_GH_LOG, method + " " + endpoint + "\\n");\nif (method === "GET") process.stdout.write(fs.readFileSync(process.env.FAKE_GH_CACHE_INPUT, "utf8"));\nelse if (method !== "DELETE") process.exit(2);\n`,
  );
  await chmod(ghPath, 0o755);
  expect(retentionRun).toBe(
    "node trusted-retention/scripts/ci/cache-retention.mjs",
  );
  const helperPath = join(
    runnerWorkspace,
    String(retentionRun).replace(/^node /u, ""),
  );
  const command = execFileSync(process.execPath, [helperPath], {
    cwd: runnerWorkspace,
    env: {
      PATH: join(runnerWorkspace, "bin"),
      CI_REPOSITORY: "morluto/rea",
      CACHE_PREFIX: prefix,
      CACHE_KEEP_KEY: keepKey,
      FAKE_GH_LOG: ghLog,
      FAKE_GH_CACHE_INPUT: cacheInput,
    },
    encoding: "utf8",
  });
  const requests = await readFile(ghLog, "utf8");
  expect(JSON.parse(command)).toEqual({
    dryRun: false,
    families: [{ prefix, deleteCount: 1, deleteBytes: 10 }],
    npmDuplicateDeleteCount: 0,
    npmDuplicateDeleteBytes: 0,
  });
  expect(requests.trim().split("\n")).toEqual([
    "GET repos/morluto/rea/actions/caches?per_page=100&page=1&key=rea-static-v1-Linux-X64-",
    "DELETE repos/morluto/rea/actions/caches/1",
  ]);
}

describe("hosted npm download-cache policy", () => {
  it("only allows shared writes for trusted original default-branch events", async () => {
    const action = await readAction();
    const policy = action.runs.steps.find((step) => step.id === "context");
    const command = z.string().parse(policy?.run);

    const outputDirectory = await createTestTempDirectory(
      "rea-ci-cache-policy-",
    );
    const npmStub = join(outputDirectory, "npm");
    await writeFile(
      npmStub,
      String.raw`#!/bin/sh
printf '%s\n' 'C:\Users\runner with spaces\AppData\Local\npm-cache'
`,
    );
    await chmod(npmStub, 0o755);

    for (const [event, ref, defaultBranch, expected] of [
      ["push", "refs/heads/main", "main", "true"],
      ["schedule", "refs/heads/main", "main", "true"],
      ["workflow_dispatch", "refs/heads/main", "main", "true"],
      ["push", "refs/heads/stable", "stable", "true"],
      ["pull_request", "refs/heads/main", "main", "false"],
      ["pull_request_target", "refs/heads/main", "main", "false"],
      ["workflow_call", "refs/heads/main", "main", "false"],
      ["push", "refs/heads/feature/cache", "main", "false"],
      ["push", "refs/heads/main", "stable", "false"],
      ["push", "refs/heads/main", "", "false"],
    ]) {
      const outputPath = join(
        outputDirectory,
        `policy-${Date.now()}-${Math.random()}`,
      );
      execFileSync("bash", ["-euo", "pipefail", "-c", command], {
        env: {
          ...process.env,
          PATH: `${outputDirectory}${delimiter}${process.env.PATH ?? ""}`,
          GITHUB_EVENT_NAME: event,
          GITHUB_REF: ref,
          GITHUB_OUTPUT: outputPath,
          DEFAULT_BRANCH: defaultBranch,
          LOCKFILES_HASH: "lock-hash",
          RUNNER_OS: "Windows",
        },
      });
      const output = await readFile(outputPath, "utf8");
      expect(output).toContain(`can-save=${expected}\n`);
      expect(output).toContain(
        `path=${String.raw`C:\Users\runner with spaces\AppData\Local\npm-cache`}\n`,
      );
      expect(output).toContain(
        `key=npm-download-Windows-${process.arch}-lock-hash\n`,
      );
      expect(output).toContain(
        `restore-key=npm-download-Windows-${process.arch}-\n`,
      );
    }
  });

  it("uses a lockfile-, npmrc-, OS-, and runtime-architecture-scoped download cache", async () => {
    const action = await readAction();
    const policy = action.runs.steps.find((step) => step.id === "context");
    const restoreAndSave = action.runs.steps.find((step) =>
      step.uses?.startsWith("actions/cache@"),
    );
    const restoreOnly = action.runs.steps.find((step) =>
      step.uses?.startsWith("actions/cache/restore@"),
    );

    expect(action.inputs?.save?.default).toBe("false");
    expect(action.outputs["can-save"]?.value).toBe(
      "${{ steps.context.outputs.can-save }}",
    );
    expect(action.outputs.path?.value).toBe(
      "${{ steps.context.outputs.path }}",
    );
    expect(policy?.env?.DEFAULT_BRANCH).toBe(
      "${{ github.event.repository.default_branch }}",
    );
    expect(policy?.env?.LOCKFILES_HASH).toBe(
      "${{ hashFiles('package-lock.json', 'npm-shrinkwrap.json', '.npmrc') }}",
    );
    expect(policy?.run).toContain(
      'cache_key="npm-download-${RUNNER_OS}-${runtime_arch}-${LOCKFILES_HASH}"',
    );
    expect(restoreAndSave?.uses).toBe(
      "actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830",
    );
    expect(restoreAndSave?.if).toBe(
      "steps.context.outputs.can-save == 'true' && inputs.save == 'true'",
    );
    expect(restoreOnly?.uses).toBe(
      "actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830",
    );
    expect(restoreOnly?.if).toBe(
      "steps.context.outputs.can-save != 'true' || inputs.save != 'true'",
    );
    expect(restoreAndSave?.with?.path).toBe(
      "${{ steps.context.outputs.path }}",
    );
    expect(restoreOnly?.with?.path).toBe(restoreAndSave?.with?.path);
    expect(restoreAndSave?.with?.key).toBe("${{ steps.context.outputs.key }}");
    expect(restoreOnly?.with?.key).toBe(restoreAndSave?.with?.key);
    expect(restoreAndSave?.with?.["restore-keys"]).toBe(
      "${{ steps.context.outputs.restore-key }}",
    );
    expect(restoreOnly?.with?.["restore-keys"]).toBe(
      restoreAndSave?.with?.["restore-keys"],
    );
  });

  it("pairs npm caches with preceding Node setup and preserves conditions", async () => {
    const workflows = await readWorkflows();
    let npmCacheSteps = 0;

    for (const { file, workflow } of workflows) {
      const source = await readFile(
        join(repository, ".github/workflows", file),
        "utf8",
      );
      expect(source).not.toMatch(/^\s+cache:\s*npm\s*$/mu);
      for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
        const steps = job.steps ?? [];
        for (let index = 0; index < steps.length; index++) {
          const step = steps[index];
          if (step?.uses !== "./.github/actions/npm-cache") continue;
          npmCacheSteps++;
          const setup = steps
            .slice(0, index)
            .findLast(
              (candidate) =>
                typeof candidate.uses === "string" &&
                candidate.uses.startsWith("actions/setup-node@"),
            );
          expect(
            setup,
            `${file}:${jobName} npm cache action requires preceding setup-node`,
          ).toBeDefined();
          expect(step.if).toBe(setup?.if);
          expect(setup?.with).not.toHaveProperty("cache", "npm");
          const npmCiIndex = steps.findIndex(
            (candidate, candidateIndex) =>
              candidateIndex > index && candidate.run === "npm ci",
          );
          expect(
            npmCiIndex,
            `${file}:${jobName} retains npm ci after cache`,
          ).toBeGreaterThan(index);
        }
      }
    }

    expect(npmCacheSteps).toBeGreaterThan(0);
  });
});

it("shares static task snapshots only after validation using the npm cache owner's write authority", async () => {
  const workflows = await readWorkflows();
  const ci = workflows.find(({ file }) => file === "ci.yml");
  const steps = ci?.workflow.jobs?.static?.steps ?? [];
  expect(
    steps.find((step) => step.uses === "./.github/actions/npm-cache")?.id,
  ).toBe("npm-cache");
  const restore = steps.find((step) => step.id === "static-cache");
  const save = steps.find(
    (step) => step.name === "Save validated static task cache",
  );
  expect(restore?.uses).toBe(
    "actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830",
  );
  expect(restore?.if).toBe("needs.changes.outputs.code == 'true'");
  expect(restore?.with).toMatchObject({ path: ".turbo/cache/" });
  expect(save?.uses).toBe(
    "actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830",
  );
  expect(save?.if).toContain("success()");
  expect(save?.if).toContain("steps.npm-cache.outputs.can-save == 'true'");
  expect(save?.with).toEqual({
    path: ".turbo/cache/",
    key: "${{ steps.static-cache.outputs.cache-primary-key }}",
  });
  expect(steps.indexOf(save!)).toBeGreaterThan(
    steps.findIndex((step) => step.run === "npm run check:ci:fast"),
  );
  const deep = ci?.workflow.jobs?.["static-deep"]?.steps ?? [];
  const deepSave = deep.find(
    (step) => step.name === "Save validated deep static task cache",
  );
  const knipRestore = deep.find((step) => step.id === "knip-cache");
  const knipSave = deep.find(
    (step) => step.name === "Save Knip analysis cache",
  );
  expect(deepSave?.uses).toBe(
    "actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830",
  );
  expect(deepSave?.if).toContain("success()");
  expect(deepSave?.if).toContain("steps.npm-cache.outputs.can-save == 'true'");
  expect(deepSave?.if).toContain(
    "steps.static-cache.outputs.cache-hit != 'true'",
  );
  expect(deep.indexOf(deepSave!)).toBeGreaterThan(
    deep.findIndex((step) => step.run === "npm run check:ci:deep"),
  );
  const knipWith = z
    .object({
      path: z.string(),
      key: z.string(),
      "restore-keys": z.string(),
    })
    .parse(knipRestore?.with);
  expect(knipWith.path).toBe("node_modules/.cache/knip");
  expect(knipWith.key).toContain("${{ github.sha }}");
  expect(knipWith["restore-keys"]).not.toContain("github.sha");
  expect(knipWith["restore-keys"].startsWith("knip-meta-v1-")).toBe(true);
  expect(knipSave?.if).toContain(
    "steps.knip-cache.outputs.cache-hit != 'true'",
  );
  expect(knipSave?.with).toEqual({
    path: "node_modules/.cache/knip",
    key: "${{ steps.knip-cache.outputs.cache-primary-key }}",
  });
  expect(
    steps.find((step) => step.run === "node scripts/ci/cache-retention.mjs"),
  ).toBeUndefined();
});

it("deletes superseded caches only from the trusted follow-up workflow", async () => {
  const workflow = z
    .object({
      on: z.object({
        workflow_run: z.object({
          workflows: z.array(z.literal("CI")),
          types: z.array(z.literal("completed")),
        }),
        workflow_call: z.unknown().optional(),
        pull_request: z.unknown().optional(),
      }),
      permissions: z.record(z.string(), z.string()),
      jobs: z.record(
        z.string(),
        z.object({
          if: z.string(),
          "runs-on": z.literal("ubuntu-latest"),
          steps: z.array(z.record(z.string(), z.unknown())),
        }),
      ),
    })
    .parse(
      parse(
        await readFile(
          join(repository, ".github/workflows/cache-retention.yml"),
          "utf8",
        ),
      ),
    );
  expect(workflow.on.workflow_call).toBeUndefined();
  expect(workflow.on.pull_request).toBeUndefined();
  expect(workflow.permissions).toEqual({
    contents: "read",
    actions: "write",
  });
  const job = workflow.jobs.retain;
  expect(job?.if).toContain(
    "github.event.workflow_run.conclusion == 'success'",
  );
  expect(job?.if).toContain(
    "github.event.workflow_run.conclusion == 'failure'",
  );
  expect(job?.if).toContain(
    "github.event.workflow_run.conclusion == 'timed_out'",
  );
  expect(job?.if).toContain(
    "github.event.workflow_run.conclusion == 'cancelled'",
  );
  expect(job?.if).toContain(
    "github.event.workflow_run.head_repository.full_name == github.repository",
  );
  expect(job?.if).toContain(
    "github.event.workflow_run.head_branch == github.event.repository.default_branch",
  );
  expect(job?.if).toContain("github.event.workflow_run.event == 'push'");
  expect(job?.if).toContain("github.event.workflow_run.event == 'schedule'");
  expect(job?.if).toContain(
    "github.event.workflow_run.event == 'workflow_dispatch'",
  );
  expect(job?.if).not.toContain("pull_request");
  const steps = job?.steps ?? [];
  expect(steps.some((step) => step.run === "npm ci")).toBe(false);
  const checkouts = steps.filter(
    (step) =>
      step.uses === "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  );
  const trustedCheckout = checkouts[0];
  expect(trustedCheckout?.with).toMatchObject({
    ref: "${{ github.workflow_sha }}",
    path: "trusted-retention",
    "persist-credentials": false,
  });
  const targetCheckout = checkouts[1];
  expect(targetCheckout?.with).toMatchObject({
    ref: "${{ github.event.workflow_run.head_sha }}",
    path: "triggering-source",
    "persist-credentials": false,
  });
  expect(checkouts).toHaveLength(2);
  expect(steps.some((step) => step.run === "npm ci")).toBe(false);
  const setupNode = steps.find(
    (step) =>
      step.uses ===
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  );
  expect(setupNode?.with).toMatchObject({
    "node-version-file": "trusted-retention/.nvmrc",
  });
  const retention = steps.find(
    (step) =>
      step.run === "node trusted-retention/scripts/ci/cache-retention.mjs",
  );
  expect(retention).toBeDefined();
  const retentionEnv = z.record(z.string(), z.string()).parse(retention?.env);
  expect(retentionEnv.CACHE_PREFIX).toBe(
    "rea-static-v1-${{ runner.os }}-${{ runner.arch }}-",
  );
  expect(retentionEnv.CACHE_KEEP_KEY).toBe(
    "rea-static-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('triggering-source/.nvmrc', 'triggering-source/.npmrc', 'triggering-source/package-lock.json') }}-${{ github.event.workflow_run.head_sha }}",
  );
  expect(retentionEnv.CACHE_DEEP_KEEP_KEY).toContain(
    "hashFiles('triggering-source/.nvmrc', 'triggering-source/.npmrc', 'triggering-source/package-lock.json')",
  );
  expect(retentionEnv.CACHE_KNIP_KEEP_KEY).toContain(
    "hashFiles('triggering-source/knip.json', 'triggering-source/tsconfig.json', 'triggering-source/package.json', 'triggering-source/package-lock.json')",
  );
  expect(retentionEnv.CACHE_PORTABLE_PREFIX).toBe(
    "rea-portable-build-v2-${{ runner.os }}-${{ runner.arch }}-",
  );
  expect(retentionEnv.DEDUPE_NPM_DOWNLOADS).toBe("true");
  expect(retentionEnv.GH_TOKEN).toBe("${{ github.token }}");

  // Exercise the selected trusted helper against a legacy target tree.
  await exerciseTrustedRetentionWithLegacyTarget(retention?.run, retentionEnv);
  const ci = (await readWorkflows()).find(({ file }) => file === "ci.yml");
  expect(JSON.stringify(ci?.workflow)).not.toContain('"actions":"write"');
  const deepSteps = ci?.workflow.jobs?.["static-deep"]?.steps ?? [];
  const publishedKey = (id: string) =>
    z
      .string()
      .parse(
        z
          .record(z.string(), z.unknown())
          .parse(deepSteps.find((step) => step.id === id)?.with).key,
      );
  const savedOnThisRun = "${{ github.event.workflow_run.head_sha }}";
  const deepPrefix = "rea-static-deep-v1-${{ runner.os }}-${{ runner.arch }}-";
  const knipPrefix = "knip-meta-v1-${{ runner.os }}-";
  const targetSourceKey = (id: string) =>
    publishedKey(id)
      .replaceAll("${{ github.sha }}", savedOnThisRun)
      .replaceAll("hashFiles('", "hashFiles('triggering-source/")
      .replaceAll(", '", ", 'triggering-source/");
  expect(retentionEnv.CACHE_DEEP_PREFIX).toBe(deepPrefix);
  expect(retentionEnv.CACHE_DEEP_KEEP_KEY).toBe(
    targetSourceKey("static-cache"),
  );
  expect(publishedKey("static-cache").startsWith(deepPrefix)).toBe(true);
  expect(retentionEnv.CACHE_KNIP_PREFIX).toBe(knipPrefix);
  expect(retentionEnv.CACHE_KNIP_KEEP_KEY).toBe(targetSourceKey("knip-cache"));
  expect(publishedKey("knip-cache").startsWith(knipPrefix)).toBe(true);
});

it("publishes each hosted npm download cache from one writer", async () => {
  const workflows = await readWorkflows();
  const writers: { file: string; job: string; save: string }[] = [];
  for (const { file, workflow } of workflows)
    for (const [job, definition] of Object.entries(workflow.jobs ?? {}))
      for (const step of definition.steps ?? []) {
        if (step.uses !== "./.github/actions/npm-cache") continue;
        const save = z
          .record(z.string(), z.unknown())
          .parse(step.with ?? {}).save;
        if (save === undefined) continue;
        writers.push({ file, job, save: z.string().parse(save) });
      }
  expect(writers).toEqual([
    { file: "ci.yml", job: "static", save: "true" },
    {
      file: "ci.yml",
      job: "package-e2e",
      save: "${{ matrix.os != 'ubuntu-latest' }}",
    },
    { file: "ci.yml", job: "windows-curated", save: "true" },
  ]);
  const ci = workflows.find(({ file }) => file === "ci.yml");
  expect(ci?.workflow.jobs?.static?.permissions).toBeUndefined();
  expect(ci?.workflow.jobs?.build?.permissions).toEqual({
    contents: "read",
    actions: "read",
  });
});

it("passes the npm cache owner's selected path to package installation", async () => {
  const workflows = await readWorkflows();
  const ci = workflows.find(({ file }) => file === "ci.yml");
  const steps = ci?.workflow.jobs?.["package-e2e"]?.steps ?? [];
  const cacheIndex = steps.findIndex(
    (step) => step.uses === "./.github/actions/npm-cache",
  );
  expect(steps[cacheIndex]?.id).toBe("npm-cache");
  const consumerIndex = steps.findIndex(
    (step) => step.run === "npm run verify:package",
  );
  expect(consumerIndex).toBeGreaterThan(cacheIndex);
  expect(
    z.record(z.string(), z.unknown()).parse(steps[consumerIndex]?.env)
      .npm_config_cache,
  ).toBe("${{ steps.npm-cache.outputs.path }}");
});

it("exports turbo remote-cache credentials wherever a workflow runs turbo", async () => {
  const directory = join(repository, ".github/workflows");
  const files = (await readdir(directory)).filter((file) =>
    /\.ya?ml$/u.test(file),
  );
  const turboCommand =
    /\bturbo\b|build:cached|check:ci|docs:check|docs:generate|docs:prepare|test:prepare/u;
  const workflowSchema = z.object({
    env: z.record(z.string(), z.unknown()).optional(),
    jobs: z.record(
      z.string(),
      z
        .object({
          env: z.record(z.string(), z.unknown()).optional(),
          steps: z.array(z.object({ run: z.string().optional() })).optional(),
        })
        .passthrough(),
    ),
  });
  for (const file of files) {
    const workflow = workflowSchema.parse(
      parse(await readFile(join(directory, file), "utf8")),
    );
    for (const [name, job] of Object.entries(workflow.jobs)) {
      const runsTurbo = job.steps?.some(
        (step) => step.run !== undefined && turboCommand.test(step.run),
      );
      if (!runsTurbo) continue;
      const env = { ...workflow.env, ...job.env };
      const token = z.string().parse(env.TURBO_TOKEN);
      const cache = z.string().parse(env.TURBO_CACHE);
      expect(token, `${file}:${name}`).toContain("secrets.TURBO_TOKEN");
      expect(token, `${file}:${name}`).toContain("|| ''");
      expect(token, `${file}:${name}`).not.toBe("${{ secrets.TURBO_TOKEN }}");
      const grantsReleaseWrite = token.includes(
        "inputs.remote_cache_write == true",
      );
      const grantsCalledEvent = token.includes(
        "github.event_name == 'workflow_call'",
      );
      expect(grantsReleaseWrite || grantsCalledEvent, `${file}:${name}`).toBe(
        true,
      );
      if (grantsReleaseWrite)
        expect(token, `${file}:${name}`).not.toContain(
          "github.event_name == 'workflow_call'",
        );
      for (const event of ["push", "schedule", "workflow_dispatch"])
        expect(token, `${file}:${name}`).toContain(
          `github.event_name == '${event}'`,
        );
      expect(token, `${file}:${name}`).not.toContain(
        "github.event_name == 'pull_request'",
      );
      if (grantsReleaseWrite) {
        expect(cache, `${file}:${name}`).toContain(
          "inputs.remote_cache_write == true",
        );
        expect(cache, `${file}:${name}`).toContain("|| 'local:rw'");
        expect(cache, `${file}:${name}`).not.toContain("local:rw,remote:r'");
      } else expect(cache, `${file}:${name}`).toContain("local:rw,remote:r'");
      expect(cache, `${file}:${name}`).toContain("local:rw,remote:rw");
      expect(env.TURBO_TEAM, `${file}:${name}`).toBe("${{ vars.TURBO_TEAM }}");
    }
  }
});

it("bounds the rolling static snapshot with Turbo age and size eviction", async () => {
  const turbo = z
    .object({
      cacheMaxAge: z.string(),
      cacheMaxSize: z.string(),
    })
    .parse(JSON.parse(await readFile(join(repository, "turbo.json"), "utf8")));
  // The static job restores the previous snapshot by prefix and saves the
  // whole .turbo/cache directory again. Without local eviction every main
  // commit carries all historical entries into a new immutable GitHub cache,
  // growing transfers toward the 10 GB repository limit.
  expect(turbo.cacheMaxAge).toMatch(/^[1-9]\d*(s|m|h|d|w)$/u);
  expect(turbo.cacheMaxAge).not.toBe("0");
  const size = /^(\d+(?:\.\d+)?)(MB|GB|TB)$/iu.exec(turbo.cacheMaxSize);
  expect(size, "cacheMaxSize must use an explicit MB/GB/TB budget").not.toBe(
    null,
  );
  const value = Number(size?.[1] ?? "0");
  const unit = (size?.[2] ?? "MB").toUpperCase();
  const megabytes =
    unit === "TB" ? value * 1024 * 1024 : unit === "GB" ? value * 1024 : value;
  expect(megabytes).toBeGreaterThan(0);
  expect(megabytes).toBeLessThanOrEqual(1024);
});
