import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "keeps missing source-map mappings partial while retaining explicit declarations through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-source-map-mappings-");
    const original = "export const answer: number = 42;";
    const cases = [
      {
        directory: "missing",
        map: {
          version: 3,
          sources: ["original.ts"],
          sourcesContent: [original],
          names: [],
        },
        expectedCoverage: "partial",
        limitation: "Source map has no mappings string.",
      },
      {
        directory: "empty",
        map: {
          version: 3,
          sources: ["original.ts"],
          sourcesContent: [original],
          names: [],
          mappings: "",
        },
        expectedCoverage: "complete",
        limitation: null,
      },
      {
        directory: "mapped",
        map: {
          version: 3,
          sources: ["original.ts"],
          sourcesContent: [original],
          names: [],
          mappings: "AAAA",
        },
        expectedCoverage: "complete",
        limitation: null,
      },
    ] as const;
    for (const { directory, map, expectedCoverage, limitation } of cases) {
      const app = join(root, directory);
      const mapText = JSON.stringify(map);
      await writeFixtureFiles(app, { "app.js.map": mapText });
      const { graph } = await analyzeJavaScriptDirectory(surface, cli, app);
      const mapDigest = createHash("sha256").update(mapText).digest("hex");
      const source = graph.nodes.find(
        (node) =>
          node.kind === "source-module" &&
          node.identity.strategy === "source-map-original" &&
          node.identity.source_map_sha256 === mapDigest,
      );

      expect(graph.coverage.status).toBe(expectedCoverage);
      expect(source).toMatchObject({
        identity: {
          strategy: "source-map-original",
          original_source: "original.ts",
          source_sha256: createHash("sha256").update(original).digest("hex"),
        },
        observations: [
          expect.objectContaining({
            evidence: expect.objectContaining({
              artifact: expect.objectContaining({ sha256: mapDigest }),
              limitations: limitation === null ? [] : [limitation],
            }),
          }),
        ],
      });
      if (limitation !== null)
        expect(graph.nodes).toContainEqual(
          expect.objectContaining({
            kind: "unknown",
            observations: expect.arrayContaining([
              expect.objectContaining({
                properties: expect.objectContaining({
                  operation: "parse-local-source-map",
                }),
                evidence: expect.objectContaining({
                  artifact: expect.objectContaining({ sha256: mapDigest }),
                  limitations: [limitation],
                }),
              }),
            ]),
          }),
        );
    }
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "recovers retained prefixed source-map originals and byte identity through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-retained-map-prefix-");
    const original = "export const answer: number = 42;";
    const mapText = `\uFEFF)]}'retained response\r\n${JSON.stringify({
      version: 3,
      sources: ["original.ts"],
      sourcesContent: [original],
      names: [],
      mappings: "AAAA",
    })}`;
    const mapPath = join(root, "bundle.js.map");
    await writeFile(
      join(root, "bundle.js"),
      "export const answer = 42;\n//# sourceMappingURL=bundle.js.map\n",
    );
    await writeFile(mapPath, mapText);

    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const mapDigest = createHash("sha256").update(mapText).digest("hex");
    const originalDigest = createHash("sha256").update(original).digest("hex");
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: "source-module",
        identity: expect.objectContaining({
          strategy: "source-map-original",
          source_map_sha256: mapDigest,
          original_source: "original.ts",
          source_sha256: originalDigest,
        }),
        observations: expect.arrayContaining([
          expect.objectContaining({
            source_map_reference: expect.objectContaining({
              source_name: "original.ts",
              map_path: "bundle.js.map",
            }),
            properties: expect.objectContaining({
              source_index: 0,
              declaration_index: 0,
              source_name_available: true,
              content_available: true,
              content_sha256: originalDigest,
            }),
            evidence: expect.objectContaining({
              artifact: expect.objectContaining({ sha256: mapDigest }),
            }),
          }),
        ]),
      }),
    );
    expect(graph.coverage.status).toBe("complete");
    expect(await readFile(mapPath, "utf8")).toBe(mapText);
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains nullable source-map declarations and aligned content through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-nullable-map-");
    const original = "export const answer: number = 42;";
    const unnamed = "retained source text without a declared name";
    const maps = {
      "absent.js.map": JSON.stringify({
        version: 3,
        sources: ["unembedded.ts"],
        sourcesContent: null,
        names: [],
        mappings: "AAAA",
      }),
      "mixed.js.map": JSON.stringify({
        version: 3,
        sources: [null, "original.ts"],
        sourcesContent: [unnamed, original],
        names: [],
        mappings: "ACAA",
      }),
      "unnamed-empty.js.map": JSON.stringify({
        version: 3,
        sources: [null, "original.ts"],
        sourcesContent: [null, original],
        names: [],
        mappings: "ACAA",
      }),
    };
    await writeFixtureFiles(root, {
      ...maps,
      "absent.js":
        "export const absent = 1;\n//# sourceMappingURL=absent.js.map\n",
      "mixed.js":
        "export const answer = 42;\n//# sourceMappingURL=mixed.js.map\n",
      "unnamed-empty.js":
        "export const answer = 42;\n//# sourceMappingURL=unnamed-empty.js.map\n",
    });
    for (const [mapPath, expectedSource] of [
      ["absent.js.map", "unembedded.ts"],
      ["mixed.js.map", "original.ts"],
      ["unnamed-empty.js.map", "original.ts"],
    ] as const)
      expect(
        originalPositionFor(new TraceMap(maps[mapPath], `file:///${mapPath}`), {
          line: 1,
          column: 0,
        }).source,
      ).toBe(`file:///${expectedSource}`);
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const digest = (text: string) =>
      createHash("sha256").update(text).digest("hex");
    expect(
      graph.nodes.filter(
        (node) => node.identity.strategy === "source-map-original",
      ),
    ).toHaveLength(3);
    for (const [name, mapPath, content, sourceIndex] of [
      ["unembedded.ts", "absent.js.map", null, 0],
      ["original.ts", "mixed.js.map", original, 1],
      ["original.ts", "unnamed-empty.js.map", original, 1],
    ] as const) {
      const mapDigest = digest(maps[mapPath]);
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({
          kind: "source-module",
          identity: expect.objectContaining({
            strategy: "source-map-original",
            source_map_sha256: mapDigest,
            original_source: name,
            source_sha256: content === null ? null : digest(content),
          }),
          observations: expect.arrayContaining([
            expect.objectContaining({
              source_map_reference: expect.objectContaining({
                source_name: name,
                map_path: mapPath,
              }),
              properties: expect.objectContaining({
                source_index: sourceIndex,
                declaration_index: sourceIndex,
                source_name_available: true,
                content_available: content !== null,
              }),
              evidence: expect.objectContaining({
                artifact: expect.objectContaining({ sha256: mapDigest }),
              }),
            }),
          ]),
        }),
      );
    }
    for (const [mapPath, content] of [
      ["mixed.js.map", unnamed],
      ["unnamed-empty.js.map", null],
    ] as const)
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({
          kind: "unknown",
          observations: expect.arrayContaining([
            expect.objectContaining({
              source_map_reference: null,
              properties: expect.objectContaining({
                source_index: 0,
                declaration_index: 0,
                source_name_available: false,
                content_available: content !== null,
                content_sha256: content === null ? null : digest(content),
              }),
              evidence: expect.objectContaining({
                artifact: expect.objectContaining({
                  sha256: digest(maps[mapPath]),
                }),
              }),
            }),
          ]),
        }),
      );
    expect(graph.coverage.status).toBe("complete");
    for (const [path, text] of Object.entries(maps))
      expect(await readFile(join(root, path), "utf8")).toBe(text);
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains valid declarations beside non-string source-map names through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-invalid-map-source-");
    const mapText = JSON.stringify({
      version: 3,
      sources: [42, "discarded.ts"],
      sourcesContent: [null, "export const answer: number = 42;"],
      names: [],
      mappings: "ACAA",
    });
    await writeFixtureFiles(root, { "invalid.js.map": mapText });
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(graph.coverage.status).toBe("partial");
    const mapDigest = createHash("sha256").update(mapText).digest("hex");
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: "source-module",
        identity: expect.objectContaining({
          strategy: "source-map-original",
          source_map_sha256: mapDigest,
          original_source: "discarded.ts",
          source_sha256: createHash("sha256")
            .update("export const answer: number = 42;")
            .digest("hex"),
        }),
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              section_path: [],
              source_index: 1,
              declaration_index: 0,
            }),
          }),
        ]),
      }),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: "unknown",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              operation: "parse-local-source-map",
            }),
            evidence: expect.objectContaining({
              artifact: expect.objectContaining({
                sha256: mapDigest,
              }),
              limitations: expect.arrayContaining([
                "Source map contains a non-string source name at index 0.",
              ]),
            }),
          }),
        ]),
      }),
    );
    expect(await readFile(join(root, "invalid.js.map"), "utf8")).toBe(mapText);
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "keeps external indexed sections unknown while retaining embedded siblings through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-external-indexed-map-");
    const url = "https://app.test/maps/part.map?revision=7";
    const mapText = JSON.stringify({
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: {
            version: 3,
            sources: ["before.ts"],
            sourcesContent: ["export const before = 1;"],
            names: [],
            mappings: "AAAA",
          },
        },
        { offset: { line: 1, column: 0 }, url },
        {
          offset: { line: 2, column: 0 },
          map: {
            version: 3,
            sources: ["after.ts"],
            sourcesContent: ["export const after = 2;"],
            names: [],
            mappings: "AAAA",
          },
        },
      ],
    });
    await writeFixtureFiles(root, { "indexed.js.map": mapText });
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const mapDigest = createHash("sha256").update(mapText).digest("hex");

    expect(graph.coverage.status).toBe("partial");
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: "unknown",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              path: "indexed.js.map",
              operation: "parse-local-source-map",
              limitation: `External source-map section URL is not fetched: ${url}`,
              external_sections: [{ section_path: [1], url }],
            }),
            evidence: expect.objectContaining({
              artifact: expect.objectContaining({ sha256: mapDigest }),
              limitations: [
                `External source-map section URL is not fetched: ${url}`,
              ],
            }),
          }),
        ]),
      }),
    );
    for (const [source, content] of [
      ["before.ts", "export const before = 1;"],
      ["after.ts", "export const after = 2;"],
    ] as const)
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({
          kind: "source-module",
          identity: expect.objectContaining({
            strategy: "source-map-original",
            source_map_sha256: mapDigest,
            original_source: source,
            source_sha256: createHash("sha256").update(content).digest("hex"),
          }),
        }),
      );
    expect(await readFile(join(root, "indexed.js.map"), "utf8")).toBe(mapText);
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves source-root declarations and URL path identity through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-source-root-identity-");
    const cases = [
      {
        sourceRoot: "https://cdn.example/src//",
        resolution: { kind: "suffix", path: "cdn.example/src//a.js" },
      },
      {
        sourceRoot: "webpack://",
        resolution: {
          kind: "unresolved",
          reason:
            "Source reference uses a non-hierarchical URL without a file pathname.",
        },
      },
      {
        sourceRoot: "webpack:///",
        resolution: { kind: "suffix", path: "a.js" },
      },
    ] as const;
    const maps = cases.map(({ sourceRoot }, index) => ({
      path: `${String(index)}.js.map`,
      text: JSON.stringify({
        version: 3,
        sourceRoot,
        sources: ["a.js"],
        names: [],
        mappings: "AAAA",
      }),
    }));
    await writeFixtureFiles(
      root,
      Object.fromEntries(maps.map(({ path, text }) => [path, text])),
    );
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const [index, { sourceRoot, resolution }] of cases.entries()) {
      const map = maps[index]!;
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({
          kind: "source-module",
          identity: expect.objectContaining({
            strategy: "source-map-original",
            source_map_sha256: createHash("sha256")
              .update(map.text)
              .digest("hex"),
            original_source: "a.js",
          }),
          observations: expect.arrayContaining([
            expect.objectContaining({
              source_map_reference: {
                source_name: "a.js",
                source_root: sourceRoot,
                map_path: map.path,
                resolution,
              },
            }),
          ]),
        }),
      );
      expect(await readFile(join(root, map.path), "utf8")).toBe(map.text);
    }
  },
);
