import { execFile } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";

import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { reconstructJavaScriptArtifact } from "../../support/javascriptApplicationScope.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const cases: readonly {
  name: string;
  metadata: Readonly<Record<string, unknown>>;
  index: boolean;
  specifier?: string;
  extraFiles?: Readonly<Record<string, string>>;
}[] = [
  { name: "main before index", metadata: { main: "actual.cjs" }, index: true },
  {
    name: "exports before index",
    metadata: { exports: { require: "./actual.cjs" } },
    index: true,
  },
  {
    name: "main without an index",
    metadata: { main: "actual.cjs" },
    index: false,
  },
  {
    name: "top-level exports array",
    metadata: { exports: ["./actual.cjs"] },
    index: true,
  },
  {
    name: "root subpath exports array",
    metadata: { exports: { ".": ["./actual.cjs"] } },
    index: true,
  },
  {
    name: "exports array skips invalid and unmatched entries",
    metadata: { exports: [42, { browser: "./browser.js" }, "./actual.cjs"] },
    index: true,
  },
  {
    name: "nested root exports array",
    metadata: { exports: { ".": [[null, { require: "./actual.cjs" }]] } },
    index: true,
  },
  { name: "index fallback", metadata: {}, index: true },
  {
    name: "missing legacy main fallback",
    metadata: { main: "missing.cjs" },
    index: true,
  },
  { name: "self-directory main", metadata: { main: "." }, index: true },
  {
    name: "bare exports with legacy main",
    metadata: { main: "legacy.cjs", exports: "./actual.cjs" },
    index: true,
    extraFiles: {
      "node_modules/fixture/legacy.cjs": "module.exports = 'legacy';",
    },
  },
  {
    name: "relative directory ignores exports",
    metadata: { main: "legacy.cjs", exports: "./actual.cjs" },
    index: true,
    specifier: "./node_modules/fixture",
    extraFiles: {
      "node_modules/fixture/legacy.cjs": "module.exports = 'legacy';",
    },
  },
  {
    name: "relative exports-only directory uses index",
    metadata: { exports: "./actual.cjs" },
    index: true,
    specifier: "./node_modules/fixture",
  },
  {
    name: "legacy main directory uses its index",
    metadata: { main: "./lib" },
    index: true,
    extraFiles: {
      "node_modules/fixture/lib/package.json": '{"main":"actual.cjs"}',
      "node_modules/fixture/lib/actual.cjs": "module.exports = 'nested';",
      "node_modules/fixture/lib/index.js": "module.exports = 'nested index';",
    },
  },
  {
    name: "legacy main directory falls back to root index",
    metadata: { main: "./lib" },
    index: true,
    extraFiles: {
      "node_modules/fixture/lib/package.json": '{"main":"actual.cjs"}',
      "node_modules/fixture/lib/actual.cjs": "module.exports = 'nested';",
    },
  },
  {
    name: "legacy main cycle falls back to root index",
    metadata: { main: "./lib" },
    index: true,
    extraFiles: { "node_modules/fixture/lib/package.json": '{"main":".."}' },
  },
  {
    name: "null exports preserves legacy main",
    metadata: { exports: null, main: "actual.cjs" },
    index: true,
  },
];

it.each(cases)(
  "matches Node package resolution for $name",
  async ({ metadata, index, specifier = "fixture", extraFiles = {} }) => {
    const root = await createTestTempDirectory("rea-package-precedence-");
    const files = {
      ...extraFiles,
      "package.json": JSON.stringify({
        name: "app",
        type: "commonjs",
        main: "main.cjs",
      }),
      "main.cjs": `const value = require(${JSON.stringify(specifier)}); module.exports = value;`,
      "node_modules/fixture/package.json": JSON.stringify({
        name: "fixture",
        ...metadata,
      }),
      "node_modules/fixture/actual.cjs": "module.exports = 'actual entry';",
      ...(index
        ? {
            "node_modules/fixture/index.js":
              "module.exports = 'fallback entry';",
          }
        : {}),
    };
    await Promise.all(
      Object.entries(files).map(async ([path, text]) => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
      }),
    );
    const expected = relative(
      root,
      createRequire(join(root, "main.cjs")).resolve(specifier),
    )
      .split(sep)
      .join("/");
    const result = await reconstructJavaScriptArtifact({
      input_path: root,
      format: "directory",
    });
    const edge = result.graph.edges.find(
      ({ properties }) =>
        properties.module_link_kind === "require" &&
        properties.specifier === specifier,
    );

    expect(edge?.properties).toMatchObject({
      resolution_status: "resolved",
      resolved_path: expected,
    });
    expect(result.graph.coverage.status).toBe("complete");
  },
);

