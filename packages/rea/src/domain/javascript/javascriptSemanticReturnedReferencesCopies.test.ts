import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  [
    "const old={child:{make:()=>module}};const box={...old};old.child={make:()=>({})};box.child.make()",
    true,
  ],
  [
    "const old={child:{make:()=>module}};const box={...old};old.child.make=()=>({});box.child.make()",
    false,
  ],
  [
    "const old={child:{make:()=>({})}};const box={...old};old.child.make=()=>module;box.child.make()",
    true,
  ],
  [
    "const old={child:{make:()=>({})}};const box={...old};old.child={make:()=>module};old.child.make=()=>module;box.child.make()",
    false,
  ],
  [
    "const old={child:{make:()=>module}};const {...box}=old;old.child={make:()=>({})};box.child.make()",
    true,
  ],
  [
    "const old={child:{make:()=>module}};const {...box}=old;old.child.make=()=>({});box.child.make()",
    false,
  ],
  [
    "let old={child:{make:()=>module}};const {...box}=old;old={child:{make:()=>({})}};box.child.make()",
    true,
  ],
  [
    "const old=[{make:()=>module}];const box=[...old];old[0]={make:()=>({})};box[0].make()",
    true,
  ],
  [
    "const old=[{make:()=>module}];const box=[...old];old[0].make=()=>({});box[0].make()",
    false,
  ],
  [
    "const old=[{make:()=>module}];const [...box]=old;old[0]={make:()=>({})};box[0].make()",
    true,
  ],
  [
    "const old=[{}, {make:()=>module}];const [skip,...box]=old;old[1]={make:()=>({})};box[0].make()",
    true,
  ],
  [
    "const old=[{}, {make:()=>module}];const [skip,...box]=old;old[1].make=()=>({});box[0].make()",
    false,
  ],
  [
    "const old={make:()=>module};const middle={...old};old.make=()=>({});const box={...middle};middle.make=()=>({});box.make()",
    true,
  ],
  [
    "const old={make:()=>({})};const middle={...old};old.make=()=>module;const box={...middle};middle.make=()=>module;box.make()",
    false,
  ],
  [
    "const old={child:{make:()=>module}};const middle={...old};old.child={make:()=>({})};const box={...middle};box.child.make()",
    true,
  ],
  [
    "const old={make:()=>module};const middle={...old};old.make=()=>({});const {...box}=middle;box.make()",
    true,
  ],
])(
  "preserves copied child identity and later writes through it: %s",
  (receiver, expected) => {
    const result = analyzeJavaScriptStaticSource(
      `${receiver}.require('./shared.cjs');`,
    );
    expect(result.parse_error_count).toBe(0);
    expect(result.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);
