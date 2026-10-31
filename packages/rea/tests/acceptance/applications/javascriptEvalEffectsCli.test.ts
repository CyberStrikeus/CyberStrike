import { expect } from "vitest";
import { cliTest } from "../../support/cli/cliFixture.js";
import { verifyJavaScriptReturnShapes } from "../../fixtures/javascriptReturnShapes.js";

cliTest(
  "retains eval uncertainty through CLI and stdio MCP return projections",
  async ({ cli }) => {
    await verifyJavaScriptReturnShapes(
      cli,
      `
 export function direct() { let value=1; eval("value=2"); return {result:value}; }
 export function member() { const value={n:1}; eval("value.n=2"); return {result:value.n}; }
 export function alias() { const value={n:1}; const copied=value; eval("value.n=2"); return {result:copied.n}; }
 export function shadowedAlias() { const value={n:1};const copied=value; {const value=0;eval("copied.n=2");} return {result:value.n}; }
 export function nested() { let value=1; change(); return {result:value}; function change(){eval("value=2");} }
 export function indirect() { let value=1; (0,eval)("value=2"); return {result:value}; }
 export function optional() { let value=1; eval?.("value=2"); return {result:value}; }
 export function captured() { let value=1; const saved=value; eval("value=2"); return {result:saved}; }
 export function unrelated() { let value=1; return {result:value}; }
 `,
      (fields) => {
        for (const name of [
          "direct",
          "member",
          "alias",
          "nested",
          "shadowedAlias",
        ])
          expect(fields(name)).toContainEqual(
            expect.objectContaining({
              path: "/result",
              state: "unknown",
              value: null,
            }),
          );
        for (const name of ["indirect", "optional", "captured", "unrelated"])
          expect(fields(name)).toContainEqual(
            expect.objectContaining({
              path: "/result",
              state: "literal",
              value: 1,
            }),
          );
      },
      "app.mjs",
    );
  },
);
