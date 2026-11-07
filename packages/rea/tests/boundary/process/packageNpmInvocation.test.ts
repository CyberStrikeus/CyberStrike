import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

processTest(
  "runs the caller-selected npm entry through Node without rewriting its inputs",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-npm-invocation-");
    const npmEntry = join(root, "selected npm entry.mjs");
    await writeFile(
      npmEntry,
      `process.stdout.write(JSON.stringify({ arguments: process.argv.slice(2), cwd: process.cwd(), marker: process.env.REA_NPM_TEST_MARKER }));\n`,
    );
    const helper = pathToFileURL(
      resolve("scripts/lib/verify-package-commands.mjs"),
    ).href;
    const cleanup = pathToFileURL(
      resolve("scripts/lib/verifier-cleanup.mjs"),
    ).href;
    const program = `
      const { createPackageVerifierCommands } = await import(${JSON.stringify(helper)});
      const { withVerifierCleanup } = await import(${JSON.stringify(cleanup)});
      const commands = await createPackageVerifierCommands({
        workspace: { path: ${JSON.stringify(root)}, close: async () => {} },
      });
      const result = await withVerifierCleanup(
        () => commands.execNpm(["pack", "value with spaces"], {
          cwd: ${JSON.stringify(root)},
          env: { ...process.env, npm_execpath: ${JSON.stringify(npmEntry)}, REA_NPM_TEST_MARKER: "caller-selected" },
        }),
        [() => commands.close()],
      );
      process.stdout.write(result.stdout);
    `;
    const result = await processes.run(
      process.execPath,
      ["--input-type=module", "--eval", program],
      { windowsHide: true, timeoutMs: 20_000 },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.signal, result.stderr).toBeNull();
    expect(JSON.parse(result.stdout)).toEqual({
      arguments: ["pack", "value with spaces"],
      cwd: root,
      marker: "caller-selected",
    });
  },
);

const windowsIt = processTest.skipIf(process.platform !== "win32");

windowsIt(
  "uses the npm entry adjacent to Node when none is selected",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-adjacent-npm-");
    const node = join(root, "node.exe");
    const npmEntry = join(root, "node_modules/npm/bin/npm-cli.js");
    await mkdir(dirname(npmEntry), { recursive: true });
    await Promise.all([
      copyFile(process.execPath, node),
      writeFile(
        npmEntry,
        `process.stdout.write(JSON.stringify({ arguments: process.argv.slice(2), cwd: process.cwd() }));\n`,
      ),
    ]);
    const helper = pathToFileURL(
      resolve("scripts/lib/verify-package-commands.mjs"),
    ).href;
    const cleanup = pathToFileURL(
      resolve("scripts/lib/verifier-cleanup.mjs"),
    ).href;
    const program = `
      const { createPackageVerifierCommands } = await import(${JSON.stringify(helper)});
      const { withVerifierCleanup } = await import(${JSON.stringify(cleanup)});
      const commands = await createPackageVerifierCommands({
        workspace: { path: ${JSON.stringify(root)}, close: async () => {} },
      });
      const environment = { ...process.env };
      delete environment.npm_execpath;
      const result = await withVerifierCleanup(
        () => commands.execNpm(["pack", "value with spaces"], {
          cwd: ${JSON.stringify(root)},
          env: environment,
        }),
        [() => commands.close()],
      );
      process.stdout.write(result.stdout);
    `;
    const environment = { ...process.env };
    delete environment.npm_execpath;
    const result = await processes.run(
      node,
      ["--input-type=module", "--eval", program],
      { env: environment, windowsHide: true, timeoutMs: 20_000 },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.signal, result.stderr).toBeNull();
    expect(JSON.parse(result.stdout)).toEqual({
      arguments: ["pack", "value with spaces"],
      cwd: root,
    });
  },
);
