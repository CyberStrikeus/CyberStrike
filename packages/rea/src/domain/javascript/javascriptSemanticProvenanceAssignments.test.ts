import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const provenance = (source: string, name: string) => {
  const result = analyzeJavaScriptSemantics(source);
  const binding = result.bindings.find((candidate) => candidate.name === name);
  if (binding === undefined) throw new Error(`Missing binding ${name}`);
  return binding.provenance;
};

it.each([
  "let api;({api}={api:require('node:fs')});",
  "let api;[api]=[require('node:fs')];",
  "let api;({api}={api:{readFileSync(){}}});",
  "let api={};({api}={api:require('node:fs')});",
  "let api;if(flag)({api}={api:require('node:fs')});",
])("keeps projected replacement provenance unresolved: %s", (source) => {
  expect(provenance(source, "api")).toMatchObject({
    status: "unknown",
    origins: [],
  });
});

it.each([
  "let api=require('node:fs');({api}={api:{}});",
  "let api=require('node:fs');if(flag)({api}={api:{}});",
  "let api=require('node:fs');[api]=[{}];",
])(
  "retains possible earlier module origins without proving them current: %s",
  (source) => {
    expect(provenance(source, "api")).toMatchObject({
      status: "ambiguous",
      origins: [{ specifier: "node:fs", importedPath: [] }],
    });
  },
);

it.each([
  ["let api=require('node:fs');const saved=api;({api}={api:{}});", "module"],
  ["let api=require('node:fs');({api}={api:{}});const saved=api;", "unknown"],
  [
    "let api=require('node:fs');if(flag)({api}={api:{}});const saved=api;",
    "ambiguous",
  ],
])("selects provenance at the alias capture: %s", (source, status) => {
  expect(provenance(source, "saved").status).toBe(status);
  if (status === "module")
    expect(provenance(source, "saved").origins).toEqual([
      { specifier: "node:fs", importedPath: [], resolutionMode: "require" },
    ]);
});

it.each([
  ["const {api=fallback}={};", "local"],
  ["const {...api}=require('node:fs');", "local"],
  ["const api=require('node:fs');", "module"],
])(
  "preserves declaration and ordinary initializer policy: %s",
  (source, status) => {
    expect(provenance(source, "api").status).toBe(status);
  },
);

it("retains an uncertain sqlite candidate instead of asserting a local constructor", () => {
  const source =
    "let Database;({Database}={Database:require('better-sqlite3')});new Database('x.db');";
  expect(provenance(source, "Database").status).toBe("unknown");
  expect(analyzeJavaScriptStaticSource(source).storage).toEqual([
    expect.objectContaining({
      kind: "sqlite",
      interpretation: "candidate",
      name: "x.db",
    }),
  ]);
});

it("preserves captured Electron origin and rejects certainty after replacement", () => {
  const source =
    "let electron=require('electron');const saved=electron;({electron}={electron:{}});const later=electron;";
  expect(provenance(source, "saved")).toMatchObject({
    status: "module",
    origins: [{ specifier: "electron" }],
  });
  expect(provenance(source, "later").status).toBe("unknown");
});
