import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

type PackageSpecifierCase = {
  readonly specifier: string;
  readonly target: string | null;
  readonly status: "resolved" | "external" | "rejected" | "not-found";
  readonly value: string | number | null;
  readonly error: string | null;
};

const directoryFormSpecifiers = [
  "legacy/feature.js/.",
  "legacy/feature.js/child/..",
  "legacy/feature.js/",
  "legacy/feature.js/.?cache=1#entry",
  "legacy/with%20space.js/.",
  "legacy/missing/.",
  "legacy/feature.js/.\t",
  "legacy/feature.js/.\n?cache=1#entry",
  "legacy/feature.js/ch\til\rd/..",
  "legacy/feature.js/. ",
];
const encodedDotSpecifiers = ["\t", "\n", "\r"].flatMap((control) => [
  `legacy/child/%2${control}e%2${control}e/feature.js`,
  `legacy/child/.%2${control}E/feature.js`,
]);

const requests = [
  {
    specifier: "rea-self-fixture",
    target: "root.cjs",
    status: "resolved",
    value: 11,
    error: null,
  },
  {
    specifier: "rea-self-fixture/feature",
    target: "feature.cjs",
    status: "resolved",
    value: 22,
    error: null,
  },
  {
    specifier: "rea-self-fixture/feature?cache=1",
    target: "punctuated.cjs",
    status: "resolved",
    value: 33,
    error: null,
  },
  {
    specifier: "rea-self-fixture/feature?cache=2",
    target: null,
    status: "external",
    value: null,
    error: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  },
  {
    specifier: "rea-self-fixture/feature#entry",
    target: null,
    status: "external",
    value: null,
    error: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  },
  {
    specifier: "fixture/feature?cache=1",
    target: null,
    status: "external",
    value: null,
    error: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  },
  {
    specifier: "fixture/feature#entry",
    target: null,
    status: "external",
    value: null,
    error: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  },
  {
    specifier: "fixture/literal?cache=1",
    target: "node_modules/fixture/literal.cjs",
    status: "resolved",
    value: "literal",
    error: null,
  },
  {
    specifier: "legacy/?cache=1",
    target: null,
    status: "rejected",
    value: null,
    error: "ERR_UNSUPPORTED_DIR_IMPORT",
  },
  {
    specifier: "legacy/#entry",
    target: null,
    status: "rejected",
    value: null,
    error: "ERR_UNSUPPORTED_DIR_IMPORT",
  },
  {
    specifier: "legacy/nested/?cache=1",
    target: null,
    status: "rejected",
    value: null,
    error: "ERR_UNSUPPORTED_DIR_IMPORT",
  },
  {
    specifier: "legacy/nested/#entry",
    target: null,
    status: "rejected",
    value: null,
    error: "ERR_UNSUPPORTED_DIR_IMPORT",
  },
  {
    specifier: "legacy/feature.js",
    target: "node_modules/legacy/feature.js",
    status: "resolved",
    value: "legacy feature",
    error: null,
  },
  {
    specifier: "legacy/feature.js?cache=1",
    target: "node_modules/legacy/feature.js",
    status: "resolved",
    value: "legacy feature",
    error: null,
  },
  {
    specifier: "legacy/feature.js#entry",
    target: "node_modules/legacy/feature.js",
    status: "resolved",
    value: "legacy feature",
    error: null,
  },
  {
    specifier: "legacy/with%20space.js?cache=1",
    target: "node_modules/legacy/with space.js",
    status: "resolved",
    value: "legacy spaced feature",
    error: null,
  },
  ...directoryFormSpecifiers.map((specifier) => ({
    specifier,
    target: null,
    status: "rejected" as const,
    value: null,
    error: "ERR_UNSUPPORTED_DIR_IMPORT",
  })),
  ...encodedDotSpecifiers.map((specifier) => ({
    specifier,
    target: "node_modules/legacy/feature.js",
    status: "resolved" as const,
    value: "legacy feature",
    error: null,
  })),
  {
    specifier: "legacy/feature.js/%2e",
    target: null,
    status: "rejected",
    value: null,
    error: "ERR_UNSUPPORTED_DIR_IMPORT",
  },
  {
    specifier: "legacy/feature.js/.%09",
    target: null,
    status: "not-found",
    value: null,
    error: "ERR_MODULE_NOT_FOUND",
  },
  {
    specifier: "legacy/feature.js/%2f",
    target: null,
    status: "rejected",
    value: null,
    error: "ERR_INVALID_MODULE_SPECIFIER",
  },
  ...[
    "legacy/feature.js?cache=/..",
    "legacy/feature.js#entry/.",
    "legacy/fea\tture.js",
    "legacy/feature.js?cache=%2\te",
    "legacy/feature.js#entry=%2\nf",
    "legacy/child/../feature.js",
  ].map((specifier) => ({
    specifier,
    target: "node_modules/legacy/feature.js",
    status: "resolved" as const,
    value: "legacy feature",
    error: null,
  })),
  ...[
    "fixture/feature.js/.",
    "fixture/feature.js/.\t",
    "fixture/child/%2\te%2\te/feature",
    "legacy/../fixture/literal.cjs",
  ].map((specifier) => ({
    specifier,
    target: "node_modules/fixture/literal.cjs",
    status: "resolved" as const,
    value: "literal",
    error: null,
  })),
  {
    specifier: "legacy/literal%252e.js",
    target: "node_modules/legacy/literal%2e.js",
    status: "resolved",
    value: "legacy literal percent",
    error: null,
  },
  {
    specifier: "legacy/feature",
    target: null,
    status: "not-found",
    value: null,
    error: "ERR_MODULE_NOT_FOUND",
  },
] satisfies readonly PackageSpecifierCase[];

