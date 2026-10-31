import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  defaultTreeAdapter,
  parse,
  type DefaultTreeAdapterTypes,
} from "parse5";
import { expect, it } from "vitest";

import { reconstructJavaScriptArtifact } from "../../support/javascriptApplicationScope.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const cases = [
  ['<script data-src="decoy.js"></script>', []],
  ['<script x:src="decoy.js"></script>', []],
  [`<script title='src="decoy.js"'></script>`, []],
  ["<script src=actual.js></script>", ["actual.js"]],
  ['<script title=">" src="actual.js"></script>', ["actual.js"]],
  ['<script src="actual.js"></script>', ["actual.js"]],
  ["<script src='actual.js'></script>", ["actual.js"]],
  ['<script data-src="decoy.js" src="actual.js"></script>', ["actual.js"]],
  ['<!-- <script src="decoy.js"></script> -->', []],
  ['<textarea><script src="decoy.js"></script></textarea>', []],
  ['<template><script src="decoy.js"></script></template>', []],
  ['<script src="actual&#46;js" src="decoy.js"></script>', ["actual.js"]],
] as const;

it.each(cases)(
  "projects local loads from actual HTML attributes in %s",
  async (html, expected) => {
    const root = await createTestTempDirectory("rea-html-entrypoints-");
    await Promise.all([
      writeFile(join(root, "index.html"), html),
      writeFile(join(root, "actual.js"), "globalThis.ownedActual = true;"),
      writeFile(join(root, "decoy.js"), "globalThis.ownedDecoy = true;"),
    ]);
    const result = await reconstructJavaScriptArtifact({ input_path: root });
    const loads = result.graph.edges.filter(
      ({ relation, properties }) =>
        relation === "loads" && properties.script_path !== undefined,
    );
    expect(loads.map(({ properties }) => properties.resolved_path)).toEqual(
      expected,
    );
  },
);

it("preserves source digest, opening-tag range and decoded local base resolution", async () => {
  const root = await createTestTempDirectory("rea-html-entrypoint-evidence-");
  const opening = '<script title=">" src="actual&#46;js">';
  const prefix = '<base data-href="decoy/"><base href=assets/>\n';
  const html = `${prefix}${opening}</script>`;
  await mkdir(join(root, "assets"));
  await Promise.all([
    writeFile(join(root, "index.html"), html),
    writeFile(
      join(root, "assets", "actual.js"),
      "globalThis.ownedActual = true;",
    ),
  ]);
  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const loads = result.graph.edges.filter(
    ({ relation, properties }) =>
      relation === "loads" && properties.script_path !== undefined,
  );
  expect(loads).toHaveLength(1);
  expect(loads[0]).toMatchObject({
    properties: {
      script_path: "actual.js",
      base_href: "assets/",
      resolved_path: "assets/actual.js",
    },
    evidence: {
      authority: "static-relationship-inference",
      artifact: {
        available: true,
        sha256: createHash("sha256").update(html).digest("hex"),
      },
      location: {
        available: true,
        value: {
          kind: "source-range",
          source: "index.html",
          start: { line: 2, column: 0 },
          end: { line: 2, column: opening.length },
        },
      },
    },
  });
});

const coordinateCases = [
  { name: "LF", prefix: "before\n", opening: '<script src="actual.js">' },
  { name: "CRLF", prefix: "before\r\n", opening: '<script src="actual.js">' },
  { name: "bare CR", prefix: "before\r", opening: '<script src="actual.js">' },
  {
    name: "mixed CRLF and CR",
    prefix: "before\r\nafter\r",
    opening: '<script src="actual.js">',
  },
  {
    name: "CR inside opening tag",
    prefix: "before\n",
    opening: '<script\r src="actual.js">',
  },
  {
    name: "CRLF inside opening tag",
    prefix: "before\n",
    opening: '<script\r\n src="actual.js">',
  },
  {
    name: "astral UTF-16 columns",
    prefix: "😀",
    opening: '<script src="actual.js">',
  },
  {
    name: "U+2028 literal text",
    prefix: "before\u2028",
    opening: '<script src="actual.js">',
  },
] as const;

