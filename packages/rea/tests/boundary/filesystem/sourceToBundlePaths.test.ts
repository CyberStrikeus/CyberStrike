import { EvidenceIntegrityError } from "../../../src/domain/evidenceErrors.js";
import { resolveSourceToBundleReference } from "../../../src/application/javascript/SourceToBundleReference.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { parseApplicationGraphEvidence } from "../../../src/application/javascript/JavaScriptApplicationEvidenceGraph.js";
import { findApplicationFeatureSeeds } from "../../../src/domain/javascript/javascriptFeatureSeed.js";
import { compareSourceToBundle } from "../../../src/domain/javascript/sourceToBundleComparison.js";
import {
  resolveJavaScriptSourceMapReferences,
  resolveJavaScriptSourceMapUrl,
} from "../../../src/domain/javascript/javascriptSourceMapPaths.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

it.each([
  { current: "export const value = 1;", status: "unchanged" },
  { current: "export const value = 2;", status: "modified" },
])(
  "counts a file's asset, module, and exports as one $status occurrence",
  async ({ current: source, status }) => {
    const root = await createTestTempDirectory("rea-source-representations-");
    const previous = join(root, "previous");
    const current = join(root, "current");
    await Promise.all([mkdir(previous), mkdir(current)]);
    await Promise.all([
      writeFile(join(previous, "index.js"), "export const value = 1;"),
      writeFile(join(current, "index.js"), source),
    ]);
    const { comparison } = await compareTrees(previous, current);
    expect(comparison.items).toEqual([
      expect.objectContaining({
        source_path: "index.js",
        status,
        candidates: [
          expect.objectContaining({
            current_file_occurrence: expect.objectContaining({
              path: "index.js",
            }),
            representation_node_ids: expect.any(Array),
          }),
        ],
      }),
    ]);
    expect(
      comparison.items[0]?.candidates[0]?.representation_node_ids?.length,
    ).toBeGreaterThan(1);
    for (const id of comparison.items[0]?.candidates[0]
      ?.representation_node_ids ?? [])
      expect(comparison.unmapped_current_node_ids).not.toContain(id);
  },
);

it("retains two physical occurrences when equal bytes share an asset node", async () => {
  const root = await createTestTempDirectory("rea-source-occurrences-");
  const previous = join(root, "previous");
  const current = join(root, "current");
  await Promise.all([mkdir(previous), mkdir(current)]);
  const source = "export const value = 1;";
  await Promise.all([
    writeFile(join(previous, "index.js"), source),
    writeFile(join(current, "index.js"), source),
    writeFile(join(current, "copy.js"), source),
  ]);
  const { comparison } = await compareTrees(previous, current);
  expect(comparison.items).toEqual([
    expect.objectContaining({
      source_path: "index.js",
      status: "duplicated",
      candidates: expect.arrayContaining([
        expect.objectContaining({
          current_file_occurrence: expect.objectContaining({
            path: "index.js",
          }),
        }),
        expect.objectContaining({
          current_file_occurrence: expect.objectContaining({ path: "copy.js" }),
        }),
      ]),
    }),
  ]);
  expect(comparison.items[0]?.candidates).toHaveLength(2);
  for (const candidate of comparison.items[0]?.candidates ?? [])
    for (const id of candidate.representation_node_ids ?? [])
      expect(comparison.unmapped_current_node_ids).not.toContain(id);
});

it("keeps literal hash characters in historical/current filesystem paths", async () => {
  const root = await createTestTempDirectory("rea-source-path-");
  const previous = join(root, "previous");
  const current = join(root, "current");
  await Promise.all([mkdir(previous), mkdir(current)]);
  await Promise.all([
    writeFile(join(previous, "worker#main.js"), "export const value = 1;"),
    writeFile(join(current, "worker#main.js"), "export const value = 2;"),
  ]);
  const { reference, comparison } = await compareTrees(previous, current);

  expect(reference.entries).toContainEqual(
    expect.objectContaining({
      kind: "file",
      path: "worker#main.js",
      content_state: "hashed",
    }),
  );
  expect(comparison.items).toContainEqual(
    expect.objectContaining({
      source_path: "worker#main.js",
      candidates: expect.arrayContaining([
        expect.objectContaining({
          signals: expect.arrayContaining([
            expect.objectContaining({
              kind: "current-path-exact",
              source_value: "worker#main.js",
            }),
          ]),
        }),
      ]),
    }),
  );
});

