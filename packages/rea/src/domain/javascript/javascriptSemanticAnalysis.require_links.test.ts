import { describe, expect, it } from "vitest";

import {
  analyzeJavaScriptSemantics,
  analyzeParsedJavaScriptSemantics,
} from "./javascriptSemanticAnalysis.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { moduleResolutionModeForJavaScriptReference } from "./javascriptModuleResolutionMode.js";
import {
  origin,
  topLevelBinding,
} from "./javascriptSemanticAnalysis.fixture.js";

describe("TypeScript import-equals links", () => {
  it("retains runtime external import-equals as a require dependency", () => {
    const links = analyzeJavaScriptSemantics(`
      import dependency = require("./dependency.cjs");
      import type types = require("./types");
      import alias = Namespace.Dependency;
    `).moduleLinks;

    expect(links).toEqual([
      expect.objectContaining({
        kind: "require",
        specifier: "./dependency.cjs",
        importedName: null,
        localName: "dependency",
        exportedName: null,
      }),
      expect.objectContaining({
        kind: "type-import",
        specifier: "./types",
        localName: "types",
      }),
    ]);
  });

  it("keeps the exported binding for exported import-equals", () => {
    const source = 'export import dependency = require("./dependency");';
    const links = analyzeJavaScriptSemantics(source).moduleLinks;

    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "require",
          specifier: "./dependency",
          localName: "dependency",
          exportedName: null,
        }),
        expect.objectContaining({
          kind: "export",
          specifier: null,
          localName: "dependency",
          exportedName: "dependency",
        }),
      ]),
    );
    expect(
      links.find(({ kind }) => kind === "require")?.location.start,
    ).toEqual({ line: 1, column: 7 });
  });
});

describe("CommonJS wrapper parameter redeclarations", () => {
  it("does not infer a CommonJS wrapper from resolution mode in an explicit module", () => {
    const path = "app/main.mjs";
    const parsed = parseJavaScriptSource(
      'var require; require("./dependency.cjs");',
      path,
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.program.sourceType).toBe("module");
    const ir = analyzeParsedJavaScriptSemantics(
      parsed!,
      moduleResolutionModeForJavaScriptReference(path, "static-import"),
    );
    expect(ir.moduleLinks).not.toContainEqual(
      expect.objectContaining({ specifier: "./dependency.cjs" }),
    );
  });

  it("retains ambient exports and require through uninitialized top-level vars", () => {
    const path = "app/main.cjs";
    const parsed = parseJavaScriptSource(
      'var module, exports, require; module.exports = require("./dependency.cjs");',
      path,
    );
    expect(parsed).not.toBeNull();
    const ir = analyzeParsedJavaScriptSemantics(
      parsed!,
      moduleResolutionModeForJavaScriptReference(path, "static-import"),
    );
    expect(ir.moduleLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "commonjs-export",
          specifier: "./dependency.cjs",
          localName: null,
          exportedName: "default",
        }),
      ]),
    );
  });

  it("retains the Node loader call on an uninitialized wrapper var assignment RHS", () => {
    const path = "app/main.cjs";
    const parsed = parseJavaScriptSource(
      'var require; require = require("./bootstrap.cjs");',
      path,
    );
    expect(parsed).not.toBeNull();
    const ir = analyzeParsedJavaScriptSemantics(
      parsed!,
      moduleResolutionModeForJavaScriptReference(path, "static-import"),
    );
    expect(ir.moduleLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "require",
          specifier: "./bootstrap.cjs",
        }),
      ]),
    );
  });

  it.each([
    'var require = local; require("./dependency.cjs");',
    'var require; require = replacement; require("./dependency.cjs");',
    "var module; module = replacement; module.exports = 1;",
    "var exports; exports = replacement; exports.value = 1;",
    'let require; require("./dependency.cjs");',
    'function nested() { var require; require("./dependency.cjs"); }',
  ])("keeps non-wrapper declarations as shadows: %s", (source) => {
    const path = "app/main.cjs";
    const parsed = parseJavaScriptSource(source, path);
    expect(parsed).not.toBeNull();
    const ir = analyzeParsedJavaScriptSemantics(
      parsed!,
      moduleResolutionModeForJavaScriptReference(path, "static-import"),
    );
    expect(
      ir.moduleLinks.filter(
        ({ kind }) => kind === "require" || kind === "commonjs-export",
      ),
    ).toEqual([]);
  });
});

