import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

type ResolutionCase = readonly [from: string, specifier: string, to: string];

interface ReferenceSourceDirectoryFixture {
  readonly workspace: string;
  readonly root: string;
  readonly outside: string;
  readonly imports: readonly ResolutionCase[];
  readonly unresolved: readonly ResolutionCase[];
}

const prepareReferenceSourceDirectoryFixture =
  async (): Promise<ReferenceSourceDirectoryFixture> => {
    const workspace = await createTestTempDirectory(
      "rea-reference-directory-imports-",
    );
    const root = join(workspace, "source");
    const outside = join(workspace, "outside", "index.js");
    const imports = [
      ["slash.cjs", "./lib/", "lib/index.js"],
      ["dot.cjs", "./lib/.", "lib/index.js"],
      ["self.cjs", ".", "index.js"],
      ["self-slash.cjs", "./", "index.js"],
      ["nested/parent.cjs", "..", "index.js"],
      ["nested/parent-slash.cjs", "../", "index.js"],
      ["direct.cjs", "./lib.js", "lib.js"],
      ["fallback.cjs", "./fallback", "fallback/index.js"],
      ["legacy-order.cjs", "./dep", "dep/index.js"],
      ["bare-index.cjs", "./bare", "bare.js"],
      ["package-main.cjs", "./pkg", "pkg/actual.js"],
      ["package-main-slash-specifier.cjs", "./pkg/", "pkg/actual.js"],
      ["package-main-newline-slash.cjs", "./pkg\n/", "pkg\n/actual.js"],
      ["package-main-no-index.cjs", "./no-index-pkg", "no-index-pkg/actual.js"],
      ["package-main-fallback.cjs", "./stale", "stale/index.js"],
      ["package-main-fallback-slash.cjs", "./stale/", "stale/index.js"],
      ["typed-index-collision.cjs", "./typed", "typed.js"],
      ["package-main-slash.cjs", "./slashed", "slashed/lib.js"],
      ["package-main-manifest-newline-slash.cjs", "./nlpkg/", "nlpkg/lib\n.js"],
      ["json.cjs", "./data", "data.json"],
      ["json-explicit.cjs", "./data.json", "data.json"],
      ["json-before-index.cjs", "./conf", "conf.json"],
      ["js-before-json.cjs", "./both", "both.js"],
      ["json-index.cjs", "./settings", "settings/index.json"],
      ["json-main.cjs", "./jpkg", "jpkg/config.json"],
    ] as const satisfies readonly ResolutionCase[];
    const unresolved = [
      ["missing.cjs", "./missing/", "missing"],
      ["escape.cjs", "../outside/", "../outside"],
      ["main.cts", "./folder.js/.", "folder.js"],
      ["only-bare.cjs", "./only/", "only"],
      ["invalid-manifest.cjs", "./broken", "broken"],
      ["absolute-main.cjs", "./absolute", outside],
    ] as const satisfies readonly ResolutionCase[];
    const files = new Map<string, string>([
      ["index.js", 'module.exports = "root index";\n'],
      ["lib/index.js", 'module.exports = "library index";\n'],
      ["lib.js", 'module.exports = "sibling JavaScript file";\n'],
      ["lib.ts", 'export const value = "sibling TypeScript file";\n'],
      ["fallback/index.js", 'module.exports = "fallback index";\n'],
      ["dep/index.js", 'module.exports = "existing index priority";\n'],
      ["dep.cjs", 'module.exports = "later CommonJS candidate";\n'],
      ["folder.ts", 'export const value = "emitted filename counterpart";\n'],
      ["missing.js", 'module.exports = "not a directory";\n'],
      ["bare.js", 'module.exports = "file before directory";\n'],
      ["bare/index", 'module.exports = "extensionless index";\n'],
      ["only/index", 'module.exports = "extensionless index";\n'],
      ["pkg/package.json", '{"main":"actual.js"}\n'],
      ["pkg\n/package.json", '{"main":"actual.js"}\n'],
      [
        "pkg\n/actual.js",
        'module.exports = "declared main behind line terminator";\n',
      ],
      ["pkg\n/index.js", 'module.exports = "index not selected";\n'],
      ["pkg/actual.js", 'module.exports = "declared main";\n'],
      ["pkg/index.js", 'module.exports = "ignored index";\n'],
      ["no-index-pkg/package.json", '{"main":"actual.js"}\n'],
      [
        "no-index-pkg/actual.js",
        'module.exports = "declared main without index";\n',
      ],
      ["typed.js", 'module.exports = "runtime file";\n'],
      ["typed/index.ts", 'export const value = "source index";\n'],
      ["stale/package.json", '{"main":"gone.js"}\n'],
      ["stale/index.js", 'module.exports = "legacy fallback";\n'],
      ["broken/package.json", '{"main":\n'],
      ["broken/index.js", 'module.exports = "unknown selection";\n'],
      ["slashed/package.json", '{"main":"lib/"}\n'],
      ["slashed/lib.js", 'module.exports = "file main";\n'],
      ["slashed/lib/index.js", 'module.exports = "not selected";\n'],
      ["slashed/index.js", 'module.exports = "not selected";\n'],
      ["nlpkg/package.json", '{"main":"lib\\n/"}\n'],
      [
        "nlpkg/lib\n.js",
        'module.exports = "file main behind line terminator";\n',
      ],
      ["nlpkg/lib\n/index.js", 'module.exports = "not selected";\n'],
      ["nlpkg/index.js", 'module.exports = "entry index";\n'],
      ["absolute/package.json", `${JSON.stringify({ main: outside })}\n`],
      ["absolute/index.js", 'module.exports = "not selected";\n'],
      ["data.json", '{"value":1}\n'],
      ["conf.json", '{"value":"file before index"}\n'],
      ["conf/index.js", 'module.exports = "not selected";\n'],
      ["both.js", 'module.exports = "JavaScript first";\n'],
      ["both.json", '{"value":"not selected"}\n'],
      ["settings/index.json", '{"value":"JSON index"}\n'],
      ["jpkg/package.json", '{"main":"config"}\n'],
      ["jpkg/config.json", '{"value":"JSON main"}\n'],
      ["jpkg/index.js", 'module.exports = "not selected";\n'],
      ...[...imports, ...unresolved].map(
        ([path, specifier]) =>
          [path, `require(${JSON.stringify(specifier)});\n`] as const,
      ),
    ]);
    await Promise.all(
      [...files].map(async ([path, contents]) => {
        const target = join(root, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents);
      }),
    );
    await mkdir(dirname(outside), { recursive: true });
    await writeFile(outside, 'module.exports = "outside import root";\n');
    return { workspace, root, outside, imports, unresolved };
  };