it("matches source-map originals named relative to the map", async () => {
  const root = await createTestTempDirectory("rea-source-map-parent-");
  const previous = join(root, "previous");
  const current = join(root, "current");
  await Promise.all([
    mkdir(join(previous, "src"), { recursive: true }),
    mkdir(join(current, "dist"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(previous, "src", "a.js"), "export const value = 1;\n"),
    writeFile(
      join(current, "dist", "main.js"),
      "var value = 2;\n//# sourceMappingURL=main.js.map\n",
    ),
    writeFile(
      join(current, "dist", "main.js.map"),
      JSON.stringify({
        version: 3,
        file: "main.js",
        sources: ["../src/a.js"],
        sourcesContent: ["export const value = 2;\n"],
        names: [],
        mappings: "AAAA",
      }),
    ),
  ]);
  const { comparison } = await compareTrees(previous, current);

  expect(comparison.items).toContainEqual(
    expect.objectContaining({
      source_path: "src/a.js",
      candidates: expect.arrayContaining([
        expect.objectContaining({
          current_node_kind: "source-module",
          signals: expect.arrayContaining([
            expect.objectContaining({
              kind: "source-map-original-path",
              current_values: ["src/a.js"],
            }),
          ]),
        }),
      ]),
    }),
  );
});

it.each([
  { root: "../src/", expected: "https://example.test/src/index.js" },
  // webpack 5 and tsc emit an empty root for map-relative sources.
  { root: "", expected: "https://example.test/maps/index.js" },
  { root: null, expected: "https://example.test/maps/index.js" },
  { root: "/", expected: "https://example.test/index.js" },
  { root: "./", expected: "https://example.test/maps/index.js" },
  { root: " ", expected: "https://example.test/index.js" },
  {
    root: "https://cdn.example/src",
    expected: "https://cdn.example/src/index.js",
  },
])("resolves sourceRoot $root according to ECMA-426", ({ root, expected }) => {
  expect(
    resolveJavaScriptSourceMapUrl(
      "index.js",
      root,
      "https://example.test/maps/app.js.map",
    ),
  ).toBe(expected);
});

it.each([
  {
    mapPath: "maps/app.js.map",
    sourceRoot: "../src/",
    source: "index.js",
    expected: "src/index.js",
  },
  {
    mapPath: "maps/app.js.map",
    sourceRoot: "",
    source: "index.js",
    expected: "maps/index.js",
    decoy: "index.js",
  },
  {
    mapPath: "pkg/dist/cjs/main.js.map",
    sourceRoot: "",
    source: "../../src/a.js",
    expected: "pkg/src/a.js",
  },
  {
    mapPath: "maps/app.js.map",
    sourceRoot: null,
    source: "index.js",
    expected: "maps/index.js",
  },
  {
    mapPath: "pkg/dist/main.js.map",
    source: "..\\src\\a.js",
    expected: "pkg/src/a.js",
  },
  {
    mapPath: "pkg/dist/main.js.map",
    source: "../src/a.js",
    expected: "pkg/src/a.js",
  },
  {
    mapPath: "apps/pkg/dist/maps/main.js.map",
    source: "../../src/a.js",
    expected: "apps/pkg/src/a.js",
  },
  {
    mapPath: "pkg/dist/main.js.map",
    sourceRoot: "../src",
    source: "a.js",
    expected: "pkg/src/a.js",
  },
  {
    mapPath: "pkg/maps/main.map",
    sourceRoot: "../src",
    source: "/vendor/a.js",
    expected: "pkg/src/vendor/a.js",
    expectedUrlPath: "pkg/src//vendor/a.js",
    decoy: "vendor/a.js",
  },
  {
    mapPath: "pkg/maps/main.js.map",
    source: "modules/a.js",
    expected: "pkg/maps/modules/a.js",
  },
  {
    mapPath: "pkg/maps/main.js.map",
    source: "generated/../src/a.js",
    expected: "pkg/maps/src/a.js",
  },
  {
    mapPath: "pkg/maps/main.js.map",
    sourceRoot: "generated/..",
    source: "src/a.js",
    expected: "pkg/maps/src/a.js",
  },
  {
    mapPath: "pkg/maps/main.js.map",
    source: "../actual/%2e%2e/src/a.js",
    expected: "pkg/src/a.js",
    decoy: "pkg/actual/%2e%2e/src/a.js",
  },
  {
    mapPath: "pkg/maps/main.js.map",
    sourceRoot: "../actual/.%2E",
    source: "src/a.js",
    expected: "pkg/src/a.js",
    decoy: "pkg/actual/.%2E/src/a.js",
  },
  {
    mapPath: "pkg#name?/maps/main.js.map",
    source: "../src/a.js",
    expected: "pkg#name?/src/a.js",
  },
  {
    mapPath: "pkg/maps/main.js.map",
    source: "modules/a%20b.js",
    expected: "pkg/maps/modules/a b.js",
  },
  {
    mapPath: "pkg/maps/main.js.map",
    source: "modules/a%23b.js",
    expected: "pkg/maps/modules/a#b.js",
  },
  {
    mapPath: "pkg/maps/main.js.map",
    source: "../actual/%252e%252e/src/a.js",
    expected: "pkg/actual/%2e%2e/src/a.js",
    decoy: "pkg/src/a.js",
  },
])(
  "resolves $source against $mapPath without selecting a same-basename decoy",
  async ({
    mapPath,
    source,
    sourceRoot,
    expected,
    expectedUrlPath,
    decoy: decoyPath = "src/a.js",
  }) => {
    if (sourceRoot !== undefined) {
      const resolved = resolveJavaScriptSourceMapUrl(
        source,
        sourceRoot,
        `https://example.test/${mapPath}`,
      );
      if (resolved === null)
        throw new Error("Expected a valid resolved source URL");
      expect(decodeURIComponent(new URL(resolved).pathname)).toBe(
        `/${expectedUrlPath ?? expected}`,
      );
    }
    const root = await createTestTempDirectory("rea-nested-map-");
    const previous = join(root, "previous");
    const current = join(root, "current");
    await Promise.all([
      mkdir(join(previous, expected, ".."), { recursive: true }),
      mkdir(join(previous, decoyPath, ".."), { recursive: true }),
      mkdir(join(current, mapPath, ".."), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(previous, expected), "export const value = 1;"),
      writeFile(join(previous, decoyPath), "export const decoy = 99;"),
      writeFile(
        join(current, mapPath),
        JSON.stringify({
          version: 3,
          sources: [source],
          ...(sourceRoot === undefined ? {} : { sourceRoot }),
          sourcesContent: ["export const value = 2;"],
          names: [],
          mappings: "AAAA",
        }),
      ),
    ]);
    const { comparison } = await compareTrees(previous, current);
    const correct = comparison.items.find(
      ({ source_path }) => source_path === expected,
    );
    expect(correct?.current_node_ids).toHaveLength(1);
    expect(correct?.candidates).toContainEqual(
      expect.objectContaining({
        confidence: "high",
        signals: expect.arrayContaining([
          expect.objectContaining({
            kind: "source-map-original-path",
            current_values: [expected],
          }),
        ]),
      }),
    );
    const decoy = comparison.items.find(
      ({ source_path }) => source_path === decoyPath,
    );
    expect(decoy?.current_node_ids).toEqual([]);
    expect(
      decoy?.candidates
        .flatMap(({ signals }) => signals)
        .some(({ kind }) => kind === "current-path-exact"),
    ).toBe(false);
    // A suffix alone must not claim a second map-relative original identity.
    expect(
      decoy?.candidates
        .flatMap(({ signals }) => signals)
        .some(({ kind }) => kind === "source-map-original-path"),
    ).toBe(false);
  },
);

it("retains every map location when identical map artifacts merge", async () => {
  const root = await createTestTempDirectory("rea-source-map-merged-");
  const previous = join(root, "previous");
  const current = join(root, "current");
  const map = JSON.stringify({
    version: 3,
    sources: ["../src/x.js"],
    sourcesContent: ["export const value = 2;"],
    names: [],
    mappings: "AAAA",
  });
  for (const prefix of ["a", "b"]) {
    await Promise.all([
      mkdir(join(previous, prefix, "src"), { recursive: true }),
      mkdir(join(current, prefix, "maps"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(previous, prefix, "src/x.js"), "export const value = 1;"),
      writeFile(join(current, prefix, "maps/main.js.map"), map),
    ]);
  }
  const { comparison, application } = await compareTrees(previous, current);
  const originals = application.graph.nodes.filter(
    ({ kind }) => kind === "source-module",
  );
  expect(originals).toHaveLength(1);
  expect(
    originals[0]?.observations.map(
      ({ source_map_reference }) => source_map_reference,
    ),
  ).toEqual(
    expect.arrayContaining(
      ["a", "b"].map((prefix) => ({
        source_name: "../src/x.js",
        source_root: null,
        map_path: `${prefix}/maps/main.js.map`,
        resolution: { kind: "artifact-relative", path: `${prefix}/src/x.js` },
      })),
    ),
  );
  for (const prefix of ["a", "b"]) {
    const path = `${prefix}/src/x.js`;
    const item = comparison.items.find(
      ({ source_path }) => source_path === path,
    );
    expect(item?.current_node_ids).toHaveLength(1);
    expect(item?.candidates).toContainEqual(
      expect.objectContaining({
        confidence: "high",
        signals: expect.arrayContaining([
          expect.objectContaining({
            kind: "source-map-original-path",
            current_values: [path],
          }),
        ]),
      }),
    );
  }
});

it("keeps leaf source roots distinct after indexed maps are serialized", async () => {
  const root = await createTestTempDirectory("rea-source-map-leaf-roots-");
  const previous = join(root, "previous");
  const current = join(root, "current");
  await mkdir(join(current, "maps"), { recursive: true });
  for (const prefix of ["one", "two"]) {
    await mkdir(join(previous, prefix), { recursive: true });
    await writeFile(join(previous, prefix, "same.js"), "export const old = 1;");
  }
  await writeFile(join(previous, "same.js"), "export const decoy = 3;");
  await writeFile(
    join(current, "maps/main.map"),
    JSON.stringify({
      version: 3,
      sections: ["one", "two"].map((prefix, line) => ({
        offset: { line, column: 0 },
        map: {
          version: 3,
          sources: ["same.js"],
          sourceRoot: `../${prefix}`,
          sourcesContent: ["export const updated = 2;"],
          mappings: "AAAA",
          names: [],
        },
      })),
    }),
  );
  const { comparison, application } = await compareTrees(previous, current);
  const originals = application.graph.nodes.filter(
    ({ kind }) => kind === "source-module",
  );
  expect(originals).toHaveLength(2);
  for (const prefix of ["one", "two"]) {
    expect(originals).toContainEqual(
      expect.objectContaining({
        identity: expect.objectContaining({
          original_source: "same.js",
          source_root: `../${prefix}`,
        }),
        observations: [
          expect.objectContaining({
            source_map_reference: {
              source_name: "same.js",
              source_root: `../${prefix}`,
              map_path: "maps/main.map",
              resolution: {
                kind: "artifact-relative",
                path: `${prefix}/same.js`,
              },
            },
          }),
        ],
      }),
    );
    expect(
      comparison.items.find(
        ({ source_path }) => source_path === `${prefix}/same.js`,
      ),
    ).toMatchObject({
      current_node_ids: [expect.any(String)],
      candidates: expect.arrayContaining([
        expect.objectContaining({ confidence: "high" }),
      ]),
    });
  }
  expect(
    comparison.items.find(({ source_path }) => source_path === "same.js")
      ?.current_node_ids,
  ).toEqual([]);
  for (const prefix of ["one", "two"])
    for (const value of [`${prefix}/same.js`, `../${prefix}`])
      expect(
        findApplicationFeatureSeeds(originals, {
          kind: "module",
          value,
          match: "exact",
          case_sensitive: true,
        }),
      ).toHaveLength(1);
});

it.each([
  { source: "file:/repo/src/a.js", hasPath: true },
  { source: "file:C:/repo/src/a.js", hasPath: true },
  { source: "file:C:\\repo\\src\\a.js", hasPath: true },
  { source: "C:\\repo\\src\\a.js", hasPath: true },
  { source: "file://server/share/src/a.js", hasPath: true },
  { source: "file:/repo/src/a.js?version=2#original", hasPath: true },
  { source: "webpack:///src/a.js", hasPath: true },
  { source: "https://example.com/src/a.js#original", hasPath: true },
  { source: "node:internal/src/a.js", hasPath: false },
  { source: "data:text/javascript,virtual/src/a.js", hasPath: false },
  { source: "data:text/javascript,virtual/../src/a.js", hasPath: false },
  { source: "data:\\src\\a.js", hasPath: false },
])(
  "projects source references from $source only when they name a file",
  async ({ source, hasPath }) => {
    const root = await createTestTempDirectory("rea-source-map-uri-");
    const previous = join(root, "previous");
    const current = join(root, "current");
    await Promise.all([
      mkdir(join(previous, "src"), { recursive: true }),
      mkdir(join(current, "maps"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(previous, "src/a.js"), "export const value = 1;"),
      writeFile(
        join(current, "maps/main.js.map"),
        JSON.stringify({
          version: 3,
          sources: [source],
          sourcesContent: ["export const value = 2;"],
          names: [],
          mappings: "AAAA",
        }),
      ),
    ]);
    const { comparison, application } = await compareTrees(previous, current);
    expect(application.graph.nodes).toContainEqual(
      expect.objectContaining({
        identity: expect.objectContaining({ original_source: source }),
      }),
    );
    if (hasPath)
      expect(comparison.items[0]?.candidates).toContainEqual(
        expect.objectContaining({
          confidence: "high",
          signals: expect.arrayContaining([
            expect.objectContaining({ kind: "source-map-original-path" }),
          ]),
        }),
      );
    else expect(comparison.items[0]?.candidates).toEqual([]);
  },
);

it.each(["#original.js", "?version.js", "?version.js#original.js"])(
  "uses the relative URL pathname rather than a literal %s filename",
  async (suffix) => {
    const root = await createTestTempDirectory("rea-source-map-suffix-");
    const previous = join(root, "previous");
    const current = join(root, "current");
    await Promise.all([
      mkdir(join(previous, "src"), { recursive: true }),
      mkdir(join(current, "maps"), { recursive: true }),
    ]);
    const source = `../src/a.js${suffix}`;
    await Promise.all([
      writeFile(join(previous, "src/a.js"), "export const value = 1;"),
      writeFile(join(previous, `src/a.js${suffix}`), "export const decoy = 3;"),
      writeFile(
        join(current, "maps/main.js.map"),
        JSON.stringify({
          version: 3,
          sources: [source],
          sourcesContent: ["export const value = 2;"],
          names: [],
          mappings: "AAAA",
        }),
      ),
    ]);
    const { comparison, application } = await compareTrees(previous, current);
    const actual = comparison.items.find(
      ({ source_path }) => source_path === "src/a.js",
    );
    expect(actual?.current_node_ids).toHaveLength(1);
    expect(actual?.candidates).toContainEqual(
      expect.objectContaining({
        confidence: "high",
        signals: expect.arrayContaining([
          expect.objectContaining({
            kind: "source-map-original-path",
            current_values: ["src/a.js"],
          }),
        ]),
      }),
    );
    const decoy = comparison.items.find(
      ({ source_path }) => source_path === `src/a.js${suffix}`,
    );
    expect(decoy?.current_node_ids).toEqual([]);
    expect(decoy?.candidates).toEqual([]);
    expect(application.graph.nodes).toContainEqual(
      expect.objectContaining({
        identity: expect.objectContaining({ original_source: source }),
      }),
    );
  },
);

it.each([
  { filename: "a#b.js", decoyFilename: "a" },
  { filename: "a?b.js", decoyFilename: "a" },
  { filename: "a%23b.js", decoyFilename: "a#b.js" },
])(
  "preserves the literal UNC filesystem name $filename without selecting a URL decoy",
  async ({ filename, decoyFilename }) => {
    const root = await createTestTempDirectory("rea-source-map-unc-");
    const previous = join(root, "previous");
    const current = join(root, "current");
    const source = `\\\\server\\share\\src\\${filename}`;
    const expected = `src/${filename}`;
    const decoy = `src/${decoyFilename}`;
    await Promise.all([
      mkdir(join(previous, "src"), { recursive: true }),
      mkdir(join(current, "maps"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(previous, expected), "export const value = 1;"),
      writeFile(join(previous, decoy), "export const decoy = 3;"),
      writeFile(
        join(current, "maps/main.map"),
        JSON.stringify({
          version: 3,
          sources: [source],
          sourcesContent: ["export const value = 2;"],
          names: [],
          mappings: "AAAA",
        }),
      ),
    ]);
    const { comparison, application } = await compareTrees(previous, current);
    const actual = comparison.items.find(
      ({ source_path }) => source_path === expected,
    );
    expect(actual?.current_node_ids).toHaveLength(1);
    expect(actual?.candidates).toContainEqual(
      expect.objectContaining({
        signals: expect.arrayContaining([
          expect.objectContaining({ kind: "source-map-original-path" }),
        ]),
      }),
    );
    expect(
      comparison.items.find(({ source_path }) => source_path === decoy)
        ?.current_node_ids,
    ).toEqual([]);
    expect(application.graph.nodes).toContainEqual(
      expect.objectContaining({
        identity: expect.objectContaining({ original_source: source }),
      }),
    );
  },
);

it.each([
  { source: "", historicalPath: "maps.js" },
  { source: ".", historicalPath: "maps.js" },
  { source: "./", historicalPath: "maps.js" },
  { source: "child/..", historicalPath: "maps.js" },
  { source: "child.js/", historicalPath: "maps.js/child.js" },
  { source: "#original.js", historicalPath: "maps.js" },
  { source: "?version.js", historicalPath: "maps.js" },
  { source: "./?version.js", historicalPath: "maps.js" },
  { source: "%2e", historicalPath: "maps.js" },
  { source: "%2e%2e", historicalPath: "maps.js" },
  { source: "child%2fpart.js", historicalPath: "maps.js/child/part.js" },
  { source: "child%5cpart.js", historicalPath: "maps.js/child/part.js" },
  { source: "bad%zz.js", historicalPath: "maps.js/bad%zz.js" },
  { source: "\\\\bad host\\share\\a.js", historicalPath: "share/a.js" },
  { source: "../../outside/a.js", historicalPath: "outside/a.js" },
])(
  "declines source references without a trustworthy file path: $source",
  async ({ source, historicalPath }) => {
    const root = await createTestTempDirectory("rea-source-map-empty-");
    const previous = join(root, "previous");
    const current = join(root, "current");
    await Promise.all([
      mkdir(join(previous, historicalPath, ".."), { recursive: true }),
      mkdir(join(current, "maps.js"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(previous, historicalPath), "export const value = 1;"),
      writeFile(
        join(current, "maps.js/main.js.map"),
        JSON.stringify({
          version: 3,
          sources: [source],
          sourcesContent: ["export const value = 2;"],
          names: [],
          mappings: "AAAA",
        }),
      ),
    ]);
    const { comparison, application } = await compareTrees(previous, current);
    const original = application.graph.nodes.find(
      ({ kind }) => kind === "source-module",
    );
    expect(original?.observations[0]?.source_map_reference).toMatchObject({
      source_name: source,
      source_root: null,
      map_path: "maps.js/main.js.map",
      resolution: { kind: "unresolved", reason: expect.any(String) },
    });
    expect(comparison.items[0]?.source_path).toBe(historicalPath);
    expect(comparison.items[0]?.candidates).toEqual([]);
  },
);

it("resolves parent segments against a nested source map's directory", async () => {
  const root = await createTestTempDirectory("rea-source-map-nested-");
  const previous = join(root, "previous");
  const current = join(root, "current");
  await Promise.all([
    mkdir(join(previous, "web", "src"), { recursive: true }),
    mkdir(join(current, "web", "maps"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(previous, "web", "src", "a.js"),
      "export const value = 1;\n",
    ),
    writeFile(
      join(current, "web", "main.js"),
      "var value = 2;\n//# sourceMappingURL=maps/main.js.map\n",
    ),
    writeFile(
      join(current, "web", "maps", "main.js.map"),
      JSON.stringify({
        version: 3,
        file: "../main.js",
        sources: ["../src/a.js"],
        sourcesContent: ["export const value = 2;\n"],
        names: [],
        mappings: "AAAA",
      }),
    ),
  ]);
  const { comparison } = await compareTrees(previous, current);

  expect(comparison.items).toContainEqual(
    expect.objectContaining({
      source_path: "web/src/a.js",
      candidates: expect.arrayContaining([
        expect.objectContaining({
          current_node_kind: "source-module",
          signals: expect.arrayContaining([
            expect.objectContaining({
              kind: "source-map-original-path",
              current_values: ["web/src/a.js"],
            }),
          ]),
        }),
      ]),
    }),
  );
});

it("rejects static application Evidence whose subject path disagrees with its result", async () => {
  const root = await createTestTempDirectory("rea-application-subject-path-");
  const analyzed = await analyzeJavaScriptApplication({ input_path: root });
  if (!analyzed.ok) throw analyzed.error;
  const subject = analyzed.value.subject;
  if (subject === null) throw new Error("Analysis Evidence subject missing");
  const inconsistent = {
    ...analyzed.value,
    subject: {
      ...subject,
      local_path: join(root, "relocated"),
    },
  };

  const parsed = parseApplicationGraphEvidence(inconsistent);
  expect(parsed.ok).toBe(false);
  if (!parsed.ok) {
    expect(parsed.error).not.toBeInstanceOf(EvidenceIntegrityError);
    if (parsed.error instanceof EvidenceIntegrityError) throw parsed.error;
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["subject"],
        reason: "invalid_value",
        message: expect.stringContaining("subject must match"),
      }),
    );
  }
});

const compareTrees = async (previous: string, current: string) => {
  const reference = await importReferenceSource({
    root: previous,
    caller: "source-to-bundle-path-test",
    policy: { secretPatterns: [] },
  });
  if (!reference.ok) throw new Error(reference.error.message);
  const analyzed = await analyzeJavaScriptApplication({ input_path: current });
  if (!analyzed.ok) throw analyzed.error;
  const parsedApplication = parseApplicationGraphEvidence(
    JSON.parse(JSON.stringify(analyzed.value)),
  );
  if (!parsedApplication.ok) throw new Error("Analysis Evidence must parse");
  const application = parsedApplication.value;
  const comparison = compareSourceToBundle({
    reference: reference.value,
    application: {
      evidenceId: application.evidence.evidence_id,
      rootArtifactSha256: application.rootArtifactSha256,
      graph: application.graph,
    },
  });
  return { reference: reference.value, comparison, application };
};

it.skipIf(process.platform === "win32")(
  "does not promote a POSIX literal backslash name to a different historical slash path",
  async () => {
    const root = await createTestTempDirectory("rea-backslash-source-match-");
    const previous = join(root, "previous");
    const current = join(root, "current");
    await mkdir(join(previous, "literal"), { recursive: true });
    await mkdir(current);
    await writeFile(
      join(previous, "literal", "name.js"),
      "export const value = 1;\n",
    );
    await writeFile(
      join(current, "literal\\name.js"),
      "export const value = 2;\n",
    );
    const { comparison } = await compareTrees(previous, current);
    const item = comparison.items.find(
      ({ source_path }) => source_path === "literal/name.js",
    );
    expect(item?.current_node_ids).toEqual([]);
    expect(
      item?.candidates
        .flatMap(({ signals }) => signals)
        .some(({ kind }) => kind === "current-path-exact"),
    ).toBe(false);
  },
);

it.skipIf(process.platform === "win32").each([
  { mapPath: "literal\\bundle.js.map", expected: "a.js" },
  { mapPath: "literal\\dir/bundle.js.map", expected: "literal\\dir/a.js" },
])(
  "resolves source-map declarations from literal artifact base $mapPath",
  async ({ mapPath, expected }) => {
    const root = await createTestTempDirectory("rea-backslash-source-map-");
    const previous = join(root, "previous");
    const current = join(root, "current");
    await mkdir(previous);
    await mkdir(current);
    await writeFile(join(previous, "a.js"), "export const value = 1;\n");
    await mkdir(join(current, "literal\\dir"), { recursive: true });
    await writeFile(join(current, mapPath.slice(0, -4)), "var value = 2;\n");
    await writeFile(
      join(current, mapPath),
      JSON.stringify({
        version: 3,
        file: mapPath.slice(0, -4),
        sources: ["a.js"],
        sourcesContent: ["export const value = 2;\n"],
        names: [],
        mappings: "AAAA",
      }),
    );
    const { application, comparison } = await compareTrees(previous, current);
    const references = application.graph.nodes
      .flatMap(({ observations }) =>
        observations.map(({ source_map_reference }) => source_map_reference),
      )
      .filter((reference) => reference?.map_path === mapPath);
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resolution: { kind: "artifact-relative", path: expected },
        }),
      ]),
    );
    const item = comparison.items.find(
      ({ source_path }) => source_path === "a.js",
    );
    const signals = item?.candidates.flatMap(({ signals }) => signals) ?? [];
    if (expected === "a.js")
      expect(signals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "source-map-original-path",
            current_values: ["a.js"],
          }),
        ]),
      );
    else
      expect(
        signals.some(({ kind }) => kind === "source-map-original-path"),
      ).toBe(false);
  },
);

