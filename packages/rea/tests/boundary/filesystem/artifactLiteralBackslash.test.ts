import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { createPackage } from "@electron/asar";
import { expect, it } from "vitest";

import { extractArtifact } from "../../../src/artifacts/extraction/ArtifactExtraction.js";
import { SafeOutputTree } from "../../../src/artifacts/SafeOutputTree.js";
import {
  inventoryArtifact,
  withArtifactResourceScope,
} from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import type { JavaScriptApplicationGraph } from "../../../src/domain/javascript/javascriptApplicationGraph.js";

const loaderImports = (graph: JavaScriptApplicationGraph) =>
  graph.edges.filter(
    ({ relation, properties }) =>
      relation === "imports" &&
      properties.specifier === "./b.js" &&
      (properties.kind === "static-import" ||
        properties.kind === "dynamic-import" ||
        properties.kind === "require"),
  );

const forwardedExports = (graph: JavaScriptApplicationGraph) =>
  graph.edges.filter(
    ({ relation, properties }) =>
      relation === "imports" &&
      properties.specifier === "./b.js" &&
      (properties.module_link_kind === "export" ||
        properties.module_link_kind === "commonjs-export"),
  );

const writeLoaderExportFixture = async (
  source: string,
  directory: string,
  targetBody: string,
): Promise<void> => {
  await mkdir(join(source, directory), { recursive: true });
  for (const [name, body] of [
    [
      "a.mjs",
      "import { marker } from './b.js'; export { marker }; import('./b.js');\n",
    ],
    ["a.cjs", "module.exports = require('./b.js');\n"],
    ["a.ts", "import { marker } from './b.js'; export { marker };\n"],
    ["b.js", targetBody],
  ] as const)
    await writeFile(join(source, directory, name), body);
};

const NAMES = [
  "literal\\name.txt",
  "\\leading.txt",
  "\\\\server\\share.txt",
  "ordinary.txt",
  "literal/name.txt",
  "nested/literal\\name.txt",
];
const CONTENT = Buffer.from("exact member bytes\n");
const DIGEST = createHash("sha256").update(CONTENT).digest("hex");

it.skipIf(process.platform === "win32").each(["directory", "asar"] as const)(
  "inventories and extracts literal POSIX backslashes from %s without changing names",
  async (format) => {
    const root = await createTestTempDirectory("rea-literal-backslash-");
    const source = join(root, "source");
    await mkdir(source);
    for (const name of NAMES) {
      await mkdir(dirname(join(source, name)), { recursive: true });
      await writeFile(join(source, name), CONTENT);
    }
    const input = format === "directory" ? source : join(root, "input.asar");
    if (format === "asar") await createPackage(source, input);

    const inventory = await inventoryArtifact(input);
    for (const name of NAMES) {
      const occurrence = inventory.occurrences.find(
        ({ logical_path }) => logical_path === name,
      );
      expect(occurrence).toMatchObject({
        entry_kind: "file",
        hash_status: "verified",
      });
      expect(
        inventory.nodes.find(
          ({ artifact_id }) => artifact_id === occurrence?.artifact_id,
        ),
      ).toMatchObject({ sha256: DIGEST, size: CONTENT.length });
    }

    const output = join(root, "output");
    const extracted = await withArtifactResourceScope((resourceScope) =>
      extractArtifact({
        inputPath: input,
        // The owner checks lstat first and selects the directory reader;
        // BinaryTarget formats have no separate directory tag.
        inputFormat: "asar",
        outputRoot: output,
        environment: {},
        integrityPolicy: "fail",
        resourceScope,
      }),
    );
    expect(
      extracted.artifacts.map(({ relative_path }) => relative_path).sort(),
    ).toEqual([...NAMES].sort());
    expect((await readdir(output)).sort()).toEqual(
      [...new Set(NAMES.map((name) => name.split("/")[0]))].sort(),
    );
    for (const name of NAMES)
      expect(Buffer.compare(await readFile(join(output, name)), CONTENT)).toBe(
        0,
      );
  },
);