describe("TypeScript type-only module links", () => {
  it("retains declarations without runtime bindings or callable claims", () => {
    const ir = analyzeJavaScriptSemantics(`
      import type { Whole } from "./whole";
      import { type Inline } from "./inline";
      import { type Erased, value } from "./mixed";
      export type { Reexported } from "./reexported";
      export { type InlineExport } from "./inline-export";
      export type LocalType = string;
      export interface LocalInterface { value: string }
      function hiddenFunction() { return 1; }
      export type { hiddenFunction };
    `);

    expect(ir.bindings.map(({ name }) => name).sort()).toEqual([
      "hiddenFunction",
      "value",
    ]);

    const externalLinks = ir.moduleLinks
      .filter(({ specifier }) => specifier !== null)
      .map(
        ({ kind, specifier, importedName, exportedName }) =>
          [kind, specifier, importedName, exportedName] as const,
      );
    expect(externalLinks).toEqual([
      ["type-import", "./whole", "Whole", null],
      ["type-import", "./inline", "Inline", null],
      ["type-import", "./mixed", "Erased", null],
      ["import", "./mixed", "value", null],
      ["type-import", "./reexported", "Reexported", "Reexported"],
      ["type-import", "./inline-export", "InlineExport", "InlineExport"],
    ]);

    const typeLinks = ir.moduleLinks
      .filter(({ kind }) => kind === "type-import")
      .map(
        ({ specifier, localName, exportedName, callableId }) =>
          [specifier, localName, exportedName, callableId] as const,
      );
    expect(typeLinks).toEqual([
      ["./whole", "Whole", null, null],
      ["./inline", "Inline", null, null],
      ["./mixed", "Erased", null, null],
      ["./reexported", null, "Reexported", null],
      ["./inline-export", null, "InlineExport", null],
      [null, "LocalType", "LocalType", null],
      [null, "LocalInterface", "LocalInterface", null],
      [null, "hiddenFunction", "hiddenFunction", null],
    ]);
    expect(ir.limitations).toContain(
      "Compiler options are unavailable; inline type-only imports or re-exports may preserve a module side-effect dependency.",
    );
  });
});

