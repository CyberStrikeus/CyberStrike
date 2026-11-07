import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";

import { expect, it } from "vitest";

import { reconstructJavaScriptArtifact } from "../../support/javascriptApplicationScope.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const cases: readonly {
  name: string;
  html: string;
  files: Readonly<Record<string, string>>;
  expected: readonly string[];
}[] = [
  {
    name: "extension fallback",
    html: '<script src="./app"></script>',
    files: { "app.js": "globalThis.owned = true;" },
    expected: [],
  },
  {
    name: "directory index",
    html: '<script src="./app"></script>',
    files: { "app/index.js": "globalThis.owned = true;" },
    expected: [],
  },
  {
    name: "directory package",
    html: '<script src="./app"></script>',
    files: {
      "app/package.json": '{"main":"entry.js"}',
      "app/entry.js": "globalThis.owned = true;",
    },
    expected: [],
  },
  {
    name: "base directory",
    html: '<base href="assets/"><script src="./app"></script>',
    files: { "assets/app.js": "globalThis.owned = true;" },
    expected: [],
  },
  {
    name: "exact base resource",
    html: '<base href="assets/"><script src="./app.js?cache=1#v2"></script>',
    files: {
      "assets/app.js": "globalThis.owned = true;",
      "app.js": "globalThis.decoy = true;",
    },
    expected: ["assets/app.js"],
  },
  {
    name: "exact script resource",
    html: '<script src="./app.js?cache=1#v2"></script>',
    files: { "app.js": "globalThis.owned = true;" },
    expected: ["app.js"],
  },
  {
    name: "percent-encoded script letters",
    html: '<script src="%61pp.js"></script>',
    files: { "app.js": "globalThis.owned = true;" },
    expected: ["app.js"],
  },
  {
    name: "script URL surrounded by whitespace",
    html: '<script src=" app.js "></script>',
    files: { "app.js": "globalThis.owned = true;" },
    expected: ["app.js"],
  },
  {
    name: "percent-encoded base directory",
    html: '<base href="%61ssets/"><script src="app.js"></script>',
    files: { "assets/app.js": "globalThis.owned = true;" },
    expected: ["assets/app.js"],
  },
];

it.each(cases)(
  "uses exact HTML resource identity for $name",
  async ({ html, files, expected }) => {
    const root = await createTestTempDirectory("rea-html-resources-");
    await Promise.all(
      Object.entries({ ...files, "index.html": html }).map(
        async ([path, text]) => {
          await mkdir(dirname(join(root, path)), { recursive: true });
          await writeFile(join(root, path), text);
        },
      ),
    );
    const result = await reconstructJavaScriptArtifact({ input_path: root });
    const loads = result.graph.edges.filter(
      ({ relation, properties }) =>
        relation === "loads" && properties.script_path !== undefined,
    );
    expect(loads.map(({ properties }) => properties.resolved_path)).toEqual(
      expected,
    );
    if (expected.length === 0) {
      const reference = result.graph.nodes
        .flatMap(({ observations }) => observations)
        .find(
          ({ properties }) => properties.mechanism === "html-script-reference",
        );
      expect(reference).toMatchObject({
        properties: {
          script_path: "./app",
          resolution_context: "html-reference",
          resolution_status: "not-found",
          resolved_path: null,
        },
        evidence: {
          authority: "static-relationship-inference",
          location: {
            available: true,
            value: { kind: "source-range", source: "index.html" },
          },
          limitations: expect.arrayContaining([
            expect.stringContaining("exact HTML resource"),
          ]),
        },
      });
    }
  },
);

it("retains CommonJS extension resolution against Node", async () => {
  const root = await createTestTempDirectory("rea-html-node-control-");
  await Promise.all([
    writeFile(
      join(root, "main.cjs"),
      'const value = require("./app"); module.exports = value;',
    ),
    writeFile(join(root, "app.js"), 'module.exports = "actual";'),
  ]);
  const expected = relative(
    root,
    createRequire(join(root, "main.cjs")).resolve("./app"),
  )
    .split(sep)
    .join("/");
  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const edge = result.graph.edges.find(
    ({ properties }) =>
      properties.module_link_kind === "require" &&
      properties.specifier === "./app",
  );
  expect(edge?.properties).toMatchObject({
    resolution_status: "resolved",
    resolved_path: expected,
  });
});
