import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const execute = promisify(execFile);

const createModuleLookupFixture = async () => {
  const root = await createTestTempDirectory("rea-module-lookup-");
  await writeFixtureFiles(root, {
    "package.json": JSON.stringify({
      name: "module-lookup-fixture",
      type: "commonjs",
    }),
    "esm/entry.mjs": [
      'import "./a%2eb.mjs";',
      'import "./sub/%2e%2e/x.mjs";',
      'import "./sub%2fx.mjs";',
      'import "./extensionless";',
      'import "./directory";',
      'import "./explicit.js";',
      'import "./exact.js";',
      'import "./actual.cjs?cache=1";',
      'import fallback from "empty-main";',
      'import "nested-main";',
      'import "file-only";',
      'import "ancestor-empty";',
      'import "ancestor-blocked";',
      'import "ancestor-sub/parser";',
      'import "./.hidden.js";',
      'import "./..pkg.js";',
      'import "./exact.js/.";',
      'import "./exact.js/child/..";',
      'import ".hidden.js";',
      'import "..pkg.js";',
      'import ".";',
      'import "..";',
      "void fallback;",
    ].join("\n"),
    "esm/extensionless.js": "module.exports = 1;",
    "esm/directory/index.js": "module.exports = 2;",
    "esm/explicit.js.js": "module.exports = 3;",
    "esm/exact.js": "module.exports = 4;",
    "esm/a.b.mjs": "export default 'encoded dot';",
    "esm/x.mjs": "export default 'confined parent';",
    "esm/actual.cjs": "module.exports = 5;",
    "esm/.hidden.js": "module.exports = 'local hidden';",
    "esm/..pkg.js": "module.exports = 'local dot package';",
    "node_modules/.hidden.js/index.js": "module.exports = 'hidden package';",
    "node_modules/..pkg.js/index.js": "module.exports = 'dot package';",
    "esm/typed.mts": 'import value from "./typed-dep.js"; void value;',
    "esm/typed-dep.ts": "export default 42;",
    "cjs/entry.cjs": [
      'require("./lit%2eb");',
      'require("./x%2Fy");',
      'require("./extensionless");',
      'require("./directory");',
      'require("./feature");',
      'require("./feature.cjs");',
      'require("./module-only");',
      'require("./valid-directory");',
      'require("./default-js");',
      'require("./default-json");',
      'require("./default-node");',
      'require("empty-main");',
      'require("nested-main");',
      'require("file-only");',
      'require("ancestor-empty");',
      'require("ancestor-blocked");',
      'require("ancestor-sub/parser");',
      'require(".hidden.js");',
      'require("./.hidden.js");',
      'require(".");',
      'require("..");',
    ].join("\n"),
    "cjs/directory/index.cjs": "module.exports = 6;",
    "cjs/index.js": "module.exports = 'current directory';",
    "index.js": "module.exports = 'parent directory';",
    "cjs/.hidden.js": "module.exports = 'local hidden';",
    "cjs/extensionless.cjs": "module.exports = 1;",
    "cjs/lit%2eb.js": "module.exports = 'literal dot bytes';",
    "cjs/x%2Fy.js": "module.exports = 'literal slash bytes';",
    "cjs/feature.cjs": "module.exports = 2;",
    "cjs/module-only.mjs": "export default 42;",
    "cjs/valid-directory/index.js": "module.exports = 42;",
    "cjs/typed.cts":
      'const value = require("./typed-dep.cjs"); module.exports = value;',
    "cjs/typed-dep.cts": "module.exports = 42;",
    "cjs/default-js.js": "module.exports = 3;",
    "cjs/default-json.json": JSON.stringify({ value: 4 }),
    // Inventory-only placeholder: never pass this path to Node's runtime.
    "cjs/default-node.node": "source-owned opaque native-module placeholder",
    "node_modules/empty-main/package.json": JSON.stringify({ main: "" }),
    "node_modules/empty-main/index.js": "module.exports = 42;",
    "node_modules/nested-main/package.json": JSON.stringify({ main: "sub" }),
    "node_modules/nested-main/sub/package.json": JSON.stringify({
      main: "other",
    }),
    "node_modules/nested-main/sub/other.js": "module.exports = 99;",
    "node_modules/file-only.js": "module.exports = 7;",
    "node_modules/ancestor-empty/index.js": "module.exports = 8;",
    "node_modules/ancestor-blocked/index.js": "module.exports = 9;",
    "node_modules/ancestor-sub/parser.js": "module.exports = 10;",
    "esm/runtime-control.mjs": [
      'const specifiers = ["./a%2eb.mjs", "./sub/%2e%2e/x.mjs", "./sub%2fx.mjs", "./extensionless", "./directory", "./explicit.js", "./exact.js", "./actual.cjs?cache=1", "empty-main", "nested-main", "file-only", "ancestor-empty", "ancestor-blocked", "ancestor-sub/parser", "./.hidden.js", "./..pkg.js", "./exact.js/.", "./exact.js/child/..", ".hidden.js", "..pkg.js", ".", ".."];',
      "const results = [];",
      "for (const specifier of specifiers) {",
      "  try { const value = (await import(specifier)).default; results.push({ specifier, ok: true, value }); }",
      "  catch (error) { results.push({ specifier, ok: false, code: error.code }); }",
      "}",
      "console.log(JSON.stringify(results));",
    ].join("\n"),
    "cjs/runtime-control.cjs": [
      'const specifiers = ["./lit%2eb", "./x%2Fy", "./extensionless", "./directory", "./feature", "./feature.cjs", "./module-only", "./valid-directory", "./default-js", "./default-json", "empty-main", "nested-main", "file-only", "ancestor-empty", "ancestor-blocked", "ancestor-sub/parser", ".hidden.js", "./.hidden.js", ".", ".."];',
      "const results = [];",
      "for (const specifier of specifiers) {",
      "  try { const value = require(specifier); results.push({ specifier, ok: true, value }); }",
      "  catch (error) { results.push({ specifier, ok: false, code: error.code }); }",
      "}",
      "console.log(JSON.stringify(results));",
    ].join("\n"),
  });
  for (const directory of ["esm", "cjs"])
    await writeFixtureFiles(root, {
      [`${directory}/node_modules/ancestor-empty/package.json`]: JSON.stringify(
        { main: "" },
      ),
      [`${directory}/node_modules/ancestor-blocked/package.json`]:
        JSON.stringify({ main: "missing" }),
      [`${directory}/node_modules/ancestor-sub/package.json`]: "{}",
    });
  return root;
};

