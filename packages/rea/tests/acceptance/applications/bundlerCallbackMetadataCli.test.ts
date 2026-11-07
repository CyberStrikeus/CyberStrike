import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains both repeated chunk callback observations through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-bundler-callbacks-");
    const source = [
      '(globalThis.webpackChunkFixture = globalThis.webpackChunkFixture || []).push([[1], {a: function() {}}, function(r) { r(7); r.e("chunk-a"); }]);',
      '(globalThis.webpackChunkFixture = globalThis.webpackChunkFixture || []).push([[1], {a: function() {}}, function(r) { r(8); r.e("chunk-b"); }]);',
    ].join("\n");
    await writeFile(join(root, "bundle.js"), source);
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const chunk = graph.nodes.find(({ kind }) => kind === "javascript-chunk");
    for (const [index, entry, asyncChunk] of [
      [0, "7", "chunk-a"],
      [1, "8", "chunk-b"],
    ] as const) {
      expect(chunk?.observations).toContainEqual(
        expect.objectContaining({
          properties: expect.objectContaining({
            entry_module_keys: [entry],
            async_chunk_keys: [asyncChunk],
          }),
          evidence: expect.objectContaining({
            location: expect.objectContaining({
              value: expect.objectContaining({
                source: "bundle.js",
                start: { line: index + 1, column: 0 },
              }),
            }),
          }),
        }),
      );
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          source_node_id: chunk?.node_id,
          properties: expect.objectContaining({
            kind: "bundler-entry-module",
            module_key: entry,
            resolution_status: "not-found",
          }),
        }),
      );
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          source_node_id: chunk?.node_id,
          properties: expect.objectContaining({
            kind: "bundler-async-chunk",
            chunk_key: asyncChunk,
            resolution_status: "not-found",
          }),
        }),
      );
    }
  },
);
