import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";

it.each([
  {
    expression:
      'flag ? require("./dependency.js").value : require("./dependency.js").value',
    resolved: true,
  },
  {
    expression:
      'require("./dependency.js").value || require("./dependency.js").value',
    resolved: true,
  },
  {
    expression: 'flag ? require("./dependency.js").value : localValue',
    resolved: false,
  },
  {
    expression: 'require("./dependency.js").value ?? localValue',
    resolved: false,
  },
])(
  "preserves export provenance for $expression",
  async ({ expression, resolved }) => {
    const root = await createTestTempDirectory("rea-js-module-provenance-");
    await Promise.all([
      writeFile(
        join(root, "app.cjs"),
        `const selected = ${expression};\nexports.selected = selected;\n`,
      ),
      writeFile(join(root, "dependency.js"), "exports.value = 1;\n"),
    ]);

    const result = await analyzeJavaScriptApplication({
      input_path: root,
      format: "directory",
    });
    if (!result.ok) throw result.error;
    const analysis = javascriptApplicationAnalysisResultSchema.parse(
      JSON.parse(JSON.stringify(result.value.normalized_result)),
    );

    const exportImports = analysis.graph.edges.filter(
      ({ relation, properties }) =>
        relation === "imports" && properties.exported_name === "selected",
    );
    if (!resolved) {
      expect(exportImports).toEqual([]);
      return;
    }
    expect(exportImports).toContainEqual(
      expect.objectContaining({
        relation: "imports",
        properties: expect.objectContaining({
          specifier: "./dependency.js",
          imported_path: ["value"],
          resolved_path: "dependency.js",
          resolution_status: "resolved",
        }),
      }),
    );
  },
);
