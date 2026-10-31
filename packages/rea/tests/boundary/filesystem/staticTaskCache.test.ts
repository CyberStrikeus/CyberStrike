import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { workflowGit } from "../../support/workflowGit.js";
import { resolveTypeScriptCompiler } from "../../../scripts/run-typescript.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const turbo = join(repository, "scripts/run-turbo.mjs");
const reportScript = join(repository, "scripts/ci/static-check-report.mjs");
const rootConfigSchema = z.object({
  globalDependencies: z.array(z.string()).optional(),
  globalPassThroughEnv: z.array(z.string()).optional(),
  tasks: z.record(z.string(), z.record(z.string(), z.unknown())),
});
const dryRunSchema = z.object({
  tasks: z.array(z.object({ taskId: z.string(), hash: z.string() })),
});

const execute = (command: string, args: string[], cwd: string) =>
  spawnSync(process.execPath, [command, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });

const readRootConfig = async () =>
  rootConfigSchema.parse(
    JSON.parse(await readFile(join(repository, "turbo.json"), "utf8")),
  );

const writeTaskFixture = async (
  root: string,
  taskNames: string[],
  scripts: Record<string, string>,
  imports?: Record<string, string>,
) => {
  const config = await readRootConfig();
  const tasks = Object.fromEntries(
    taskNames.map((name) => {
      const task = config.tasks[name];
      if (task === undefined) throw new Error(`Missing Turbo task ${name}`);
      // Measure each task's own input ownership without dependency hashes.
      const { dependsOn: _dependsOn, ...definition } = task;
      return [name, definition];
    }),
  );
  await writeFile(
    join(root, "turbo.json"),
    JSON.stringify(
      {
        ...(config.globalDependencies === undefined
          ? {}
          : { globalDependencies: config.globalDependencies }),
        ...(config.globalPassThroughEnv === undefined
          ? {}
          : { globalPassThroughEnv: config.globalPassThroughEnv }),
        tasks,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "rea-static-task-cache-fixture",
      version: "1.0.0",
      private: true,
      type: "module",
      packageManager: "npm@11.16.0",
      scripts,
      ...(imports === undefined ? {} : { imports }),
    }),
  );
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({
      name: "rea-static-task-cache-fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "rea-static-task-cache-fixture", version: "1.0.0" },
      },
    }),
  );
};

const runTurbo = (
  root: string,
  task: string,
  cacheDirectory: string,
  dryRun = false,
) =>
  execute(
    turbo,
    [
      "run",
      task,
      ...(dryRun ? ["--dry=json"] : ["--output-logs=errors-only"]),
      "--cache=local:rw,remote:r",
      "--cache-dir",
      cacheDirectory,
    ],
    root,
  );

const taskHash = (root: string, task: string, cacheDirectory: string) => {
  const result = runTurbo(root, task, cacheDirectory, true);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const { tasks } = dryRunSchema.parse(JSON.parse(result.stdout));
  const entry = tasks.find(({ taskId }) => taskId === task);
  if (entry === undefined) throw new Error(`Turbo omitted task ${task}`);
  return entry.hash;
};