it.each([
  { source: "https://user%2Fname@host.test/a.js", expected: "host.test/a.js" },
  {
    source: "C:\\code\\literal%5Cname.js",
    expected: "C:/code/literal%5Cname.js",
  },
])(
  "checks encoded source-map separators in the parsed pathname of $source",
  ({ source, expected }) => {
    expect(
      resolveJavaScriptSourceMapReferences([source], null, "ordinary.js.map")[0]
        ?.resolution,
    ).toEqual({ kind: "suffix", path: expected });
  },
);

it("cancels historical graph file reads and rejects malformed JSON through the owning reader", async () => {
  const root = await createTestTempDirectory("rea-reference-read-");
  const path = join(root, "reference.json");
  await writeFile(path, "{malformed");
  const resources = new ArtifactResourceScope();
  try {
    const malformed = await resolveSourceToBundleReference(
      { kind: "file", path },
      undefined,
      resources,
    );
    expect(malformed).toMatchObject({
      ok: false,
      error: { _tag: "EvidenceFileError", reason: "invalid-json" },
    });
    for (const abortBefore of [true, false]) {
      const controller = new AbortController();
      if (abortBefore) controller.abort("cancelled test read");
      const pending = resolveSourceToBundleReference(
        { kind: "file", path },
        controller.signal,
        resources,
      );
      if (!abortBefore) controller.abort("cancelled test read");
      expect(await pending).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError" },
      });
    }
  } finally {
    await resources.close();
  }
  expect(resources.hasPending).toBe(false);
});
