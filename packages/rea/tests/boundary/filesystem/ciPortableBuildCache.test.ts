import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const script = fileURLToPath(
  new URL("../../../scripts/ci/portable-build-cache.mjs", import.meta.url),
);
const first = { taskId: "compile", hash: "0123456789abcdef" };
const second = { taskId: "artifacts:skills", hash: "fedcba9876543210" };
const plan = { tasks: [first, second] };
const prefix = "rea-portable-build-v2-Linux-X64-toolchain";
const output = ".cache/ci-build-cache";
const manifestName = "portable-build-cache.json";

function run(
  root: string,
  mode: "key" | "snapshot",
  input: unknown = plan,
  environment: NodeJS.ProcessEnv = {},
) {
  const result = spawnSync(process.execPath, [script, mode], {
    cwd: root,
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, BUILD_CACHE_PREFIX: prefix, ...environment },
  });
  expect(result.error).toBeUndefined();
  return result;
}

async function fixture() {
  const root = await createTestTempDirectory("rea-ci-portable-cache-");
  await mkdir(join(root, ".turbo/cache"), { recursive: true });
  return root;
}

async function entry(root: string, hash: string, manifest = true) {
  for (const suffix of [
    ".tar.zst",
    "-meta.json",
    ...(manifest ? ["-manifest.json"] : []),
  ])
    await writeFile(
      join(root, ".turbo/cache", `${hash}${suffix}`),
      `${hash}${suffix}\n`,
    );
}

async function inventory(root: string, path: string) {
  const files = (await readdir(join(root, path))).sort();
  return Promise.all(
    files.map(async (name) => [
      name,
      await readFile(join(root, path, name), "hex"),
    ]),
  );
}

const payload = async (root: string) =>
  (await inventory(root, output)).filter(([name]) => name !== manifestName);

const coverage = async (root: string) =>
  JSON.parse(await readFile(join(root, output, manifestName), "utf8"));

it("publishes only current task companions without changing the source cache or retaining old snapshots", async () => {
  const root = await fixture();
  await entry(root, first.hash);
  await entry(root, second.hash, false);
  await entry(root, "aaaaaaaaaaaaaaaa");
  const before = await inventory(root, ".turbo/cache");
  const result = run(root, "snapshot");
  expect(result.status, result.stderr).toBe(0);
  const current = before.filter(
    ([name]) => name?.startsWith(first.hash) || name?.startsWith(second.hash),
  );
  expect(await payload(root)).toEqual(current);
  expect(JSON.parse(result.stdout)).toMatchObject({
    tasks: 2,
    files: 6,
    path: output,
    missing_tasks: [],
  });
  expect(await coverage(root)).toEqual({
    version: 1,
    tasks: plan.tasks.map((task) => ({ ...task, available: true })),
  });
  expect(run(root, "snapshot", { tasks: [second] }).status).toBe(0);
  expect(await payload(root)).toEqual(
    before.filter(([name]) => name?.startsWith(second.hash)),
  );
  expect(await inventory(root, ".turbo/cache")).toEqual(before);
});

