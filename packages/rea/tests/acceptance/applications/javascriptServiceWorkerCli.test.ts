import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest(
  "attributes service-worker module URLs through the compiled CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-service-worker-identity-");
    await writeFixtureFiles(root, {
      "app/module.mjs":
        'navigator.serviceWorker.register(new URL("./sw.js?version=2", import.meta.url));',
      "app/document.mjs": 'navigator.serviceWorker.register("./sw.js");',
      "app/replaced.mjs":
        'navigator.serviceWorker.register = load; navigator.serviceWorker.register(new URL("./ordinary.js", import.meta.url));',
      "app/vendor.mjs":
        'import navigator from "vendor"; navigator.serviceWorker.register(new URL("./ordinary.js", import.meta.url));',
      "app/sw.js": "self.addEventListener('fetch', () => {});",
      "app/ordinary.js": "export const ordinary = true;",
    });
    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const workers = result.graph.nodes.filter(
      ({ kind }) => kind === "service-worker",
    );
    expect(workers).toHaveLength(2);
    expect(
      workers.flatMap(({ observations }) =>
        observations.map(({ properties }) => properties),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          declared_specifier: "./sw.js?version=2",
          resolved_path: "app/sw.js",
          resolution_status: "resolved",
        }),
        expect.objectContaining({
          declared_specifier: null,
          resolved_path: null,
          expression: 'navigator.serviceWorker.register("./sw.js")',
        }),
      ]),
    );
    const mapped = result.graph.edges.filter(
      ({ relation, source_node_id }) =>
        relation === "maps_to" &&
        workers.some(({ node_id }) => node_id === source_node_id),
    );
    expect(mapped.map(({ properties }) => properties.resolved_path)).toEqual([
      "app/sw.js",
    ]);
  },
);
