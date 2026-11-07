import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import {
  findSourceModule,
  writeFixtureFiles,
} from "../../support/javascriptApplicationFixture.js";

const writes = [
  {
    name: "object pattern",
    source: "({require}={require:()=>({BrowserWindow:LocalBrowserWindow})});",
  },
  {
    name: "array pattern",
    source: "[require]=[()=>({BrowserWindow:LocalBrowserWindow})];",
  },
] as const;

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    writes.flatMap((write) =>
      ([false, true] as const).map((capturedBeforeWrite) => ({
        surface,
        ...write,
        capturedBeforeWrite,
      })),
    ),
  ),
)(
  "preserves Electron capture ownership through $surface after $name with capturedBeforeWrite=$capturedBeforeWrite",
  async ({ surface, source, capturedBeforeWrite }, { cli }) => {
    const root = await createTestTempDirectory("rea-wrapper-electron-capture-");
    const capture = 'const {BrowserWindow}=require("electron");';
    await writeFixtureFiles(root, {
      "package.json": JSON.stringify({ main: "main.cjs" }),
      "main.cjs": [
        'throw new Error("Static fixture must never execute");',
        "class LocalBrowserWindow{}",
        "var require;",
        ...(capturedBeforeWrite ? [capture, source] : [source, capture]),
        'new BrowserWindow({webPreferences:{preload:"./bridge.cjs"}});',
      ].join("\n"),
      "bridge.cjs": 'throw new Error("Preload fixture must never execute");',
    });
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const expectedRoles = capturedBeforeWrite ? 1 : 0;
    expect(result.summary).toMatchObject({
      browser_windows: expectedRoles,
      preload_entrypoints: expectedRoles,
    });
    const { graph } = result;
    const windows = graph.nodes.filter(({ kind }) => kind === "browser-window");
    expect(windows).toHaveLength(expectedRoles);
    // Preload roles share the BrowserWindow identity owner.
    expect(
      graph.nodes.filter(
        ({ kind, observations }) =>
          kind === "electron-preload" &&
          observations.some(
            ({ properties }) =>
              properties.mechanism === "BrowserWindow:webPreferences.preload",
          ),
      ),
    ).toHaveLength(expectedRoles);
    expect(
      graph.nodes.filter(({ kind }) => kind === "electron-preload"),
    ).toHaveLength(expectedRoles);
    const main = findSourceModule(graph, "main.cjs");
    expect(main).toBeDefined();
    const imports = graph.edges.filter(
      ({ relation, source_node_id }) =>
        relation === "imports" && source_node_id === main?.node_id,
    );
    expect(
      imports.some(({ properties }) => properties.specifier === "electron"),
    ).toBe(capturedBeforeWrite);
    expect(
      imports.some(({ properties }) => properties.specifier === null),
    ).toBe(!capturedBeforeWrite);
    const preloads = graph.edges.filter(
      ({ evidence }) =>
        evidence.extractor.operation === "associate-browser-window-preload",
    );
    if (capturedBeforeWrite)
      expect(preloads).toMatchObject([
        {
          relation: "loads",
          source_node_id: windows[0]?.node_id,
          properties: {
            declared_path: "./bridge.cjs",
            resolved_path: "bridge.cjs",
            resolution_status: "resolved",
          },
        },
      ]);
    else expect(preloads).toEqual([]);
  },
);
