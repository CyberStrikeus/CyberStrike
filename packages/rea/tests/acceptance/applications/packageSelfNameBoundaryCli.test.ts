import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

type SelfNameCase = {
  readonly directory: string;
  readonly packageName: string;
  readonly exportKey: string;
  readonly specifier: string;
  readonly selfValue: string;
  readonly dependency?: {
    readonly packagePath: string;
    readonly exportKey: string;
    readonly value: string;
  };
  readonly esmTarget: string;
  readonly requireTarget: string;
  readonly esmValue: string;
  readonly requireValue: string;
};

const cases = [
  {
    directory: "scope-prefix",
    packageName: "@scope",
    exportKey: "./pkg",
    specifier: "@scope/pkg",
    selfValue: "scope self",
    dependency: {
      packagePath: "node_modules/@scope/pkg",
      exportKey: ".",
      value: "scope dependency",
    },
    esmTarget: "scope-prefix/node_modules/@scope/pkg/dependency.cjs",
    requireTarget: "scope-prefix/self.cjs",
    esmValue: "scope dependency",
    requireValue: "scope self",
  },
  {
    directory: "slash-name",
    packageName: "fixture/sub",
    exportKey: "./feature",
    specifier: "fixture/sub/feature",
    selfValue: "slash self",
    dependency: {
      packagePath: "node_modules/fixture",
      exportKey: "./sub/feature",
      value: "slash dependency",
    },
    esmTarget: "slash-name/node_modules/fixture/dependency.cjs",
    requireTarget: "slash-name/self.cjs",
    esmValue: "slash dependency",
    requireValue: "slash self",
  },
  {
    directory: "slash-exact-name",
    packageName: "fixture/sub",
    exportKey: ".",
    specifier: "fixture/sub",
    selfValue: "slash exact self",
    dependency: {
      packagePath: "node_modules/fixture",
      exportKey: "./sub",
      value: "slash exact dependency",
    },
    esmTarget: "slash-exact-name/node_modules/fixture/dependency.cjs",
    requireTarget: "slash-exact-name/self.cjs",
    esmValue: "slash exact dependency",
    requireValue: "slash exact self",
  },
  {
    directory: "valid-scoped",
    packageName: "@scope/pkg",
    exportKey: "./feature",
    specifier: "@scope/pkg/feature",
    selfValue: "valid scoped self",
    esmTarget: "valid-scoped/self.cjs",
    requireTarget: "valid-scoped/self.cjs",
    esmValue: "valid scoped self",
    requireValue: "valid scoped self",
  },
  {
    directory: "query-self-name",
    packageName: "self?x",
    exportKey: ".",
    specifier: "self?x",
    selfValue: "query self",
    esmTarget: "query-self-name/self.cjs",
    requireTarget: "query-self-name/self.cjs",
    esmValue: "query self",
    requireValue: "query self",
  },
  {
    directory: "fragment-self-name",
    packageName: "@scope/self#entry",
    exportKey: ".",
    specifier: "@scope/self#entry",
    selfValue: "fragment self",
    esmTarget: "fragment-self-name/self.cjs",
    requireTarget: "fragment-self-name/self.cjs",
    esmValue: "fragment self",
    requireValue: "fragment self",
  },
] satisfies readonly SelfNameCase[];

const sourceFor = (specifier: string, moduleKind: "import" | "require") =>
  moduleKind === "import"
    ? `import value from ${JSON.stringify(specifier)};\nexport default value;`
    : `const value = require(${JSON.stringify(specifier)});\nmodule.exports = value;`;

const createSelfNameFixture = async () => {
  const root = await createTestTempDirectory("rea-package-self-name-boundary-");
  const files: Record<string, string> = {};
  for (const item of cases) {
    const prefix = item.directory;
    files[`${prefix}/package.json`] = JSON.stringify({
      name: item.packageName,
      exports: { [item.exportKey]: "./self.cjs" },
    });
    files[`${prefix}/main.mjs`] = sourceFor(item.specifier, "import");
    files[`${prefix}/main.cjs`] = sourceFor(item.specifier, "require");
    files[`${prefix}/self.cjs`] =
      `module.exports = ${JSON.stringify(item.selfValue)};`;
    if (item.dependency !== undefined) {
      const dependencyPrefix = `${prefix}/${item.dependency.packagePath}`;
      files[`${dependencyPrefix}/package.json`] = JSON.stringify({
        exports: { [item.dependency.exportKey]: "./dependency.cjs" },
      });
      files[`${dependencyPrefix}/dependency.cjs`] =
        `module.exports = ${JSON.stringify(item.dependency.value)};`;
    }
  }
  files["node-control.mjs"] = `import { createRequire } from "node:module";
const cases = ${JSON.stringify(cases.map(({ directory, specifier }) => ({ directory, specifier })))};
const esm = await Promise.all(
  cases.map(async ({ directory }) =>
    (await import(new URL(directory + "/main.mjs", import.meta.url))).default,
  ),
);
const require = cases.map(({ directory, specifier }) =>
  createRequire(new URL(directory + "/main.cjs", import.meta.url))(specifier),
);
console.log(JSON.stringify({ esm, require }));`;
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const absolute = join(root, path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content);
    }),
  );
  return root;
};

cliTest.for(["CLI", "stdio MCP"] as const)(
  "matches self references by parsed ESM name and preserves CommonJS prefix matching through %s",
  async (surface, { cli }) => {
    const root = await createSelfNameFixture();
    if (surface === "CLI") {
      const native = await promisify(execFile)(
        process.execPath,
        [join(root, "node-control.mjs")],
        { cwd: root, timeout: 5_000 },
      );
      expect(JSON.parse(native.stdout)).toEqual({
        esm: cases.map(({ esmValue }) => esmValue),
        require: cases.map(({ requireValue }) => requireValue),
      });
    }

    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const item of cases)
      for (const [moduleKind, target] of [
        ["import", item.esmTarget],
        ["require", item.requireTarget],
      ] as const) {
        const sourcePath = `${item.directory}/main.${moduleKind === "import" ? "mjs" : "cjs"}`;
        const source = sourceFor(item.specifier, moduleKind);
        expect(graph.edges).toContainEqual(
          expect.objectContaining({
            relation: "imports",
            properties: expect.objectContaining({
              module_link_kind: moduleKind,
              specifier: item.specifier,
              resolved_path: target,
              resolution_status: "resolved",
            }),
            evidence: expect.objectContaining({
              artifact: expect.objectContaining({
                sha256: createHash("sha256").update(source).digest("hex"),
              }),
              location: expect.objectContaining({
                value: expect.objectContaining({ source: sourcePath }),
              }),
            }),
          }),
        );
      }
  },
);
