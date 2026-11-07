import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";
import { analyzeArtifactFiles } from "../../../fixtures/javascriptArtifactAnalysis.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";

it("does not infer renderer loads from external data blocks or import maps", async () => {
  const root = await createTestTempDirectory("rea-html-script-types-");
  const declarations = [
    ["classic.js", 'type=" Text/JavaScript "'],
    ["module.js", 'type="module"'],
    ["data.js", 'type="application/json"'],
    ["imports.js", 'type="importmap"'],
    ["rules.js", 'type="speculationrules"'],
    ["unsupported.js", 'language="vbscript"'],
  ] as const;
  const html = declarations
    .map(
      ([path, attributes]) => `<script ${attributes} src="${path}"></script>`,
    )
    .join("\n");
  await Promise.all([
    writeFile(join(root, "index.html"), html),
    ...declarations.map(([path]) => writeFile(join(root, path), "export {};")),
  ]);
  const result = await analyzeJavaScriptApplication({
    input_path: root,
    format: "directory",
  });
  if (!result.ok) throw result.error;
  const analysis = javascriptApplicationAnalysisResultSchema.parse(
    result.value.normalized_result,
  );
  expect(
    analysis.graph.edges
      .filter(
        ({ relation, properties }) =>
          relation === "loads" && typeof properties.script_path === "string",
      )
      .map(({ properties }) => properties.script_path)
      .sort(),
  ).toEqual(["classic.js", "module.js"]);
  const sources = await analyzeArtifactFiles({
    files: [
      {
        path: "index.html",
        container_sha256: "a".repeat(64),
        sha256: "b".repeat(64),
        bytes: Buffer.byteLength(html),
        inventory_artifact_id: "html_fixture",
        kind: "html",
        unpacked: false,
        text: { included: true, value: html },
      },
    ],
    unavailable_relevant_files: [],
    containers: [],
    text_bytes_read: Buffer.byteLength(html),
    invalid_utf8_files: 0,
  });
  expect(
    sources.analysis.html_scripts.map(({ script_path, script_type }) => [
      script_path,
      script_type,
    ]),
  ).toEqual([
    ["classic.js", "classic"],
    ["module.js", "module"],
    ["data.js", null],
    ["imports.js", null],
    ["rules.js", null],
    ["unsupported.js", null],
  ]);
});
