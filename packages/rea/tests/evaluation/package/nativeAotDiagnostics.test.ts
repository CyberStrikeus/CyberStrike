import { execFile } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import {
  nativeAotCommandError,
  supportsNativeAotFixtureHost,
} from "../../../scripts/lib/nativeaot-build.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const generator = fileURLToPath(
  new URL("../../../scripts/generate-nativeaot-fixtures.mjs", import.meta.url),
);

const supportedHost = supportsNativeAotFixtureHost(
  process.platform,
  process.arch,
);

it.skipIf(!supportedHost).each(["restore", "publish"])(
  "redacts authenticated feed URLs from the uncaught %s diagnostic",
  async (operation) => {
    const directory = await createTestTempDirectory(
      "rea-nativeaot-diagnostic-",
    );
    const hook = join(directory, "child-output.cjs");
    await writeFile(
      hook,
      `
const child = require("node:child_process");
child.spawnSync = (_command, args) => {
  if (args[0] === "--version") return { status: 0, stdout: "8.0.416\\n", stderr: "" };
  if (args[0] === ${JSON.stringify(operation)}) return {
    status: 1,
    error: new Error("failed HTTPS://error-user:error-secret@feed.invalid/v3/index.json"),
    stdout: "NU1301 https://stdout-user:stdout-secret@feed.invalid/v3/index.json\\n",
    stderr: "source https://stderr-user:stderr-secret%40suffix@feed.invalid/v3/index.json\\nkeep https://feed.invalid/path/user@name?label=token-name\\n"
  };
  return { status: 0, stdout: "", stderr: "" };
};
require("node:module").syncBuiltinESMExports();
`,
      "utf8",
    );
    const failure = await promisify(execFile)(
      process.execPath,
      ["--require", hook, generator],
      {
        env: {
          ...process.env,
          REA_NATIVEAOT_FIXTURE_ROOT: join(directory, "output"),
        },
        timeout: 15_000,
      },
    ).then(
      () => {
        throw new Error("Expected fixture generation to fail");
      },
      (error: { stderr: string; code: number }) => error,
    );
    expect(failure.code).toBe(1);
    for (const secret of [
      "error-user",
      "error-secret",
      "stdout-user",
      "stdout-secret",
      "stderr-user",
      "stderr-secret",
    ])
      expect(failure.stderr).not.toContain(secret);
    expect(failure.stderr).toContain("NU1301");
    expect(failure.stderr).toContain("feed.invalid/v3/index.json");
    expect(failure.stderr).toContain(
      "https://feed.invalid/path/user@name?label=token-name",
    );
    if (operation === "restore") {
      expect(failure.stderr).toContain("attempt 2/2");
      expect(failure.stderr).toContain("failed after two attempts");
      expect(failure.stderr).toContain("[cause]");
    }
  },
);

it.skipIf(supportedHost)(
  "refuses unsupported fixture hosts before tooling or output creation",
  async () => {
    const directory = await createTestTempDirectory("rea-nativeaot-host-");
    const hook = join(directory, "unexpected-child.cjs");
    await writeFile(
      hook,
      `const child = require("node:child_process");
child.spawnSync = () => { throw new Error("Unexpected fixture tooling invocation"); };
require("node:module").syncBuiltinESMExports();
`,
      "utf8",
    );
    const failure = await promisify(execFile)(
      process.execPath,
      ["--require", hook, generator],
      {
        env: {
          ...process.env,
          REA_NATIVEAOT_FIXTURE_ROOT: join(directory, "output"),
        },
        timeout: 15_000,
      },
    ).then(
      () => {
        throw new Error("Expected unsupported fixture host refusal");
      },
      (error: { stderr: string; code: number }) => error,
    );
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain("requires Linux or Windows x64");
    expect(failure.stderr).not.toContain(
      "Unexpected fixture tooling invocation",
    );
    expect(await readdir(directory)).toEqual(["unexpected-child.cjs"]);
  },
);

it("preserves diagnostics without transport authentication exactly", () => {
  const error = nativeAotCommandError(
    "C:/token projects/dotnet.exe",
    "restore",
    {
      status: 1,
      stdout: "NU1301 https://feed.invalid/user@name?label=password\n",
      stderr: "project C:/token projects/fixture.csproj unavailable",
    },
  );
  expect(error.message).toBe(
    "NativeAOT fixture lane requires/action failed C:/token projects/dotnet.exe restore: exit 1\nNU1301 https://feed.invalid/user@name?label=password\nproject C:/token projects/fixture.csproj unavailable",
  );
  expect(error.cause).toBeUndefined();
});

it("treats HTTP backslashes as path separators rather than authentication", () => {
  const output = String.raw`https://feed.invalid\path\user@name`;
  expect(new URL(output).username).toBe("");
  const error = nativeAotCommandError("dotnet", "restore", {
    status: 1,
    stdout: output,
  });
  expect(error.message).toContain(output);
});