type RuntimeControlResult = {
  readonly specifier: string;
  readonly ok: boolean;
  readonly code?: string;
  readonly value?: unknown;
};

const expectNodeRuntimeControls = (
  esmOutput: string,
  cjsOutput: string,
): void => {
  const esmResults = JSON.parse(esmOutput) as RuntimeControlResult[];
  const cjsResults = JSON.parse(cjsOutput) as RuntimeControlResult[];
  expect(esmResults).toEqual([
    { specifier: "./a%2eb.mjs", ok: true, value: "encoded dot" },
    { specifier: "./sub/%2e%2e/x.mjs", ok: true, value: "confined parent" },
    {
      specifier: "./sub%2fx.mjs",
      ok: false,
      code: "ERR_INVALID_MODULE_SPECIFIER",
    },
    {
      specifier: "./extensionless",
      ok: false,
      code: "ERR_MODULE_NOT_FOUND",
    },
    {
      specifier: "./directory",
      ok: false,
      code: "ERR_UNSUPPORTED_DIR_IMPORT",
    },
    {
      specifier: "./explicit.js",
      ok: false,
      code: "ERR_MODULE_NOT_FOUND",
    },
    { specifier: "./exact.js", ok: true, value: 4 },
    { specifier: "./actual.cjs?cache=1", ok: true, value: 5 },
    { specifier: "empty-main", ok: true, value: 42 },
    { specifier: "nested-main", ok: false, code: "ERR_MODULE_NOT_FOUND" },
    { specifier: "file-only", ok: false, code: "ERR_MODULE_NOT_FOUND" },
    { specifier: "ancestor-empty", ok: false, code: "ERR_MODULE_NOT_FOUND" },
    {
      specifier: "ancestor-blocked",
      ok: false,
      code: "ERR_MODULE_NOT_FOUND",
    },
    {
      specifier: "ancestor-sub/parser",
      ok: false,
      code: "ERR_MODULE_NOT_FOUND",
    },
    { specifier: "./.hidden.js", ok: true, value: "local hidden" },
    { specifier: "./..pkg.js", ok: true, value: "local dot package" },
    {
      specifier: "./exact.js/.",
      ok: false,
      code: "ERR_UNSUPPORTED_DIR_IMPORT",
    },
    {
      specifier: "./exact.js/child/..",
      ok: false,
      code: "ERR_UNSUPPORTED_DIR_IMPORT",
    },
    {
      specifier: ".hidden.js",
      ok: false,
      code: "ERR_INVALID_MODULE_SPECIFIER",
    },
    {
      specifier: "..pkg.js",
      ok: false,
      code: "ERR_INVALID_MODULE_SPECIFIER",
    },
    { specifier: ".", ok: false, code: "ERR_UNSUPPORTED_DIR_IMPORT" },
    { specifier: "..", ok: false, code: "ERR_UNSUPPORTED_DIR_IMPORT" },
  ]);
  expect(cjsResults).toEqual([
    { specifier: "./lit%2eb", ok: true, value: "literal dot bytes" },
    { specifier: "./x%2Fy", ok: true, value: "literal slash bytes" },
    {
      specifier: "./extensionless",
      ok: false,
      code: "MODULE_NOT_FOUND",
    },
    {
      specifier: "./directory",
      ok: false,
      code: "MODULE_NOT_FOUND",
    },
    {
      specifier: "./feature",
      ok: false,
      code: "MODULE_NOT_FOUND",
    },
    { specifier: "./feature.cjs", ok: true, value: 2 },
    { specifier: "./module-only", ok: false, code: "MODULE_NOT_FOUND" },
    { specifier: "./valid-directory", ok: true, value: 42 },
    { specifier: "./default-js", ok: true, value: 3 },
    { specifier: "./default-json", ok: true, value: { value: 4 } },
    { specifier: "empty-main", ok: true, value: 42 },
    { specifier: "nested-main", ok: false, code: "MODULE_NOT_FOUND" },
    { specifier: "file-only", ok: true, value: 7 },
    { specifier: "ancestor-empty", ok: true, value: 8 },
    { specifier: "ancestor-blocked", ok: false, code: "MODULE_NOT_FOUND" },
    { specifier: "ancestor-sub/parser", ok: true, value: 10 },
    { specifier: ".hidden.js", ok: true, value: "hidden package" },
    { specifier: "./.hidden.js", ok: true, value: "local hidden" },
    { specifier: ".", ok: true, value: "current directory" },
    { specifier: "..", ok: true, value: "parent directory" },
  ]);
};