it.each(coordinateCases)(
  "retains parse5 source coordinates for resolved and unresolved scripts with $name",
  async ({ prefix, opening }) => {
    const root = await createTestTempDirectory("rea-html-coordinate-evidence-");
    const html = `${prefix}${opening}</script><script src="missing.js"></script>`;
    const expected = htmlScriptRanges(html);
    expect(expected).toHaveLength(2);
    await Promise.all([
      writeFile(join(root, "index.html"), html),
      writeFile(join(root, "actual.js"), "export const actual = true;"),
    ]);
    const result = await reconstructJavaScriptArtifact({ input_path: root });
    const resolved = result.graph.edges.filter(
      ({ relation, properties }) =>
        relation === "loads" && properties.script_path === "actual.js",
    );
    const unresolved = result.graph.nodes
      .flatMap(({ observations }) => observations)
      .filter(
        ({ properties }) =>
          properties.mechanism === "html-script-reference" &&
          properties.script_path === "missing.js",
      );
    expect(resolved).toHaveLength(1);
    expect(unresolved).toHaveLength(1);
    for (const [index, observation] of [resolved[0], unresolved[0]].entries()) {
      expect(observation).toMatchObject({
        evidence: {
          artifact: {
            available: true,
            sha256: createHash("sha256").update(html).digest("hex"),
          },
          location: {
            available: true,
            value: {
              kind: "source-range",
              source: "index.html",
              ...expected[index],
            },
          },
        },
      });
    }
  },
);

const htmlScriptRanges = (html: string) => {
  const pending: DefaultTreeAdapterTypes.Node[] = [
    parse(html, { sourceCodeLocationInfo: true }),
  ];
  const ranges = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    if (defaultTreeAdapter.isElementNode(node) && node.tagName === "script") {
      const location = node.sourceCodeLocation?.startTag;
      if (location === undefined)
        throw new Error("Missing parse5 script range");
      ranges.push({
        start: { line: location.startLine, column: location.startCol - 1 },
        end: { line: location.endLine, column: location.endCol - 1 },
      });
    }
    if ("childNodes" in node) {
      for (const child of node.childNodes.toReversed()) pending.push(child);
    }
  }
  return ranges;
};

it("reports unanalyzed inline HTML scripts instead of claiming complete coverage", async () => {
  const root = await createTestTempDirectory("rea-html-inline-scripts-");
  const html = [
    "<!doctype html><html><head>",
    '<script src="cordova.js"></script>',
    '<script type="application/ld+json">{"@type":"Thing"}</script>',
    "</head><body>",
    "<script>",
    'function startGame(){ fetch("https://api.example.test/score"); }',
    "</script>",
    '<script type="module">import { x } from "./mod.js"; console.log(x);</script>',
    "</body></html>",
  ].join("\n");
  await mkdir(join(root, "www"));
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "game", version: "1.0.0" }),
    ),
    writeFile(join(root, "www", "index.html"), html),
    writeFile(join(root, "www", "cordova.js"), "globalThis.cordova = {};"),
  ]);

  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const gaps = result.graph.nodes.filter(
    ({ kind, observations }) =>
      kind === "unknown" &&
      observations.some(
        ({ properties }) =>
          properties.operation === "parse-html-inline-scripts",
      ),
  );

  expect(result.graph.coverage.status).toBe("partial");
  expect(gaps).toHaveLength(1);
  expect(gaps[0]?.observations[0]).toMatchObject({
    properties: {
      path: "www/index.html",
      inline_script_count: 2,
      inline_scripts: [
        {
          script_type: "classic",
          location: {
            start: { line: 5, column: 8 },
            end: { line: 7, column: 0 },
          },
        },
        {
          script_type: "module",
          location: {
            start: { line: 8, column: 22 },
            end: { line: 8, column: 67 },
          },
        },
      ],
    },
    evidence: {
      state: "unavailable",
      artifact: {
        sha256: createHash("sha256").update(html).digest("hex"),
      },
      coverage: { status: "partial" },
    },
  });
  expect(result.graph.limitations).toContain(
    "www/index.html has 2 inline JavaScript bodies starting at lines 5, 8 that were not analyzed; endpoints, storage, imports and other facts in them are absent from the evidence.",
  );
  // The external script is still projected as before.
  expect(
    result.graph.edges.some(
      ({ relation, properties }) =>
        relation === "loads" && properties.resolved_path === "www/cordova.js",
    ),
  ).toBe(true);
});

