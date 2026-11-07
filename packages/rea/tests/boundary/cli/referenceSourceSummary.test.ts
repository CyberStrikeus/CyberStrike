import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import canonicalize from "canonicalize";
import { describe, expect } from "vitest";

import { parseHistoricalSourceGraph } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

describe.skipIf(process.platform === "win32")(
  "compiled historical-source summaries",
  () => {
    cliTest(
      "selects a committed summary without changing complete output",
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-reference-summary-");
        await mkdir(join(root, "src", "nested"), { recursive: true });
        await Promise.all([
          writeFile(join(root, "package.json"), '{"name":"fixture"}\n'),
          writeFile(
            join(root, "src", "main.js"),
            'import "./nested/value.js";\n',
          ),
          writeFile(
            join(root, "src", "nested", "value.js"),
            "export const value = 1;\n",
          ),
          writeFile(join(root, "\uE000.js"), "export const first = 1;\n"),
          writeFile(join(root, "\u{10000}.js"), "export const last = 2;\n"),
        ]);
        const run = (...options: string[]) =>
          cli.run({
            arguments: ["import-reference-source", root, "--json", ...options],
            cwd: root,
          });
        const complete = await run();
        expect(complete.exitCode).toBe(0);
        const graph = parseHistoricalSourceGraph(complete.json);
        const graphJson = canonicalize(graph);
        if (graphJson === undefined)
          throw new TypeError("Unserializable complete graph");
        const expectedSemantic = {
          schema: "HistoricalSourceManifest",
          authority: "historical-reference",
          graph_sha256: createHash("sha256").update(graphJson).digest("hex"),
          root_sha256: graph.root_sha256,
          inventory_state: graph.inventory_state,
          entry_count: 7,
          relationship_count: 1,
        };
        const semanticJson = canonicalize(expectedSemantic);
        if (semanticJson === undefined)
          throw new TypeError("Unserializable manifest semantics");
        const expectedManifest = {
          ...expectedSemantic,
          manifest_id: `hsm_${createHash("sha256").update(semanticJson).digest("hex")}`,
        };
        expect((await run("--detail", "full")).stdout).toBe(complete.stdout);
        for (const { depth, token } of [
          { depth: undefined, token: undefined },
          { depth: 0, token: "0" },
          { depth: 1, token: "1" },
          { depth: 2, token: "2" },
          { depth: 2, token: "02" },
          { depth: 10, token: "10" },
          {
            depth: Number.MAX_SAFE_INTEGER,
            token: String(Number.MAX_SAFE_INTEGER),
          },
        ]) {
          const result = await run(
            "--detail",
            "summary",
            ...(token === undefined ? [] : ["--outline-depth", token]),
          );
          expect(result.exitCode).toBe(0);
          expect(result.json).toHaveProperty("manifest", expectedManifest);
          const selected = graph.entries.filter(
            (entry) => entry.path.split("/").length <= (depth ?? 2),
          );
          expect(result.json).toMatchObject({
            schema: "HistoricalSourceSummary",
            authority: graph.authority,
            root_alias: graph.root_alias,
            inventory_state: graph.inventory_state,
            provenance: graph.provenance,
            vcs: graph.vcs,
            languages: graph.languages,
            manifests: graph.manifests,
            counts: {
              entries: 7,
              files: 5,
              directories: 2,
              symlinks: 0,
              relationships: 1,
              parse_failures: 0,
              exclusions: 0,
            },
            outline: {
              depth: depth ?? 2,
              entries: selected.map(({ path, kind }) =>
                expect.objectContaining({ path, kind }),
              ),
              omitted_entry_count: graph.entries.length - selected.length,
            },
          });
          expect(result.json).not.toHaveProperty("relationships");
        }
      },
    );

    cliTest(
      "retains exclusions and parse coverage independently of a hidden outline",
      async ({ cli }) => {
        const root = await createTestTempDirectory(
          "rea-reference-partial-summary-",
        );
        await Promise.all([
          writeFile(join(root, ".gitignore"), "ignored.txt\n"),
          writeFile(join(root, "ignored.txt"), "ignored\n"),
          writeFile(join(root, "broken.js"), "export const = ;\n"),
        ]);
        const result = await cli.run({
          arguments: [
            "import-reference-source",
            root,
            "--detail",
            "summary",
            "--outline-depth",
            "0",
            "--json",
          ],
          cwd: root,
        });
        expect(result.exitCode).toBe(0);
        expect(result.json).toMatchObject({
          inventory_state: "partial",
          counts: { parse_failures: 1, exclusions: 1 },
          exclusions: [
            {
              path: "ignored.txt",
              reason: "project-ignored",
              pattern: "ignored.txt",
            },
          ],
          outline: { depth: 0, entries: [], omitted_entry_count: 2 },
        });
      },
    );
  },
);

describe("compiled historical-source summary input boundaries", () => {
  cliTest(
    "documents detail and depth in public command help",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: ["import-reference-source", "--help"],
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--detail");
      expect(result.stdout).toContain("--outline-depth");
      expect(result.stdout).toContain("requires --detail summary");
    },
  );

  for (const [label, options] of [
    ["--outline-depth=", ["--detail", "summary", "--outline-depth="]],
    [
      "an empty outline-depth argument",
      ["--detail", "summary", "--outline-depth", ""],
    ],
    ...[
      " ",
      "\t",
      "1\n",
      "0x1",
      "0b1",
      "1e0",
      "+1",
      "1.0",
      "-0",
      "-1",
      "1.5",
      "NaN",
      "9007199254740992",
    ].map((value) => [
      JSON.stringify(value),
      ["--detail", "summary", "--outline-depth", value],
    ]),
  ] as const) {
    cliTest(`rejects ${label} as an outline depth`, async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-reference-summary-input-",
      );
      const invocation = {
        arguments: ["import-reference-source", root, ...options, "--json"],
        cwd: root,
      };
      const result =
        label === "--outline-depth="
          ? await cli.run(invocation)
          : await runFileCli(cli, invocation);
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: expect.arrayContaining([
          expect.objectContaining({
            path: expect.stringContaining("outlineDepth"),
          }),
        ]),
      });
      expect(result.stdout).not.toContain("HistoricalSourceGraph");
      expect(result.stdout).not.toContain("HistoricalSourceSummary");
    });
  }

  for (const options of [
    ["--detail", "summry"],
    ["--outline-depth", "1"],
    ["--detail", "full", "--outline-depth", "1"],
  ]) {
    cliTest(`rejects ${options.join(" ")}`, async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-reference-summary-input-",
      );
      const result = await runFileCli(cli, {
        arguments: ["import-reference-source", root, ...options, "--json"],
        cwd: root,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).not.toContain("HistoricalSourceGraph");
      expect(result.stdout).not.toContain("HistoricalSourceSummary");
      expect(result.stdout).toMatch(/detail|outline/u);
    });
  }

  cliTest(
    "preserves the missing-root failure in summary mode",
    async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-reference-summary-missing-",
      );
      const result = await cli.run({
        arguments: [
          "import-reference-source",
          join(root, "missing"),
          "--detail",
          "summary",
          "--json",
        ],
        cwd: root,
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        error: "Import failed",
        category: "invalid_input",
        message: expect.stringContaining(
          "Reference source root could not be resolved",
        ),
      });
    },
  );
});
