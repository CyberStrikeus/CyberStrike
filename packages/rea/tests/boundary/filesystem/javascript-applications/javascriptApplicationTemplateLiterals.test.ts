import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";

const graphIdentities = async (source: string) => {
  const inputPath = await createTestTempDirectory("rea-js-template-literal-");
  await writeFile(join(inputPath, "app.js"), `${source}\n`);
  await writeFile(join(inputPath, "dep.js"), "module.exports = 1;\n");
  await writeFile(join(inputPath, "worker.js"), "self.onmessage = null;\n");
  const result = await analyzeJavaScriptApplication({
    input_path: inputPath,
    format: "directory",
  });
  if (!result.ok)
    throw new Error(`Expected analysis success: ${result.error.message}`);
  const { graph } = javascriptApplicationAnalysisResultSchema.parse(
    result.value.normalized_result,
  );
  return (
    graph.nodes
      .filter(({ kind }) => kind !== "javascript-asset" && kind !== "artifact")
      // Artifact digests differ between spellings; keep the derived keys.
      .map(({ kind, identity }) => ({
        kind,
        strategy: identity.strategy,
        ...(identity.strategy === "artifact-local-key"
          ? {
              namespace: identity.namespace,
              // Module-export identity is a JSON tuple whose first entry
              // binds the whole container; only that digest changes here.
              key:
                identity.namespace === "module-export"
                  ? JSON.stringify(
                      (JSON.parse(identity.key) as unknown[]).slice(1),
                    )
                  : identity.namespace === "source-module"
                    ? identity.key.replace(/^[0-9a-f]{64}:/u, "")
                    : identity.key,
            }
          : {}),
      }))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      )
  );
};

// Each quoted literal has the same length as its template spelling, so
// source locations and every derived identity stay comparable.
it.each([
  "fetch('https://api.example.com/v1/users');",
  "client['get']('/api/items');",
  "navigator['sendBeacon']('/api/events', payload);",
  "localStorage.setItem('token', 1);",
  "new Worker(new URL('./worker.js', import.meta.url));",
  "const dep = require('./dep.js'); dep();",
  "import('./dep.js');",
])(
  "reads a template without substitutions as its exact string: %s",
  async (quoted) => {
    const template = quoted.replaceAll("'", "`");
    const expected = await graphIdentities(quoted);
    expect(
      expected.some(({ kind }) =>
        ["endpoint", "storage", "worker", "javascript-module"].includes(kind),
      ),
    ).toBe(true);
    await expect(graphIdentities(template)).resolves.toEqual(expected);
  },
);
