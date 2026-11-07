import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

import { createCli } from "../../src/cli.js";
import { PRODUCT_IDENTITY } from "../../src/identity.js";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  host: vi.fn(() => ({ owner: "selected-update-host" })),
  dependencyInstall: vi.fn(() => {
    throw new Error("Dependency installer must not run in this test.");
  }),
}));

vi.mock("../../src/application/Update.js", async (original) => ({
  ...(await original<typeof import("../../src/application/Update.js")>()),
  runUpdate: mocks.run,
}));
vi.mock("../../src/application/UpdateRuntime.js", () => ({
  systemUpdateHost: mocks.host,
}));

const initialExitCode = process.exitCode;
const current = {
  status: "current",
  currentVersion: PRODUCT_IDENTITY.packageVersion,
  latestVersion: PRODUCT_IDENTITY.packageVersion,
  installMethod: "unknown",
};

beforeEach(async () => {
  vi.clearAllMocks();
  const root = await createTestTempDirectory("rea-update-api-sandbox-");
  await writeFile(
    join(root, process.platform === "win32" ? "npm.cmd" : "npm"),
    process.platform === "win32"
      ? "@echo off\r\necho Test package manager refuses installation 1>&2\r\nexit /b 97\r\n"
      : "#!/bin/sh\nprintf '%s\\n' 'Test package manager refuses installation' >&2\nexit 97\n",
    { mode: 0o700 },
  );
  vi.stubEnv("PATH", root);
  vi.stubEnv("npm_config_user_agent", "npm/test");
  vi.stubEnv("npm_config_prefix", join(root, "global"));
  vi.stubEnv("npm_config_cache", join(root, "cache"));
  // Externalized dependencies bypass Vitest module factories for Node builtins.
  // Patch the real builtin and synchronize named ESM exports; PATH/prefix above
  // independently prevent any real installation if this guard stops working.
  vi.spyOn(childProcess, "execFile").mockImplementation(
    mocks.dependencyInstall,
  );
  syncBuiltinESMExports();
  vi.stubEnv("CI", "1");
  vi.stubEnv("NO_UPDATE_NOTIFIER", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("No network in this test."))),
  );
  mocks.run.mockResolvedValue(current);
});
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  process.exitCode = initialExitCode;
});

const serve = async (
  cli: ReturnType<typeof createCli>,
  arguments_: string[],
) => {
  process.exitCode = 0;
  let stdout = "";
  let exitCode = 0;
  await cli.serve(arguments_, {
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    exit: (code) => {
      exitCode = code;
    },
  });
  return { stdout, exitCode: exitCode || Number(process.exitCode ?? 0) };
};

it.each(["json", "jsonl", "yaml", "toon", "md"])(
  "uses the verified update command and selected environment through direct serve with %s output",
  async (format) => {
    const selected = { REA_SELECTED_UPDATE: "original" };
    const cli = createCli(selected);
    selected.REA_SELECTED_UPDATE = "changed";
    const expected = await serve(cli, ["update", "--format", format]);
    const actual = await serve(cli, ["--format", format, "--update"]);
    expect(actual).toEqual(expected);
    expect(actual.exitCode).toBe(0);
    expect(actual.stdout).toContain(PRODUCT_IDENTITY.packageVersion);
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run).toHaveBeenLastCalledWith(
      PRODUCT_IDENTITY.packageVersion,
      { owner: "selected-update-host" },
      "structured",
    );
    expect(mocks.host).toHaveBeenLastCalledWith(undefined, undefined, {
      REA_SELECTED_UPDATE: "original",
    });
    expect(mocks.dependencyInstall).not.toHaveBeenCalled();
  },
);

it("preserves filtering, full output and unsuccessful update exit status", async () => {
  const cli = createCli({});
  const flags = ["--json", "--full-output", "--filter-output", "status"];
  const filtered = await serve(cli, ["--update", ...flags]);
  const canonical = await serve(cli, ["update", ...flags]);
  expect(filtered.exitCode).toBe(canonical.exitCode);
  for (const output of [filtered, canonical])
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: true,
      data: "current",
      meta: { command: expect.stringContaining("update") },
    });
  mocks.run.mockResolvedValue({
    status: "failed",
    currentVersion: PRODUCT_IDENTITY.packageVersion,
    latestVersion: "99.0.0",
    reason: "install",
    remediation: "EACCES owned installation",
  });
  const failed = await serve(cli, ["--update", "--json"]);
  expect(failed.exitCode).toBe(1);
  expect(JSON.parse(failed.stdout)).toMatchObject({
    status: "failed",
    reason: "install",
    remediation: "EACCES owned installation",
  });
  expect(mocks.dependencyInstall).not.toHaveBeenCalled();
});

it.each([
  ["--update", "--help"],
  ["--incur-update-check", "--update"],
])("preserves non-installing precedence for %j", async (...arguments_) => {
  await serve(createCli({}), arguments_);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.dependencyInstall).not.toHaveBeenCalled();
});

it("refuses ambiguous built-in installation rather than selecting another updater", async () => {
  const result = await serve(createCli({}), [
    "providers",
    "--update",
    "--json",
  ]);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    code: "UPDATE_FAILED",
    message: expect.stringContaining("rea update"),
  });
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.dependencyInstall).not.toHaveBeenCalled();
});
