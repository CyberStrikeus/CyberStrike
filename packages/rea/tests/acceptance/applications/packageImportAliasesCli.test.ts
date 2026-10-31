import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

const literalAliases = ["#/x", "#x%2Fy", "#x%2Ey", "#x\\y", "#x\0y"];
const fallbackAliases = {
  "#tab-escape": ["./.\t./outside.cjs", "./config.cjs"],
  "#newline-escape": ["./.%\n2e/outside.cjs", "./config.cjs"],
  "#normalized-url": "./con\tfig.cjs",
  "#trimmed-url": "./config.cjs \t",
  "#url-suffix": "./config.cjs?selected=one#fragment",
  "#inactive-array": {
    node: [{ browser: "./browser.cjs" }],
    default: "./config.cjs",
  },
  "#nested-inactive-array": {
    node: [[{ browser: "./browser.cjs" }]],
    default: "./config.cjs",
  },
  "#parent": ["../outside.cjs", "./config.cjs"],
  "#absolute": { node: [["/outside.cjs"], "./config.cjs"] },
  "#url": {
    import: ["https://example.invalid/outside.cjs", "./config.cjs"],
    require: ["file:///outside.cjs", "./config.cjs"],
  },
};
const resolvedAliases = [...literalAliases, ...Object.keys(fallbackAliases)];
const refusedAliases = {
  "#empty": {
    target: [],
    status: "external",
    limitation: "an empty imports target array",
  },
  "#empty-active": {
    target: { node: [] },
    status: "external",
    limitation: "an empty imports target array",
  },
  "#null-last": {
    target: [[], null],
    status: "external",
    limitation: "an explicit null imports target",
  },
  "#empty-last": {
    target: [null, []],
    status: "external",
    limitation: "an empty imports target array",
  },
  "#inactive": {
    target: [{ browser: "./browser.cjs" }],
    status: "external",
    limitation: "it declares browser.",
  },
  "#nested-inactive": {
    status: "external",
    target: [
      [{ browser: "./browser.cjs" }, { "rea-inactive": "./inactive.cjs" }],
    ],
    limitation: "it declares browser, rea-inactive.",
  },
  "#escape": {
    target: "./.\t./outside.cjs",
    status: "rejected",
    limitation: "escapes the package root",
  },
  "#encoded-separator": {
    target: ["./con%2ffig.cjs", "./config.cjs"],
    status: "rejected",
    limitation: "separator bytes",
  },
  "#missing-url": {
    target: ["./miss\ting.cjs", "./config.cjs"],
    status: "not-found",
    limitation: JSON.stringify("./miss\ting.cjs"),
  },
};
const allAliases = [...resolvedAliases, ...Object.keys(refusedAliases)];

const createPackageImportAliasFixture = async () => {
  const root = await createTestTempDirectory("rea-package-import-aliases-");
  const mainSource = [
    'const config = require("#config");',
    'const nested = require("./node_modules/fixture/index.cjs");',
    'const missing = require("#missing");',
    ...allAliases.map((specifier) => `require(${JSON.stringify(specifier)});`),
  ].join("\n");
  const moduleSource = allAliases
    .map((specifier) => `import ${JSON.stringify(specifier)};`)
    .join("\n");
  const nestedSource = [
    'const config = require("#config");',
    "module.exports = config;",
  ].join("\n");
  const files = {
    "package.json": JSON.stringify({
      name: "app",
      imports: {
        "#config": "./config.cjs",
        ...Object.fromEntries(
          literalAliases.map((specifier) => [specifier, "./config.cjs"]),
        ),
        ...fallbackAliases,
        ...Object.fromEntries(
          Object.entries(refusedAliases).map(([specifier, { target }]) => [
            specifier,
            target,
          ]),
        ),
      },
    }),
    "main.cjs": mainSource,
    "main.mjs": moduleSource,
    "config.cjs": "module.exports = 'app-config';",
    "node_modules/fixture/package.json": JSON.stringify({
      name: "fixture",
      imports: { "#config": "./local.cjs" },
    }),
    "node_modules/fixture/index.cjs": nestedSource,
    "node_modules/fixture/local.cjs": "module.exports = 'fixture-config';",
  };
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const absolute = join(root, path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content);
    }),
  );
  return { root, mainSource, moduleSource, nestedSource };
};

