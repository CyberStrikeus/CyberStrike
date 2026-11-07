import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import { javaScriptSemanticTraceResultSchema } from "../../../src/domain/javascript/javascriptSemanticTraceSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

cliTest(
  "traces reassignment inputs through the public analysis and trace commands",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-assignment-influence-");
    for (const [name, body, label] of [
      ["declaration", "const next = accel; return next;", "next"],
      ["variable", "speed = accel; return speed;", "speed"],
      ["property", "state.speed = accel; return state.speed;", "speed"],
      ["compound", "state.speed += accel; return state.speed;", "speed"],
      [
        "computed-key",
        "const obj = { [speed = accel]() {} }; return speed;",
        "speed",
      ],
    ] as const) {
      const directory = join(root, name);
      await mkdir(directory);
      await writeFile(
        join(directory, "main.js"),
        `const accel = 0.001; let speed = 6; const state = { speed: 6 }; export function update() { ${body} }`,
      );
      // The compiled CLI prepares Darwin ownership helpers; hosts that select
      // a matching SDK explicitly must pass that selection through, as the
      // other compiled-CLI lifecycle tests do.
      const environment: { readonly SDKROOT: string } | Record<string, never> =
        process.env.SDKROOT === undefined
          ? {}
          : { SDKROOT: process.env.SDKROOT };
      const analyzed = await cli.run({
        arguments: ["analyze-javascript-application", directory, "--json"],
        environment,
      });
      expect(analyzed.exitCode, `${name} analyzed: ${analyzed.stderr}`).toBe(0);
      const queryFile = join(root, `${name}.json`);
      const query = {
        application: analyzed.json,
        query: {
          seed: { kind: "literal", value: 0.001 },
          direction: "forward-influence",
        },
      };
      await writeFile(queryFile, JSON.stringify(query));
      const trace = {
        arguments: ["trace-javascript-semantics", queryFile, "--json"],
      };
      const traced = await (name === "declaration"
        ? cli.run(trace)
        : runFileCli(cli, trace));
      expect(traced.exitCode, `${name} traced: ${traced.stderr}`).toBe(0);
      const { normalized_result: result } = z
        .object({ normalized_result: javaScriptSemanticTraceResultSchema })
        .parse(traced.json);
      expect(
        result.nodes.some(
          (node) =>
            ["binding", "property-slot"].includes(node.kind) &&
            node.label === label,
        ),
      ).toBe(true);
      // Later property reads remain uncertain after a mutable write. Follow
      // candidates explicitly rather than upgrading their pre-existing resolution.
      await writeFile(
        queryFile,
        JSON.stringify({
          ...query,
          query: { ...query.query, include_ambiguous_dynamic_edges: true },
        }),
      );
      const expanded = await runFileCli(cli, {
        arguments: ["trace-javascript-semantics", queryFile, "--json"],
      });
      expect(expanded.exitCode, `${name} expanded: ${expanded.stderr}`).toBe(0);
      const expandedResult = z
        .object({ normalized_result: javaScriptSemanticTraceResultSchema })
        .parse(expanded.json).normalized_result;
      expect(expandedResult.nodes.map((node) => node.label)).toContain(
        "return",
      );
    }
  },
  120_000,
);