const createPackageSpecifierFixture = async (): Promise<{
  readonly root: string;
  readonly source: string;
}> => {
  const root = await createTestTempDirectory("rea-package-specifier-suffix-");
  const packagePath = join(root, "node_modules", "fixture");
  const legacyPackagePath = join(root, "node_modules", "legacy");
  await Promise.all([
    mkdir(packagePath, { recursive: true }),
    mkdir(join(legacyPackagePath, "nested"), { recursive: true }),
  ]);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "rea-self-fixture",
      exports: {
        ".": { import: "./root.cjs", require: "./require.cjs" },
        "./feature": { import: "./feature.cjs", require: "./require.cjs" },
        "./feature?cache=1": {
          import: "./punctuated.cjs",
          require: "./require.cjs",
        },
      },
    }),
  );
  const source = requests
    .map(
      ({ specifier }, index) =>
        `import value${index} from ${JSON.stringify(specifier)};`,
    )
    .join("\n");
  await Promise.all([
    writeFile(join(root, "main.mjs"), source),
    writeFile(join(root, "root.cjs"), "module.exports = 11;"),
    writeFile(join(root, "feature.cjs"), "module.exports = 22;"),
    writeFile(join(root, "punctuated.cjs"), "module.exports = 33;"),
    writeFile(join(root, "require.cjs"), "module.exports = -1;"),
  ]);
  await writeFile(
    join(packagePath, "package.json"),
    JSON.stringify({
      exports: {
        "./feature": "./feature.cjs",
        "./literal?cache=1": "./literal.cjs",
        "./feature.js/.": "./literal.cjs",
        "./feature.js/.\t": "./literal.cjs",
        "./child/%2\te%2\te/feature": "./literal.cjs",
      },
    }),
  );
  await Promise.all([
    writeFile(join(packagePath, "feature.cjs"), 'module.exports = "feature";'),
    writeFile(join(packagePath, "literal.cjs"), 'module.exports = "literal";'),
    writeFile(
      join(legacyPackagePath, "package.json"),
      JSON.stringify({ name: "legacy", main: "./main.cjs" }),
    ),
    writeFile(
      join(legacyPackagePath, "main.cjs"),
      'module.exports = "legacy root";',
    ),
    writeFile(
      join(legacyPackagePath, "feature.js"),
      'module.exports = "legacy feature";',
    ),
    writeFile(
      join(legacyPackagePath, "with space.js"),
      'module.exports = "legacy spaced feature";',
    ),
    writeFile(
      join(legacyPackagePath, "literal%2e.js"),
      'module.exports = "legacy literal percent";',
    ),
    writeFile(
      join(legacyPackagePath, "nested", "package.json"),
      JSON.stringify({ main: "./main.cjs" }),
    ),
    writeFile(
      join(legacyPackagePath, "nested", "main.cjs"),
      'module.exports = "legacy nested";',
    ),
  ]);
  return { root, source };
};

