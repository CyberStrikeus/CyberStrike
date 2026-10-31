import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { applicationVersionComparisonResultSchema } from "../../../src/domain/javascript/javascriptApplicationVersionComparisonSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "keeps unresolved endpoint text separate from an equal exact literal through version comparison",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-endpoint-correspondence-");
    const applications = [];
    for (const [name, source] of [
      ["before", "fetch(API_BASE);"],
      ["after", 'fetch("API_BASE");'],
    ] as const) {
      const path = join(root, name);
      await mkdir(path);
      await writeFile(join(path, "main.js"), source);
      const analyzed = await cli.run({
        arguments: ["analyze-javascript-application", path, "--format", "json"],
      });
      expect(analyzed.exitCode, analyzed.stderr).toBe(0);
      applications.push(parseEvidence(analyzed.json));
    }
    const input = join(root, "comparison.json");
    await writeFile(
      input,
      JSON.stringify({ left: applications[0], right: applications[1] }),
    );
    const response = await cli.run({
      arguments: ["compare-application-versions", input, "--format", "json"],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const result = applicationVersionComparisonResultSchema.parse(
      parseEvidence(response.json).normalized_result,
    );
    const endpoints = result.items.filter(
      ({ node_kind }) => node_kind === "endpoint",
    );
    expect(endpoints).toHaveLength(2);
    expect(
      endpoints.every(
        ({ status, match }) =>
          status === "unknown" && match.status === "unmatched",
      ),
    ).toBe(true);
  },
);