it("restores a real lint report across cold, warm, and fresh consumer checkouts", async () => {
  const producer = await createTestTempDirectory("rea-static-cache-producer-");
  const consumer = await createTestTempDirectory("rea-static-cache-consumer-");
  const cache = await createTestTempDirectory("rea-static-cache-store-");
  const script = "node scripts/ci/static-check-report.mjs lint";
  for (const root of [producer, consumer]) {
    await mkdir(join(root, "scripts/ci"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await symlink(
      join(repository, "node_modules"),
      join(root, "node_modules"),
      "junction",
    );
    await writeTaskFixture(root, ["lint"], { lint: script });
    await writeFile(
      join(root, ".nvmrc"),
      await readFile(join(repository, ".nvmrc")),
    );
    await writeFile(join(root, ".gitignore"), ".cache/\nnode_modules/\n");
    await writeFile(
      join(root, ".oxlintrc.json"),
      JSON.stringify({ rules: { "no-debugger": "error" } }),
    );
    await writeFile(join(root, "src/check.js"), "export const ready = true;\n");
    await writeFile(
      join(root, "scripts/ci/static-check-report.mjs"),
      await readFile(reportScript, "utf8"),
    );
    await workflowGit(root, ["init", "--initial-branch=main"]);
    await workflowGit(root, ["add", "."]);
    await workflowGit(root, ["commit", "-m", "test: seed static task cache"]);
  }

  const cold = runTurbo(producer, "lint", cache);
  expect(cold.error).toBeUndefined();
  expect(cold.status, cold.stderr).toBe(0);
  expect(cold.stdout).toMatch(/Cached:\s+0 cached/u);
  const report = join(producer, ".cache/static-checks/oxlint.json");
  const cleanReport = await readFile(report, "utf8");

  await rm(join(producer, ".cache"), { recursive: true });
  const warm = runTurbo(producer, "lint", cache);
  expect(warm.error).toBeUndefined();
  expect(warm.status, warm.stderr).toBe(0);
  expect(warm.stdout).toMatch(/Cached:\s+1 cached/u);
  expect(await readFile(report, "utf8")).toBe(cleanReport);

  const freshConsumer = runTurbo(consumer, "lint", cache);
  expect(freshConsumer.error).toBeUndefined();
  expect(freshConsumer.status, freshConsumer.stderr).toBe(0);
  expect(freshConsumer.stdout).toMatch(/Cached:\s+1 cached/u);
  expect(
    await readFile(join(consumer, ".cache/static-checks/oxlint.json"), "utf8"),
  ).toBe(cleanReport);

  await writeFile(join(consumer, "src/check.js"), "debugger;\n");
  const invalid = runTurbo(consumer, "lint", cache);
  expect(invalid.error).toBeUndefined();
  expect(invalid.status).not.toBe(0);
  expect(invalid.stdout).toMatch(/Cached:\s+0 cached/u);
  const { diagnostics } = z
    .object({
      diagnostics: z.array(
        z.object({ code: z.string().optional(), severity: z.string() }),
      ),
    })
    .parse(
      JSON.parse(
        await readFile(
          join(consumer, ".cache/static-checks/oxlint.json"),
          "utf8",
        ),
      ),
    );
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: "eslint(no-debugger)",
      severity: "error",
    }),
  );
});

