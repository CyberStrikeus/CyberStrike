import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import type { JavaScriptArtifactFile } from "../../../../src/domain/javascript/javascriptArtifactFiles.js";
import { resolveStandaloneArtifactPath } from "../../../support/javascriptArtifactPathResolution.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";
import { importReferenceSource } from "../../../support/referenceSourceResourceScope.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";

const filesFor = (paths: readonly string[]) =>
  new Map<string, JavaScriptArtifactFile>(
    ["app/main.js", ...paths].map((path) => [
      path,
      {
        path,
        container_sha256: "a".repeat(64),
        sha256: "b".repeat(64),
        bytes: 0,
        inventory_artifact_id: `artifact-${path}`,
        kind: "javascript",
        unpacked: false,
        text: { included: true, value: "" },
      },
    ]),
  );

describe("prefix-only Node builtins", () => {
  it.each(["import", "require"] as const)(
    "resolves ordinary packages named test, sqlite and sea for %s",
    async (moduleKind) => {
      const root = await createTestTempDirectory("rea-prefix-only-builtins-");
      const names = ["test", "sqlite", "sea"];
      for (const name of [...names, "fs"]) {
        const directory = join(root, "node_modules", name);
        await mkdir(directory, { recursive: true });
        await writeFile(
          join(directory, "index.js"),
          `module.exports = ${JSON.stringify(name)};`,
        );
      }
      const main = join(
        root,
        moduleKind === "import" ? "main.mjs" : "main.cjs",
      );
      await writeFile(
        main,
        names
          .map((name, index) =>
            moduleKind === "import"
              ? `import value${index} from ${JSON.stringify(name)}; console.log(value${index});`
              : `console.log(require(${JSON.stringify(name)}));`,
          )
          .join("\n") +
          (moduleKind === "import"
            ? '\nimport "fs"; import "node:test";'
            : '\nrequire("fs"); require("node:test");'),
      );
      const native = await promisify(execFile)(process.execPath, [main], {
        timeout: 5_000,
      });
      expect(native.stdout.trim().split("\n").slice(0, 3)).toEqual(names);
      const result = await analyzeJavaScriptApplication({
        input_path: root,
        format: "directory",
      });
      if (!result.ok) throw result.error;
      const { graph } = javascriptApplicationAnalysisResultSchema.parse(
        result.value.normalized_result,
      );
      const imports = graph.edges.filter((edge) => edge.relation === "imports");
      for (const name of names) {
        const matches = imports.filter(
          (edge) => edge.properties.specifier === name,
        );
        expect(matches.length).toBeGreaterThan(0);
        for (const edge of matches)
          expect(edge.properties.resolved_path).toBe(
            `node_modules/${name}/index.js`,
          );
      }
      for (const name of ["fs", "node:test"]) {
        const matches = imports.filter(
          (edge) => edge.properties.specifier === name,
        );
        expect(matches.length).toBeGreaterThan(0);
        for (const edge of matches)
          expect(edge.properties.resolved_path).toBeNull();
      }
    },
  );
});

