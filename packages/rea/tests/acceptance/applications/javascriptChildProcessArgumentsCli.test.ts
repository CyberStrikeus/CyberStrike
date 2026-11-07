import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "keeps child argv counts unknown after spread through %s",
  async (surface, { cli, processes }) => {
    const root = await createTestTempDirectory("rea-child-argv-");
    await writeFixtureFiles(root, {
      "entry.mjs": [
        'import { spawn, execFile, fork } from "node:child_process";',
        'const args = ["a", "b"];',
        'spawn("spread-spawn", [...args]);',
        'execFile("spread-exec", ["prefix", ...args]);',
        'fork("spread-fork", [...args, "suffix"]);',
        'spawn("fixed", ["a", "b"]);',
        'execFile("empty", []);',
      ].join("\n"),
      "child.cjs": "console.log(process.argv.slice(2).length);",
    });
    const args = ["a", "b"];
    const counts: number[] = [];
    for (const values of [
      [...args],
      ["prefix", ...args],
      [...args, "suffix"],
      ["a", "b"],
      [],
    ]) {
      const control = await processes.run(
        process.execPath,
        [join(root, "child.cjs"), ...values],
        { timeoutMs: 5_000 },
      );
      expect(control.exitCode, control.stderr).toBe(0);
      counts.push(Number(control.stdout));
    }
    expect(counts).toEqual([2, 3, 3, 2, 0]);
    const graph = (await analyzeJavaScriptDirectory(surface, cli, root))
      .semantic_graph;
    const children = graph.nodes.filter(
      (node) => node.kind === "child-process",
    );
    expect(children).toHaveLength(5);
    for (const command of ["spread-spawn", "spread-exec", "spread-fork"]) {
      const child = children.find(
        (node) => node.properties.command === command,
      );
      expect(child?.properties.argv_count, command).toBeNull();
      expect(
        graph.relations.filter(
          (relation) =>
            relation.relation === "supplies-argv" &&
            relation.target_node_id === child?.node_id,
        ),
      ).toEqual([]);
    }
    expect(
      children.find((node) => node.properties.command === "fixed")?.properties
        .argv_count,
    ).toBe(2);
    expect(
      children.find((node) => node.properties.command === "empty")?.properties
        .argv_count,
    ).toBe(0);
  },
);