const assertNodeResolutionControls = (
  fixture: ReferenceSourceDirectoryFixture,
): void => {
  const { root, outside, imports } = fixture;
  for (const [path, specifier, target] of imports)
    expect(createRequire(join(root, path)).resolve(specifier)).toBe(
      join(root, target),
    );
  expect(() =>
    createRequire(join(root, "missing.cjs")).resolve("./missing/"),
  ).toThrow();
  expect(() =>
    createRequire(join(root, "main.cts")).resolve("./folder.js/."),
  ).toThrow();
  expect(() =>
    createRequire(join(root, "only-bare.cjs")).resolve("./only/"),
  ).toThrow();
  expect(() =>
    createRequire(join(root, "invalid-manifest.cjs")).resolve("./broken"),
  ).toThrow();
  expect(createRequire(join(root, "escape.cjs")).resolve("../outside/")).toBe(
    outside,
  );
  expect(
    createRequire(join(root, "absolute-main.cjs")).resolve("./absolute"),
  ).toBe(outside);
};

const assertGraphResolution = (
  graph: ReturnType<typeof historicalSourceGraphSchema.parse>,
  fixture: ReferenceSourceDirectoryFixture,
): void => {
  const { imports, unresolved } = fixture;
  expect(graph.parse_failures).toEqual([]);
  expect(graph.relationships).toHaveLength(imports.length + unresolved.length);
  for (const [from, , to] of imports)
    expect.soft(graph.relationships, from).toContainEqual({
      from_path: from,
      to,
      kind: "requires",
      resolution: "internal",
      parse_state: "parsed",
    });
  for (const [from, , to] of unresolved)
    expect.soft(graph.relationships, from).toContainEqual({
      from_path: from,
      to,
      kind: "requires",
      resolution: "unresolved",
      parse_state: "parsed",
    });
  expect(graph.entries.some((entry) => entry.path.includes("outside"))).toBe(
    false,
  );
};

// Reference-source reads require no-follow opens; Windows reports unsupported.
describe.skipIf(process.platform === "win32")(
  "compiled reference-source directory imports",
  () => {
    cliTest(
      "resolves directory spellings without selecting similarly named files",
      async ({ cli }) => {
        const fixture = await prepareReferenceSourceDirectoryFixture();
        assertNodeResolutionControls(fixture);
        const result = await cli.run({
          arguments: ["import-reference-source", fixture.root, "--json"],
          environment: {
            HOME: fixture.workspace,
            XDG_CONFIG_HOME: fixture.workspace,
            XDG_CACHE_HOME: fixture.workspace,
          },
        });
        expect(result.exitCode).toBe(0);
        assertGraphResolution(
          historicalSourceGraphSchema.parse(result.json),
          fixture,
        );
      },
    );
  },
);
