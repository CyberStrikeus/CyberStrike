import { execFile } from "node:child_process";
import { rm, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  SOURCE,
  applicationFixture,
  electronRuntimeEvidence,
} from "../../fixtures/javascriptRuntimeReconciliation.js";

const execute = promisify(execFile);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const selectedFixture = async () => {
  const physical = await applicationFixture();
  const root = await createTestTempDirectory("rea-verifier-selection-");
  temporary.push(physical, root);
  const alias = join(root, "selected-app");
  await symlink(
    physical,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  return { physical, root, selected: relative(process.cwd(), alias) };
};

// Run the real script helper against the same built owner used by the verifiers.
const analysisIdentity = async (path: string) => {
  const helper = new URL(
    "../../../scripts/lib/javascript-application-analysis.mjs",
    import.meta.url,
  ).href;
  const { stdout } = await execute(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { analyzeJavaScriptApplicationWithOwnedScope } from ${JSON.stringify(helper)};
     const evidence = await analyzeJavaScriptApplicationWithOwnedScope({ input_path: process.argv[1] });
     console.log(JSON.stringify({ evidence_id: evidence.evidence_id, selected: evidence.parameters.input_path }));`,
      path,
    ],
    { maxBuffer: 16 * 1_024 * 1_024 },
  );
  return JSON.parse(stdout) as { evidence_id: string; selected: string };
};

it("retains selected layer paths in runtime verifier parent Evidence", async () => {
  const { physical, root, selected } = await selectedFixture();
  const evidencePath = join(root, "runtime.json");
  await writeFile(
    evidencePath,
    JSON.stringify(electronRuntimeEvidence(physical, SOURCE)),
  );
  const expected = await analysisIdentity(selected);
  const canonical = await analysisIdentity(physical);
  expect(expected.selected).toBe(selected);
  expect(expected.evidence_id).not.toBe(canonical.evidence_id);
  const { stdout } = await execute(
    process.execPath,
    [
      "scripts/verify/javascript/runtime-observation.mjs",
      "--application",
      selected,
      "--runtime-evidence",
      evidencePath,
    ],
    { maxBuffer: 16 * 1_024 * 1_024 },
  );
  expect(JSON.parse(stdout)).toMatchObject({
    verified: true,
    layers: [{ evidence_id: expected.evidence_id }],
  });
}, 20_000);

it("retains workflow selections while rejecting aliases of the same target", async () => {
  const left = await selectedFixture();
  const right = await selectedFixture();
  const expectedLeft = await analysisIdentity(left.selected);
  const expectedRight = await analysisIdentity(right.selected);
  const { stdout } = await execute(
    process.execPath,
    [
      "scripts/verify/javascript/application-workflows.mjs",
      "--left",
      left.selected,
      "--right",
      right.selected,
    ],
    { maxBuffer: 16 * 1_024 * 1_024 },
  );
  expect(JSON.parse(stdout)).toMatchObject({
    verified: true,
    left: { evidence_id: expectedLeft.evidence_id },
    right: { evidence_id: expectedRight.evidence_id },
  });
  await expect(
    execute(process.execPath, [
      "scripts/verify/javascript/application-workflows.mjs",
      "--left",
      left.selected,
      "--right",
      left.physical,
    ]),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("must resolve to distinct paths"),
  });
}, 20_000);
