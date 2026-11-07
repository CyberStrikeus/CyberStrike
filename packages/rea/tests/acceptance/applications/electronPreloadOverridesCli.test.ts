import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const FIRST = 'preload: "./first.js"';
const LAST = 'preload: "./last.js"';
const scenarios = [
  {
    preferences: `${FIRST}, preload: runtimePath`,
    preloadPath: null,
    overrideExpression: "runtimePath",
  },
  {
    preferences: `${FIRST}, ...runtimeOptions`,
    preloadPath: null,
    overrideExpression: "runtimeOptions",
  },
  {
    preferences: `${FIRST}, [runtimeKey]: runtimeValue`,
    preloadPath: null,
    overrideExpression: "[runtimeKey]: runtimeValue",
  },
  {
    preferences: `${FIRST}, get preload() { return runtimePath; }`,
    preloadPath: null,
    overrideExpression: "get preload() { return runtimePath; }",
  },
  {
    preferences: `${FIRST}, preload() { return runtimePath; }`,
    preloadPath: null,
    overrideExpression: "preload() { return runtimePath; }",
  },
  { preferences: `${FIRST}, preload: false`, preloadPath: null },
  {
    preferences: `preload: runtimePath, ${FIRST}`,
    preloadPath: "./first.js",
  },
  { preferences: `...runtimeOptions, ${FIRST}`, preloadPath: "./first.js" },
  {
    preferences: `[runtimeKey]: runtimeValue, ${FIRST}`,
    preloadPath: "./first.js",
  },
  { preferences: `${FIRST}, ${LAST}`, preloadPath: "./last.js" },
  {
    preferences: `${FIRST}, ["preload"]: "./last.js"`,
    preloadPath: "./last.js",
  },
  {
    preferences: `${FIRST}, ["sandbox"]: true, "": runtimeValue`,
    preloadPath: "./first.js",
  },
] as const;

