import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  analyzeJavaScriptDirectory,
  runNodeJsonControl,
} from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains standalone GraphQL sources and only suppresses owned copies through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-graphql-source-");
    await writeFixtureFiles(root, {
      "classic.js": `
        const document = {
          kind: "OperationDefinition", operation: "query",
          name: { kind: "Name", value: "ClassicSource" },
          loc: { source: {
            body: "query ClassicSource { viewer { id } }",
            locationOffset: { line: 1, column: 1 },
          } },
        };
      `,
      "entry.mjs": `
        const source = {
          body: "query Standalone { viewer { id } }",
          locationOffset: { line: 1, column: 1 },
        };
        const compiledSource = {
          body: "query Compiled { viewer { id } }",
          locationOffset: { line: 1, column: 1 },
        };
        const document = { kind: "Document", definitions: [{
          kind: "OperationDefinition", operation: "query",
          name: { kind: "Name", value: "Compiled" },
        }], loc: { source: compiledSource } };
        const independentSource = {
          body: "query Independent { viewer { id } }",
          locationOffset: { line: 1, column: 1 },
        };
        const unrelated = {
          kind: "OperationDefinition", operation: "query",
          name: { kind: "Name", value: "Independent" },
        };
        const changedSource = {
          body: "query ChangedSource { viewer { id } }",
          locationOffset: { line: 1, column: 1 },
        };
        const location = { source: changedSource };
        location.source = {};
        const changedDocument = {
          kind: "OperationDefinition", operation: "query",
          name: { kind: "Name", value: "ChangedSource" }, loc: location,
        };
        const exposedSource = {
          body: "query ExposedSource { viewer { id } }",
          locationOffset: { line: 1, column: 1 },
        };
        const exposedDocument = {
          kind: "OperationDefinition", operation: "query",
          name: { kind: "Name", value: "ExposedSource" },
          loc: { source: exposedSource },
        };
        exposedDocument.loc.source = {};
      `,
    });
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    const operations = result.graph.nodes
      .filter((node) => node.kind === "endpoint")
      .flatMap((node) => node.observations)
      .filter(({ properties }) => properties.mechanism === "graphql:query");
    expect(operations.map(({ properties }) => properties.value).sort()).toEqual(
      [
        "ChangedSource",
        "ChangedSource",
        "ClassicSource",
        "ClassicSource",
        "Compiled",
        "ExposedSource",
        "ExposedSource",
        "Independent",
        "Independent",
        "Standalone",
      ],
    );
    for (const observation of operations)
      expect(observation.evidence).toMatchObject({
        authority: "ast-static-analysis",
        state: "observed",
        artifact: { available: true },
        location: {
          available: true,
          value: {
            kind: "source-range",
            source:
              observation.properties.value === "ClassicSource"
                ? "classic.js"
                : "entry.mjs",
          },
        },
      });
    expect(result.statistics.parse_failures).toBe(0);
    expect(result.graph.coverage.status).toBe("complete");
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains only final known RPC object properties through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-rpc-properties-");
    await writeFixtureFiles(root, {
      "entry.mjs": `
        function httpBatchLink(options) { return options.url; }
        const options = { url: "/trpc/runtime" };
        const key = "url";
        const links = [
          httpBatchLink({ url: "/trpc/old", url: "/trpc/live" }),
          httpBatchLink({ url: "/trpc/spread-old", ...options }),
          httpBatchLink({ url: "/trpc/computed-old", [key]: options.url }),
          httpBatchLink({ ...options, url: "/trpc/final", headers: {} }),
        ];
        const doc = {
          kind: "OperationDefinition", operation: "query", operation: "mutation",
          name: { kind: "Name", value: "Old" },
          name: { kind: "Name", value: "Current" },
        };
        console.log(JSON.stringify([links, doc.operation, doc.name.value]));
      `,
    });
    // This control checks JavaScript object semantics, not a live tRPC client.
    expect(await runNodeJsonControl(root, "entry.mjs")).toEqual([
      ["/trpc/live", "/trpc/runtime", "/trpc/runtime", "/trpc/final"],
      "mutation",
      "Current",
    ]);
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const endpoints = graph.nodes
      .filter((node) => node.kind === "endpoint")
      .flatMap((node) => node.observations)
      .filter(({ properties }) =>
        /^(trpc:link:|graphql:)/u.test(String(properties.mechanism)),
      )
      .map(({ properties }) => [properties.value, properties.mechanism]);
    expect(endpoints).toEqual(
      expect.arrayContaining([
        ["/trpc/live", "trpc:link:httpBatchLink"],
        ["/trpc/final", "trpc:link:httpBatchLink"],
        ["Current", "graphql:mutation"],
      ]),
    );
    expect(endpoints).toHaveLength(3);
  },
);
