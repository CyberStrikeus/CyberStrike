import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const historicalModuleFixture = async () => {
  const root = await createTestTempDirectory("rea-reference-module-semantics-");
  const files: Record<string, string> = {
    "package.json": '{"type":"module"}\n',
    "main.js": 'require("./dep.cjs"); export {};\n',
    "dep.cjs": 'throw new Error("must never load");\n',
    "directory.cjs": 'require("./nested/");\n',
    "nested/index.js": 'module.exports = "fallback";\n',
    "optional.cjs":
      'require.resolve?.("./dep.cjs"); require?.resolve("./dep.cjs");\n',
    "overwritten.cjs":
      'require.resolve = other; require.resolve?.("./dep.cjs");\n',
    "shadowed.cjs": 'function f(require) { require?.resolve("./dep.cjs"); }\n',
    "types.d.ts":
      'declare module "consumer" { import type { Marker } from "dependency"; export type A = import("./dep").Marker; export type B = typeof import("./dep"); }\n',
    "dep.ts": "export interface Marker { id: string }\n",
    "nested/package.json": '{"type":"commonjs","main":"main.js"}\n',
    "nested/main.js": 'require("../dep.cjs");\n',
    "untyped/package.json": "{}\n",
    "untyped/main.js": 'require("../dep.cjs");\n',
    "unknown/package.json": "{invalid",
    "unknown/main.js": 'require("../dep.cjs");\n',
    "url.mjs":
      'import "./dep%20name.mjs?v=1#first"; import "./dep%20name.mjs?v=2#second"; import "./dep%2520name.mjs"; import "./bad%2Fname.mjs"; import "./bad%.mjs";\n',
    "dep name.mjs": "export const actual = 1;\n",
    "dep%20name.mjs": "export const literalPercent = 2;\n",
    "literal.cjs":
      'require.resolve("./dep%20name.mjs"); require.resolve("./dep?literal.cjs");\n',
    "dep?literal.cjs": 'throw new Error("must never load");\n',
    "oracle.mjs":
      'import { fileURLToPath } from "node:url"; import { createRequire } from "node:module"; const require = createRequire(import.meta.url); console.log(JSON.stringify([fileURLToPath(import.meta.resolve("./dep%20name.mjs?v=1#first")), fileURLToPath(import.meta.resolve("./dep%2520name.mjs")), require.resolve("./dep%20name.mjs"), require.resolve("./dep?literal.cjs")]));\n',
  };
  for (const directory of ["nested", "unknown", "untyped"])
    await mkdir(join(root, directory));
  await Promise.all(
    Object.entries(files).map(([path, source]) =>
      writeFile(join(root, path), source),
    ),
  );
  return { root, files };
};

cliTest(
  "preserves historical module syntax, loader scope and URL request identity",
  async ({ cli }) => {
    const { root, files } = await historicalModuleFixture();
    // This self-authored resolver control never loads a dependency.
    const oracle = await promisify(execFile)(
      process.execPath,
      [join(root, "oracle.mjs")],
      { timeout: 5_000 },
    );
    expect(JSON.parse(oracle.stdout)).toEqual(
      [
        "dep name.mjs",
        "dep%20name.mjs",
        "dep%20name.mjs",
        "dep?literal.cjs",
      ].map((path) => join(root, path)),
    );
    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.parse_failures).toEqual([]);
    const edges = (from: string) =>
      graph.relationships.filter((edge) => edge.from_path === from);
    expect(edges("main.js")).toEqual([]);
    expect(edges("directory.cjs")).toEqual([
      {
        from_path: "directory.cjs",
        to: "nested/main.js",
        kind: "requires",
        resolution: "internal",
        parse_state: "parsed",
      },
    ]);
    expect(edges("shadowed.cjs")).toEqual([]);
    for (const from of ["optional.cjs", "nested/main.js", "untyped/main.js"])
      expect(edges(from)).toEqual([
        {
          from_path: from,
          to: "dep.cjs",
          kind: "requires",
          resolution: "internal",
          parse_state: "parsed",
        },
      ]);
    for (const [from, to] of [
      ["overwritten.cjs", "./dep.cjs"],
      ["unknown/main.js", "../dep.cjs"],
    ] as const)
      expect(edges(from)).toEqual([
        {
          from_path: from,
          to,
          kind: "requires",
          resolution: "unknown",
          parse_state: "partial",
        },
      ]);
    expect(edges("types.d.ts")).toEqual(
      expect.arrayContaining([
        {
          from_path: "types.d.ts",
          to: "consumer",
          kind: "declares-module",
          resolution: "unknown",
          parse_state: "parsed",
        },
        {
          from_path: "types.d.ts",
          to: "dependency",
          kind: "imports",
          resolution: "external",
          parse_state: "parsed",
        },
        {
          from_path: "types.d.ts",
          to: "dep.ts",
          kind: "imports",
          resolution: "internal",
          parse_state: "parsed",
        },
      ]),
    );
    for (const [source_specifier, to] of [
      ["./dep%20name.mjs?v=1#first", "dep name.mjs"],
      ["./dep%20name.mjs?v=2#second", "dep name.mjs"],
      ["./dep%2520name.mjs", "dep%20name.mjs"],
    ])
      expect(edges("url.mjs")).toContainEqual({
        from_path: "url.mjs",
        to,
        source_specifier,
        kind: "imports",
        resolution: "internal",
        parse_state: "parsed",
      });
    expect(
      edges("url.mjs").filter((edge) => edge.resolution === "unresolved"),
    ).toHaveLength(2);
    expect(
      graph.entries.find((entry) => entry.path === "url.mjs")?.limitations,
    ).toHaveLength(2);
    expect(
      edges("literal.cjs")
        .map((edge) => edge.to)
        .sort(),
    ).toEqual(["dep%20name.mjs", "dep?literal.cjs"]);
    for (const [path, source] of Object.entries(files))
      expect(graph.entries).toContainEqual(
        expect.objectContaining({
          path,
          sha256: createHash("sha256").update(source).digest("hex"),
        }),
      );
  },
);

cliTest(
  "preserves case-sensitive compiler suffix languages in full graphs and summaries",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-reference-native-suffixes-",
    );
    const languages = {
      "upper.C": "C++",
      "lower.c": "C",
      "upper.M": "Objective-C++",
      "lower.m": "Objective-C",
    };
    await Promise.all(
      Object.keys(languages).map((path) =>
        writeFile(join(root, path), "// inert source\n"),
      ),
    );
    const full = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
    });
    expect(full.exitCode, full.stderr).toBe(0);
    const graph = historicalSourceGraphSchema.parse(full.json);
    expect(
      Object.fromEntries(
        graph.entries.map((entry) => [
          entry.path,
          entry.kind === "file" ? entry.language : null,
        ]),
      ),
    ).toEqual(languages);
    const summary = await cli.run({
      arguments: [
        "import-reference-source",
        root,
        "--json",
        "--detail",
        "summary",
      ],
    });
    expect(summary.exitCode, summary.stderr).toBe(0);
    expect(summary.json).toMatchObject({
      languages: ["C", "C++", "Objective-C", "Objective-C++"],
    });
  },
);
