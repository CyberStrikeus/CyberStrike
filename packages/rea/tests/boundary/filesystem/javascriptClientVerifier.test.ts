import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { assertJavaScriptApplicationInputPaths } from "../../../scripts/lib/javascript-application-paths.mjs";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";

it("checks caller and canonical paths independently in real JavaScript analysis Evidence", async () => {
  const root = await createTestTempDirectory("rea-js-client-paths-");
  const directory = join(root, "app α测试");
  const inputPath = join(root, "selected app");
  await mkdir(directory);
  await writeFile(join(directory, "main.js"), "export const observed = 7;\n");
  await symlink(
    directory,
    inputPath,
    process.platform === "win32" ? "junction" : "dir",
  );
  const canonicalPath = await realpath(inputPath);
  const result = await analyzeJavaScriptApplication({ input_path: inputPath });
  if (!result.ok) throw result.error;
  const evidence = {
    ...result.value,
    normalized_result: javascriptApplicationAnalysisResultSchema.parse(
      result.value.normalized_result,
    ),
  };

  await expect(
    assertJavaScriptApplicationInputPaths(evidence, inputPath),
  ).resolves.toBeUndefined();

  for (const parameters of [{}, { input_path: canonicalPath }])
    await expect(
      assertJavaScriptApplicationInputPaths(
        { ...evidence, parameters },
        inputPath,
      ),
    ).rejects.toThrow("must retain the caller's input_path");

  await expect(
    assertJavaScriptApplicationInputPaths(
      { ...evidence, subject: { local_path: inputPath } },
      inputPath,
    ),
  ).rejects.toThrow("subject must identify the resolved artifact");
  await expect(
    assertJavaScriptApplicationInputPaths(
      { ...evidence, normalized_result: { input_path: inputPath } },
      inputPath,
    ),
  ).rejects.toThrow("result must identify the resolved artifact");
});
