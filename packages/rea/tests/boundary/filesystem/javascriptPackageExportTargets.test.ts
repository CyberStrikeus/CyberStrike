import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";
import { z } from "zod";

import { reconstructJavaScriptArtifact } from "../../support/javascriptApplicationScope.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const cases: readonly {
  name: string;
  exports: unknown;
  expected: string | null;
  nodeError?: string;
  rejectedTarget?: string;
}[] = [
  ...[
    "./../outside.cjs",
    "./lib/../actual.cjs",
    "././actual.cjs",
    "./node_modules/actual.cjs",
    "./NODE_MODULES/actual.cjs",
    "./%2e%2e/outside.cjs",
    "./n%6fde_modules/actual.cjs",
    "./lib\\..\\actual.cjs",
    "../outside.cjs",
    "actual.cjs",
    "/actual.cjs",
    "file:./actual.cjs",
    "",
  ].map((target) => ({
    name: `invalid target ${JSON.stringify(target)}`,
    exports: target,
    expected: null,
    nodeError: "ERR_INVALID_PACKAGE_TARGET",
    rejectedTarget: target,
  })),
  {
    name: "root subpath rejects a parent segment",
    exports: { ".": "./../outside.cjs" },
    expected: null,
    nodeError: "ERR_INVALID_PACKAGE_TARGET",
    rejectedTarget: "./../outside.cjs",
  },
  {
    name: "active condition rejects instead of selecting default",
    exports: { node: "./../outside.cjs", default: "./actual.cjs" },
    expected: null,
    nodeError: "ERR_INVALID_PACKAGE_TARGET",
    rejectedTarget: "./../outside.cjs",
  },
  {
    name: "extensionless target is not completed with an extension",
    exports: "./actual",
    expected: null,
    nodeError: "MODULE_NOT_FOUND",
  },
  {
    // Node reports ERR_UNSUPPORTED_DIR_IMPORT for import, MODULE_NOT_FOUND for require.
    name: "directory target does not load its index",
    exports: "./folder",
    expected: null,
  },
  {
    name: "top-level array skips an invalid target",
    exports: ["./../outside.cjs", "./actual.cjs"],
    expected: "node_modules/fixture/actual.cjs",
  },
  {
    name: "root array skips encoded invalid segments",
    exports: { ".": ["./%2e%2e/outside.cjs", "./actual.cjs"] },
    expected: "node_modules/fixture/actual.cjs",
  },
  {
    name: "nested arrays skip invalid package-local segments",
    exports: { node: [["./n%6fde_modules/actual.cjs", "./actual.cjs"]] },
    expected: "node_modules/fixture/actual.cjs",
  },
  {
    name: "last invalid target retains its reason",
    exports: ["./../outside.cjs", "././actual.cjs"],
    expected: null,
    nodeError: "ERR_INVALID_PACKAGE_TARGET",
    rejectedTarget: "././actual.cjs",
  },
  {
    name: "null following an invalid target blocks exports",
    exports: ["./../outside.cjs", null],
    expected: null,
    nodeError: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  },
  {
    name: "an invalid target following null remains invalid",
    exports: [null, "./../outside.cjs"],
    expected: null,
    nodeError: "ERR_INVALID_PACKAGE_TARGET",
    rejectedTarget: "./../outside.cjs",
  },
  {
    name: "inactive invalid condition does not block default",
    exports: { browser: "./../outside.cjs", default: "./actual.cjs" },
    expected: "node_modules/fixture/actual.cjs",
  },
  {
    name: "active module-sync rejects an invalid target instead of default",
    exports: { "module-sync": "./../outside.cjs", default: "./actual.cjs" },
    expected: null,
    nodeError: "ERR_INVALID_PACKAGE_TARGET",
    rejectedTarget: "./../outside.cjs",
  },
  {
    name: "module-sync null blocks default",
    exports: { "module-sync": null, default: "./actual.cjs" },
    expected: null,
    nodeError: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  },
  {
    name: "unmatched nested module-sync permits default",
    exports: {
      "module-sync": { browser: "./missing.cjs" },
      default: "./actual.cjs",
    },
    expected: "node_modules/fixture/actual.cjs",
  },
  ...["./bad%.cjs", "./bad%C3.cjs"].map((target) => ({
    name: `malformed URL ${target} is selected before URL decoding`,
    exports: [target, "./actual.cjs"],
    expected: null,
    nodeError: "URIError",
  })),
  {
    name: "encoded separator is selected before final path refusal",
    exports: ["./lib%2Factual.cjs", "./actual.cjs"],
    expected: null,
    nodeError: "ERR_INVALID_MODULE_SPECIFIER",
  },
  {
    name: "missing first target does not select a second file",
    exports: ["./missing.cjs", "./actual.cjs"],
    expected: null,
    nodeError: "MODULE_NOT_FOUND",
  },
  {
    name: "nested directory is valid",
    exports: "./lib/actual.cjs",
    expected: "node_modules/fixture/lib/actual.cjs",
  },
  {
    name: "node_modules substring is not a forbidden segment",
    exports: "./node_modules.cjs",
    expected: "node_modules/fixture/node_modules.cjs",
  },
  {
    name: "encoded underscore and letters do not borrow a forbidden directory",
    exports: ["./%6eode%5fmodules/actual.cjs", "./actual.cjs"],
    expected: "node_modules/fixture/actual.cjs",
  },
  {
    name: "percent encoding is applied once",
    exports: "./literal%252e.cjs",
    expected: "node_modules/fixture/literal%2e.cjs",
  },
];

