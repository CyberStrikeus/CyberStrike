import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { execFileOutput } from "../../../src/process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const run = (
  root: string,
  command: string,
  arguments_: readonly string[],
  env?: NodeJS.ProcessEnv,
) =>
  execFileOutput(command, arguments_, {
    cwd: root,
    stopSignal: "SIGTERM",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    ...(env === undefined ? {} : { env }),
  });

const git = (root: string, ...arguments_: string[]) =>
  run(root, "git", arguments_);

const commit = (root: string, message: string) =>
  git(
    root,
    "-c",
    "user.name=REA fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--quiet",
    "-m",
    message,
  );

const fixture = async () => {
  const root = await createTestTempDirectory("rea-development-tests-");
  await mkdir(join(root, "scripts", "lib"), { recursive: true });
  await mkdir(join(root, "src"));
  for (const path of [
    "scripts/run-development-tests.mjs",
    "scripts/run-exact-tests.mjs",
    "scripts/run-exclusive.mjs",
    "scripts/run-exclusive-command.mjs",
    "scripts/lib/development-tests.mjs",
    "scripts/lib/test-projects.mjs",
    "scripts/lib/windows-owned-command.mjs",
  ])
    await copyFile(join(process.cwd(), path), join(root, path));
  await symlink(
    join(process.cwd(), "node_modules"),
    join(root, "node_modules"),
    process.platform === "win32" ? "junction" : undefined,
  );
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(join(root, ".gitignore"), "node_modules\nselected.txt\n");
  await writeFile(
    join(root, "vitest.config.mjs"),
    'export default { test: { projects: [{ test: { name: "domain", include: ["src/**/*.test.ts"] } }] } };\n',
  );
  await writeFile(join(root, "src/value.ts"), "export const value = 1;\n");
  await writeFile(
    join(root, "src/value.test.ts"),
    'import { expect, it } from "vitest"; import { writeFileSync } from "node:fs"; import { value } from "./value.js"; it("checks the selected source", () => { expect(value).toBe(1); writeFileSync("selected.txt", String(value)); });\n',
  );
  await git(root, "init", "--quiet", "-b", "main");
  await git(root, "add", ".");
  await commit(root, "fixture");
  return root;
};

// Assertions read the child's plain-text summary. An inherited color setting
// styled the counts in the CI lane; NO_COLOR takes precedence over FORCE_COLOR.
const testCommand = (root: string, ...arguments_: string[]) =>
  run(
    root,
    process.execPath,
    ["scripts/run-development-tests.mjs", ...arguments_],
    { ...process.env, NO_COLOR: "1" },
  );