it.each(NAMES.filter((name) => name.includes("\\")))(
  "rejects Windows separator interpretation before materializing %j",
  async (name) => {
    const root = await createTestTempDirectory("rea-backslash-output-");
    const output = join(root, "output");
    const tree = await SafeOutputTree.create(output, "win32");
    const stream = Readable.from(CONTENT);
    try {
      await expect(
        tree.write(name, stream, { sha256: DIGEST, bytes: CONTENT.length }),
      ).rejects.toMatchObject({
        reason: "path",
        message: expect.stringContaining(
          "Windows destination cannot materialize artifact path",
        ),
      });
      expect(stream.destroyed).toBe(true);
      expect(await readdir(output)).toEqual([]);
    } finally {
      expect(await tree.rollback()).toMatchObject({ status: "complete" });
    }
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each([
  "../outside",
  "safe/../outside",
  "/outside",
  "//server/share",
  "C:\\outside",
  "C:/outside",
  "safe/\0bad",
])("keeps output containment rejection for %j", async (name) => {
  const root = await createTestTempDirectory("rea-backslash-containment-");
  const output = join(root, "output");
  const tree = await SafeOutputTree.create(output);
  try {
    await expect(
      tree.write(name, Readable.from(CONTENT), {
        sha256: DIGEST,
        bytes: CONTENT.length,
      }),
    ).rejects.toMatchObject({ reason: "path" });
    expect(await readdir(output)).toEqual([]);
  } finally {
    expect(await tree.rollback()).toMatchObject({ status: "complete" });
  }
});

it.skipIf(process.platform === "win32").each(["directory", "asar"] as const)(
  "retains literal POSIX JavaScript names in application and semantic graphs from %s",
  async (format) => {
    const root = await createTestTempDirectory("rea-backslash-js-graph-");
    const source = join(root, "source");
    await mkdir(source);
    const names = [
      "literal\\name.js",
      "\\leading.js",
      "\\\\server\\share.js",
      "nested/literal\\name.js",
    ];
    for (const name of names) {
      await mkdir(dirname(join(source, name)), { recursive: true });
      await writeFile(join(source, name), "export const marker = 42;\n");
    }
    const input = format === "directory" ? source : join(root, "input.asar");
    if (format === "asar") await createPackage(source, input);
    const result = await analyzeJavaScriptApplication({
      input_path: input,
      format,
    });
    if (!result.ok) throw result.error;
    const parsed = javascriptApplicationAnalysisResultSchema.parse(
      result.value.normalized_result,
    );
    const observed = parsed.graph.nodes.flatMap(({ observations }) =>
      observations.map(({ properties }) => properties.path),
    );
    expect(observed).toEqual(expect.arrayContaining(names));
    const semantic = parsed.semantic_graph?.nodes.map(
      ({ identity }) => identity.module_path,
    );
    expect(semantic).toEqual(expect.arrayContaining(names));
  },
);

it("rejects inherited encoded separators with the real Node ESM loader before file lookup", async () => {
  const root = await createTestTempDirectory("rea-backslash-esm-url-");
  const source = pathToFileURL(join(root, "a.mjs"));
  source.pathname = source.pathname.replace(/a\.mjs$/u, "literal%5Cdir/a.mjs");
  const target = new URL("./b.mjs", source);
  expect(target.pathname).toContain("literal%5Cdir/b.mjs");
  // Use the actual Node loader, outside Vitest's module runner.
  const observed = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "try { await import(process.argv[1]); console.log(JSON.stringify({loaded:true})); } catch(error) { console.log(JSON.stringify({code:error.code})); }",
      target.href,
    ],
    { encoding: "utf8", timeout: 5_000 },
  );
  expect(JSON.parse(observed) as unknown).toEqual({
    code: "ERR_INVALID_MODULE_SPECIFIER",
  });
});