it("retains existing cross-run keys independent of plan order and invalidates changed task hashes", async () => {
  const root = await fixture();
  const digest = createHash("sha256")
    .update(
      plan.tasks
        .map(({ taskId, hash }) => `${taskId}:${hash}`)
        .sort()
        .join("\n"),
    )
    .digest("hex");
  const expected = `key=${prefix}-${digest}\nprefix=${prefix}-\n`;
  const result = run(root, "key", {
    tasks: plan.tasks.map((task) => ({ ...task, command: "not retained" })),
    environmentVariables: { passthrough: ["not retained"] },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(expected);
  expect(
    JSON.parse(await readFile(join(root, ".cache/ci-build-plan.json"), "utf8")),
  ).toEqual(plan);
  expect(run(root, "key", { tasks: [second, first] }).stdout).toBe(expected);
  const changed = run(root, "key", {
    tasks: [first, { ...second, hash: "aaaaaaaaaaaaaaaa" }],
  });
  expect(changed.status, changed.stderr).toBe(0);
  expect(changed.stdout).not.toBe(expected);
});

it("rejects malformed or ambiguous plans in both commands and removes stale publication output", async () => {
  const root = await fixture();
  for (const invalid of [
    "not JSON",
    {},
    { tasks: [] },
    { tasks: [{ taskId: "compile" }] },
    { tasks: [{ ...first, hash: null }] },
    { tasks: [{ ...first, hash: "../outside" }] },
    { tasks: [first, { ...first, hash: second.hash }] },
  ]) {
    await mkdir(join(root, output), { recursive: true });
    await writeFile(join(root, output, "old-success"), "stale");
    await writeFile(
      join(root, ".cache/ci-build-plan.json"),
      JSON.stringify(plan),
    );
    for (const mode of ["key", "snapshot"] as const) {
      const result = run(root, mode, invalid);
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stdout).toBe("");
    }
    await expect(readdir(join(root, output))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(root, ".cache/ci-build-plan.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
});

it("records cold caches and omits whole entries with missing required companions", async () => {
  const root = await fixture();
  const cold = run(root, "snapshot");
  expect(cold.status, cold.stderr).toBe(0);
  expect(JSON.parse(cold.stdout)).toMatchObject({
    files: 1,
    missing_tasks: plan.tasks.map((task) => task.taskId),
  });
  expect(await payload(root)).toEqual([]);
  expect(await coverage(root)).toEqual({
    version: 1,
    tasks: plan.tasks.map((task) => ({ ...task, available: false })),
  });
  await entry(root, first.hash);
  for (const suffix of [".tar.zst", "-meta.json"]) {
    await entry(root, second.hash);
    await rm(join(root, ".turbo/cache", `${second.hash}${suffix}`));
    const result = run(root, "snapshot");
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      files: 4,
      missing_tasks: [second.taskId],
    });
    expect(
      (await payload(root)).every(([name]) => name?.startsWith(first.hash)),
    ).toBe(true);
    expect(await coverage(root)).toEqual({
      version: 1,
      tasks: [
        { ...first, available: true },
        { ...second, available: false },
      ],
    });
  }
});

it("rejects non-file cache companions and cleans up already copied entries", async () => {
  const root = await fixture();
  await entry(root, first.hash);
  for (const suffix of [".tar.zst", "-meta.json", "-manifest.json"]) {
    await entry(root, second.hash);
    const path = join(root, ".turbo/cache", `${second.hash}${suffix}`);
    await rm(path);
    await mkdir(path);
    const result = run(root, "snapshot");
    expect(result.status, result.stderr).not.toBe(0);
    await expect(readdir(join(root, output))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await rm(path, { recursive: true, force: true });
  }
});

it.each([
  { suffix: "-meta.json", code: "ENOENT" },
  { suffix: "-manifest.json", code: "ENOENT" },
  { suffix: "-meta.json", code: "EACCES" },
])(
  "handles $code during $suffix copying without publishing partial entries",
  async ({ suffix, code }) => {
    const root = await fixture();
    await entry(root, first.hash);
    await entry(root, second.hash);
    const preload = join(root, "evict-during-copy.mjs");
    await writeFile(
      preload,
      `
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const copy = fs.copyFile;
fs.copyFile = async (source, ...args) => {
  if (source.endsWith(${JSON.stringify(second.hash + suffix)})) {
    if (${JSON.stringify(code)} === "ENOENT") await fs.unlink(source);
    else throw Object.assign(new Error("copy denied"), { code: "EACCES" });
  }
  return copy(source, ...args);
};
syncBuiltinESMExports();
`,
    );
    const result = run(root, "snapshot", plan, {
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`,
    });
    if (code === "EACCES") {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("EACCES");
      await expect(readdir(join(root, output))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } else {
      expect(result.status, result.stderr).toBe(0);
      const missing = suffix === "-meta.json";
      expect(JSON.parse(result.stdout).missing_tasks).toEqual(
        missing ? [second.taskId] : [],
      );
      expect(
        (await payload(root)).filter(([name]) => name?.startsWith(second.hash)),
      ).toHaveLength(missing ? 0 : 2);
      expect((await coverage(root)).tasks).toEqual([
        { ...first, available: true },
        { ...second, available: !missing },
      ]);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "rejects symlinked archives and optional manifests without copying their targets",
  async () => {
    const root = await fixture();
    const outside = join(root, "outside");
    await writeFile(outside, "must not publish");
    for (const suffix of [".tar.zst", "-manifest.json"]) {
      await entry(root, first.hash);
      const path = join(root, ".turbo/cache", `${first.hash}${suffix}`);
      await rm(path);
      await symlink(outside, path);
      const result = run(root, "snapshot", { tasks: [first] });
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toContain("must be a regular file");
      await expect(readdir(join(root, output))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(outside, "utf8")).toBe("must not publish");
      await rm(path);
    }
  },
);

async function workflowFixture(historyKiB: number) {
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  const { packageManager } = z
    .object({ packageManager: z.string() })
    .parse(
      JSON.parse(await readFile(join(repository, "package.json"), "utf8")),
    );
  const steps = z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      run: z.string().optional(),
    }),
  );
  const action = z
    .object({ runs: z.object({ steps }) })
    .parse(
      parse(
        await readFile(
          join(repository, ".github/actions/portable-build-cache/action.yml"),
          "utf8",
        ),
      ),
    );
  const workflow = z
    .object({ jobs: z.object({ build: z.object({ steps }) }) })
    .parse(
      parse(
        await readFile(join(repository, ".github/workflows/ci.yml"), "utf8"),
      ),
    );
  const planCommand = action.runs.steps.find((step) => step.id === "plan")?.run;
  const stageCommand = workflow.jobs.build.steps.find(
    (step) => step.name === "Stage current portable build task cache",
  )?.run;
  expect(planCommand).toBeTypeOf("string");
  expect(stageCommand).toBeTypeOf("string");
  const root = await fixture();
  await symlink(
    join(repository, "node_modules"),
    join(root, "node_modules"),
    "junction",
  );
  await mkdir(join(root, "scripts/ci"), { recursive: true });
  await writeFile(
    join(root, "scripts/ci/portable-build-cache.mjs"),
    await readFile(script),
  );
  await writeFile(join(root, "input.bin"), randomBytes(192 * 1024));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "portable-cache-workflow-fixture",
      version: "1.0.0",
      private: true,
      packageManager,
      scripts: {
        "test:prepare": "turbo run build",
        "seed:prepare": "turbo run seed",
        "metadata:check": "node -e \"console.log('validated')\"",
        build: "node produce.mjs build",
        seed: "node produce.mjs seed",
      },
    }),
  );
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({
      name: "portable-cache-workflow-fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "portable-cache-workflow-fixture", version: "1.0.0" },
      },
    }),
  );
  await writeFile(
    join(root, "produce.mjs"),
    `
import { mkdir, readFile, writeFile } from "node:fs/promises";
const name = process.argv[2];
await mkdir("out", { recursive: true });
const bytes = await readFile("input.bin");
await writeFile("out/" + name + ".bin", bytes.subarray(0, (name === "seed" ? ${historyKiB} : 64) * 1024));
`,
  );
  await writeFile(
    join(root, "turbo.json"),
    JSON.stringify({
      cacheDir: ".turbo/cache",
      cacheMaxSize: "0.125MB",
      tasks: {
        "metadata:check": { outputs: [] },
        build: { dependsOn: ["metadata:check"], outputs: ["out/build.bin"] },
        seed: { dependsOn: ["metadata:check"], outputs: ["out/seed.bin"] },
      },
    }),
  );
  await writeFile(
    join(root, ".gitignore"),
    "node_modules/\n.turbo/\n.cache/\nout/\n",
  );
  const execute = (command: string | undefined, expectedStatus = 0) => {
    if (command === undefined) throw new Error("Missing workflow command");
    const result = spawnSync(
      "bash",
      ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", command],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          BUILD_CACHE_PREFIX: prefix,
          GITHUB_OUTPUT: join(root, ".turbo/action-output"),
          TURBO_CACHE_DIR: ".turbo/cache",
          TURBO_CACHE_MAX_SIZE: "0.125MB",
          TURBO_CACHE_MAX_AGE: "0",
          TURBO_TELEMETRY_DISABLED: "1",
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(expectedStatus);
    return expectedStatus === 0 ? result.stdout : result.stdout + result.stderr;
  };
  return { root, planCommand, stageCommand, execute };
}

it.skipIf(process.platform === "win32").each([
  { historyKiB: 96, evictAll: false },
  { historyKiB: 192, evictAll: false },
  { historyKiB: 96, evictAll: true },
])(
  "stages and restores current build entries through the real workflow (history=$historyKiB KiB, evictAll=$evictAll)",
  async ({ historyKiB, evictAll }) => {
    const { root, planCommand, stageCommand, execute } =
      await workflowFixture(historyKiB);
    execute(planCommand);
    // Exercise eviction at build startup, after building, and complete cache
    // loss. All are cache misses; successful build artifacts remain required.
    execute("npm run --silent seed:prepare");
    const prepared = execute("npm run --silent test:prepare");
    expect(prepared).toContain("2 successful, 2 total");
    if (historyKiB === 96)
      expect(prepared).toContain("Cached:    1 cached, 2 total");
    const artifact = await readFile(join(root, "out/build.bin"));
    if (evictAll)
      execute(
        "TURBO_CACHE_MAX_SIZE=1B npm run --silent test:prepare -- --dry=json > /dev/null",
      );
    const staged = JSON.parse(execute(stageCommand));
    const index = z
      .object({
        version: z.literal(1),
        tasks: z.array(
          z.object({
            taskId: z.string(),
            hash: z.string(),
            available: z.boolean(),
          }),
        ),
      })
      .parse(await coverage(root));
    const identities = JSON.parse(
      await readFile(join(root, ".cache/ci-build-plan.json"), "utf8"),
    );
    expect(
      index.tasks.map(({ available: _available, ...task }) => task),
    ).toEqual(identities.tasks);
    const hits = index.tasks.filter((task) => task.available).length;
    expect(staged).toMatchObject({
      tasks: 2,
      files: 1 + hits * 3,
      missing_tasks: index.tasks
        .filter((task) => !task.available)
        .map((task) => task.taskId),
    });
    if (evictAll) expect(hits).toBe(0);
    const remaining = await readdir(join(root, ".turbo/cache"));
    for (const task of index.tasks)
      expect(task.available).toBe(
        [".tar.zst", "-meta.json"].every((suffix) =>
          remaining.includes(`${task.hash}${suffix}`),
        ),
      );
    await rm(join(root, ".turbo/cache"), { recursive: true });
    await cp(join(root, output), join(root, ".turbo/cache"), {
      recursive: true,
    });
    await rm(join(root, "out"), { recursive: true });
    const restored = execute("npm run --silent test:prepare");
    expect(restored).toContain(`Cached:    ${hits} cached, 2 total`);
    expect(
      Buffer.compare(await readFile(join(root, "out/build.bin")), artifact),
    ).toBe(0);
    await expect(readFile(join(root, "out/seed.bin"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    execute(planCommand);
    execute("npm run --silent test:prepare");
    expect(JSON.parse(execute(stageCommand))).toMatchObject({
      tasks: 2,
      files: 7,
      missing_tasks: [],
    });
    if (evictAll) {
      await writeFile(join(root, "produce.mjs"), "process.exitCode = 47;\n");
      expect(execute("npm run --silent test:prepare", 47)).toContain("(47)");
    }
  },
);
