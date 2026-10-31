import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

const requests = [
  { specifier: "legacy?x", plainName: "legacy", exports: false },
  { specifier: "exported#entry", plainName: "exported", exports: true },
  { specifier: "@scope/legacy?x", plainName: "@scope/legacy", exports: false },
  { specifier: "@scope#entry/pkg", plainName: "@scope/pkg", exports: true },
] as const;

// Windows cannot materialize the question-mark directories in this fixture.
cliTest.skipIf(process.platform === "win32").for(["CLI", "stdio MCP"] as const)(
  "keeps ESM root URL suffixes out of dependency filesystem lookup through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-package-root-suffix-");
    const sources = {
      "main.mjs": requests
        .map(({ specifier }) => `import ${JSON.stringify(specifier)};`)
        .join("\n"),
      "main.cjs": requests
        .map(({ specifier }) => `require(${JSON.stringify(specifier)});`)
        .join("\n"),
    };
    const files: Record<string, string> = { ...sources };
    for (const item of requests)
      for (const name of [item.specifier, item.plainName]) {
        const directory = `node_modules/${name}`;
        files[`${directory}/package.json`] = JSON.stringify(
          item.exports ? { exports: "./entry.cjs" } : { main: "./entry.cjs" },
        );
        files[`${directory}/entry.cjs`] =
          `module.exports = ${JSON.stringify(name)};`;
      }
    await Promise.all(
      Object.entries(files).map(async ([path, text]) => {
        const absolute = join(root, path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, text);
      }),
    );
    if (surface === "CLI") {
      const native = await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import { createRequire } from "node:module";
const require = createRequire(new URL("./main.cjs", import.meta.url));
const requests = ${JSON.stringify(requests.map(({ specifier }) => specifier))};
const results = await Promise.all(requests.map(async (specifier) => {
  let esm;
  try { esm = { value: (await import(specifier)).default, error: null }; }
  catch (error) { esm = { value: null, error: error.code }; }
  return { esm, require: require(specifier) };
}));
console.log(JSON.stringify(results));`,
        ],
        { cwd: root, timeout: 5_000 },
      );
      expect(JSON.parse(native.stdout)).toEqual(
        requests.map(({ specifier }) => ({
          esm: { value: null, error: "ERR_MODULE_NOT_FOUND" },
          require: specifier,
        })),
      );
    }

    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const { specifier } of requests)
      for (const [moduleKind, sourcePath] of [
        ["import", "main.mjs"],
        ["require", "main.cjs"],
      ] as const)
        expect(graph.edges).toContainEqual(
          expect.objectContaining({
            relation: "imports",
            properties: expect.objectContaining({
              module_link_kind: moduleKind,
              specifier,
              resolved_path:
                moduleKind === "import"
                  ? null
                  : `node_modules/${specifier}/entry.cjs`,
              resolution_status:
                moduleKind === "import" ? "external" : "resolved",
            }),
            evidence: expect.objectContaining({
              artifact: expect.objectContaining({
                sha256: createHash("sha256")
                  .update(sources[sourcePath])
                  .digest("hex"),
              }),
              location: expect.objectContaining({
                value: expect.objectContaining({ source: sourcePath }),
              }),
            }),
          }),
        );
  },
);