it.each(["workflow", "action manifest"])(
  "invalidates Knip for GitHub %s entrypoints and module contents",
  async (kind) => {
    const root = await createTestTempDirectory("rea-knip-github-inputs-");
    const cache = await createTestTempDirectory("rea-knip-github-cache-");
    for (const directory of [
      "src",
      ".github/workflows",
      ".github/actions/probe",
    ])
      await mkdir(join(root, directory), { recursive: true });
    await symlink(
      join(repository, "node_modules"),
      join(root, "node_modules"),
      "junction",
    );
    await writeTaskFixture(root, ["knip"], {
      knip: "node node_modules/knip/bin/knip.js",
    });
    await writeFile(
      join(root, ".gitignore"),
      "node_modules/\n.cache/\n.turbo/\n",
    );
    await writeFile(
      join(root, "knip.json"),
      JSON.stringify({ entry: ["src/main.js"], project: ["src/**/*.js"] }),
    );
    await writeFile(join(root, "src/main.js"), 'console.log("ready");\n');
    const modulePath = join(root, ".github/actions/fault.mjs");
    const invalidModule = 'import "rea-ci-controlled-yaml-dependency";\n';
    await writeFile(modulePath, invalidModule);
    const workflow = (entry: string) =>
      JSON.stringify({
        name: "Probe",
        on: "workflow_dispatch",
        jobs: {
          probe: {
            "runs-on": "ubuntu-latest",
            steps: [{ run: `node ${entry}` }],
          },
        },
      });
    const action = (entry: string) =>
      JSON.stringify({
        name: "Probe",
        runs: { using: "node24", main: entry },
      });
    await writeFile(
      join(root, ".github/workflows/ci.yml"),
      workflow("src/main.js"),
    );
    if (kind === "action manifest")
      await writeFile(
        join(root, ".github/actions/probe/action.yml"),
        action("../../../src/main.js"),
      );
    await workflowGit(root, ["init", "--initial-branch=main"]);
    await workflowGit(root, ["add", "."]);
    await workflowGit(root, ["commit", "-m", "test: seed Knip GitHub inputs"]);
    const cold = runTurbo(root, "knip", cache);
    expect(cold.status, cold.stdout + cold.stderr).toBe(0);
    expect(cold.stdout).toMatch(/Cached:\s+0 cached/u);
    await writeFile(join(root, ".github/README.md"), "# Unrelated notes\n");
    await writeFile(
      join(root, ".github/actions/notes.yml"),
      "# Unrelated notes\n",
    );
    const warm = runTurbo(root, "knip", cache);
    expect(warm.status, warm.stdout + warm.stderr).toBe(0);
    expect(warm.stdout).toMatch(/Cached:\s+1 cached/u);
    await writeFile(
      join(
        root,
        kind === "workflow"
          ? ".github/workflows/ci.yml"
          : ".github/actions/probe/action.yml",
      ),
      kind === "workflow"
        ? workflow(".github/actions/fault.mjs")
        : action("../fault.mjs"),
    );
    const invalid = runTurbo(root, "knip", cache);
    expect(invalid.error).toBeUndefined();
    expect(invalid.status, invalid.stdout + invalid.stderr).not.toBe(0);
    expect(invalid.stdout).toMatch(/Cached:\s+0 cached/u);
    expect(invalid.stdout + invalid.stderr).toContain(
      "rea-ci-controlled-yaml-dependency",
    );

    // A reachable module can change dependencies without another manifest edit.
    await writeFile(modulePath, 'console.log("ready");\n');
    const reachable = runTurbo(root, "knip", cache);
    expect(reachable.status, reachable.stdout + reachable.stderr).toBe(0);
    const reused = runTurbo(root, "knip", cache);
    expect(reused.status, reused.stdout + reused.stderr).toBe(0);
    expect(reused.stdout).toMatch(/Cached:\s+1 cached/u);
    await writeFile(modulePath, invalidModule);
    const changedModule = runTurbo(root, "knip", cache);
    expect(changedModule.error).toBeUndefined();
    expect(
      changedModule.status,
      changedModule.stdout + changedModule.stderr,
    ).not.toBe(0);
    expect(changedModule.stdout).toMatch(/Cached:\s+0 cached/u);
    expect(changedModule.stdout + changedModule.stderr).toContain(
      "rea-ci-controlled-yaml-dependency",
    );
  },
);

