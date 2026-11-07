import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { prepareWindowsNativeInspectionWorkspace } from "../../../scripts/lib/windows-native-inspection-workspace.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

const repository = fileURLToPath(new URL("../../..", import.meta.url));

processTest(
  "imports the isolated compiled Windows loader with its dependencies while keeping the injected addon separate",
  async ({ processes }) => {
    const scratch = await createTestTempDirectory(
      "rea-native-inspection-layout-",
    );
    const workspace = join(scratch, "runtime");
    const artifact = join(scratch, "injected");
    await mkdir(workspace);
    await mkdir(artifact);
    // These inert bytes establish layout and import coverage, never native authority.
    const addon = "inert inspection fixture";
    await writeFile(join(artifact, "rea-windows-x64.node"), addon);
    await writeFile(join(artifact, "manifest.json"), "{}");
    const loader = await prepareWindowsNativeInspectionWorkspace({
      root: repository,
      artifact,
      workspace,
    });
    const imported = await processes.run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          'import assert from "node:assert/strict";',
          "const loader = await import(" + JSON.stringify(loader) + ");",
          'assert.equal(typeof loader.systemWindowsNativeAuthority, "function");',
        ].join("\n"),
      ],
      { cwd: workspace, timeoutMs: 10_000 },
    );
    expect(imported.exitCode, imported.stderr).toBe(0);
    expect(await realpath(join(workspace, "node_modules"))).toBe(
      await realpath(join(repository, "node_modules")),
    );
    const isolatedAddon = join(
      workspace,
      "native/windows/build/rea-windows-x64.node",
    );
    expect(await readFile(isolatedAddon, "utf8")).toBe(addon);
    await writeFile(isolatedAddon, "changed isolated fixture");
    expect(await readFile(join(artifact, "rea-windows-x64.node"), "utf8")).toBe(
      addon,
    );
  },
);
