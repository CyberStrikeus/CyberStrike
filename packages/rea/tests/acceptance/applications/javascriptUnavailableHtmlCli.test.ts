import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for([
  "invalid-html",
  "empty-html",
  "reference-html",
  "invalid-json",
] as const)(
  "retains applicable unavailable HTML reference scope through CLI for %s",
  async (testCase, { cli }) => {
    const root = await createTestTempDirectory("rea-unavailable-html-");
    const reference = '<script src="main.js"></script>';
    const html =
      testCase === "invalid-html"
        ? Buffer.concat([Buffer.from(reference), Buffer.from([0xff])])
        : testCase === "reference-html"
          ? reference
          : "<html></html>";
    await writeFile(
      join(root, "package.json"),
      '{"name":"html-scope","main":"main.js"}',
    );
    await writeFile(join(root, "main.js"), "module.exports = 42;");
    await writeFile(join(root, "index.html"), html);
    await writeFile(
      join(root, "data.json"),
      testCase === "invalid-json" ? Buffer.from([0xff]) : "{}",
    );
    const response = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        ...["package.json", "main.js", "index.html", "data.json"].flatMap(
          (path) => ["--source-path", path],
        ),
        "--format",
        "json",
      ],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(response.json).normalized_result,
    );
    const scopes = result.graph.nodes
      .filter(({ kind }) => kind === "unknown")
      .flatMap(({ observations }) => observations);
    const htmlScopes = scopes.filter(
      ({ properties }) =>
        properties.path === "index.html" &&
        properties.operation === "parse-html-script-references",
    );
    expect(htmlScopes).toHaveLength(testCase === "invalid-html" ? 1 : 0);
    if (testCase === "invalid-html") {
      expect(htmlScopes[0]?.evidence).toMatchObject({
        authority: "artifact-bytes",
        state: "unavailable",
      });
      expect(htmlScopes[0]?.properties.limitation).toContain("invalid-utf8");
      expect(result.graph.coverage).toMatchObject({
        status: "partial",
        truncated: false,
      });
    }
    expect(
      scopes.filter(
        ({ properties }) =>
          properties.path === "data.json" &&
          properties.operation === "parse-json-module",
      ),
    ).toHaveLength(testCase === "invalid-json" ? 1 : 0);
    expect(
      result.graph.edges.filter(
        ({ relation, properties }) =>
          relation === "loads" && properties.script_path !== undefined,
      ),
    ).toHaveLength(testCase === "reference-html" ? 1 : 0);
  },
);