describe("development test runner symlink aliases", () => {
  it("rejects excluded file and directory aliases without running their targets", async ({
    skip,
  }) => {
    for (const { kind, mode } of [
      { kind: "file", mode: "focused" },
      { kind: "directory", mode: "local" },
      { kind: "directory", mode: "focused" },
    ] as const) {
      const root = await fixture();
      const included =
        kind === "file" ? join(root, "src") : join(root, "src", "domain");
      const includedTest = join(included, "value.test.ts");
      const alias =
        kind === "file"
          ? join(root, "src", "excluded.test.ts")
          : join(root, "src", "contracts");
      if (kind === "directory") {
        await mkdir(included);
        for (const name of ["value.ts", "value.test.ts"])
          await copyFile(join(root, "src", name), join(included, name));
      }
      try {
        await symlink(
          kind === "file" ? includedTest : included,
          alias,
          kind === "directory"
            ? process.platform === "win32"
              ? "junction"
              : "dir"
            : undefined,
        );
      } catch (cause) {
        if (
          process.platform === "win32" &&
          cause instanceof Error &&
          "code" in cause &&
          (cause.code === "EPERM" || cause.code === "EACCES")
        )
          skip("Windows symlink creation requires unavailable privileges");
        throw cause;
      }
      const selectedAlias =
        kind === "file"
          ? "src/excluded.test.ts"
          : "src/contracts/value.test.ts";
      const includedSelection =
        kind === "file" ? "src/value.test.ts" : "src/domain/value.test.ts";
      await writeFile(
        join(root, "vitest.config.mjs"),
        `export default { test: { projects: [{ test: { name: "domain", include: ["${includedSelection}"] } }] } };\n`,
      );

      await expect(
        testCommand(root, mode, selectedAlias),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          `Selected test files were not discovered: ${selectedAlias}`,
        ),
      });
      await expect(
        readFile(join(root, "selected.txt"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await testCommand(root, mode, includedSelection);
      expect(await readFile(join(root, "selected.txt"), "utf8")).toBe("1");
    }
  });
});

describe("development test runner exact selection", () => {
  it("matches selected path casing to the host filesystem", async () => {
    const root = await fixture();
    try {
      await lstat(join(root, "src/VALUE.test.ts"));
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        !("code" in cause) ||
        cause.code !== "ENOENT"
      )
        throw cause;
      await expect(
        testCommand(root, "focused", "src/VALUE.test.ts"),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("ENOENT"),
      });
      return;
    }
    await testCommand(root, "focused", "src/VALUE.test.ts");
    expect(await readFile(join(root, "selected.txt"), "utf8")).toBe("1");
  });

  it("matches Unicode-normalized aliases by filesystem identity", async () => {
    const root = await fixture();
    const composed = "caf\u00e9.test.ts";
    const decomposed = composed.normalize("NFD");
    await writeFile(
      join(root, "src", composed),
      'import { it } from "vitest"; it("checks the selected Unicode path", () => {});\n',
    );
    const selected = join(root, "src", decomposed);
    try {
      await lstat(selected);
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        !("code" in cause) ||
        cause.code !== "ENOENT"
      )
        throw cause;
      await expect(
        testCommand(root, "focused", `src/${decomposed}`),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("ENOENT"),
      });
      return;
    }
    const result = await testCommand(root, "focused", `src/${decomposed}`);
    expect(result.stdout).toContain("1 passed");
  });

  it.each(["local", "focused"])(
    "runs only the exact selected file in %s mode",
    async (mode) => {
      const root = await fixture();
      await mkdir(join(root, "src", "nested", "src"), { recursive: true });
      await writeFile(
        join(root, "src", "nested", "src", "value.test.ts"),
        'import { it } from "vitest"; it("must not run", () => { throw new Error("unselected nested test ran"); });\n',
      );
      const result = await testCommand(root, mode, "src/value.test.ts");
      expect(result.stdout).toContain("1 passed");
      expect(result.stdout).not.toContain("nested/src/value.test.ts");
      expect(await readFile(join(root, "selected.txt"), "utf8")).toBe("1");
    },
  );

  it("fails when any selected existing test file is excluded from discovery", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "src", "excluded.test.ts"),
      'import { it } from "vitest"; it("excluded", () => {});\n',
    );
    await writeFile(
      join(root, "vitest.config.mjs"),
      'export default { test: { projects: [{ test: { name: "domain", include: ["src/value.test.ts"] } }] } };\n',
    );
    await expect(
      testCommand(root, "focused", "src/value.test.ts", "src/excluded.test.ts"),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "Selected test files were not discovered: src/excluded.test.ts",
      ),
    });
  });

  it("runs every selected file and preserves selected test failures", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "src", "failure.test.ts"),
      'import { it } from "vitest"; it("selected failure", () => { throw new Error("selected regression"); });\n',
    );
    await expect(
      testCommand(root, "focused", "src/value.test.ts", "src/failure.test.ts"),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("1 failed | 1 passed"),
      stderr: expect.stringContaining("selected regression"),
    });
    expect(await readFile(join(root, "selected.txt"), "utf8")).toBe("1");
  });

  it("preserves all configured projects for an exact file", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "src/value.test.ts"),
      'import { it } from "vitest"; import { writeFileSync } from "node:fs"; it("records the project", () => writeFileSync(`selected-${process.env.REA_TEST_PROJECT}.txt`, "ran"));\n',
    );
    await writeFile(
      join(root, "vitest.config.mjs"),
      'export default { test: { projects: ["domain", "evaluation"].map(name => ({ test: { name, env: { REA_TEST_PROJECT: name }, include: ["src/value.test.ts"] } })) } };\n',
    );
    await testCommand(root, "focused", "src/value.test.ts");
    for (const name of ["domain", "evaluation"])
      expect(await readFile(join(root, `selected-${name}.txt`), "utf8")).toBe(
        "ran",
      );
  });

  it("fails an exact file with no tests even when another selected file passes", async () => {
    const root = await fixture();
    await writeFile(join(root, "src", "empty.test.ts"), "export {};\n");
    await expect(
      testCommand(root, "focused", "src/value.test.ts", "src/empty.test.ts"),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("No test suite found"),
    });
    expect(await readFile(join(root, "selected.txt"), "utf8")).toBe("1");
  });
});

