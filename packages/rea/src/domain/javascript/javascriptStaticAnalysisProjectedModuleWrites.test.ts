import { Module } from "node:module";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const projectedModuleWrites = [
  [
    "object assignment",
    "let selected;({selected}={selected:module});selected.require=module.require;",
    true,
  ],
  [
    "object declaration",
    "const {selected}={selected:module};selected.require=module.require;",
    true,
  ],
  [
    "array assignment",
    "let selected;[selected]=[module];selected.require=module.require;",
    true,
  ],
  [
    "array declaration",
    "const [selected]=[module];selected.require=module.require;",
    true,
  ],
  [
    "nested assignment",
    "let selected;({nested:{selected}}={nested:{selected:module}});selected.require=module.require;",
    true,
  ],
  [
    "assignment fallback",
    "let selected;({selected=module}={});selected.require=module.require;",
    true,
  ],
  [
    "nested fallback",
    "let selected;({nested:{selected=module}}={nested:{}});selected.require=module.require;",
    true,
  ],
  [
    "object rest child",
    "let selected;({...selected}={loader:module});selected.loader.require=module.require;",
    true,
  ],
  [
    "array rest child",
    "let selected;[,...selected]=[0,module];selected[0].require=module.require;",
    true,
  ],
  [
    "captured alias",
    "let selected;({selected}={selected:module});const saved=selected;selected={};saved.require=module.require;",
    true,
  ],
  [
    "captured source container",
    "let source={selected:module};let selected;({selected}=source);source={selected:{}};selected.require=module.require;",
    true,
  ],
  [
    "projected escape",
    "let selected;({selected}={selected:module});expose(selected);",
    true,
  ],
  [
    "copied child escape",
    "let selected;({...selected}={loader:module});expose(selected.loader);",
    true,
  ],
  [
    "inactive fallback",
    "const {selected=module}={selected:{}};selected.require=module.require;",
    false,
  ],
  [
    "local alias",
    "let selected;({selected}={selected:{require(){}}});selected.require=module.require;",
    false,
  ],
  [
    "object rest container",
    "let selected;({...selected}=module);selected.require=module.require;",
    false,
  ],
  [
    "rebound alias",
    "let selected;({selected}={selected:module});selected={};selected.require=module.require;",
    false,
  ],
  [
    "rebound fallback",
    "let selected;({selected=module}={});selected={};selected.require=module.require;",
    false,
  ],
  [
    "copied container escape",
    "let selected;({...selected}=module);expose(selected);",
    false,
  ],
] as const;

it.each(projectedModuleWrites)(
  "tracks copied require after a projected module write: %s",
  (_name, setup, expected) => {
    const body = `${setup}const copy={...module};const load=copy.require;load.call(module,'node:path');`;
    const host = new Module("projected-module-write-oracle.cjs");
    const context = {
      module: host,
      expose: (value: Module) => {
        value.require = host.require;
      },
    };
    if (expected) expect(runInNewContext(body, context).join).toBe(path.join);
    else expect(() => runInNewContext(body, context)).toThrow();
    const result = analyzeJavaScriptStaticSource(body);
    expect(result.parse_error_count).toBe(0);
    expect(result.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it.each(["selected.require=module.require;", "expose(selected);"])(
  "captures copied require before a later projected module effect: %s",
  (effect) => {
    const body = `let selected;({selected}={selected:module});const copy={...module};${effect}const load=copy.require;load.call(module,'node:path');`;
    const host = new Module("late-module-effect.cjs");
    expect(() =>
      runInNewContext(body, {
        module: host,
        expose: (value: Module) => {
          value.require = host.require;
        },
      }),
    ).toThrow();
    expect(analyzeJavaScriptStaticSource(body).references).toEqual([]);
  },
);