it.each([
  {
    label: "imported documentation helper",
    path: "docs/.vitepress/helper.ts",
    content: 'export const value: number = "invalid";\n',
    diagnostic: "TS2322",
    invalidatesCompile: false,
  },
  {
    label: "documentation package scope",
    path: "docs/package.json",
    content: '{"type":"commonjs"}\n',
    diagnostic: "CommonJS",
    invalidatesCompile: false,
  },
  {
    label: "source package scope",
    path: "src/package.json",
    content: '{"type":"commonjs"}\n',
    diagnostic: "CommonJS",
    invalidatesCompile: true,
  },
  {
    label: "test package scope",
    path: "tests/package.json",
    content: '{"type":"commonjs"}\n',
    diagnostic: "CommonJS",
    invalidatesCompile: false,
  },
  {
    label: "declaration package scope",
    path: "scripts/package.json",
    content: '{"imports":{"#compiler-scope":"./shadow-types.d.mts"}}\n',
    diagnostic: "TS2322",
    invalidatesCompile: false,
  },
  {
    label: "compiler launcher",
    path: "scripts/run-typescript.mjs",
    content: 'throw new Error("compiler launcher changed");\n',
    diagnostic: "compiler launcher changed",
    invalidatesCompile: true,
  },
  {
    label: "source declaration",
    path: "src/types.d.mts",
    content: "export type SourceValue = 2;\n",
    diagnostic: "TS2322",
    invalidatesCompile: true,
  },
  {
    label: "test declaration",
    path: "tests/types.d.cts",
    content: 'export type TestValue = "shadow";\n',
    diagnostic: "TS2322",
    invalidatesCompile: false,
  },
  {
    label: "script declaration",
    path: "scripts/value.d.cts",
    content: 'export type ScriptValue = "shadow";\n',
    diagnostic: "TS2322",
    invalidatesCompile: false,
  },
  {
    label: "GitHub action source",
    path: ".github/actions/helper.ts",
    content: "export const githubValue = 2;\n",
    diagnostic: "TS2322",
    invalidatesCompile: false,
  },
  {
    label: "GitHub action declaration",
    path: ".github/actions/api.d.mts",
    content: "export type GithubValue = 2;\n",
    diagnostic: "TS2322",
    invalidatesCompile: false,
  },
  {
    label: "GitHub action package scope",
    path: ".github/actions/package.json",
    content: '{"type":"commonjs"}\n',
    diagnostic: "CommonJS",
    invalidatesCompile: false,
  },
])(
  "rejects a changed $label after warming real compiler tasks",
  async ({ path, content, diagnostic, invalidatesCompile }) => {
    const root = await createTestTempDirectory("rea-compiler-cache-inputs-");
    const cache = await createTestTempDirectory("rea-compiler-cache-store-");
    await mkdir(join(root, "docs/.vitepress"), { recursive: true });
    await mkdir(join(root, ".github/actions"), { recursive: true });
    for (const directory of ["src", "tests", "scripts"])
      await mkdir(join(root, directory));
    await symlink(
      join(repository, "node_modules"),
      join(root, "node_modules"),
      "junction",
    );
    await writeTaskFixture(
      root,
      ["compile", "typecheck"],
      {
        // Exercise the real compiler phase with the production task inputs.
        compile: "node scripts/run-typescript.mjs -p tsconfig.build.json",
        typecheck: "node scripts/run-typescript.mjs --noEmit",
      },
      { "#compiler-scope": "./scripts/root-types.d.mts" },
    );
    await writeFile(
      join(root, "scripts/run-typescript.mjs"),
      await readFile(join(repository, "scripts/run-typescript.mjs")),
    );
    for (const name of [
      "tsconfig.json",
      "tsconfig.build.json",
      ".nvmrc",
      ".npmrc",
    ])
      await writeFile(join(root, name), await readFile(join(repository, name)));
    await writeFile(
      join(root, ".gitignore"),
      "node_modules/\n.cache/\n.turbo/\ndist/\n",
    );
    await writeFile(
      join(root, "src/main.ts"),
      'import type { SourceValue } from "./types.mjs";\nexport const value: SourceValue = 1;\n',
    );
    await writeFile(
      join(root, "src/types.d.mts"),
      "export type SourceValue = 1;\n",
    );
    await writeFile(
      join(root, "docs/.vitepress/helper.ts"),
      "export const value: number = 1;\n",
    );
    await writeFile(
      join(root, "docs/.vitepress/config.ts"),
      'import { value } from "./helper.js";\nexport const configValue: number = value;\n',
    );
    await writeFile(
      join(root, "scripts/root-types.d.mts"),
      'export type Scope = "root";\n',
    );
    await writeFile(
      join(root, "scripts/shadow-types.d.mts"),
      'export type Scope = "shadow";\n',
    );
    await writeFile(
      join(root, "scripts/api.d.mts"),
      'import type { Scope } from "#compiler-scope";\nexport type ApiScope = Scope;\n',
    );
    await writeFile(
      join(root, "tests/use-script.ts"),
      'import type { ApiScope } from "../scripts/api.mjs";\nimport type { TestValue } from "./types.cjs";\nimport type { ScriptValue } from "../scripts/value.cjs";\nexport const scope: ApiScope = "root";\nexport const testValue: TestValue = "root";\nexport const scriptValue: ScriptValue = "root";\n',
    );
    await writeFile(
      join(root, ".github/actions/helper.ts"),
      "export const githubValue = 1;\n",
    );
    await writeFile(
      join(root, ".github/actions/api.d.mts"),
      "export type GithubValue = 1;\n",
    );
    await writeFile(
      join(root, "tests/use-github.ts"),
      'import { githubValue } from "../.github/actions/helper.js";\nimport type { GithubValue } from "../.github/actions/api.mjs";\nexport const actionValue: GithubValue = githubValue;\n',
    );
    await writeFile(
      join(root, "tests/types.d.cts"),
      'export type TestValue = "root";\n',
    );
    await writeFile(
      join(root, "scripts/value.d.cts"),
      'export type ScriptValue = "root";\n',
    );
    await workflowGit(root, ["init", "--initial-branch=main"]);
    await workflowGit(root, ["add", "."]);
    await workflowGit(root, ["commit", "-m", "test: seed compiler cache"]);
    const tasks = ["compile", "typecheck"];
    const hashes = new Map<string, string>();
    for (const task of tasks) {
      const cold = runTurbo(root, task, cache);
      expect(cold.error).toBeUndefined();
      expect(cold.status, cold.stdout + cold.stderr).toBe(0);
      expect(cold.stdout).toMatch(/Cached:\s+0 cached/u);
      hashes.set(task, taskHash(root, task, cache));
    }
    await writeFile(
      join(root, "docs/guide.md"),
      "# Documentation-only change\n",
    );
    for (const directory of ["cache", "dist"]) {
      await mkdir(join(root, "docs/.vitepress", directory));
      await writeFile(
        join(root, "docs/.vitepress", directory, "generated.ts"),
        "export const generated = 1;\n",
      );
    }
    for (const task of tasks) {
      expect(taskHash(root, task, cache)).toBe(hashes.get(task));
      const warm = runTurbo(root, task, cache);
      expect(warm.status, warm.stdout + warm.stderr).toBe(0);
      expect(warm.stdout).toMatch(/Cached:\s+1 cached/u);
    }
    await writeFile(join(root, path), content);
    for (const task of tasks) {
      const invalidates = task === "typecheck" || invalidatesCompile;
      const result = runTurbo(root, task, cache);
      expect(result.error).toBeUndefined();
      if (invalidates) {
        expect(result.status, result.stdout + result.stderr).toBeGreaterThan(0);
        expect(result.stdout + result.stderr).toContain(diagnostic);
        expect(taskHash(root, task, cache)).not.toBe(hashes.get(task));
      } else {
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toMatch(/Cached:\s+1 cached/u);
        expect(taskHash(root, task, cache)).toBe(hashes.get(task));
      }
    }
  },
);