describe("development test runner cancellation", () => {
  it.runIf(process.platform !== "win32")(
    "waits for the owned test process group on cancellation",
    async () => {
      const root = await fixture();
      const ready = join(root, "descendant-ready");
      const activity = join(root, "descendant-activity");
      const release = join(root, "descendant-release");
      await writeFile(
        join(root, "descendant.cjs"),
        `
        const fs = require("node:fs");
        process.on("SIGTERM", () => {});
        fs.writeFileSync("descendant-activity", "active\\n");
        fs.writeFileSync("descendant-ready", "ready");
        const timer = setInterval(() => {
          if (fs.existsSync("descendant-release")) { clearInterval(timer); clearTimeout(deadline); return; }
          fs.appendFileSync("descendant-activity", "active\\n");
        }, 20);
        const deadline = setTimeout(() => clearInterval(timer), 10000);
      `,
      );
      await writeFile(
        join(root, "src/value.test.ts"),
        'import { it } from "vitest"; import { spawn } from "node:child_process"; it("waits", async () => { spawn(process.execPath, ["descendant.cjs"], { stdio: "ignore" }); await new Promise(() => {}); }, 30000);',
      );
      const runner = spawn(
        process.execPath,
        ["scripts/run-development-tests.mjs", "local", "src/value.test.ts"],
        { cwd: root, stdio: "ignore" },
      );
      const closed = new Promise<{
        code: number | null;
        signal: string | null;
      }>((resolve) =>
        runner.once("exit", (code, signal) => resolve({ code, signal })),
      );
      try {
        let started = false;
        for (let attempt = 0; attempt < 200; attempt += 1) {
          try {
            await readFile(ready);
            started = true;
            break;
          } catch (cause) {
            if (
              !(cause instanceof Error) ||
              !("code" in cause) ||
              cause.code !== "ENOENT"
            )
              throw cause;
            await delay(50);
          }
        }
        expect(started).toBe(true);
        runner.kill("SIGTERM");
        expect(await closed).toEqual({ code: 143, signal: null });
        const stopped = await readFile(activity, "utf8");
        await delay(100);
        expect(await readFile(activity, "utf8")).toBe(stopped);
      } finally {
        await writeFile(release, "stop");
        if (runner.exitCode === null && runner.signalCode === null)
          runner.kill("SIGTERM");
        await closed;
      }
    },
    20_000,
  );
});

describe("development test runner public CLI", () => {
  it("runs an explicitly selected source test on a clean tree without build artifacts", async () => {
    const root = await fixture();
    const { stdout: status } = await git(root, "status", "--porcelain");
    expect(status).toBe("");
    await testCommand(root, "local", "src/value.test.ts");
    expect(await readFile(join(root, "selected.txt"), "utf8")).toBe("1");
  });

  it("plans an exact local test without building", async () => {
    const root = await fixture();
    const { stdout } = await testCommand(
      root,
      "local",
      "src/value.test.ts",
      "--dry-run",
    );
    expect(JSON.parse(stdout)).toMatchObject({
      needsBuild: false,
      artifactTasks: [],
      vitestArguments: expect.arrayContaining([
        "run",
        "--project",
        "domain",
        "--project",
        "services",
        "--project",
        "adapters",
        "--project",
        "composition",
        "--project",
        "conformance",
        "--project",
        "evaluation",
        "src/value.test.ts",
      ]),
    });
  });

  it("uses committed dependency changes to select source tests and reports failures", async () => {
    const root = await fixture();
    const { stdout: base } = await git(root, "rev-parse", "HEAD");
    await writeFile(join(root, "src/value.ts"), "export const value = 2;\n");
    await git(root, "add", "src/value.ts");
    await commit(root, "change dependency");
    await expect(
      testCommand(root, "changed", "--base", base.trim()),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("src/value.test.ts"),
      stderr: expect.stringContaining("expected 2 to be 1"),
    });
  });

  it("runs changed and focused tests from a committed branch regression", async () => {
    const root = await fixture();
    const { stdout: baseline } = await git(root, "rev-parse", "HEAD");
    await git(root, "update-ref", "refs/remotes/origin/main", baseline.trim());
    await git(root, "switch", "--quiet", "-c", "regression");
    await writeFile(join(root, "src/value.ts"), "export const value = 2;\n");
    await writeFile(
      join(root, "src/value.test.ts"),
      'import { expect, it } from "vitest"; import { value } from "./value.js"; it("checks current source", () => expect(value).toBe(2));\n',
    );
    await git(root, "add", "src");
    await commit(root, "regression fix");
    expect((await git(root, "status", "--porcelain")).stdout).toBe("");

    const changed = await testCommand(root, "changed");
    expect(changed.stdout).toContain("1 passed");
    const focused = await testCommand(root, "focused", "src/value.test.ts");
    expect(focused.stdout).toContain("1 passed");
  }, 60_000);

  it("reports a missing comparison base and rejects missing or compiled-boundary paths", async () => {
    const root = await fixture();
    await expect(
      testCommand(root, "changed", "--base", "missing-test-base", "--dry-run"),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "Fetch origin/main or pass --base REVISION",
      ),
    });
    await expect(
      testCommand(root, "focused", "src/missing.test.ts"),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("ENOENT"),
    });
    await expect(
      testCommand(root, "local", "tests/acceptance/runtime.test.ts"),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Use test:focused"),
    });
  });
});
