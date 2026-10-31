import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execFileAsync = promisify(execFile);
const expectedFailure =
  "package did not retain its MCP Registry ownership marker";

it("keeps npm pack output in the owned workspace when package validation fails", async () => {
  const testRoot = await createTestTempDirectory("rea-pack-isolation-");
  const packageRoot = join(testRoot, "source");
  const workspace = join(testRoot, "workspace");
  const npmCache = join(testRoot, "npm-cache");
  const archiveName = "rea-agents-6.0.0.tgz";
  const archivePath = join(packageRoot, archiveName);
  const sentinel = Buffer.from("caller-owned archive\n");
  await Promise.all([mkdir(packageRoot), mkdir(workspace), mkdir(npmCache)]);
  await Promise.all([
    writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "rea-agents",
        version: "6.0.0",
        mcpName: "invalid-owner",
        bin: { rea: "scripts/rea.mjs", "rea-agents": "scripts/rea.mjs" },
        dependencies: {},
      }),
    ),
    writeFile(
      join(packageRoot, "package-lock.json"),
      JSON.stringify({
        name: "rea-agents",
        version: "6.0.0",
        lockfileVersion: 3,
        packages: {
          "": { name: "rea-agents", version: "6.0.0", dependencies: {} },
        },
      }),
    ),
    writeFile(archivePath, sentinel),
  ]);
  const packageContentsBefore = (await readdir(packageRoot)).sort();
  const packerUrl = pathToFileURL(
    resolve("scripts/verify-package-pack.mjs"),
  ).href;
  const commandsUrl = pathToFileURL(
    resolve("scripts/lib/verify-package-commands.mjs"),
  ).href;
  const cleanupUrl = pathToFileURL(
    resolve("scripts/lib/verifier-cleanup.mjs"),
  ).href;
  const harness = `
import { rm } from "node:fs/promises";
import { createPackageVerifierCommands } from ${JSON.stringify(commandsUrl)};
import { withVerifierCleanup } from ${JSON.stringify(cleanupUrl)};
const workspace = ${JSON.stringify(workspace)};
const scratch = { path: workspace, close: () => rm(workspace, { recursive: true, force: true }) };
let commands;
let failure;
await withVerifierCleanup(async () => {
commands = await createPackageVerifierCommands({ workspace: scratch });
try {
  const { verifyPackagePack } = await import(${JSON.stringify(packerUrl)});
  await verifyPackagePack({ root: ${JSON.stringify(packageRoot)}, workspace, commands });
} catch (cause) {
  if (!(cause instanceof Error) || cause.message !== ${JSON.stringify(expectedFailure)}) throw cause;
  failure = cause.message;
}
}, [() => commands === undefined ? scratch.close() : commands.close()]);
if (failure !== ${JSON.stringify(expectedFailure)}) throw new Error("Expected package metadata validation to fail after packing");
process.stdout.write(JSON.stringify({ failure }));
`;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", harness],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        npm_config_cache: npmCache,
        TEMP: npmCache,
        TMP: npmCache,
        TMPDIR: npmCache,
      },
      maxBuffer: 1_024 * 1_024,
    },
  );

  expect(JSON.parse(stdout)).toEqual({ failure: expectedFailure });
  expect((await readdir(packageRoot)).sort()).toEqual(packageContentsBefore);
  expect(Buffer.compare(await readFile(archivePath), sentinel)).toBe(0);
  await expect(access(workspace)).rejects.toMatchObject({ code: "ENOENT" });
});
