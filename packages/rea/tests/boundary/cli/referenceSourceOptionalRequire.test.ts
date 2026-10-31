import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";
import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "retains optional loader dependencies with their original identity and lookup uncertainty",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-reference-optional-require-",
    );
    const config = await createTestTempDirectory(
      "rea-reference-optional-config-",
    );
    const resolverCallees = [
      "require.resolve",
      "require.resolve?.",
      "require?.resolve",
      "require?.resolve?.",
      'require?.["resolve"]',
      "(require?.resolve)",
    ];
    const sources: Record<string, string> = Object.fromEntries(
      resolverCallees.map((callee, index) => [
        `resolver-${index}.cjs`,
        `console.log(${callee}("./dep.cjs"));`,
      ]),
    );
    Object.assign(sources, {
      "bare.cjs": 'require?.("./dep.cjs");',
      "shadow.cjs": 'function load(require) { require?.resolve("./dep.cjs"); }',
      "null.cjs":
        'function load() { const require = null; require?.resolve("./dep.cjs"); }',
      "computed.cjs":
        'const member = "resolve"; require?.[member]("./dep.cjs");',
      "dynamic.cjs": "require.resolve?.(getTarget());",
      "missing-wrapper.mjs": 'require?.resolve("./dep.cjs");',
      "overwritten.cjs":
        'require.resolve = () => "other"; require?.resolve("./dep.cjs");',
      "deleted.cjs": 'delete require.resolve; require.resolve?.("./dep.cjs");',
      "later-write.cjs":
        'require?.resolve("./dep.cjs"); require.resolve = () => "other";',
      "search-paths.cjs": 'require?.resolve("./dep.cjs", { paths: [] });',
      "own-directory.cjs":
        'require.resolve?.("./dep.cjs", { paths: [__dirname] });',
      "factory.mjs":
        'import { createRequire } from "node:module"; const local = createRequire(new URL("./sub/entry.cjs", import.meta.url)); local?.resolve("./dep.cjs");',
      "dep.cjs": 'throw new Error("Dependency must not execute");',
      "sub/dep.cjs": 'throw new Error("Nested dependency must not execute");',
      "sub/entry.cjs": "",
    });
    await mkdir(join(root, "sub"));
    await Promise.all(
      Object.entries(sources).map(([path, source]) =>
        writeFile(join(root, path), source),
      ),
    );

    // Resolve-only Node controls confirm the equivalent spellings without loading
    // the throwing dependency. REA only reads these self-authored fixtures.
    for (const [index] of resolverCallees.entries()) {
      const executed = await promisify(execFile)(
        process.execPath,
        [join(root, `resolver-${index}.cjs`)],
        { timeout: 5_000 },
      );
      expect(executed.stdout.trim()).toBe(join(root, "dep.cjs"));
      expect(executed.stderr).toBe("");
    }
    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: {
        HOME: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
        REA_REFERENCE_SECRET_PATTERNS_JSON: "[]",
      },
    });
    expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
      0,
    );
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.parse_failures).toEqual([]);
    for (const [path, source] of Object.entries(sources))
      expect(graph.entries).toContainEqual(
        expect.objectContaining({
          path,
          sha256: createHash("sha256").update(source).digest("hex"),
        }),
      );
    for (const path of [
      "bare.cjs",
      "later-write.cjs",
      "own-directory.cjs",
      ...resolverCallees.map((_, index) => `resolver-${index}.cjs`),
    ])
      expect(
        graph.relationships.filter(({ from_path }) => from_path === path),
      ).toEqual([
        {
          from_path: path,
          to: "dep.cjs",
          kind: "requires",
          resolution: "internal",
          parse_state: "parsed",
        },
      ]);
    for (const path of [
      "shadow.cjs",
      "null.cjs",
      "computed.cjs",
      "dynamic.cjs",
      "missing-wrapper.mjs",
    ])
      expect(
        graph.relationships.filter(({ from_path }) => from_path === path),
      ).toEqual([]);
    for (const path of ["overwritten.cjs", "deleted.cjs", "search-paths.cjs"])
      expect(
        graph.relationships.filter(({ from_path }) => from_path === path),
      ).toEqual([
        {
          from_path: path,
          to: "./dep.cjs",
          kind: "requires",
          resolution: "unknown",
          parse_state: "partial",
        },
      ]);
    expect(
      graph.relationships.filter(
        ({ from_path, kind }) =>
          from_path === "factory.mjs" && kind === "requires",
      ),
    ).toEqual([
      {
        from_path: "factory.mjs",
        to: "sub/dep.cjs",
        kind: "requires",
        resolution: "internal",
        parse_state: "parsed",
      },
    ]);
  },
);
