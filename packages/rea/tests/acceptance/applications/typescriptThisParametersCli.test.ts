import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "maps arguments to runtime TypeScript parameters through %s",
  async (surface, { cli, processes }) => {
    const root = await createTestTempDirectory("rea-this-parameters-");
    await writeFixtureFiles(root, {
      "bundle.mts": [
        "self.webpackChunkApp.push([[1], { 7: function(this: void, module: unknown, exports: Record<string, unknown>, require: (id: number) => unknown) { exports.answer = 42; } }, function(this: void, require: (id: number) => unknown) { require(7); }]);",
      ].join("\n"),
      "interop.cts": [
        "function identity<T>(this: void, value: T) { return value; }",
        'const electron = identity(require("electron"));',
        'electron.ipcRenderer.send("typed-identity");',
      ].join("\n"),
      "ipc-wrapper.cts": [
        'const { ipcRenderer } = require("electron");',
        "function send(this: void, channel: string) { ipcRenderer.send(channel); }",
        "function sendRest(this: void, ...channels: string[]) { ipcRenderer.send(...channels); }",
        'send("typed-channel");',
        'sendRest("typed-rest");',
      ].join("\n"),
      "entry.mts": [
        "function first(this: void, value: number) { return value; }",
        "function rest(this: void, ...values: number[]) { return values; }",
        "function destructured({ left }: { left: number }, right: number) { return left + right; }",
        "function mixed(this: void, head: number, ...tail: number[]) { return [head, ...tail]; }",
        "const a = first(7);",
        "const b = rest(1, 2);",
        "const c = destructured({ left: 3 }, 4);",
        "const d = mixed(9, 10, 11);",
        "console.log(JSON.stringify([a, b, c, d, first.length, rest.length, mixed.length]));",
      ].join("\n"),
    });
    const control = await processes.run(
      process.execPath,
      [join(root, "entry.mts")],
      { timeoutMs: 15_000 },
    );
    expect(control.exitCode, control.stderr).toBe(0);
    expect(JSON.parse(control.stdout)).toEqual([
      7,
      [1, 2],
      7,
      [9, 10, 11],
      1,
      0,
      1,
    ]);
    const analysis = await analyzeJavaScriptDirectory(surface, cli, root);
    const graph = analysis.semantic_graph;
    const parameters = graph.nodes.filter(
      (node) =>
        node.kind === "parameter" && node.identity.module_path === "entry.mts",
    );
    expect(parameters.map((node) => node.label).sort()).toEqual([
      "head",
      "left",
      "right",
      "tail",
      "value",
      "values",
    ]);
    const parameterIds = new Set(parameters.map((node) => node.node_id));
    const flows = graph.relations.filter(
      (relation) =>
        relation.relation === "argument-to-parameter" &&
        parameterIds.has(relation.target_node_id),
    );
    expect(
      flows
        .map((flow) => {
          const source = graph.nodes.find(
            (node) => node.node_id === flow.source_node_id,
          );
          const target = parameters.find(
            (node) => node.node_id === flow.target_node_id,
          );
          const owner = graph.nodes.find(
            (node) => node.node_id === target?.function_node_id,
          );
          return [
            source?.identity.source_range?.start.line,
            source?.label,
            owner?.label,
            target?.label,
          ];
        })
        .sort(),
    ).toEqual([
      [5, "argument 0", "first", "value"],
      [6, "argument 0", "rest", "values"],
      [6, "argument 1", "rest", "values"],
      [7, "argument 0", "destructured", "left"],
      [7, "argument 1", "destructured", "right"],
      [8, "argument 0", "mixed", "head"],
      [8, "argument 1", "mixed", "tail"],
      [8, "argument 2", "mixed", "tail"],
    ]);
    expect(
      analysis.graph.nodes
        .flatMap((node) => node.observations)
        .some(
          (observation) =>
            Array.isArray(observation.properties.exports) &&
            observation.properties.exports.includes("answer"),
        ),
    ).toBe(true);
    const channels = analysis.graph.nodes
      .filter((node) => node.kind === "ipc-channel")
      .flatMap((node) =>
        node.observations.map((observation) => observation.properties.channel),
      );
    expect(channels).toEqual(
      expect.arrayContaining(["typed-channel", "typed-rest", "typed-identity"]),
    );
    for (const [name, arity] of [
      ["first", 1],
      ["rest", 1],
      ["destructured", 2],
      ["mixed", 2],
    ] as const) {
      const callable = graph.nodes.find(
        (node) => node.kind === "function" && node.label === name,
      );
      expect(callable, name).toBeDefined();
      const fingerprint = graph.fingerprints.find(
        (value) => value.function_node_id === callable?.node_id,
      );
      expect(fingerprint?.components.parameter_arity, name).toBe(arity);
    }
  },
);