cliTest.for(["CLI", "stdio MCP"] as const)(
  "resolves exact package import aliases with package scope through %s",
  async (surface, { cli }) => {
    const { root, mainSource, moduleSource, nestedSource } =
      await createPackageImportAliasFixture();
    const nativeRequire = createRequire(join(root, "main.cjs"));
    expect(
      relative(root, nativeRequire.resolve("#config")).replaceAll("\\", "/"),
    ).toBe("config.cjs");
    expect(
      relative(
        root,
        createRequire(join(root, "node_modules/fixture/index.cjs")).resolve(
          "#config",
        ),
      ).replaceAll("\\", "/"),
    ).toBe("node_modules/fixture/local.cjs");
    expect(() => nativeRequire.resolve("#missing")).toThrow(
      expect.objectContaining({ code: "ERR_PACKAGE_IMPORT_NOT_DEFINED" }),
    );

    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const specifier of resolvedAliases)
      for (const [moduleKind, sourcePath, source] of [
        ["require", "main.cjs", mainSource],
        ["import", "main.mjs", moduleSource],
      ] as const)
        expect(graph.edges).toContainEqual(
          expect.objectContaining({
            properties: expect.objectContaining({
              module_link_kind: moduleKind,
              specifier,
              resolved_path: "config.cjs",
              resolution_status: "resolved",
            }),
            evidence: sourceEvidence(sourcePath, source),
          }),
        );
    const imports = graph.edges.filter(
      ({ properties }) => properties.module_link_kind === "require",
    );
    for (const [specifier, { status, limitation }] of Object.entries(
      refusedAliases,
    ))
      for (const [moduleKind, sourcePath, source] of [
        ["require", "main.cjs", mainSource],
        ["import", "main.mjs", moduleSource],
      ] as const)
        expect(graph.edges).toContainEqual(
          expect.objectContaining({
            properties: expect.objectContaining({
              module_link_kind: moduleKind,
              specifier,
              resolved_path: null,
              resolution_status: status,
            }),
            evidence: sourceEvidence(
              sourcePath,
              source,
              specifier === "#encoded-separator" && moduleKind === "import"
                ? "percent-encoded slash or backslash bytes"
                : limitation,
            ),
          }),
        );
    expect(imports).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          specifier: "#config",
          resolved_path: "config.cjs",
          resolution_status: "resolved",
        }),
        evidence: sourceEvidence("main.cjs", mainSource),
      }),
    );
    expect(imports).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          specifier: "#config",
          resolved_path: "node_modules/fixture/local.cjs",
          resolution_status: "resolved",
        }),
        evidence: sourceEvidence(
          "node_modules/fixture/index.cjs",
          nestedSource,
        ),
      }),
    );
    expect(imports).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          specifier: "#missing",
          resolved_path: null,
          resolution_status: "external",
        }),
        evidence: expect.objectContaining({
          limitations: expect.arrayContaining([
            expect.stringContaining("does not define package import alias"),
          ]),
        }),
      }),
    );
  },
);

const sourceEvidence = (
  sourcePath: string,
  source: string,
  limitation?: string,
): unknown =>
  expect.objectContaining({
    artifact: expect.objectContaining({
      available: true,
      sha256: createHash("sha256").update(source).digest("hex"),
    }),
    location: expect.objectContaining({
      available: true,
      value: expect.objectContaining({
        kind: "source-range",
        source: sourcePath,
      }),
    }),
    ...(limitation === undefined
      ? {}
      : {
          limitations: expect.arrayContaining([
            expect.stringContaining(limitation),
          ]),
        }),
  });
