import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect } from "vitest";

import type { JavaScriptApplicationGraph } from "../../../src/domain/javascript/javascriptApplicationGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const execute = promisify(execFile);

const logicalPath = (root: string, path: string): string =>
  relative(root, path).split(sep).join("/");

const requireSources = (
  requests: readonly (readonly [string, string, string | null])[],
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    [...new Set(requests.map(([source]) => source))].map((source) => [
      source,
      requests
        .filter(([path]) => path === source)
        .map(([, specifier]) => `require(${JSON.stringify(specifier)});`)
        .join("\n"),
    ]),
  );

const expectResolution = (
  graph: JavaScriptApplicationGraph,
  source: string,
  specifier: string,
  kind: "require" | "import",
  resolvedPath: string | null,
): void => {
  const edges = graph.edges.filter(
    ({ relation, properties, evidence }) =>
      relation === "imports" &&
      properties.specifier === specifier &&
      evidence.location.available &&
      evidence.location.value.kind === "source-range" &&
      evidence.location.value.source === source,
  );
  expect(edges).toHaveLength(2);
  expect(edges.map(({ properties }) => properties)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: kind === "require" ? "require" : "static-import",
        resolved_path: resolvedPath,
      }),
      expect.objectContaining({
        module_link_kind: kind,
        resolved_path: resolvedPath,
        resolution_status: resolvedPath === null ? "not-found" : "resolved",
      }),
    ]),
  );
};

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves CommonJS directory requests before path normalization through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-cjs-directory-lookup-");
    const requests = [
      ["main.cjs", "./dep/.", "dep/index.js"],
      ["main.cjs", "./dep/", "dep/index.js"],
      ["main.cjs", "./parent/child/..", "parent/index.js"],
      ["main.cjs", "./dep", "dep.js"],
      ["main.cjs", "./entry/.", "entry/dep.js"],
      ["main.cjs", "./missing/.", null],
      ["main.cjs", "directory/", "node_modules/directory/index.js"],
      ["main.cjs", "directory/.", "node_modules/directory/index.js"],
      ["main.cjs", "package/dep/.", "node_modules/package/dep/index.js"],
      ["parent/child/main.cjs", ".", "parent/child/index.js"],
      ["parent/child/main.cjs", "..", "parent/index.js"],
      ["typed.cts", "./typed.js/.", "typed.js/index.js"],
    ] as const;
    await writeFixtureFiles(root, {
      "package.json": '{"type":"commonjs"}',
      "dep.js": "module.exports = 'file';",
      "dep/index.js": "module.exports = 'directory';",
      "entry/package.json": '{"main":"./dep/."}',
      "entry/dep.js": "module.exports = 'main file';",
      "entry/dep/index.js": "module.exports = 'main directory decoy';",
      "missing.js": "module.exports = 'missing directory decoy';",
      "parent.js": "module.exports = 'parent file';",
      "parent/index.js": "module.exports = 'parent directory';",
      "parent/child.js": "module.exports = 'child file';",
      "parent/child/index.js": "module.exports = 'child directory';",
      "node_modules/directory.js": "module.exports = 'package file';",
      "node_modules/directory/index.js":
        "module.exports = 'package directory';",
      "node_modules/package/dep.js": "module.exports = 'subpath file';",
      "node_modules/package/dep/index.js":
        "module.exports = 'subpath directory';",
      "typed.ts": "module.exports = 'emitted source decoy';",
      "typed.js/index.js": "module.exports = 'typed request directory';",
      ...requireSources(requests),
    });
    for (const [source, specifier, expected] of requests) {
      const require = createRequire(join(root, source));
      if (expected === null)
        expect(() => require.resolve(specifier)).toThrow(
          expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
        );
      else expect(logicalPath(root, require.resolve(specifier))).toBe(expected);
    }
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const [source, specifier, expected] of requests)
      expectResolution(graph, source, specifier, "require", expected);
    expect(graph.coverage.status).toBe("complete");
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves loader-specific node_modules ancestors through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-cjs-ancestor-lookup-");
    const requests = [
      [
        "node_modules/client/main.cjs",
        "shared",
        "node_modules/shared/index.js",
      ],
      [
        "node_modules/client/main.cjs",
        "@scope/shared",
        "node_modules/@scope/shared/index.js",
      ],
      [
        "node_modules/client/main.cjs",
        "private",
        "node_modules/client/node_modules/private/index.js",
      ],
      [
        "node_modules/@scope/client/main.cjs",
        "shared",
        "node_modules/shared/index.js",
      ],
      [
        "node_modules/parent/node_modules/client/main.cjs",
        "shared",
        "node_modules/parent/node_modules/shared/index.js",
      ],
    ] as const;
    const esmSource = "node_modules/client/main.mjs";
    const esmTarget = "node_modules/node_modules/shared/index.js";
    await writeFixtureFiles(root, {
      "package.json": '{"type":"commonjs"}',
      "node_modules/shared/index.js": "module.exports = 'outer dependency';",
      "node_modules/@scope/shared/index.js":
        "module.exports = 'scoped dependency';",
      "node_modules/node_modules/shared/index.js":
        "module.exports = 'ESM dependency';",
      "node_modules/node_modules/@scope/shared/index.js":
        "module.exports = 'scoped decoy';",
      "node_modules/client/node_modules/private/index.js":
        "module.exports = 'private dependency';",
      "node_modules/parent/node_modules/shared/index.js":
        "module.exports = 'nested dependency';",
      "node_modules/parent/node_modules/node_modules/shared/index.js":
        "module.exports = 'nested decoy';",
      [esmSource]:
        'import "shared"; console.log(JSON.stringify(import.meta.resolve("shared")));',
      ...requireSources(requests),
    });
    for (const [source, specifier, expected] of requests)
      expect(
        logicalPath(root, createRequire(join(root, source)).resolve(specifier)),
      ).toBe(expected);
    const control = await execute(process.execPath, [join(root, esmSource)], {
      cwd: root,
      timeout: 5_000,
    });
    expect(
      logicalPath(root, fileURLToPath(JSON.parse(control.stdout) as string)),
    ).toBe(esmTarget);
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const [source, specifier, expected] of requests)
      expectResolution(graph, source, specifier, "require", expected);
    expectResolution(graph, esmSource, "shared", "import", esmTarget);
    expect(graph.coverage.status).toBe("complete");
  },
);
