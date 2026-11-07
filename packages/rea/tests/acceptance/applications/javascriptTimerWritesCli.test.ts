import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest(
  "links cancellation to the timer handle reaching its read through the CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-timer-reaching-write-");
    await writeFixtureFiles(root, {
      "app.mjs": `
      function cleared() {
        let handle = setTimeout(work, 10);
        handle = null;
        clearTimeout(handle);
      }
      function latest() {
        let handle = setTimeout(work, 20);
        handle = setTimeout(work, 30);
        clearTimeout(handle);
      }
      function conditional() {
        let handle = setTimeout(work, 40);
        if (condition) handle = null;
        clearTimeout(handle);
      }
    `,
    });
    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const graph = result.semantic_graph;
    expect(graph).not.toBeNull();
    if (graph === null) throw new Error("Expected a semantic graph");
    const cancellationTargets = graph.relations
      .filter(({ relation }) => relation === "cancels-timer")
      .map(({ resolution, target_node_id }) => ({
        resolution,
        delay: graph.nodes.find(({ node_id }) => node_id === target_node_id)
          ?.properties.delay_milliseconds,
      }));
    expect(cancellationTargets).toEqual(
      expect.arrayContaining([
        { resolution: "resolved", delay: 30 },
        { resolution: "candidate", delay: 40 },
      ]),
    );
    expect(cancellationTargets).toHaveLength(2);
    expect(
      graph.unknowns.filter(({ family }) => family === "timer"),
    ).toHaveLength(2);
  },
);