const nativeResultSchema = z.object({
  value: z.string().nullable(),
  code: z.string().nullable(),
});

it.each(cases)(
  "matches Node import and require target selection for $name",
  async ({ name, exports, expected, nodeError, rejectedTarget }) => {
    const root = await createTestTempDirectory("rea-package-target-");
    const files = {
      "main.mjs": 'import value from "fixture"; export default value;',
      "main.cjs": 'module.exports = require("fixture");',
      "node_modules/fixture/package.json": JSON.stringify({ exports }),
      ...Object.fromEntries(
        [
          "node_modules/fixture/actual.cjs",
          "node_modules/outside.cjs",
          "node_modules/fixture/lib/actual.cjs",
          "node_modules/fixture/node_modules/actual.cjs",
          "node_modules/fixture/node_modules.cjs",
          "node_modules/fixture/literal%2e.cjs",
          "node_modules/fixture/folder/index.js",
        ].map((path) => [path, `module.exports = ${JSON.stringify(path)};`]),
      ),
    };
    await Promise.all(
      Object.entries(files).map(async ([path, text]) => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
      }),
    );
    for (const moduleKind of ["import", "require"] as const) {
      const runner =
        moduleKind === "import"
          ? 'const load = async () => (await import("fixture")).default;'
          : 'const load = async () => require("fixture");';
      const native = await promisify(execFile)(
        process.execPath,
        [
          "--input-type",
          moduleKind === "import" ? "module" : "commonjs",
          "--eval",
          `${runner} load().then(value => console.log(JSON.stringify({value,code:null})), error => console.log(JSON.stringify({value:null,code:error.code ?? error.name})));`,
        ],
        { cwd: root, timeout: 5_000 },
      );
      const oracle = nativeResultSchema.parse(JSON.parse(native.stdout));
      expect(oracle.value, `${name} (${moduleKind})`).toBe(expected);
      if (nodeError !== undefined)
        expect(oracle.code, `${name} (${moduleKind})`).toBe(
          moduleKind === "import" && nodeError === "MODULE_NOT_FOUND"
            ? "ERR_MODULE_NOT_FOUND"
            : nodeError,
        );
    }

    const result = await reconstructJavaScriptArtifact({
      input_path: root,
      format: "directory",
    });
    for (const mainPath of ["main.mjs", "main.cjs"] as const) {
      const edge = result.graph.edges.find(
        ({ evidence, properties }) =>
          properties.specifier === "fixture" &&
          properties.resolution_status !== undefined &&
          properties.resolution_status !== null &&
          evidence.location.available &&
          evidence.location.value.kind === "source-range" &&
          evidence.location.value.source === mainPath,
      );
      expect(edge, `${name} (${mainPath})`).toBeDefined();
      expect(edge?.properties.resolved_path, `${name} (${mainPath})`).toBe(
        expected,
      );
      if (expected !== null) {
        expect(
          edge?.properties.resolution_status,
          `${name} (${mainPath})`,
        ).toBe("resolved");
      } else {
        expect(
          edge?.properties.resolution_status,
          `${name} (${mainPath})`,
        ).not.toBe("resolved");
      }
      if (rejectedTarget !== undefined) {
        expect(
          edge?.properties.resolution_status,
          `${name} (${mainPath})`,
        ).toBe("rejected");
        expect(edge?.evidence.limitations.join(" ")).toContain(
          JSON.stringify(rejectedTarget),
        );
        expect(edge?.evidence.limitations.join(" ")).toContain(
          "exports target",
        );
        expect(edge?.evidence.limitations.join(" ")).not.toContain(
          "not valid package JSON",
        );
        expect(edge?.evidence.location).toMatchObject({
          value: { kind: "source-range", source: mainPath },
        });
      }
    }
  },
);