describe("CommonJS dependency links", () => {
  it("retains an import-equals binding and its module origin", () => {
    const ir = analyzeJavaScriptSemantics(`
      import typed = require("dependency");
      import type TypeOnly = require("type-only");
      namespace Local { export class Marker {} }
      import Alias = Local.Marker;
      void typed;
    `);
    expect(topLevelBinding(ir, "typed")).toMatchObject({
      kind: "import",
      mutable: false,
      provenance: {
        origins: [{ specifier: "dependency", importedPath: [] }],
      },
    });
    expect(
      ir.moduleLinks.filter(({ specifier }) => specifier !== null),
    ).toEqual([
      expect.objectContaining({
        kind: "require",
        specifier: "dependency",
        importedName: null,
        localName: "typed",
      }),
      expect.objectContaining({
        kind: "type-import",
        specifier: "type-only",
        importedName: null,
        localName: "TypeOnly",
      }),
    ]);
    expect(ir.references.filter(({ name }) => name === "typed")).toHaveLength(
      1,
    );
  });

  it.each([
    'require("dependency");',
    'void require("dependency");',
    'consume(require("dependency"));',
    'require("dependency").member;',
    'require("dependency")[key];',
    'const {} = require("dependency");',
    'const [] = require("dependency");',
    'let assigned; assigned = require("dependency");',
    'function run(value = require("dependency")) {}',
    '(require("dependency") as unknown);',
  ])("retains an unbound dependency in %s", (source) => {
    const ir = analyzeJavaScriptSemantics(source);
    expect(ir.moduleLinks).toEqual([
      expect.objectContaining({
        kind: "require",
        specifier: "dependency",
        importedName: null,
        localName: null,
        exportedName: null,
        callableId: null,
      }),
    ]);
  });

  it.each([
    'function run(require) { require("dependency"); }',
    'require("dependency"); const require = loader;',
    'function run() { require("dependency"); var require; }',
    'with (environment) { require("dependency"); }',
    "require(dynamicSpecifier);",
  ])("does not invent a static global dependency in %s", (source) => {
    expect(analyzeJavaScriptSemantics(source).moduleLinks).toEqual([]);
  });

  it("keeps bindings and re-exports without extra dependency links", () => {
    const ir = analyzeJavaScriptSemantics(`
      const bound = (require("bound") as unknown);
      const { left, right } = require("destructured");
      module.exports = require("forwarded");
      exports = module.exports;
      exports.member = require("member").value;
      exports.first = exports.second = require("chained");
    `);
    expect(
      ir.moduleLinks.map(({ kind, specifier, localName, exportedName }) => ({
        kind,
        specifier,
        localName,
        exportedName,
      })),
    ).toEqual([
      {
        kind: "require",
        specifier: "bound",
        localName: "bound",
        exportedName: null,
      },
      {
        kind: "require",
        specifier: "destructured",
        localName: "left",
        exportedName: null,
      },
      {
        kind: "require",
        specifier: "destructured",
        localName: "right",
        exportedName: null,
      },
      {
        kind: "commonjs-export",
        specifier: "forwarded",
        localName: null,
        exportedName: "default",
      },
      {
        kind: "commonjs-export",
        specifier: "member",
        localName: null,
        exportedName: "member",
      },
      {
        kind: "commonjs-export",
        specifier: "chained",
        localName: null,
        exportedName: "first",
      },
      {
        kind: "commonjs-export",
        specifier: "chained",
        localName: null,
        exportedName: "second",
      },
    ]);
    expect(
      ir.bindings.find(({ name }) => name === "bound")?.provenance.origins,
    ).toEqual([
      { specifier: "bound", importedPath: [], resolutionMode: "require" },
    ]);
  });

  it.each([
    'require("outer", require("inner"));',
    'const bound = require("outer", require("inner"));',
    'module.exports = require("outer", require("inner"));',
  ])("retains a distinct nested call in %s", (source) => {
    const links = analyzeJavaScriptSemantics(source).moduleLinks;
    expect(links.map(({ specifier }) => specifier)).toEqual(["outer", "inner"]);
    expect(links[1]).toMatchObject({
      kind: "require",
      importedName: null,
      localName: null,
      exportedName: null,
    });
  });
});

it("preserves unshadowed require origins through aliases and assignments", () => {
  const ir = analyzeJavaScriptSemantics(`
    const { ipcMain: bus } = require("electron");
    const forwarded = bus;
    let assigned;
    assigned = require("electron").ipcMain;
    { const require = localLoader; require("./local.js"); }
  `);
  for (const name of ["bus", "forwarded"])
    expect(origin(topLevelBinding(ir, name))).toEqual({
      specifier: "electron",
      importedPath: ["ipcMain"],
      resolutionMode: "require",
    });
  expect(topLevelBinding(ir, "assigned").provenance).toMatchObject({
    status: "ambiguous",
    origins: [{ specifier: "electron", importedPath: ["ipcMain"] }],
  });
  expect(ir.moduleLinks.filter(({ kind }) => kind === "require")).toEqual([
    expect.objectContaining({
      specifier: "electron",
      importedName: "ipcMain",
      localName: "bus",
    }),
    expect.objectContaining({
      specifier: "electron",
      importedName: null,
      localName: null,
    }),
  ]);
});
