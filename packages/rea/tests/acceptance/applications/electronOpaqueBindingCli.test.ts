import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains only the pre-eval Electron window through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-electron-opaque-binding-");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ main: "main.cjs" }),
    );
    const source = [
      '(()=>{var m={45840:e=>{e.exports=require("electron")},100:(e,t,n)=>{',
      '"use strict";let s=n(45840);',
      "new s.BrowserWindow({webPreferences:{nodeIntegration:true}});",
      'eval("s={BrowserWindow:class{}}");',
      "new s.BrowserWindow({webPreferences:{nodeIntegration:false}});",
      "}},c={};function n(t){var r=c[t];if(void 0!==r)return r.exports;var o=c[t]={exports:{}};",
      "return m[t](o,o.exports,n),o.exports}n(100)})();",
      'throw new Error("must not execute fixture");',
    ].join("\n");
    await writeFile(join(root, "main.cjs"), source);
    let document: unknown;
    if (surface === "CLI") {
      const response = await cli.run({
        arguments: [
          "analyze-javascript-application",
          root,
          "--json",
          "--max-heap-mb",
          "128",
          "--analysis-timeout-ms",
          "10000",
        ],
      });
      expect(response.exitCode, response.stderr).toBe(0);
      document = response.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const response = await call("analyze_javascript_application", {
        input_path: root,
        max_heap_mb: 128,
        analysis_timeout_ms: 10000,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      document = response.structuredContent;
    }
    const result = z
      .object({
        normalized_result: javascriptApplicationAnalysisResultSchema,
      })
      .parse(document).normalized_result;
    expect(result.summary.browser_windows).toBe(1);
    expect(result.statistics.parse_failures).toBe(0);
    expect(result.statistics.parsed_javascript_files).toBe(1);
    const windows = result.graph.nodes.filter(
      ({ kind }) => kind === "browser-window",
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]?.observations[0]?.evidence.location).toMatchObject({
      available: true,
      value: { kind: "source-range", source: "main.cjs", start: { line: 3 } },
    });
  },
);
