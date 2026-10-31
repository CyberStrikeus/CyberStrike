import { expect, it } from "vitest";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import {
  javaScriptStaticParseStatus,
  unexaminedJavaScriptStaticCoverage,
} from "./javascriptStaticCoverage.js";
import { aliasSelectionBudgetSource } from "../../../tests/fixtures/javascriptAliasSelectionBudget.js";

it("separates dynamic semantic uncertainty from completed syntax and examination", () => {
  const result = analyzeJavaScriptStaticSource(
    "const {ipcMain}=require('electron'); ipcMain.on(channel, () => {});",
  );
  expect(result.parse_status).toBe("partial");
  expect(result.analysis_coverage).toMatchObject({
    syntax: { status: "complete", error_count: 0 },
    semantics: { unknown_findings: 1, uncertainty: ["dynamic-findings"] },
    examination: {
      status: "complete",
      semantic_resource_limits: [],
      electron_call_paths_limited: false,
    },
    applicability: { electron: "observed" },
  });
  expect(result.electron.ipc).toMatchObject([
    { channel: null, channel_expression: "channel" },
  ]);
});

it("distinguishes recovered syntax from unparseable source without inventing an error total", () => {
  const recovered = analyzeJavaScriptStaticSource("let value; let value;");
  expect(recovered.parse_status).toBe("partial");
  expect(recovered.analysis_coverage?.syntax).toEqual({
    status: "recovered",
    error_count: recovered.parse_error_count,
  });
  const failed = analyzeJavaScriptStaticSource("const value = ;");
  expect(failed.parse_status).toBe("failed");
  expect(failed.analysis_coverage).toMatchObject({
    syntax: { status: "failed", error_count: null },
    semantics: { unknown_findings: null },
    examination: { status: "not-examined" },
  });
});

it("keeps framework applicability unknown without positive Electron evidence", () => {
  const ordinary = analyzeJavaScriptStaticSource("export const value = 1;");
  expect(ordinary.parse_status).toBe("complete");
  expect(ordinary.analysis_coverage?.applicability.electron).toBe("unknown");
  const electron = analyzeJavaScriptStaticSource(
    "const {ipcMain}=require('electron');",
  );
  expect(electron.analysis_coverage?.applicability.electron).toBe("observed");
});

it("reports compiler-dependent module side effects independently of complete syntax", () => {
  const result = analyzeJavaScriptStaticSource(
    "import { type Config } from './config';",
  );
  expect(result.analysis_coverage?.syntax).toEqual({
    status: "complete",
    error_count: 0,
  });
  expect(result.analysis_coverage?.semantics.uncertainty).toContain(
    "type-only-module-side-effect",
  );
});

it("retains typed examination limits alongside successfully parsed source", () => {
  const result = analyzeJavaScriptStaticSource(aliasSelectionBudgetSource());
  expect(result.parse_status).toBe("partial");
  expect(result.analysis_coverage).toMatchObject({
    syntax: { status: "complete", error_count: 0 },
    examination: {
      status: "limited",
      semantic_resource_limits: ["alias-selections"],
    },
  });
});

it("preserves the legacy summary responsibility without relabeling independent limitations", () => {
  const base = analyzeJavaScriptStaticSource(
    "export const value = 1;",
  ).analysis_coverage!;
  expect(
    javaScriptStaticParseStatus({
      ...base,
      semantics: {
        unknown_findings: 0,
        uncertainty: ["returned-reference-widening"],
      },
      examination: {
        ...base.examination,
        status: "limited",
        electron_call_paths_limited: true,
      },
    }),
  ).toBe("complete");
  expect(
    unexaminedJavaScriptStaticCoverage("Caller selected another source."),
  ).toMatchObject({
    syntax: { status: "not-examined", error_count: null },
    semantics: { unknown_findings: null },
    examination: { status: "not-examined" },
    unexamined_reason: "Caller selected another source.",
  });
});