it("invalidates checker task hashes for Node, ignore, and VitePress config changes", async () => {
  const root = await createTestTempDirectory("rea-static-cache-inputs-");
  const cache = await createTestTempDirectory("rea-static-cache-hashes-");
  await mkdir(join(root, "docs/.vitepress"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeTaskFixture(
    root,
    ["jscpd", "knip", "metadata:check", "scan:todos"],
    // This fixture probes only Turbo's real task hash; the checker commands
    // are intentionally inert so the hash test cannot invoke large suites.
    {
      jscpd: 'node -e "process.exit(0)"',
      knip: 'node -e "process.exit(0)"',
      "metadata:check": 'node -e "process.exit(0)"',
      "scan:todos": 'node -e "process.exit(0)"',
    },
  );
  await writeFile(join(root, ".nvmrc"), "24.18.0\n");
  await writeFile(join(root, ".npmrc"), "engine-strict=true\n");
  await writeFile(join(root, ".gitignore"), ".cache/\n");
  await writeFile(join(root, ".jscpd.json"), "{}\n");
  await writeFile(join(root, "docs/.vitepress/config.ts"), "export {};\n");
  await writeFile(
    join(root, "vitest.config.ts"),
    'import { CiTestSequencer } from "./tests/ciTestSequencer.js";\nexport const sequencer = CiTestSequencer;\n',
  );
  await writeFile(join(root, "src/input.ts"), "export {};\n");
  await writeFile(join(root, "tests/input.ts"), "export {};\n");

  const initial = new Map<string, string>();
  for (const task of ["jscpd", "knip", "metadata:check", "scan:todos"])
    initial.set(task, taskHash(root, task, cache));

  await writeFile(join(root, ".nvmrc"), "24.19.0\n");
  for (const task of ["jscpd", "metadata:check", "scan:todos"])
    expect(
      taskHash(root, task, cache),
      `${task} must hash the Node pin`,
    ).not.toBe(initial.get(task));
  await writeFile(join(root, ".nvmrc"), "24.18.0\n");

  await writeFile(join(root, ".npmrc"), "engine-strict=false\n");
  for (const task of ["jscpd", "knip", "metadata:check", "scan:todos"])
    expect(
      taskHash(root, task, cache),
      `${task} must hash npm settings`,
    ).not.toBe(initial.get(task));
  await writeFile(join(root, ".npmrc"), "engine-strict=true\n");
  for (const task of ["jscpd", "metadata:check", "scan:todos"])
    expect(taskHash(root, task, cache), `${task} restores after Node pin`).toBe(
      initial.get(task),
    );

  await writeFile(join(root, ".gitignore"), ".cache/\ncoverage/\n");
  for (const task of ["jscpd", "knip"])
    expect(taskHash(root, task, cache), `${task} must hash gitignore`).not.toBe(
      initial.get(task),
    );
  await writeFile(join(root, ".gitignore"), ".cache/\n");
  for (const task of ["jscpd", "knip"])
    expect(
      taskHash(root, task, cache),
      `${task} restores after gitignore`,
    ).toBe(initial.get(task));

  await writeFile(
    join(root, "docs/.vitepress/config.ts"),
    "export const configRevision = 2;\n",
  );
  expect(
    taskHash(root, "knip", cache),
    "knip must hash its configured VitePress entry",
  ).not.toBe(initial.get("knip"));
  await writeFile(join(root, "docs/.vitepress/config.ts"), "export {};\n");

  await writeFile(join(root, "vitest.config.ts"), "export {};\n");
  expect(
    taskHash(root, "knip", cache),
    "knip must hash vitest.config.ts so unused sequencer imports invalidate the cache",
  ).not.toBe(initial.get("knip"));
  for (const task of ["jscpd", "metadata:check", "scan:todos"])
    expect(
      taskHash(root, task, cache),
      `${task} must ignore vitest.config.ts`,
    ).toBe(initial.get(task));
});

it.skipIf(resolveTypeScriptCompiler().name !== "tsrs")(
  "does not replay an official compiler success for a Rust compiler error",
  async () => {
    const root = await createTestTempDirectory("rea-cross-compiler-cache-");
    const cache = await createTestTempDirectory("rea-cross-compiler-store-");
    const require = createRequire(import.meta.url);
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules/tsrs"), { recursive: true });
    for (const name of ["typescript", "turbo"])
      await symlink(
        dirname(require.resolve(`${name}/package.json`)),
        join(root, "node_modules", name),
        "junction",
      );
    for (const name of ["run-typescript.mjs", "run-turbo.mjs"])
      await writeFile(
        join(root, "scripts", name),
        await readFile(join(repository, "scripts", name)),
      );
    await writeTaskFixture(root, ["compile", "typecheck"], {
      compile: "node scripts/run-typescript.mjs -p tsconfig.build.json",
      typecheck: "node scripts/run-typescript.mjs --noEmit",
    });
    const rustPath = require.resolve("tsrs/package.json");
    const rust = z
      .object({ version: z.string(), bin: z.object({ tsrs: z.string() }) })
      .parse(JSON.parse(await readFile(rustPath, "utf8")));
    const writeInventory = (supported: boolean) =>
      writeFile(
        join(root, "node_modules/tsrs/package.json"),
        JSON.stringify({
          name: "tsrs",
          version: rust.version,
          bin: { tsrs: resolve(dirname(rustPath), rust.bin.tsrs) },
          optionalDependencies: supported
            ? { [`@tsrs/${process.platform}-${process.arch}`]: rust.version }
            : {},
        }),
      );
    await writeInventory(false);
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          rootDir: "src",
          types: [],
          lib: ["ES2023", "DOM"],
          target: "ES2023",
          module: "NodeNext",
          outDir: "dist",
        },
        include: ["src/**/*.ts"],
      }),
    );
    await writeFile(
      join(root, "tsconfig.build.json"),
      '{"extends":"./tsconfig.json"}\n',
    );
    await writeFile(
      join(root, ".gitignore"),
      "node_modules/\ndist/\n.cache/\n.turbo/\n",
    );
    // TS 7.0 accepts this contextual callback; TS 7.1 reports TS7031.
    // The source stays identical while only the selected compiler changes.
    await writeFile(
      join(root, "src/repro.ts"),
      [
        "interface Options { signal?: AbortSignal }",
        "interface Provider { inspect(options?: Options): Promise<void> }",
        "declare const base: Provider;",
        "const providers: Provider[] = [{ ...base, inspect: async ({ signal } = {}) => {",
        "  if (signal?.aborted) throw signal.reason;",
        "} }];",
      ].join("\n"),
    );
    await workflowGit(root, ["init", "--initial-branch=main"]);
    await workflowGit(root, ["add", "."]);
    await workflowGit(root, ["commit", "-m", "test: seed compiler isolation"]);
    const run = (task: string, dryRun = false) =>
      execute(
        join(root, "scripts/run-turbo.mjs"),
        [
          "run",
          task,
          ...(dryRun ? ["--dry=json"] : ["--output-logs=errors-only"]),
          "--cache=local:rw",
          "--cache-dir",
          cache,
        ],
        root,
      );
    const hash = (task: string) => {
      const result = run(task, true);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const entry = dryRunSchema
        .parse(JSON.parse(result.stdout))
        .tasks.find((value) => value.taskId === task);
      if (entry === undefined) throw new Error(`Missing compiler task ${task}`);
      return entry.hash;
    };
    const hashes = new Map<string, string>();
    for (const task of ["compile", "typecheck"]) {
      const cold = run(task);
      expect(cold.status, cold.stdout + cold.stderr).toBe(0);
      hashes.set(task, hash(task));
      const warm = run(task);
      expect(warm.status, warm.stdout + warm.stderr).toBe(0);
      expect(warm.stdout).toMatch(/Cached:\s+1 cached/u);
    }
    await writeInventory(true);
    for (const task of ["compile", "typecheck"]) {
      const result = run(task);
      expect(result.status, result.stdout + result.stderr).toBeGreaterThan(0);
      expect(result.stdout + result.stderr).toContain("TS7031");
      expect(result.stdout).toMatch(/Cached:\s+0 cached/u);
      expect(hash(task)).not.toBe(hashes.get(task));
    }
  },
);
