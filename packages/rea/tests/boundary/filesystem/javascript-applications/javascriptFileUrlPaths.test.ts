import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseExpression } from "@babel/parser";
import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { staticPath } from "../../../../src/domain/javascript/javascriptStaticAnalysisHelpers.js";
import { analyzeJavaScriptStaticSource } from "../../../../src/domain/javascript/javascriptStaticAnalysis.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";

const urlCases = [
  ["./preload%20name.cjs", "preload name.cjs", "main.mjs"],
  ["./preload%252Fname.cjs", "preload%2Fname.cjs", "main.mjs"],
  ["./pr%C3%A9load.cjs", "préload.cjs", "main.mjs"],
  ["./preload%3F%23.cjs", "preload?#.cjs", "main.mjs"],
  ["./preload.cjs?cache=1#v2", "preload.cjs", "main.mjs"],
  ["../preload.cjs?cache=1", "preload.cjs", "src/main.mjs"],
  ["./sub/../preload.cjs", "preload.cjs", "main.mjs"],
  ["./preload.cjs", "preload.cjs", "main.mjs"],
] as const;

const unknownExpressions = [
  'fileURLToPath("file:///app/%2Fpreload.cjs")',
  'fileURLToPath("file:///app/%5Cpreload.cjs")',
  'fileURLToPath("file:///app/%")',
  'fileURLToPath("file:///C:/app/preload.cjs")',
  'fileURLToPath("file://remote/share/preload.cjs")',
  'fileURLToPath("file:///app/preload.cjs", { windows: selectedPlatform })',
  'fileURLToPath(new URL("./invalid%.cjs", import.meta.url))',
  'fileURLToPath(new URL("./preload%2fname.cjs", import.meta.url))',
  'fileURLToPath(new URL("./preload%5cname.cjs", import.meta.url))',
  'fileURLToPath(new URL("./%2e/preload.cjs", import.meta.url))',
  'fileURLToPath(new URL("https://example.test/preload.cjs", import.meta.url))',
  'fileURLToPath(new URL("//example.test/preload.cjs", import.meta.url))',
  'fileURLToPath(new URL("#fragment", import.meta.url))',
  'fileURLToPath(new URL("?cache=1", import.meta.url))',
  'fileURLToPath(new URL("./preload.cjs", runtimeBase))',
  "fileURLToPath(new URL(runtimePath, import.meta.url))",
  'convertFileURLToPath(new URL("./preload.cjs", import.meta.url))',
];

describe("JavaScript file URL paths", () => {
  it.each(urlCases)(
    "resolves %s to the file read by Node",
    async (reference, target, sourcePath) => {
      const root = await createTestTempDirectory("rea-file-url-path-");
      const sourceFile = join(root, sourcePath);
      await mkdir(dirname(sourceFile), { recursive: true });
      await writeFile(join(root, target), 'module.exports = "real preload";\n');
      if (reference.includes("%") && sourcePath === "main.mjs")
        await writeFile(
          join(root, reference),
          'module.exports = "encoded-name decoy";\n',
        );
      const nativePath = fileURLToPath(
        new URL(reference, pathToFileURL(sourceFile)),
      );
      expect(relative(root, nativePath)).toBe(target);
      expect(await readFile(nativePath, "utf8")).toContain("real preload");
      await writeFile(
        sourceFile,
        `import { fileURLToPath } from "node:url";\nimport { BrowserWindow } from "electron";\nnew BrowserWindow({ webPreferences: { preload: fileURLToPath(new URL(${JSON.stringify(reference)}, import.meta.url)) } });\n`,
      );

      const result = await analyzeJavaScriptApplication({
        input_path: root,
        format: "directory",
      });
      if (!result.ok) throw result.error;
      const { graph } = javascriptApplicationAnalysisResultSchema.parse(
        result.value.normalized_result,
      );
      const preloads = graph.nodes.filter(
        ({ kind }) => kind === "electron-preload",
      );
      expect(preloads).toHaveLength(1);
      expect(preloads[0]?.observations).not.toHaveLength(0);
      for (const observation of preloads[0]?.observations ?? [])
        expect(observation.properties).toMatchObject({
          resolved_path: target,
          resolution_status: "resolved",
          resolution_context: "filesystem-expression",
        });
    },
  );

  it("keeps a decoded absolute file URL unmapped without host ownership", async () => {
    const root = await createTestTempDirectory("rea-literal-file-url-");
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(
      join(root, "app", "preload name.cjs"),
      'module.exports = "literal file URL preload";\n',
    );
    await writeFile(
      join(root, "main.mjs"),
      `import { fileURLToPath } from "node:url";\nimport { BrowserWindow } from "electron";\nnew BrowserWindow({ webPreferences: { preload: fileURLToPath("file:///app/preload%20name.cjs") } });\n`,
    );

    const result = await analyzeJavaScriptApplication({
      input_path: root,
      format: "directory",
    });
    if (!result.ok) throw result.error;
    const { graph } = javascriptApplicationAnalysisResultSchema.parse(
      result.value.normalized_result,
    );
    const preload = graph.nodes.find(({ kind }) => kind === "electron-preload");
    expect(preload?.observations).not.toHaveLength(0);
    for (const observation of preload?.observations ?? [])
      expect(observation.properties).toMatchObject({
        resolved_path: null,
        resolution_status: "unavailable",
        resolution_context: "filesystem-expression",
      });
    expect(
      graph.edges.filter(
        ({ source_node_id, relation }) =>
          source_node_id === preload?.node_id && relation === "maps_to",
      ),
    ).toEqual([]);
  });

  it.each(unknownExpressions)("leaves unsupported %s unknown", (expression) => {
    expect(
      staticPath(parseExpression(expression, { sourceType: "module" })),
    ).toBeUndefined();
  });

  it("does not URL-decode literal filesystem punctuation", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      const path = require('node:path');
      const {BrowserWindow} = require('electron');
      new BrowserWindow({webPreferences:{preload:path.join(__dirname,"preload%20?#.cjs")}});
    `);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.electron.browser_windows).toHaveLength(1);
    expect(analysis.electron.browser_windows[0]?.preload_path).toBe(
      "preload%20?#.cjs",
    );
  });
});