describe("module specifier punctuation", () => {
  it.each(["#", "?"])(
    "keeps CommonJS punctuation and strips URL suffixes for ESM (%s)",
    (punctuation) => {
      const literal = `app/dep.cjs${punctuation}literal.cjs`;
      const stripped = "app/dep.cjs";
      const commonJs = resolveStandaloneArtifactPath({
        declaredPath: `./dep.cjs${punctuation}literal.cjs`,
        sourcePath: "app/main.js",
        context: "module-specifier",
        files: filesFor([literal, stripped]),
        moduleKind: "require",
      });
      expect(commonJs).toMatchObject({
        resolution_status: "resolved",
        resolved_path: literal,
      });

      const esm = resolveStandaloneArtifactPath({
        declaredPath: `./dep.cjs${punctuation}literal.cjs`,
        sourcePath: "app/main.js",
        context: "module-specifier",
        files: filesFor([literal, stripped]),
        moduleKind: "import",
      });
      expect(esm).toMatchObject({
        resolution_status: "resolved",
        resolved_path: stripped,
      });

      const noStrippedTarget = resolveStandaloneArtifactPath({
        declaredPath: `./dep.cjs${punctuation}literal.cjs`,
        sourcePath: "app/main.js",
        context: "module-specifier",
        files: filesFor([literal]),
        moduleKind: "import",
      });
      expect(noStrippedTarget).toMatchObject({
        resolution_status: "not-found",
        resolved_path: null,
      });
    },
  );

  it.each(["#", "?"])(
    "keeps HTML URL suffix handling for %s",
    (punctuation) => {
      expect(
        resolveStandaloneArtifactPath({
          declaredPath: `./dep.cjs${punctuation}literal.cjs`,
          sourcePath: "app/main.js",
          context: "html-reference",
          files: filesFor([
            "app/dep.cjs",
            `app/dep.cjs${punctuation}literal.cjs`,
          ]),
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: "app/dep.cjs",
      });
    },
  );
});

describe("ESM module URL decoding", () => {
  it("resolves ESM URL paths to the files loaded by Node", async () => {
    const cases = [
      ["./plain.mjs", "plain.mjs", "static"],
      ["./space%20name.mjs", "space name.mjs", "static"],
      ["./pr%C3%A9load.mjs", "préload.mjs", "static"],
      ["./name%3F%23.mjs", "name?#.mjs", "static"],
      ["./percent%2520.mjs?cache=1#v2", "percent%20.mjs", "static"],
      ["./nested\\direct.mjs", "nested/direct.mjs", "static"],
      ["./unused\\..\\nested\\parent.mjs", "nested/parent.mjs", "dynamic"],
    ] as const;
    const root = await createTestTempDirectory("rea-module-url-");
    const main = join(root, "main.mjs");
    await mkdir(join(root, "nested"));
    await writeFile(
      main,
      cases
        .map(([specifier, , mode], index) =>
          mode === "dynamic"
            ? `const { default: value${index} } = await import(${JSON.stringify(specifier)}); console.log(value${index});`
            : `import value${index} from ${JSON.stringify(specifier)}; console.log(value${index});`,
        )
        .join("\n"),
    );
    for (const [specifier, target] of cases) {
      await writeFile(
        join(root, target),
        `export default ${JSON.stringify(target)};`,
      );
      const encoded = specifier.slice(2).split("?", 1)[0]?.split("#", 1)[0];
      if (
        encoded !== undefined &&
        encoded !== target &&
        (!encoded.includes("\\") || process.platform !== "win32")
      )
        await writeFile(join(root, encoded), 'export default "encoded decoy";');
    }
    const native = await promisify(execFile)(process.execPath, [main], {
      timeout: 5_000,
    });
    expect(native.stdout.trim().split("\n")).toEqual(
      cases.map(([, target]) => target),
    );

    const result = await analyzeJavaScriptApplication({
      input_path: root,
      format: "directory",
    });
    if (!result.ok) throw result.error;
    const { graph } = javascriptApplicationAnalysisResultSchema.parse(
      result.value.normalized_result,
    );
    for (const [specifier, target] of cases) {
      const imports = graph.edges.filter(
        (edge) =>
          edge.relation === "imports" &&
          edge.properties.specifier === specifier,
      );
      expect(imports.length).toBeGreaterThan(0);
      for (const edge of imports)
        expect(edge.properties.resolved_path).toBe(target);
    }

    const historical = await importReferenceSource({
      root,
      caller: "relative-module-separators-test",
      policy: { secretPatterns: [] },
    });
    if (!historical.ok) throw historical.error;
    for (const [, target] of cases)
      expect(historical.value.relationships).toContainEqual(
        expect.objectContaining({
          from_path: "main.mjs",
          to: target,
          kind: "imports",
          resolution: "internal",
        }),
      );
  });

  it("preserves CommonJS literal percent names", () => {
    expect(
      resolveStandaloneArtifactPath({
        declaredPath: "./space%20name.cjs",
        sourcePath: "app/main.js",
        context: "module-specifier",
        moduleKind: "require",
        files: filesFor(["app/space%20name.cjs", "app/space name.cjs"]),
      }),
    ).toMatchObject({
      resolved_path: "app/space%20name.cjs",
      resolution_status: "resolved",
    });
  });

  it.each(["./invalid%.mjs", "./invalid%C3.mjs", "./nul%00.mjs"])(
    "rejects malformed or NUL URL %s",
    (declaredPath) => {
      expect(
        resolveStandaloneArtifactPath({
          declaredPath,
          sourcePath: "app/main.js",
          context: "module-specifier",
          moduleKind: "import",
          files: filesFor([`app/${declaredPath.slice(2)}`]),
        }),
      ).toMatchObject({ resolved_path: null, resolution_status: "rejected" });
    },
  );
});

const packageEntryUrlCases = [
  ["exports", "./actual%20file.cjs", "actual file.cjs"],
  ["exports", "./actual.cjs?variant", "actual.cjs"],
  ["exports", "./actual.cjs#variant", "actual.cjs"],
  ["exports", "./actual%23file.cjs", "actual#file.cjs"],
  ["exports", "./actual%3Ffile.cjs", "actual?file.cjs"],
  ["exports", "./actual%252Ffile.cjs", "actual%2Ffile.cjs"],
  ["exports", "./actual.cjs", "actual.cjs"],
  ["main", "./actual%20file.cjs", "actual%20file.cjs"],
  ["main", "./actual?file.cjs", "actual?file.cjs"],
  ["main", "./actual#file.cjs", "actual#file.cjs"],
] as const;

it.each(["import", "require"] as const)(
  "matches Node %s across package exports and main path representations",
  async (moduleKind) => {
    const root = await createTestTempDirectory("rea-package-export-url-");
    for (const [
      index,
      [field, declaredPath, target],
    ] of packageEntryUrlCases.entries()) {
      const name = `fixture-${index}`;
      const packageRoot = join(root, "node_modules", name);
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        join(packageRoot, "package.json"),
        JSON.stringify({
          name,
          [field]: declaredPath,
        }),
      );
      await writeFile(
        join(packageRoot, target),
        `module.exports=${JSON.stringify(target)};`,
      );
      const literal = declaredPath.slice(2).split("?", 1)[0]?.split("#", 1)[0];
      if (literal !== undefined && literal !== target)
        await writeFile(
          join(packageRoot, literal),
          'module.exports="literal decoy";',
        );
    }
    const main = join(root, moduleKind === "import" ? "main.mjs" : "main.cjs");
    await writeFile(
      main,
      packageEntryUrlCases
        .map((_, index) =>
          moduleKind === "import"
            ? `import value${index} from "fixture-${index}"; console.log(value${index});`
            : `console.log(require("fixture-${index}"));`,
        )
        .join("\n"),
    );
    const native = await promisify(execFile)(process.execPath, [main], {
      timeout: 5_000,
    });
    expect(native.stdout.trim().split("\n")).toEqual(
      packageEntryUrlCases.map(([, , target]) => target),
    );
    const result = await analyzeJavaScriptApplication({
      input_path: root,
      format: "directory",
    });
    if (!result.ok) throw result.error;
    const { graph } = javascriptApplicationAnalysisResultSchema.parse(
      result.value.normalized_result,
    );
    for (const [
      index,
      [field, declaredPath, target],
    ] of packageEntryUrlCases.entries()) {
      const imports = graph.edges.filter(
        (edge) =>
          edge.relation === "imports" &&
          edge.properties.specifier === `fixture-${index}`,
      );
      expect(
        imports.length,
        `${moduleKind}: ${field} ${declaredPath}`,
      ).toBeGreaterThan(0);
      for (const edge of imports)
        expect(edge.properties.resolved_path).toBe(
          `node_modules/fixture-${index}/${target}`,
        );
    }
  },
);

