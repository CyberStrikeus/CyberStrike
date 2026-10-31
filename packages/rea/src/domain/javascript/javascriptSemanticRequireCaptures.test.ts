import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  ['const h={require:module.require};h.require("./shared.cjs");', true],
  [
    'const h={require:module.require};h.require.call(module,"./shared.cjs");',
    true,
  ],
  [
    'const h={require:module.require};h.require.apply(module,["./shared.cjs"]);',
    true,
  ],
  [
    'const h={inner:{require:module.require}};h.inner.require("./shared.cjs");',
    true,
  ],
  ['const h={require(){}};h.require("./shared.cjs");', false],
  ['const h={require(){}};h.require.call(module,"./shared.cjs");', false],
  [
    'const h={require:module.require};h.require=()=>{};h.require("./shared.cjs");',
    false,
  ],
  [
    'const h={require(){}};h.require=module.require;h.require("./shared.cjs");',
    true,
  ],
])(
  "follows the actual named delegate as well as its receiver: %s",
  (source, expected) => {
    expect(analyzeJavaScriptStaticSource(source).references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it.each([
  ['(0,module).require("./shared.cjs");', true],
  ['(module,{}).require("./shared.cjs");', false],
  ['const get=()=>module;(0,get()).require("./shared.cjs");', true],
  ['const loader=(0,module);loader.require("./shared.cjs");', true],
  ['const load=(0,module.require);load("./shared.cjs");', true],
  ['const load=(module.require,()=>{});load("./shared.cjs");', false],
])(
  "selects only the final sequence value as a loader: %s",
  (source, expected) => {
    const result = analyzeJavaScriptStaticSource(source);
    expect(result.parse_error_count).toBe(0);
    expect(result.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it.each([
  [
    'const old={loader:module};const middle={...old};old.loader={};const box={...middle};middle.loader={};box.loader.require("./x");',
    true,
  ],
  [
    'const old={loader:{}};const middle={...old};old.loader=module;const box={...middle};middle.loader=module;box.loader.require("./x");',
    false,
  ],
  [
    'const old={loader:module};const middle={...old};old.loader={};const {...box}=middle;middle.loader={};box.loader.require("./x");',
    true,
  ],
  [
    'const old={loader:{}};const middle={...old};old.loader=module;const {...box}=middle;middle.loader=module;box.loader.require("./x");',
    false,
  ],
  [
    'const inner={loader:{}};const box={inner};inner.loader=module;box.inner.loader.require("./x");',
    true,
  ],
  [
    'const inner={loader:module};const box={inner};inner.loader={};box.inner.loader.require("./x");',
    false,
  ],
  [
    'let inner={loader:module};const box={inner};inner={loader:{}};inner.loader={};box.inner.loader.require("./x");',
    true,
  ],
  [
    'let inner={loader:{}};const box={inner};inner={loader:{}};inner.loader=module;box.inner.loader.require("./x");',
    false,
  ],
  [
    'const old={loader:module};const box={...old};old.loader={};box.loader.require("./x");',
    true,
  ],
  [
    'const old={loader:{}};const box={...old};old.loader=module;box.loader.require("./x");',
    false,
  ],
  [
    'const old={child:{loader:module}};const box={...old};old.child={loader:{}};box.child.loader.require("./x");',
    true,
  ],
  [
    'const old={child:{loader:module}};const box={...old};old.child.loader={};box.child.loader.require("./x");',
    false,
  ],
  [
    'const old={child:{loader:{}}};const box={...old};old.child.loader=module;box.child.loader.require("./x");',
    true,
  ],
  [
    'const old={child:{loader:{}}};const box={...old};old.child={loader:module};old.child.loader=module;box.child.loader.require("./x");',
    false,
  ],
  [
    'const old=[module];const box=[...old];old[0]={};box[0].require("./x");',
    true,
  ],
  [
    'const old=[{}];const box=[...old];old[0]=module;box[0].require("./x");',
    false,
  ],
  [
    'const old={loader:module};const {...box}=old;old.loader={};box.loader.require("./x");',
    true,
  ],
  [
    'const old={loader:{}};const {...box}=old;old.loader=module;box.loader.require("./x");',
    false,
  ],
  [
    'const old=[module];const [...box]=old;old[0]={};box[0].require("./x");',
    true,
  ],
  [
    'const old=[{}];const [...box]=old;old[0]=module;box[0].require("./x");',
    false,
  ],
])(
  "keeps module receiver capture and later member selection separate: %s",
  (source, expected) => {
    const result = analyzeJavaScriptStaticSource(source);
    expect(
      result.references
        .filter(({ kind }) => kind === "require")
        .map(({ specifier }) => specifier),
    ).toEqual(expected ? [null] : []);
  },
);
