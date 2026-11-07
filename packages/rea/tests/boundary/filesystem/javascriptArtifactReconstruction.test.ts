import { createHash } from "node:crypto";
import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import {
  analyzeJavaScriptApplication,
  reconstructJavaScriptArtifact,
  readJavaScriptArtifactFiles,
} from "../../support/javascriptApplicationScope.js";
import { scanArtifactInventory } from "../../fixtures/artifactInventory.js";
import type {
  ArtifactEntry,
  ArtifactReader,
} from "../../../src/artifacts/ArtifactReader.js";
import { writeJavaScriptArtifactFixture } from "../../fixtures/javascriptArtifactApplication.js";

it("reads local source maps as part of static artifact analysis", async () => {
  const root = await fixtureDirectory();
  const result = await reconstructJavaScriptArtifact({ input_path: root });

  expect(result.graph.nodes.some(({ kind }) => kind === "source-map")).toBe(
    true,
  );
  expect(result.graph.nodes.some(({ kind }) => kind === "source-module")).toBe(
    true,
  );
});

it("does not follow symlinks and analyzes each local source file", async () => {
  const root = await fixtureDirectory();
  const outside = await createTestTempDirectory("rea-javascript-outside-");
  const outsideFile = join(outside, "secret.js");
  await writeFile(
    outsideFile,
    'fetch("https://outside-secret.invalid/credential");',
  );
  await symlink(outsideFile, join(root, "escape.js"));
  const baseline = await reconstructJavaScriptArtifact({ input_path: root });
  const additionalSource = Array.from(
    { length: 1_000 },
    (_value, index) => `export const value${String(index)} = ${String(index)};`,
  ).join("\n");
  await writeFile(join(root, "additional.js"), additionalSource);

  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const encoded = JSON.stringify(result);

  expect(result.graph.coverage).toMatchObject({
    status: "complete",
    truncated: false,
  });
  expect(result.statistics.parsed_javascript_files).toBe(
    baseline.statistics.parsed_javascript_files + 1,
  );
  expect(result.statistics.text_bytes_read).toBe(
    baseline.statistics.text_bytes_read + Buffer.byteLength(additionalSource),
  );
  expect(encoded).not.toContain(outsideFile);
  expect(encoded).not.toContain("outside-secret.invalid");
});

it("keeps malformed JavaScript, package metadata, and source maps as explicit unknowns", async () => {
  const root = await fixtureDirectory();
  await Promise.all([
    writeFile(join(root, "package.json"), "{"),
    writeFile(join(root, "broken.js"), "function broken( {"),
    writeFile(join(root, "data.json"), "{"),
    writeFile(join(root, "renderer", "renderer.js.map"), "{"),
  ]);

  const result = await reconstructJavaScriptArtifact({
    input_path: root,
  });
  const unknownOperations = result.graph.nodes
    .filter(({ kind }) => kind === "unknown")
    .flatMap(({ observations }) =>
      observations.map(({ properties }) => properties.operation),
    );

  expect(result.statistics.parse_failures).toBeGreaterThan(0);
  expect(result.graph.coverage).toMatchObject({
    status: "partial",
    truncated: false,
    omitted_count: null,
  });
  expect(unknownOperations).toEqual(
    expect.arrayContaining([
      "parse-javascript",
      "parse-package-json",
      "parse-json-module",
      "parse-local-source-map",
    ]),
  );
  const gaps = result.graph.nodes
    .filter(({ kind }) => kind === "unknown")
    .flatMap(({ observations }) => observations);
  for (const operation of [
    "parse-javascript",
    "parse-package-json",
    "parse-json-module",
    "parse-local-source-map",
  ]) {
    const applicable = gaps.filter(
      ({ properties }) => properties.operation === operation,
    );
    expect(applicable.length).toBeGreaterThan(0);
    for (const gap of applicable)
      expect(gap.evidence).toMatchObject({
        authority:
          operation === "parse-javascript"
            ? "ast-static-analysis"
            : "artifact-bytes",
        state: "unavailable",
        confidence: "unknown",
      });
  }
});

it("retains every source declared by every included local source map", async () => {
  const root = await createTestTempDirectory("rea-javascript-source-maps-");
  await Promise.all([
    writeFile(
      join(root, "a.js.map"),
      JSON.stringify({
        version: 3,
        sources: ["a-one.ts", "a-two.ts"],
        sourcesContent: ["one", "two"],
        names: [],
        mappings: "",
      }),
    ),
    writeFile(
      join(root, "b.js.map"),
      JSON.stringify({
        version: 3,
        sources: ["b-one.ts", "b-two.ts"],
        sourcesContent: ["three", "four"],
        names: [],
        mappings: "",
      }),
    ),
  ]);

  const result = await reconstructJavaScriptArtifact({ input_path: root });

  expect(
    result.graph.nodes.filter(({ kind }) => kind === "source-module"),
  ).toHaveLength(4);
  expect(result.graph.coverage).toMatchObject({
    status: "complete",
    truncated: false,
    omitted_count: 0,
  });
});