cliTest.for(["CLI", "stdio MCP"] as const)(
  "matches Node module lookup for ESM and CommonJS through %s",
  async (surface, { cli }) => {
    const root = await createModuleLookupFixture();
    const [esmControl, cjsControl] = await Promise.all([
      execute(process.execPath, ["esm/runtime-control.mjs"], {
        cwd: root,
        timeout: 5_000,
      }),
      execute(process.execPath, ["cjs/runtime-control.cjs"], {
        cwd: root,
        timeout: 5_000,
      }),
    ]);
    expectNodeRuntimeControls(esmControl.stdout, cjsControl.stdout);

    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const expectations = [
      ["import", "./a%2eb.mjs", "esm/a.b.mjs", "resolved"],
      ["import", "./sub/%2e%2e/x.mjs", "esm/x.mjs", "resolved"],
      ["import", "./sub%2fx.mjs", null, "rejected"],
      ["import", "./extensionless", null, "not-found"],
      ["import", "./directory", null, "not-found"],
      ["import", "./explicit.js", null, "not-found"],
      ["import", "./exact.js", "esm/exact.js", "resolved"],
      ["import", "./actual.cjs?cache=1", "esm/actual.cjs", "resolved"],
      ["import", "./typed-dep.js", "esm/typed-dep.ts", "resolved"],
      ["import", "empty-main", "node_modules/empty-main/index.js", "resolved"],
      ["import", "nested-main", null, "not-found"],
      ["import", "file-only", null, "external"],
      ["import", "ancestor-empty", null, "not-found"],
      ["import", "ancestor-blocked", null, "not-found"],
      ["import", "ancestor-sub/parser", null, "not-found"],
      ["import", "./.hidden.js", "esm/.hidden.js", "resolved"],
      ["import", "./..pkg.js", "esm/..pkg.js", "resolved"],
      ["import", ".hidden.js", null, "rejected"],
      ["import", "..pkg.js", null, "rejected"],
      ["import", ".", null, "not-found"],
      ["import", "..", null, "not-found"],
      ["import", "./exact.js/.", null, "not-found"],
      ["import", "./exact.js/child/..", null, "not-found"],
      ["require", "./extensionless", null, "not-found"],
      ["require", "./lit%2eb", "cjs/lit%2eb.js", "resolved"],
      ["require", "./x%2Fy", "cjs/x%2Fy.js", "resolved"],
      ["require", "./directory", null, "not-found"],
      ["require", "./feature", null, "not-found"],
      ["require", "./feature.cjs", "cjs/feature.cjs", "resolved"],
      ["require", "./module-only", null, "not-found"],
      [
        "require",
        "./valid-directory",
        "cjs/valid-directory/index.js",
        "resolved",
      ],
      ["require", "./typed-dep.cjs", "cjs/typed-dep.cts", "resolved"],
      ["require", "./default-js", "cjs/default-js.js", "resolved"],
      ["require", "./default-json", "cjs/default-json.json", "resolved"],
      ["require", "./default-node", "cjs/default-node.node", "resolved"],
      ["require", "empty-main", "node_modules/empty-main/index.js", "resolved"],
      ["require", "nested-main", null, "not-found"],
      ["require", "file-only", "node_modules/file-only.js", "resolved"],
      [
        "require",
        "ancestor-empty",
        "node_modules/ancestor-empty/index.js",
        "resolved",
      ],
      ["require", "ancestor-blocked", null, "not-found"],
      [
        "require",
        "ancestor-sub/parser",
        "node_modules/ancestor-sub/parser.js",
        "resolved",
      ],
      ["require", ".hidden.js", "node_modules/.hidden.js/index.js", "resolved"],
      ["require", "./.hidden.js", "cjs/.hidden.js", "resolved"],
      ["require", ".", "cjs/index.js", "resolved"],
      ["require", "..", "index.js", "resolved"],
    ] as const;

    for (const [kind, specifier, resolvedPath, status] of expectations) {
      const matchingProperties = graph.edges
        .filter((edge) => edge.relation === "imports")
        .map((edge) => edge.properties)
        .filter(
          (properties) =>
            "module_link_kind" in properties &&
            properties.module_link_kind === kind &&
            properties.specifier === specifier,
        );
      expect(matchingProperties).toContainEqual(
        expect.objectContaining({
          module_link_kind: kind,
          specifier,
          resolved_path: resolvedPath,
          resolution_status: status,
        }),
      );
    }
  },
);
