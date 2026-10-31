import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

for (const surface of ["CLI", "stdio MCP"] as const)
  cliTest(
    `excludes erased TypeScript reads and handler captures through ${surface}`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-typescript-erasure-");
      await writeFixtureFiles(root, {
        "main.cts": [
          'import type { Shape } from "./shape";',
          'const { contextBridge, ipcRenderer } = require("electron");',
          "const marker = 1;",
          "type Description = typeof marker;",
          "function describe() { type Local = typeof marker; }",
          "const kind = typeof marker;",
          'const CHANNEL = "ready";',
          "function register(value: Shape) {",
          "  const handler = () => {",
          "    type Local = typeof value;",
          "    interface Method { value(): void; }",
          "  };",
          "  ipcRenderer.on(CHANNEL, handler);",
          "}",
          'contextBridge.exposeInMainWorld("api", { on: () => register("unused") });',
        ].join("\n"),
        "shape.d.ts": "export type Shape = string;",
      });
      const result = await analyzeJavaScriptDirectory(surface, cli, root);
      expect(result.statistics).toMatchObject({
        parsed_javascript_files: 2,
        parse_failures: 0,
      });
      const graph = result.semantic_graph;
      const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
      const markerReads = graph.relations.filter(
        (relation) =>
          relation.relation === "reads" &&
          nodes.get(relation.target_node_id)?.label === "marker",
      );
      expect(markerReads).toHaveLength(1);
      expect(markerReads[0]?.evidence.location).toMatchObject({
        available: true,
        value: { kind: "source-range", source: "main.cts", start: { line: 6 } },
      });
      expect(
        graph.relations.filter(
          (relation) =>
            relation.relation === "captures" &&
            nodes.get(relation.source_node_id)?.label === "value",
        ),
      ).toEqual([]);
      const channels = result.graph.nodes
        .filter((node) => node.kind === "ipc-channel")
        .flatMap((node) => node.observations);
      expect(channels).toHaveLength(1);
      expect(channels[0]?.properties).toMatchObject({
        channel: "ready",
        resolution: "literal",
      });
      expect(
        result.graph.nodes.flatMap((node) => node.observations),
      ).toContainEqual(
        expect.objectContaining({
          properties: expect.objectContaining({
            semantic_role: "source-module",
            path: "main.cts",
            type_relationships: 1,
          }),
        }),
      );
    },
  );