describe("package exports URL path rejections", () => {
  it.each(
    (["import", "require"] as const).flatMap((moduleKind) =>
      [
        "./actual%file.cjs",
        "./actual%E0%A4file.cjs",
        "./actual%00file.cjs",
        "./actual%2Ffile.cjs",
        "./actual%5Cfile.cjs",
        "./../../../../escape.cjs",
      ].map((declaredPath) => ({ moduleKind, declaredPath })),
    ),
  )(
    "rejects $moduleKind URL $declaredPath without borrowing a literal decoy",
    ({ moduleKind, declaredPath }) => {
      const packagePath = "app/node_modules/fixture/package.json";
      const files = filesFor([
        packagePath,
        `app/node_modules/fixture/${declaredPath.slice(2)}`,
      ]);
      const metadata = files.get(packagePath);
      if (metadata === undefined) throw new Error("Missing fixture metadata");
      files.set(packagePath, {
        ...metadata,
        kind: "package-json",
        text: {
          included: true,
          value: JSON.stringify({ exports: declaredPath }),
        },
      });
      expect(
        resolveStandaloneArtifactPath({
          declaredPath: "fixture",
          sourcePath: "app/main.js",
          context: "module-specifier",
          moduleKind,
          files,
        }),
      ).toMatchObject({ resolved_path: null, resolution_status: "rejected" });
    },
  );

  it.each(["import", "require"] as const)(
    "keeps %s exports inside their inventoried container",
    (moduleKind) => {
      const packagePath = "app/node_modules/fixture/package.json";
      const target = "app/node_modules/fixture/actual file.cjs";
      const files = filesFor([packagePath, target]);
      const metadata = files.get(packagePath);
      const crossContainer = files.get(target);
      if (metadata === undefined || crossContainer === undefined)
        throw new Error("Missing fixture files");
      files.set(packagePath, {
        ...metadata,
        kind: "package-json",
        text: {
          included: true,
          value: '{"exports":"./actual%20file.cjs"}',
        },
      });
      files.set(target, {
        ...crossContainer,
        container_sha256: "c".repeat(64),
      });
      const resolveTarget = () =>
        resolveStandaloneArtifactPath({
          declaredPath: "fixture",
          sourcePath: "app/main.js",
          context: "module-specifier",
          moduleKind,
          files,
        });
      expect(resolveTarget()).toMatchObject({
        resolved_path: null,
        resolution_status: "unavailable",
        candidate_path: target,
        limitations: [
          expect.stringContaining("crosses an artifact container boundary"),
        ],
      });
      files.delete(target);
      expect(resolveTarget()).toMatchObject({
        resolved_path: null,
        resolution_status: "not-found",
      });
      files.set(target, crossContainer);
      expect(resolveTarget()).toMatchObject({
        resolved_path: target,
        resolution_status: "resolved",
      });
    },
  );
});
