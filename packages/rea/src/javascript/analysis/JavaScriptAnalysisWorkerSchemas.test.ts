import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "../../domain/javascript/javascriptStaticAnalysis.js";
import {
  javaScriptWorkerModuleHeaderSchema,
  javaScriptWorkerModuleRecordSchema,
  javaScriptWorkerStaticAnalysisSchema,
} from "./JavaScriptAnalysisWorkerSchemas.js";
import { analyzeJavaScriptSemantics } from "../../domain/javascript/javascriptSemanticAnalysis.js";
import { getterExpansionSource } from "../../../tests/fixtures/javascriptGetterExpansion.js";
import { aliasSelectionBudgetSource } from "../../../tests/fixtures/javascriptAliasSelectionBudget.js";

it("preserves independent static coverage and historical unmeasured facts", () => {
  const facts = analyzeJavaScriptStaticSource("require(moduleName);");
  expect(
    javaScriptWorkerStaticAnalysisSchema.parse(
      JSON.parse(JSON.stringify(facts)),
    ),
  ).toEqual(facts);
  const { analysis_coverage: _coverage, ...historical } = facts;
  expect(javaScriptWorkerStaticAnalysisSchema.parse(historical)).toEqual(
    historical,
  );
  expect(
    javaScriptWorkerStaticAnalysisSchema.safeParse({
      ...facts,
      analysis_coverage: {
        ...facts.analysis_coverage,
        syntax: { status: "complete", error_count: -1 },
      },
    }).success,
  ).toBe(false);
});

it("transfers bounded alias selection coverage across the worker boundary", () => {
  const source = aliasSelectionBudgetSource();
  const facts = analyzeJavaScriptStaticSource(source);
  const ir = analyzeJavaScriptSemantics(source);
  const header = { coverage: ir.coverage, limitations: ir.limitations };
  expect(ir.coverage).toMatchObject({
    status: "partial",
    resourceLimits: ["alias-selections"],
  });
  expect(
    javaScriptWorkerModuleHeaderSchema.parse(
      JSON.parse(JSON.stringify(header)) as unknown,
    ),
  ).toEqual(header);
  expect(
    javaScriptWorkerStaticAnalysisSchema.parse(
      JSON.parse(JSON.stringify(facts)) as unknown,
    ),
  ).toEqual(facts);
});

it("retains application path change identity and provenance across the worker boundary", () => {
  const facts = analyzeJavaScriptStaticSource(`
    const { app } = require("electron");
    app.setAppPath("./other");
  `);
  expect(facts.electron.app_path_changes).toHaveLength(1);
  expect(
    javaScriptWorkerStaticAnalysisSchema.parse(
      JSON.parse(JSON.stringify(facts)) as unknown,
    ),
  ).toEqual(facts);
});

it("transfers getter expansion limits and unknown bindings across the worker boundary", () => {
  const ir = analyzeJavaScriptSemantics(getterExpansionSource());
  const header = { coverage: ir.coverage, limitations: ir.limitations };
  expect(
    javaScriptWorkerModuleHeaderSchema.parse(
      JSON.parse(JSON.stringify(header)) as unknown,
    ),
  ).toEqual(header);
  for (const value of ir.bindings) {
    const record = { kind: "binding", value };
    expect(
      javaScriptWorkerModuleRecordSchema.parse(
        JSON.parse(JSON.stringify(record)) as unknown,
      ),
    ).toEqual(record);
  }
  expect(ir.coverage.resourceLimits).toEqual(["getter-expansion"]);
});

it("retains candidate endpoint interpretation across the worker boundary", () => {
  const facts = analyzeJavaScriptStaticSource(`
    client.get("settingKey");
    fetch("/api");
  `);
  expect(facts.endpoints).toEqual([
    expect.objectContaining({
      value: "settingKey",
      interpretation: "candidate",
    }),
    expect.objectContaining({ value: "/api" }),
  ]);
  expect(facts.endpoints[1]).not.toHaveProperty("interpretation");
  const serialized = JSON.parse(JSON.stringify(facts)) as unknown;
  expect(javaScriptWorkerStaticAnalysisSchema.parse(serialized)).toEqual(facts);
  expect(
    javaScriptWorkerStaticAnalysisSchema.safeParse({
      ...facts,
      endpoints: facts.endpoints.map((endpoint) => ({
        ...endpoint,
        interpretation: "confirmed",
      })),
    }).success,
  ).toBe(false);
});

it.each(["babel-ast-v1", "babel-ast-v2"])(
  "versions fingerprints through the worker schema and rejects %s",
  (oldAlgorithm) => {
    const facts =
      analyzeJavaScriptStaticSource(`globalThis.webpackChunkApp.push([[1], {
    17(module, exports) { const key = selectKey(); exports.read = value[key]; }
  }]);`);
    expect(facts.bundler_registrations[0]?.modules[0]).toMatchObject({
      structural_fingerprint_algorithm: "babel-ast-v3",
      structural_fingerprint_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(
      javaScriptWorkerStaticAnalysisSchema.safeParse(
        JSON.parse(JSON.stringify(facts)) as unknown,
      ).success,
    ).toBe(true);
    const old = {
      ...facts,
      bundler_registrations: facts.bundler_registrations.map(
        (registration) => ({
          ...registration,
          modules: registration.modules.map((module) => ({
            ...module,
            structural_fingerprint_algorithm: oldAlgorithm,
          })),
        }),
      ),
    };
    expect(javaScriptWorkerStaticAnalysisSchema.safeParse(old).success).toBe(
      false,
    );
  },
);

it("accepts candidate endpoint interpretations from static analysis", () => {
  const facts = analyzeJavaScriptStaticSource(`http.request("POST", target);`);
  expect(facts.endpoints).toContainEqual(
    expect.objectContaining({
      kind: "network",
      value: "POST",
      interpretation: "candidate",
    }),
  );
  expect(
    javaScriptWorkerStaticAnalysisSchema.safeParse(
      JSON.parse(JSON.stringify(facts)) as unknown,
    ).success,
  ).toBe(true);
});

it("preserves partial request targets through the strict worker schema", () => {
  const facts = analyzeJavaScriptStaticSource("fetch(endpointUrl);");
  expect(facts.endpoints).toContainEqual(
    expect.objectContaining({
      kind: "network",
      value: "endpointUrl",
      resolution: "partial",
    }),
  );
  const serialized = JSON.parse(JSON.stringify(facts)) as unknown;
  expect(javaScriptWorkerStaticAnalysisSchema.parse(serialized)).toEqual(facts);
});

it("preserves scoped IPC receiver provenance and rejects malformed scope metadata", () => {
  const facts =
    analyzeJavaScriptStaticSource(`const {BrowserWindow} = require("electron");
    const window = new BrowserWindow(); window.webContents.mainFrame.ipc.handle("scoped", () => {});`);
  expect(facts.electron.ipc).toHaveLength(1);
  expect(facts.electron.ipc[0]?.receiver?.kind).toBe("main-frame");
  expect(
    javaScriptWorkerStaticAnalysisSchema.parse(
      JSON.parse(JSON.stringify(facts)) as unknown,
    ),
  ).toEqual(facts);
  const finding = facts.electron.ipc[0]!;
  for (const receiver of [
    { kind: "global", owner_location: finding.receiver?.owner_location },
    { kind: "main-frame" },
    { ...finding.receiver, runtime_frame_id: 42 },
  ]) {
    expect(
      javaScriptWorkerStaticAnalysisSchema.safeParse({
        ...facts,
        electron: {
          ...facts.electron,
          ipc: [{ ...finding, receiver }],
        },
      }).success,
    ).toBe(false);
  }
});
