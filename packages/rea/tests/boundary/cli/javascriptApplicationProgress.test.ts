import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const progressLine = z.object({
  rea_progress: z.object({
    phase: z.string(),
    completed: z.number(),
    total: z.number().nullable(),
    message: z.string(),
    sequence: z.number(),
    terminal: z.boolean().optional(),
  }),
});

for (const command of ["analyze-javascript-application", "analyze"]) {
  cliTest(
    `${command} reports real analysis phases on stderr and preserves stdout Evidence`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-js-cli-progress-");
      await writeFile(join(root, "main.js"), "fetch('');\n");
      const direct = await analyzeJavaScriptApplication({ input_path: root });
      if (!direct.ok) throw direct.error;

      const output = await cli.run({ arguments: [command, root, "--json"] });
      expect(output.exitCode, `${output.stdout}\n${output.stderr}`).toBe(0);
      expect(parseEvidence(output.json).evidence_id).toBe(
        direct.value.evidence_id,
      );
      const updates = output.stderr
        .trim()
        .split("\n")
        .map((line) => progressLine.parse(JSON.parse(line)).rea_progress);
      expect(updates[0]?.completed).toBe(0);
      expect(
        updates.some(({ phase }) => phase === "parse_javascript_sources"),
      ).toBe(true);
      expect(
        updates
          .filter(({ phase }) => phase.startsWith("javascript_worker_"))
          .map(({ phase }) => phase),
      ).toEqual([
        "javascript_worker_parse",
        "javascript_worker_static",
        "javascript_worker_semantic",
        "javascript_worker_projection",
        "javascript_worker_transfer",
      ]);
      expect(updates.at(-1)).toMatchObject({ completed: 1, terminal: true });
      expect(
        updates.slice(0, -1).every(({ terminal }) => terminal !== true),
      ).toBe(true);
    },
  );
}

cliTest(
  "keeps a failed analysis distinct from a completed result",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-cli-progress-failure-");
    const output = await cli.run({
      arguments: [
        "analyze-javascript-application",
        join(root, "absent"),
        "--json",
      ],
    });
    expect(output.json).toMatchObject({ code: "invalid_request" });
    const updates = output.stderr
      .trim()
      .split("\n")
      .map((line) => progressLine.parse(JSON.parse(line)).rea_progress);
    expect(updates[0]?.completed).toBe(0);
    expect(updates.every(({ terminal }) => terminal !== true)).toBe(true);
  },
);

for (const extension of ["mts", "cts"]) {
  for (const command of ["analyze-javascript-application", "analyze"]) {
    cliTest(
      `${command} returns facts for a selected ${extension} source`,
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-nodenext-cli-");
        const path = `selected.${extension}`;
        await writeFile(
          join(root, path),
          "export function selected_feature(value: string) { return { value }; }",
        );
        const output = await cli.run({ arguments: [command, root, "--json"] });
        expect(output.exitCode).toBe(0);
        const evidence = parseEvidence(output.json);
        const result = javascriptApplicationAnalysisResultSchema.parse(
          evidence.normalized_result,
        );
        expect(result.statistics).toMatchObject({
          relevant_files: 1,
          parsed_javascript_files: 1,
          parse_failures: 0,
        });
        expect(
          result.graph.nodes.some(
            ({ kind, observations }) =>
              kind === "javascript-asset" &&
              observations.some(({ properties }) => properties.path === path),
          ),
        ).toBe(true);
      },
    );
  }
}

for (const command of ["analyze-javascript-application", "analyze"]) {
  cliTest(
    `${command} retains HTML source ranges after a bare carriage return`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-html-coordinate-cli-");
      const opening = '<script src="actual.js">';
      await Promise.all([
        writeFile(
          join(root, "index.html"),
          `<main>context</main>\r${opening}</script>`,
        ),
        writeFile(join(root, "actual.js"), "export const actual = true;"),
      ]);
      const output = await cli.run({ arguments: [command, root, "--json"] });
      expect(output.exitCode).toBe(0);
      const evidence = parseEvidence(output.json);
      const result = javascriptApplicationAnalysisResultSchema.parse(
        evidence.normalized_result,
      );
      const loads = result.graph.edges.filter(
        ({ relation, properties }) =>
          relation === "loads" && properties.script_path === "actual.js",
      );
      expect(loads).toHaveLength(1);
      expect(loads[0]).toMatchObject({
        properties: { resolved_path: "actual.js" },
        evidence: {
          location: {
            available: true,
            value: {
              kind: "source-range",
              source: "index.html",
              start: { line: 2, column: 0 },
              end: { line: 2, column: opening.length },
            },
          },
        },
      });
    },
  );
}