it.each([
  ["a non-array sourcesContent value", { sourcesContent: "source" }],
  ["a non-string, non-null source entry", { sourcesContent: [42] }],
])(
  "reports %s as an invalid local source map",
  async (_description, content) => {
    const root = await createTestTempDirectory(
      "rea-javascript-invalid-source-map-",
    );
    await writeFile(
      join(root, "invalid.js.map"),
      JSON.stringify({
        version: 3,
        sources: ["source.ts"],
        names: [],
        mappings: "",
        ...content,
      }),
    );

    const result = await reconstructJavaScriptArtifact({ input_path: root });

    expect(result.graph.coverage.status).toBe("partial");
    expect(
      result.graph.nodes.some(
        ({ kind, observations }) =>
          kind === "unknown" &&
          observations.some(
            ({ properties }) =>
              properties.operation === "parse-local-source-map",
          ),
      ),
    ).toBe(true);
  },
);

it("accepts omitted and explicitly null source-map source contents", async () => {
  const root = await createTestTempDirectory(
    "rea-javascript-null-source-content-",
  );
  await Promise.all([
    writeFile(
      join(root, "omitted.js.map"),
      JSON.stringify({
        version: 3,
        sources: ["omitted.ts"],
        names: [],
        mappings: "",
      }),
    ),
    writeFile(
      join(root, "null.js.map"),
      JSON.stringify({
        version: 3,
        sources: ["null.ts"],
        sourcesContent: null,
        names: [],
        mappings: "",
      }),
    ),
  ]);

  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const originals = result.graph.nodes.filter(
    ({ kind }) => kind === "source-module",
  );

  expect(originals).toHaveLength(2);
  expect(
    originals.every(
      ({ observations }) =>
        observations[0]?.properties.content_available === false,
    ),
  ).toBe(true);
  expect(result.graph.coverage.status).toBe("complete");
});

it.each([
  ["shorter", ["export const answer = 42;"]],
  ["longer", ["export const answer = 42;", null, "unused trailing content"]],
])(
  "keeps every source declaration when sourcesContent is %s than sources",
  async (length, sourcesContent) => {
    const root = await createTestTempDirectory(
      `rea-javascript-${length}-source-content-`,
    );
    await writeFile(
      join(root, "bundle.js.map"),
      JSON.stringify({
        version: 3,
        sources: ["a.ts", "b.ts"],
        sourcesContent,
        names: [],
        mappings: "AAAA;ACAA",
      }),
    );

    const result = await reconstructJavaScriptArtifact({ input_path: root });
    const originals = result.graph.nodes.filter(
      ({ identity }) => identity.strategy === "source-map-original",
    );

    expect(
      originals
        .map(({ identity, observations }) => ({
          original_source:
            "original_source" in identity ? identity.original_source : null,
          source_index: observations[0]?.properties.source_index,
          content_available: observations[0]?.properties.content_available,
        }))
        .sort(
          (left, right) =>
            Number(left.source_index) - Number(right.source_index),
        ),
    ).toEqual([
      { original_source: "a.ts", source_index: 0, content_available: true },
      { original_source: "b.ts", source_index: 1, content_available: false },
    ]);
    expect(result.graph.coverage.status).toBe("complete");
  },
);

it("retains unnamed source declarations without shifting later source evidence", async () => {
  const root = await createTestTempDirectory("rea-javascript-unnamed-source-");
  const text = JSON.stringify({
    version: 3,
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: {
          version: 3,
          sources: ["prior.ts"],
          sourcesContent: ["export const prior = 1;"],
          names: [],
          mappings: "",
        },
      },
      {
        offset: { line: 1, column: 0 },
        map: {
          version: 3,
          sources: [null, "original.ts"],
          sourcesContent: [null, "export const answer: number = 42;"],
          names: [],
          mappings: "ACAA",
        },
      },
    ],
  });
  await writeFile(join(root, "bundle.js.map"), text);

  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const nodes = result.graph.nodes;
  const original = nodes.find(
    ({ kind, identity }) =>
      kind === "source-module" &&
      identity.strategy === "source-map-original" &&
      identity.original_source === "original.ts",
  );
  const unnamed = nodes.find(
    ({ kind, observations }) =>
      kind === "unknown" &&
      observations.some(
        ({ properties }) => properties.source_name_available === false,
      ),
  );

  expect(original?.identity).toMatchObject({
    strategy: "source-map-original",
    source_sha256: createHash("sha256")
      .update("export const answer: number = 42;")
      .digest("hex"),
  });
  expect(original?.observations[0]?.properties).toMatchObject({
    source_index: 1,
    declaration_index: 2,
    content_available: true,
  });
  expect(unnamed?.observations[0]?.properties).toMatchObject({
    source_index: 0,
    declaration_index: 1,
    source_name_available: false,
    content_available: false,
    content_sha256: null,
  });
  expect(unnamed?.identity).toMatchObject({
    strategy: "artifact-local-key",
    namespace: "source-map-unnamed-declaration",
    key: "1",
  });
  expect(result.graph.coverage.status).toBe("complete");
});