it("keeps complete coverage when HTML has only external scripts and data blocks", async () => {
  const root = await createTestTempDirectory("rea-html-no-inline-scripts-");
  await Promise.all([
    writeFile(
      join(root, "index.html"),
      '<script src="actual.js"></script><script type="importmap">{"imports":{}}</script><script>  </script>',
    ),
    writeFile(join(root, "actual.js"), "globalThis.ownedActual = true;"),
  ]);

  const result = await reconstructJavaScriptArtifact({ input_path: root });

  expect(result.graph.coverage.status).toBe("complete");
  expect(
    result.graph.limitations.some((limitation) =>
      limitation.includes("inline JavaScript"),
    ),
  ).toBe(false);
});

it.each(coordinateCases)(
  "retains parse5 source coordinates for inline script bodies with $name",
  async ({ prefix }) => {
    const root = await createTestTempDirectory("rea-html-inline-coordinates-");
    const html = `${prefix}<script>\r\nrun();\rnext();\n</script>`;
    await writeFile(join(root, "index.html"), html);

    const result = await reconstructJavaScriptArtifact({ input_path: root });
    const gap = result.graph.nodes
      .flatMap(({ observations }) => observations)
      .find(
        ({ properties }) =>
          properties.operation === "parse-html-inline-scripts",
      );

    expect(gap?.properties.inline_scripts).toEqual([
      { script_type: "classic", location: inlineBodyRange(html) },
    ]);
  },
);

const inlineBodyRange = (html: string) => {
  const pending: DefaultTreeAdapterTypes.Node[] = [
    parse(html, { sourceCodeLocationInfo: true }),
  ];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    if (defaultTreeAdapter.isElementNode(node) && node.tagName === "script") {
      const opening = node.sourceCodeLocation?.startTag;
      const body = node.childNodes[0]?.sourceCodeLocation;
      if (opening === undefined || body === undefined || body === null)
        throw new Error("Missing parse5 inline script range");
      return {
        start: { line: opening.endLine, column: opening.endCol - 1 },
        end: { line: body.endLine, column: body.endCol - 1 },
      };
    }
    if ("childNodes" in node) {
      for (const child of node.childNodes.toReversed()) pending.push(child);
    }
  }
  throw new Error("Missing parse5 inline script");
};

it("bounds retained inline script locations and names the omitted remainder", async () => {
  const root = await createTestTempDirectory("rea-html-many-inline-scripts-");
  const count = 5_000;
  await writeFile(
    join(root, "index.html"),
    "<script>run();</script>\n".repeat(count),
  );

  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const gap = result.graph.nodes
    .flatMap(({ observations }) => observations)
    .find(
      ({ properties }) => properties.operation === "parse-html-inline-scripts",
    );
  const limit = {
    name: "html_inline_script_locations_per_file",
    value: 100,
    unit: "items",
  };

  expect(gap?.properties.inline_script_count).toBe(count);
  expect(gap?.properties.inline_scripts).toHaveLength(100);
  // The gap record knows exactly which locations the bound dropped.
  expect(gap?.evidence.coverage).toEqual({
    status: "partial",
    truncated: true,
    omitted_count: count - 100,
    limits: [limit],
  });
  // The graph is truncated too, but unanalyzed bodies hide an unknown total.
  expect(result.graph.coverage).toMatchObject({
    status: "partial",
    truncated: true,
    omitted_count: null,
    limits: expect.arrayContaining([limit]),
  });
  expect(result.graph.limitations).toContain(
    `index.html has ${String(count)} inline JavaScript bodies starting at lines 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and ${String(count - 10)} more that were not analyzed; endpoints, storage, imports and other facts in them are absent from the evidence.`,
  );
});