it("keeps loader modes separate from forwarded export relationships", async () => {
  const root = await createTestTempDirectory("rea-loader-export-contract-");
  const source = join(root, "source");
  await writeLoaderExportFixture(
    source,
    "ordinary",
    "export const marker = 'target';\n",
  );
  const result = await analyzeJavaScriptApplication({
    input_path: source,
    format: "directory",
  });
  if (!result.ok) throw result.error;
  const { graph } = javascriptApplicationAnalysisResultSchema.parse(
    result.value.normalized_result,
  );
  const imports = loaderImports(graph);
  expect(imports).toHaveLength(4);
  expect(
    imports.map(({ properties }) => [
      properties.kind,
      properties.resolution_mode,
    ]),
  ).toEqual(
    expect.arrayContaining([
      ["require", "require"],
      ["dynamic-import", "import"],
      ["static-import", "import"],
      ["static-import", "compiler-dependent"],
    ]),
  );
  const exports = forwardedExports(graph);
  expect(exports).toHaveLength(3);
  expect(
    exports.map(({ properties }) => [
      properties.module_link_kind,
      properties.exported_name,
      properties.resolution_mode,
    ]),
  ).toEqual(
    expect.arrayContaining([
      ["export", "marker", undefined],
      ["export", "marker", "compiler-dependent"],
      ["commonjs-export", "default", undefined],
    ]),
  );
  for (const { properties } of [...imports, ...exports])
    expect(properties).toMatchObject({
      resolved_path: "ordinary/b.js",
      resolution_status: "resolved",
    });
});

it.skipIf(process.platform === "win32").each(["directory", "asar"] as const)(
  "preserves loader-specific relative paths inside a literal POSIX directory from %s",
  async (format) => {
    const root = await createTestTempDirectory("rea-backslash-import-base-");
    const source = join(root, "source");
    const literal = "literal\\dir";
    await mkdir(join(source, "literal", "dir"), { recursive: true });
    const body = "export const marker = 'literal';\n";
    await writeLoaderExportFixture(source, literal, body);
    await writeFile(
      join(source, "literal", "dir", "b.js"),
      "export const marker = 'decoy';\n",
    );
    // Node's CommonJS resolver uses the literal filesystem base on POSIX.
    expect(
      createRequire(join(source, literal, "a.cjs")).resolve("./b.js"),
    ).toBe(join(source, literal, "b.js"));
    const input = format === "directory" ? source : join(root, "input.asar");
    if (format === "asar") await createPackage(source, input);
    const result = await analyzeJavaScriptApplication({
      input_path: input,
      format,
    });
    if (!result.ok) throw result.error;
    const parsed = javascriptApplicationAnalysisResultSchema.parse(
      result.value.normalized_result,
    );
    const imports = loaderImports(parsed.graph);
    expect(imports).toHaveLength(4);
    expect(
      new Set(imports.map(({ properties }) => properties.resolution_mode)),
    ).toEqual(new Set(["require", "import", "compiler-dependent"]));
    for (const { properties } of imports) {
      const mode = properties.resolution_mode;
      expect(properties).toMatchObject({
        resolved_path: mode === "require" ? `${literal}/b.js` : null,
        resolution_status:
          mode === "require"
            ? "resolved"
            : mode === "import"
              ? "rejected"
              : "unavailable",
      });
      if (mode === "compiler-dependent")
        expect(properties.conditional_resolutions).toEqual([
          expect.objectContaining({
            mode: "import",
            resolution_status: "rejected",
            resolved_path: null,
          }),
          expect.objectContaining({
            mode: "require",
            resolution_status: "resolved",
            resolved_path: `${literal}/b.js`,
          }),
        ]);
    }
    const exports = forwardedExports(parsed.graph);
    expect(exports).toHaveLength(3);
    for (const exported of exports) {
      const sourceNode = parsed.graph.nodes.find(
        ({ node_id }) => node_id === exported.source_node_id,
      );
      const path = sourceNode?.observations.find(
        ({ properties }) => typeof properties.module_path === "string",
      )?.properties.module_path;
      expect([
        `${literal}/a.cjs`,
        `${literal}/a.mjs`,
        `${literal}/a.ts`,
      ]).toContain(path);
      expect(exported.properties).toMatchObject({
        resolved_path: path === `${literal}/a.cjs` ? `${literal}/b.js` : null,
        resolution_status:
          path === `${literal}/a.cjs`
            ? "resolved"
            : path === `${literal}/a.mjs`
              ? "rejected"
              : "unavailable",
      });
    }
    expect(parsed.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identity: {
            strategy: "content-digest",
            stability: "global-exact",
            sha256: createHash("sha256").update(body).digest("hex"),
          },
          observations: expect.arrayContaining([
            expect.objectContaining({
              properties: expect.objectContaining({ path: `${literal}/b.js` }),
            }),
          ]),
        }),
      ]),
    );
  },
);