cliTest.for(["CLI", "stdio MCP"] as const)(
  "reports effective preload overrides through %s without executing source",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-preload-overrides-");
    const sourceLines = scenarios.map(
      ({ preferences }) =>
        `new BrowserWindow({webPreferences:{${preferences}}});`,
    );
    await Promise.all([
      writeFile(
        join(root, "main.js"),
        `${sourceLines.join("\n")}\nimport { BrowserWindow } from "electron";\n`,
      ),
      writeFile(join(root, "first.js"), 'throw new Error("inert preload");\n'),
      writeFile(join(root, "last.js"), 'throw new Error("inert preload");\n'),
    ]);

    let document: unknown;
    if (surface === "CLI") {
      const response = await cli.run({
        arguments: ["analyze-javascript-application", root, "--format", "json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode, response.stderr).toBe(0);
      document = response.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const response = await call("analyze_javascript_application", {
        input_path: root,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      document = response.structuredContent;
    }
    const { graph } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(document).normalized_result;
    const windows = graph.nodes.filter(({ kind }) => kind === "browser-window");
    expect(windows).toHaveLength(scenarios.length);

    for (const [index, scenario] of scenarios.entries()) {
      const window = windows.find((node) => {
        const location = node.observations[0]?.evidence.location;
        return (
          location?.available &&
          location.value.kind === "source-range" &&
          location.value.start.line === index + 1
        );
      });
      const observation = window?.observations[0];
      expect.soft(observation, scenario.preferences).toMatchObject({
        properties: {
          web_preferences_status: "object-literal",
          preload_path: scenario.preloadPath,
          preload_resolution_context:
            scenario.preloadPath === null ? null : "module-specifier",
          web_preferences: expect.arrayContaining([
            {
              name: "preload",
              value: {
                status: "literal",
                value: "./first.js",
                expression: null,
              },
            },
          ]),
        },
        evidence: {
          state: "observed",
          location: {
            available: true,
            value: {
              kind: "source-range",
              source: "main.js",
              start: { line: index + 1, column: 0 },
              end: {
                line: index + 1,
                column: (sourceLines[index]?.length ?? 0) - 1,
              },
            },
          },
        },
      });
      if ("overrideExpression" in scenario)
        expect.soft(observation?.properties.web_preferences).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              value: {
                status: "dynamic",
                value: null,
                expression: scenario.overrideExpression,
              },
            }),
          ]),
        );
      const associations = graph.edges.filter(
        (edge) =>
          edge.source_node_id === window?.node_id &&
          edge.evidence.extractor.operation ===
            "associate-browser-window-preload",
      );
      if (scenario.preloadPath === null) {
        expect.soft(associations, scenario.preferences).toEqual([]);
      } else {
        expect.soft(associations, scenario.preferences).toMatchObject([
          {
            relation: "loads",
            properties: {
              declared_path: scenario.preloadPath,
              resolved_path: scenario.preloadPath.slice(2),
              resolution_status: "resolved",
            },
          },
        ]);
      }
    }
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves asserted inline options and unresolved overrides through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-asserted-window-options-");
    const scenarios = [
      {
        sourceLine:
          'new BrowserWindow(({webPreferences:{preload:"./first.js",sandbox:true}} as const));',
        expectedPreload: "./first.js",
        preferencesStatus: "object-literal",
      },
      {
        sourceLine:
          'new BrowserWindow({webPreferences:({preload:"./first.js",sandbox:true} as const)});',
        expectedPreload: "./first.js",
        preferencesStatus: "object-literal",
      },
      {
        sourceLine:
          'new BrowserWindow({webPreferences:{preload:"./first.js" as const,sandbox:true}});',
        expectedPreload: "./first.js",
        preferencesStatus: "object-literal",
      },
      {
        sourceLine:
          "new BrowserWindow(({webPreferences:getPreferences()} as const));",
        expectedPreload: null,
        preferencesStatus: "dynamic",
      },
      {
        sourceLine:
          'new BrowserWindow(({webPreferences:{preload:"./first.js",...runtimeOptions}} as const));',
        expectedPreload: null,
        preferencesStatus: "object-literal",
      },
    ] as const;
    const sourceLines = scenarios.map(({ sourceLine }) => sourceLine);
    await Promise.all([
      writeFile(
        join(root, "main.ts"),
        `import { BrowserWindow } from "electron";\n${sourceLines.join("\n")}\n`,
      ),
      writeFile(join(root, "first.js"), 'throw new Error("inert preload");\n'),
    ]);

    let document: unknown;
    if (surface === "CLI") {
      const response = await cli.run({
        arguments: ["analyze-javascript-application", root, "--format", "json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode, response.stderr).toBe(0);
      document = response.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const response = await call("analyze_javascript_application", {
        input_path: root,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      document = response.structuredContent;
    }
    const { graph } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(document).normalized_result;
    const windows = graph.nodes.filter(({ kind }) => kind === "browser-window");
    expect(windows).toHaveLength(sourceLines.length);

    for (const [index, scenario] of scenarios.entries()) {
      const { sourceLine } = scenario;
      const window = windows.find((node) => {
        const location = node.observations[0]?.evidence.location;
        return (
          location?.available &&
          location.value.kind === "source-range" &&
          location.value.start.line === index + 2
        );
      });
      const observation = window?.observations[0];
      const known = scenario.expectedPreload !== null;
      expect.soft(observation, sourceLine).toMatchObject({
        properties: {
          options_status: "object-literal",
          web_preferences_status: scenario.preferencesStatus,
          preload_path: scenario.expectedPreload,
          preload_resolution_context: known ? "module-specifier" : null,
        },
        evidence: {
          state: "observed",
          location: {
            available: true,
            value: {
              kind: "source-range",
              source: "main.ts",
              start: { line: index + 2, column: 0 },
              end: { line: index + 2, column: sourceLine.length - 1 },
            },
          },
        },
      });
      const associations = graph.edges.filter(
        (edge) =>
          edge.source_node_id === window?.node_id &&
          edge.evidence.extractor.operation ===
            "associate-browser-window-preload",
      );
      if (known) {
        expect.soft(associations, sourceLine).toMatchObject([
          {
            relation: "loads",
            properties: {
              declared_path: "./first.js",
              resolved_path: "first.js",
            },
          },
        ]);
      } else {
        expect.soft(associations, sourceLine).toEqual([]);
      }
    }
  },
);
