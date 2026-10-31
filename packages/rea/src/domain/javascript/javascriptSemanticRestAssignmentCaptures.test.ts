import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { topLevelBinding } from "./javascriptSemanticAnalysis.fixture.js";

it.each([
  [
    "let box;const old={loader:module};({...box}=old);old.loader={};box.loader",
    true,
  ],
  [
    "let box;const old={loader:{}};({...box}=old);old.loader=module;box.loader",
    false,
  ],
  [
    "const holder={};const old={loader:module};({...holder.box}=old);old.loader={};holder.box.loader",
    true,
  ],
  [
    "const holder={};const old={loader:{}};({...holder.box}=old);old.loader=module;holder.box.loader",
    false,
  ],
  ["let box;const old=[module];([...box]=old);old[0]={};box[0]", true],
  ["let box;const old=[{}];([...box]=old);old[0]=module;box[0]", false],
  [
    "const holder={};const old=[module];([...holder.box]=old);old[0]={};holder.box[0]",
    true,
  ],
  [
    "const holder={};const old=[{}];([...holder.box]=old);old[0]=module;holder.box[0]",
    false,
  ],
  [
    "let box;const old={make:()=>module};({...box}=old);old.make=()=>({});box.make()",
    true,
  ],
  [
    "let box;const old={make:()=>({})};({...box}=old);old.make=()=>module;box.make()",
    false,
  ],
  [
    "const holder={};const old={make:()=>module};({...holder.box}=old);old.make=()=>({});holder.box.make()",
    true,
  ],
  [
    "const holder={};const old={make:()=>({})};({...holder.box}=old);old.make=()=>module;holder.box.make()",
    false,
  ],
  [
    "let box;const old=[()=>module];([...box]=old);old[0]=()=>({});box[0]()",
    true,
  ],
  [
    "let box;const old=[()=>({})];([...box]=old);old[0]=()=>module;box[0]()",
    false,
  ],
  [
    "const holder={};const old=[()=>module];([...holder.box]=old);old[0]=()=>({});holder.box[0]()",
    true,
  ],
  [
    "const holder={};const old=[()=>({})];([...holder.box]=old);old[0]=()=>module;holder.box[0]()",
    false,
  ],
  [
    "let box;const old={child:{loader:module}};({child:{...box}}=old);old.child={loader:{}};box.loader",
    true,
  ],
  [
    "const holder={};const old={child:[module]};({child:[...holder.box]}=old);old.child=[{}];holder.box[0]",
    true,
  ],
  [
    "const holder={};const old={child:{loader:module}};({...holder.box}=old);old.child.loader={};holder.box.child.loader",
    false,
  ],
  ["let make=()=>module;({make}={make:()=>({})});make()", false],
  ["let make;({make=()=>module}={});make()", true],
  ["let make;({make=()=>module}={make:()=>({})});make()", false],
  ["let make=()=>module;if(flag)({make}={make:()=>({})});make()", true],
  [
    "let make=()=>module;const saved=make;({make}={make:()=>({})});saved()",
    true,
  ],
])(
  "retains assigned rest-copy slots at their capture: %s",
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

it.each(["[value]=['new']", "({key:value}={key:'new'})"])(
  "preserves whole-binding and read-value ambiguity after %s",
  (assignment) => {
    const result = analyzeJavaScriptSemantics(
      `let value='old';${assignment};const observed=value;`,
    );
    expect(topLevelBinding(result, "value").value.status).toBe("ambiguous");
    expect(topLevelBinding(result, "observed").value.status).toBe("ambiguous");
  },
);