it("retains every repeated content observation and containment path", async () => {
  const root = await createTestTempDirectory("rea-javascript-observations-");
  await Promise.all(
    Array.from({ length: 70 }, (_, index) =>
      writeFile(
        join(root, `duplicate-${String(index).padStart(2, "0")}.js`),
        "export const same = 1;\n",
      ),
    ),
  );

  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const duplicateNode = result.graph.nodes.find(
    ({ kind, observations }) =>
      kind === "javascript-asset" &&
      observations.some(({ properties }) =>
        String(properties.path).startsWith("duplicate-"),
      ),
  );
  const duplicateEdges = result.graph.edges.filter(
    ({ relation, properties }) =>
      relation === "contains" &&
      String(properties.path).startsWith("duplicate-"),
  );

  expect(duplicateNode?.observations).toHaveLength(70);
  expect(duplicateEdges).toHaveLength(70);
  expect(result.graph.coverage).toMatchObject({
    status: "complete",
    truncated: false,
    omitted_count: 0,
  });
}, 15_000);

it("rejects NUL paths through the public request contract before reconstruction", async () => {
  const input = { input_path: "invalid\u0000.asar" };
  await expect(reconstructJavaScriptArtifact(input)).rejects.toMatchObject({
    name: "ZodError",
    issues: [
      {
        code: "invalid_format",
        path: ["input_path"],
        message: "Local filesystem paths cannot contain NUL",
      },
    ],
  });

  const result = await analyzeJavaScriptApplication(input);
  if (result.ok) throw new Error("Expected invalid input path");
  expect(result.error).toMatchObject({
    _tag: "AnalysisInputError",
    operation: "analyze_javascript_application",
    issues: [
      {
        path: ["input_path"],
        reason: "invalid_format",
        expected: "regex",
        message: "Local filesystem paths cannot contain NUL",
      },
    ],
  });
});

it("rejects traversal from a production reader seam and malformed ASAR containers", async () => {
  const root = await fixtureDirectory();
  const snapshot = await scanArtifactInventory(root);
  await expect(
    readJavaScriptArtifactFiles(new TraversalReader(), snapshot),
  ).rejects.toMatchObject({ reason: "path" });

  const malformed = join(root, "malformed.asar");
  await writeFile(malformed, "not an asar");
  await expect(
    reconstructJavaScriptArtifact({ input_path: malformed }),
  ).rejects.toMatchObject({
    name: "ArtifactReaderFailure",
    reason: "format",
  });
});

it("preserves cancellation and explicit format diagnostics", async () => {
  const root = await fixtureDirectory();
  const controller = new AbortController();
  const reason = Object.freeze({ requested: "reconstruction-stop" });
  controller.abort(reason);
  const cancelled: unknown = await reconstructJavaScriptArtifact(
    { input_path: root },
    controller.signal,
  ).catch((caught: unknown) => caught);
  expect(cancelled).toMatchObject({ reason: "cancelled" });
  expect((cancelled as { cause?: unknown }).cause).toBe(reason);
  await expect(
    reconstructJavaScriptArtifact({ input_path: root, format: "asar" }),
  ).rejects.toMatchObject({
    issues: [
      {
        path: ["format"],
        reason: "invalid_value",
        message: expect.stringContaining(root),
      },
    ],
  });
});

class TraversalReader implements ArtifactReader {
  readonly format = "directory" as const;

  async *entries(): AsyncIterable<ArtifactEntry> {
    yield {
      path: "../escape.js",
      kind: "file",
      declaredSize: 1,
      compressedSize: null,
      executable: false,
      encrypted: false,
      byteOffset: null,
      declaredIntegrity: null,
      unpacked: false,
      limitations: [],
      adapterKey: "/tmp/escape.js",
    };
  }

  open(): Promise<Readable> {
    return Promise.resolve(Readable.from("x"));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  provenance(): readonly [] {
    return [];
  }
}

const fixtureDirectory = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-javascript-artifact-");
  await writeJavaScriptArtifactFixture(root);
  return root;
};