cliTest.for(["CLI", "stdio MCP"] as const)(
  "resolves package self references and suffix keys through %s",
  async (surface, { cli }) => {
    const { root, source } = await createPackageSpecifierFixture();
    if (surface === "CLI") {
      const native = await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const requests = ${JSON.stringify(requests.map(({ specifier }) => specifier))};
          const results = await Promise.all(requests.map(async (specifier) => {
            try {
              const result = await import(specifier);
              return { value: result.default, error: null };
            } catch (error) {
              return { value: null, error: error.code };
            }
          }));
          console.log(JSON.stringify(results));`,
        ],
        { cwd: root, timeout: 5_000 },
      );
      expect(JSON.parse(native.stdout)).toEqual(
        requests.map(({ value, error }) => ({ value, error })),
      );
    }

    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const { specifier, target, status } of requests)
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          relation: "imports",
          properties: expect.objectContaining({
            module_link_kind: "import",
            specifier,
            resolved_path: target,
            resolution_status: status,
          }),
          evidence: expect.objectContaining({
            ...(directoryFormSpecifiers.includes(specifier)
              ? {
                  limitations: expect.arrayContaining([
                    `ESM package subpath ${JSON.stringify(specifier)} has URL directory form; directory imports are unsupported and no exact-file, package main or index lookup was attempted.`,
                  ]),
                }
              : {}),
            ...(specifier === "legacy/feature"
              ? {
                  limitations: expect.arrayContaining([
                    "The selected package ESM subpath target node_modules/legacy/feature does not exist in the inventoried artifact container; ESM subpath targets are exact files, so no extension or directory index was tried.",
                  ]),
                }
              : {}),
            artifact: expect.objectContaining({
              sha256: createHash("sha256").update(source).digest("hex"),
            }),
            location: expect.objectContaining({
              value: expect.objectContaining({ source: "main.mjs" }),
            }),
          }),
        }),
      );
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "confines legacy package traversal before URL normalization through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-package-root-traversal-");
    const cases = [
      { specifier: "legacy/../../outside.js", status: "resolved" },
      {
        specifier: "legacy/../../outside.js?cache=/../../rea-artifact/#/..",
        status: "resolved",
      },
      { specifier: "legacy//../../../outside.js", status: "resolved" },
      {
        specifier: "legacy/../../../rea-artifact/outside.js",
        status: "rejected",
      },
      {
        specifier: "legacy/../../../../rea-artifact/outside.js",
        status: "rejected",
      },
      {
        specifier: "legacy/../.\t./.\n./rea-artifact/outside.js?cache=1#entry",
        status: "rejected",
      },
    ] as const;
    const source = cases
      .map(({ specifier }) => `import ${JSON.stringify(specifier)};`)
      .join("\n");
    await writeFixtureFiles(root, {
      "main.mjs": source,
      "outside.js": "export default 1;",
      "node_modules/legacy/package.json": "{}",
    });
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const { specifier, status } of cases)
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          relation: "imports",
          properties: expect.objectContaining({
            specifier,
            resolution_status: status,
            resolved_path: status === "resolved" ? "outside.js" : null,
          }),
          evidence: expect.objectContaining({
            ...(status === "rejected"
              ? {
                  limitations: expect.arrayContaining([
                    "The resolved candidate escapes the canonical artifact root.",
                  ]),
                }
              : {}),
            artifact: expect.objectContaining({
              sha256: createHash("sha256").update(source).digest("hex"),
            }),
          }),
        }),
      );
  },
);
