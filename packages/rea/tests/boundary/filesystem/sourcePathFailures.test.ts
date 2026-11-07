import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { captureProcessScenarioFile } from "../../../src/application/process/ProcessCli.js";
import { projectReferenceSourceImportError } from "../../../src/application/ReferenceSourceImportTypes.js";
import { readJsonFile } from "../../../src/application/JsonFiles.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

it.skipIf(process.platform === "win32")(
  "preserves root-selection causes for a loop and an overlong component",
  async () => {
    const root = await createTestTempDirectory("rea-source-path-causes-");
    await symlink("loop-b", join(root, "loop-a"));
    await symlink("loop-a", join(root, "loop-b"));
    await mkdir(join(root, "valid"));
    await writeFile(join(root, "valid", "source.js"), "export const x = 1;");
    for (const [path, errno, advice] of [
      [join(root, "loop-a"), "ELOOP", "symbolic-link"],
      [join(root, "x".repeat(300)), "ENAMETOOLONG", "path-length"],
    ] as const) {
      const result = await importReferenceSource({
        root: path,
        caller: "source-path-causes",
        policy: { secretPatterns: [] },
      });
      if (result.ok) throw new Error("expected invalid root");
      expect(projectReferenceSourceImportError(result.error)).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        message: expect.stringContaining(errno),
        remediation: { action: expect.stringContaining(advice) },
        details: { issues: [expect.objectContaining({ path: ["root"] })] },
      });
    }
    const path = join(root, "loop-a");
    const read = await readJsonFile(path);
    if (read.ok) throw new Error("expected loop refusal");
    expect(projectAnalysisError(read.error)).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      message: expect.stringContaining("symbolic-link"),
    });
    expect(await captureProcessScenarioFile(path)).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      message: expect.stringContaining("ELOOP"),
      details: { issues: [expect.objectContaining({ path: ["input_file"] })] },
    });
  },
);