const runNode = promisify(execFile);

it.each([
  {
    name: "import uses main before bundler module",
    kind: "import",
    metadata: { main: "actual.cjs", module: "bundler.mjs" },
  },
  {
    name: "import ignores a module-only entry",
    kind: "import",
    metadata: { module: "bundler.mjs" },
  },
  {
    name: "require ignores a module-only entry",
    kind: "require",
    metadata: { module: "bundler.mjs" },
  },
  {
    name: "import preserves a main-only entry",
    kind: "import",
    metadata: { main: "actual.cjs" },
  },
  {
    name: "require preserves main before bundler module",
    kind: "require",
    metadata: { main: "actual.cjs", module: "bundler.mjs" },
  },
  {
    name: "import preserves declared exports before legacy entries",
    kind: "import",
    metadata: {
      main: "actual.cjs",
      module: "bundler.mjs",
      exports: { import: "./exported.mjs", require: "./actual.cjs" },
    },
  },
  {
    name: "import selects module-sync before default",
    kind: "import",
    metadata: {
      exports: { "module-sync": "./sync.mjs", default: "./actual.cjs" },
    },
  },
  {
    name: "require selects nested module-sync before default",
    kind: "require",
    metadata: {
      exports: {
        ".": { node: { "module-sync": "./sync.mjs", default: "./actual.cjs" } },
      },
    },
  },
  {
    name: "an earlier import condition precedes module-sync",
    kind: "import",
    metadata: {
      exports: { import: "./exported.mjs", "module-sync": "./sync.mjs" },
    },
  },
  {
    name: "an earlier default condition precedes module-sync",
    kind: "require",
    metadata: {
      exports: { default: "./actual.cjs", "module-sync": "./sync.mjs" },
    },
  },
] as const)(
  "matches the native Node loader when $name",
  async ({ kind, metadata }) => {
    const root = await createTestTempDirectory("rea-node-package-fields-");
    const entry = kind === "import" ? "main.mjs" : "main.cjs";
    const source =
      kind === "import"
        ? `import value from "fixture"; console.log(JSON.stringify({value, resolved: import.meta.resolve("fixture")}));`
        : `const value = require("fixture"); console.log(JSON.stringify({value: typeof value === "string" ? value : value.default, resolved: require.resolve("fixture")}));`;
    const files = {
      "package.json": JSON.stringify({
        name: "app",
        main: entry,
        type: kind === "import" ? "module" : "commonjs",
      }),
      [entry]: source,
      "node_modules/fixture/package.json": JSON.stringify({
        name: "fixture",
        ...metadata,
      }),
      "node_modules/fixture/actual.cjs": "module.exports = 'actual.cjs';",
      "node_modules/fixture/index.js": "module.exports = 'index.js';",
      "node_modules/fixture/bundler.mjs": "export default 'bundler.mjs';",
      "node_modules/fixture/exported.mjs": "export default 'exported.mjs';",
      "node_modules/fixture/sync.mjs": "export default 'sync.mjs';",
    };
    await Promise.all(
      Object.entries(files).map(async ([path, text]) => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
      }),
    );
    const { stdout } = await runNode(process.execPath, [join(root, entry)], {
      cwd: root,
    });
    const oracle: unknown = JSON.parse(stdout);
    expect(oracle).toMatchObject({
      value: expect.any(String),
      resolved: expect.any(String),
    });
    if (typeof oracle !== "object" || oracle === null)
      throw new Error("Node returned no package identity");
    const resolved: unknown = Reflect.get(oracle, "resolved");
    if (typeof resolved !== "string")
      throw new Error("Node returned no resolved path");
    const expected = relative(
      await realpath(root),
      kind === "import" ? fileURLToPath(resolved) : resolved,
    )
      .split(sep)
      .join("/");
    expect(Reflect.get(oracle, "value")).toBe(expected.split("/").at(-1));
    const result = await reconstructJavaScriptArtifact({
      input_path: root,
      format: "directory",
    });
    const edge = result.graph.edges.find(
      ({ properties }) =>
        properties.module_link_kind === kind &&
        properties.specifier === "fixture",
    );
    expect(edge?.properties).toMatchObject({
      resolution_status: "resolved",
      resolved_path: expected,
    });
    expect(result.graph.coverage.status).toBe("complete");
  },
);
