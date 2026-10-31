import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "../../../src/domain/javascript/javascriptStaticAnalysis.js";

it.each(
  (["call", "apply"] as const).flatMap((method) =>
    (["unmodified", "mutated", "shadowed"] as const).map((authority) => ({
      method,
      authority,
    })),
  ),
)(
  "preserves native $method authority when Function is $authority",
  ({ method, authority }) => {
    const setup =
      "import {createRequire as make} from 'node:module';const load=make(import.meta.url);";
    const mutation =
      authority === "unmodified"
        ? ""
        : `${authority === "shadowed" ? "const Function={prototype:{}};" : ""}Function.prototype.${method}=()=>({kind:'local'});`;
    const invocation = `load.${method}(null,${method === "call" ? "'node:path'" : "['node:path']"})`;
    const observed = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `${setup}const original=globalThis.Function.prototype.${method};${mutation}let out;try{out=${invocation};}finally{globalThis.Function.prototype.${method}=original;}console.log(JSON.stringify({native:typeof out.join==='function',local:out.kind==='local'}));`,
      ],
      { encoding: "utf8", timeout: 5_000 },
    );
    // Native createRequire and Function.prototype belong to the same child
    // realm; injecting a host function into a VM would test another prototype.
    expect(JSON.parse(observed) as unknown).toEqual({
      native: authority !== "mutated",
      local: authority === "mutated",
    });
    const analysis = analyzeJavaScriptStaticSource(
      `${setup}${mutation}${invocation};`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(
      analysis.references.filter(({ kind }) => kind === "require"),
    ).toEqual([
      expect.objectContaining({
        specifier: authority === "mutated" ? null : "node:path",
      }),
    ]);
  },
);
