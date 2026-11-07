import { expect } from "vitest";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";

cliTest(
  "retains constant window preferences and inferred source provenance through CLI, MCP and fact views",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-window-options-");
    await writeFixtureFiles(root, {
      "main.js": [
        'throw new Error("Static input must never execute");',
        'const { BrowserWindow } = require("electron");',
        "function open() {",
        '  const prefs = {nodeIntegration: true, contextIsolation: false, preload: "./preload.js"};',
        "  const options = {webPreferences: prefs};",
        '  if (linux) options.icon = "icon.png";',
        "  new BrowserWindow(options);",
        "  const escaped = {webPreferences: {sandbox: true}};",
        "  patch(escaped); new BrowserWindow(escaped);",
        "  new BrowserWindow({webPreferences: {sandbox: true}});",
        "}",
      ].join("\n"),
      "preload.js": "// Inert preload source",
    });
    const cliResponse = await cli.run({
      arguments: ["analyze-javascript-application", root, "--format", "json"],
    });
    expect(cliResponse.exitCode, JSON.stringify(cliResponse.json)).toBe(0);
    const cliResult = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(cliResponse.json).normalized_result,
    );
    const { call } = await connectLocalToolsMcp();
    const response = await call("analyze_javascript_application", {
      input_path: root,
      format: "directory",
    });
    expect(response.isError).not.toBe(true);
    const parent = parseEvidence(response.structuredContent);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parent.normalized_result,
    );
    expect(result.graph).toEqual(cliResult.graph);
    expect(result.summary).toEqual(cliResult.summary);
    expect(result.summary).toMatchObject({
      browser_windows: 3,
      explicit_web_preferences: 4,
      preload_entrypoints: 1,
    });
    const windows = result.graph.nodes.filter(
      (node) => node.kind === "browser-window",
    );
    const resolved = windows.find(
      (node) =>
        node.observations[0]?.properties.resolution_sources !== undefined,
    );
    expect(resolved?.observations[0]).toMatchObject({
      properties: {
        source_path: "main.js",
        options_status: "object-literal",
        web_preferences: expect.arrayContaining([
          {
            name: "nodeIntegration",
            value: { status: "literal", value: true, expression: null },
          },
          {
            name: "contextIsolation",
            value: { status: "literal", value: false, expression: null },
          },
          {
            name: "preload",
            value: {
              status: "literal",
              value: "./preload.js",
              expression: null,
            },
          },
        ]),
        resolution_sources: [
          { source: "main.js", start: { line: 5 } },
          { source: "main.js", start: { line: 4 } },
        ],
      },
      evidence: {
        state: "inferred",
        authority: "static-relationship-inference",
        location: { value: { source: "main.js", start: { line: 7 } } },
      },
    });
    expect(
      windows.filter(
        (node) =>
          node.observations[0]?.properties.web_preferences_status === "dynamic",
      ),
    ).toHaveLength(1);
    expect(
      windows.filter(
        (node) => node.observations[0]?.evidence.state === "observed",
      ),
    ).toHaveLength(2);
    const viewResponse = await call("inspect_analysis_view", {
      source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
      view: {
        kind: "javascript-facts",
        where: { paths: ["main.js"], kinds: ["browser-window"] },
        property_keys: ["web_preferences", "resolution_sources"],
      },
    });
    expect(viewResponse.isError).not.toBe(true);
    const view = analysisViewResultSchema.parse(
      parseEvidence(viewResponse.structuredContent).normalized_result,
    );
    if (view.kind !== "javascript-facts") throw new Error("Expected fact view");
    expect(view.rows).toHaveLength(3);
    const row = view.rows.find((row) => row.node_id === resolved?.node_id);
    expect(row?.evidence).toEqual(resolved?.observations[0]?.evidence);
    expect(row?.properties).toEqual({
      web_preferences: resolved?.observations[0]?.properties.web_preferences,
      resolution_sources:
        resolved?.observations[0]?.properties.resolution_sources,
    });
  },
);
