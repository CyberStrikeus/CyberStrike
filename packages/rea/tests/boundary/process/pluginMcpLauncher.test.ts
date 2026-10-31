import { spawn } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const launcher = fileURLToPath(
  new URL("../../../scripts/plugin-mcp-launcher.mjs", import.meta.url),
);

const pluginFixture = async (runtime: string) => {
  const workspace = await createTestTempDirectory("rea-plugin-");
  const root = join(workspace, "plugin with spaces");
  await mkdir(root);
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "dist/mcp"), { recursive: true });
  const entry = join(root, "scripts/plugin-mcp-launcher.mjs");
  await copyFile(launcher, entry);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "rea-agents", version: "6.8.0", type: "module" }),
  );
  await writeFile(join(root, "dist/mcp/main.js"), "");
  await writeFile(join(root, "scripts/rea.mjs"), runtime);
  return { root, entry };
};

const start = (entry: string, cwd: string, args = ["6.8.0"]) => {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    stdio: "pipe",
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (bytes: Buffer) => {
    stdout += bytes.toString();
  });
  child.stderr.on("data", (bytes: Buffer) => {
    stderr += bytes.toString();
  });
  const closed = new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await closed;
  });
  return { child, closed };
};

it("runs the matching runtime in-process and preserves cwd, stdio, and exit status", async () => {
  const { root, entry } = await pluginFixture(`
    process.stderr.write(JSON.stringify({ pid: process.pid, args: process.argv.slice(2), cwd: process.cwd() }));
    process.stdin.pipe(process.stdout);
    process.stdin.on("end", () => { process.exitCode = 7; });
  `);
  const caller = await createTestTempDirectory("rea-plugin-caller-");
  const cwd = join(caller, "caller with spaces");
  await mkdir(cwd);
  // Built source plugins and npm artifacts use the same runtime owner.
  await writeFile(join(root, ".git"), "gitdir: /fixture/worktree");
  const { child, closed } = start(entry, cwd);
  child.stdin.end('{"jsonrpc":"2.0","id":1}\n');
  const result = await closed;
  expect(result).toMatchObject({
    code: 7,
    stdout: '{"jsonrpc":"2.0","id":1}\n',
  });
  expect(JSON.parse(result.stderr)).toEqual({
    pid: child.pid,
    args: ["mcp"],
    cwd,
  });
});

it.each([["latest"], ["6.8.0&echo wrong"], ["6.8.0", "extra"], []])(
  "rejects a non-exact or extra version argument: %j",
  async (...args) => {
    const { root, entry } = await pluginFixture(
      'process.stdout.write("unexpected");',
    );
    const { child, closed } = start(entry, root, args);
    child.stdin.end();
    expect(await closed).toEqual({
      code: 1,
      stdout: "",
      stderr: "REA plugin requires one exact rea-agents@VERSION pin.\n",
    });
  },
);

it("rejects a mismatched runtime instead of downloading another package", async () => {
  const { root, entry } = await pluginFixture(
    'process.stdout.write("unexpected");',
  );
  const { child, closed } = start(entry, root, ["6.7.0"]);
  child.stdin.end();
  expect(await closed).toEqual({
    code: 1,
    stdout: "",
    stderr:
      "REA plugin version pin does not match its installed rea-agents package; reinstall the plugin.\n",
  });
});

it("reports how to repair an incomplete artifact or unbuilt source checkout", async () => {
  const { root, entry } = await pluginFixture(
    'process.stdout.write("unexpected");',
  );
  await rm(join(root, "dist"), { recursive: true });
  const { child, closed } = start(entry, root);
  child.stdin.end();
  expect(await closed).toEqual({
    code: 1,
    stdout: "",
    stderr:
      "REA plugin runtime is missing; reinstall the plugin, or run npm ci && npm run build:cached in a source checkout.\n",
  });
});

it("preserves runtime startup failures", async () => {
  const { root, entry } = await pluginFixture(
    'throw new Error("runtime failed");',
  );
  const { child, closed } = start(entry, root);
  child.stdin.end();
  const result = await closed;
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("runtime failed");
});

it.skipIf(process.platform === "win32")(
  "leaves signal cleanup with the running REA runtime",
  async () => {
    const { root, entry } = await pluginFixture(`
    process.on("SIGTERM", () => { process.stderr.write("cleaned"); process.exit(0); });
    process.stdin.resume();
    process.stdout.write("ready");
  `);
    const { child, closed } = start(entry, root);
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("error", reject);
      child.once("exit", () =>
        reject(new Error("runtime exited before readiness")),
      );
    });
    child.kill("SIGTERM");
    expect(await closed).toEqual({
      code: 0,
      stdout: "ready",
      stderr: "cleaned",
    });
  },
);
