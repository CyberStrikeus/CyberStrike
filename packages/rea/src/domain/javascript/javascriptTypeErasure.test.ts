import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it("keeps declared exports as source type links without runtime values", () => {
  const ir = analyzeJavaScriptSemantics(`
    export declare const token: number;
    export declare class Shape {}
    export default interface DefaultShape {}
  `);
  expect(ir.coverage.status).not.toBe("failed");
  expect(ir.moduleLinks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "type-import",
        localName: "token",
        exportedName: "token",
      }),
      expect.objectContaining({
        kind: "type-import",
        localName: "Shape",
        exportedName: "Shape",
      }),
      expect.objectContaining({
        kind: "type-import",
        exportedName: "default",
      }),
    ]),
  );
  expect(ir.moduleLinks.filter(({ kind }) => kind === "export")).toEqual([]);
});

it("retains computed keys and decorators only when declared or abstract fields are decorated", () => {
  const ir = analyzeJavaScriptSemantics(`
    const key = Symbol();
    function dec(...args: unknown[]) {}
    class Declared {
      declare [key]: string;
    }
    abstract class AbstractShape {
      abstract [key]: string;
    }
    class DecoratedDeclared {
      @dec declare [key]: string;
    }
    abstract class DecoratedAbstract {
      @dec abstract [key]: string;
    }
  `);
  expect(ir.coverage.status).not.toBe("failed");
  expect(ir.references.filter(({ name }) => name === "key")).toHaveLength(2);
  expect(ir.references.filter(({ name }) => name === "dec")).toHaveLength(2);
});

it("does not promote a type literal to a route candidate beside a runtime route", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    createBrowserRouter([{ path: "/admin", Component: Admin }]);
    type Ghost = "/admin/ghost";
  `);
  expect(analysis.routes?.candidates.map(({ path }) => path)).toEqual([
    "/admin",
  ]);
});
