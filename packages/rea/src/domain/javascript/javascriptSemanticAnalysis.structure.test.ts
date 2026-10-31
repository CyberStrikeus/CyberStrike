import { describe, expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { analyzeCommonJsSemanticFixture } from "../../../tests/fixtures/javascriptCommonJsAnalysis.js";

import {
  programScope,
  bindingById,
  bindingsNamed,
  onlyBinding,
  topLevelBinding,
  origin,
} from "./javascriptSemanticAnalysis.fixture.js";

describe("JavaScript semantic analysis: ESM import origins", () => {
  it.each(["", "a", "0"])(
    "preserves exact ESM import name %j in binding origins",
    (name) => {
      const ir = analyzeJavaScriptSemantics(
        "import { " +
          JSON.stringify(name) +
          ' as selected } from "./module.mjs"; const alias = selected; export { alias };',
      );
      for (const binding of ["selected", "alias"])
        expect(origin(topLevelBinding(ir, binding))).toEqual({
          specifier: "./module.mjs",
          importedPath: [name],
        });
      expect(ir.moduleLinks).toContainEqual(
        expect.objectContaining({
          kind: "import",
          importedName: name,
          localName: "selected",
        }),
      );
    },
  );

  it("keeps default and namespace import origins distinct from an empty named import", () => {
    const ir = analyzeJavaScriptSemantics(
      'import value from "./module.mjs"; import * as namespace from "./module.mjs";',
    );
    expect(origin(topLevelBinding(ir, "value"))).toEqual({
      specifier: "./module.mjs",
      importedPath: ["default"],
    });
    expect(origin(topLevelBinding(ir, "namespace"))).toEqual({
      specifier: "./module.mjs",
      importedPath: [],
    });
  });
});

describe("JavaScript semantic analysis: structure 1", () => {
  it("resolves CommonJS require destructuring, aliases, assignments, and shadowing", () => {
    const ir = analyzeCommonJsSemanticFixture(`
      const { ipcRenderer: ir } = require("electron");
      const { ipcMain: bus } = require("electron");
      const forwarded = bus;
      let assigned;
      assigned = ir;
      ir.invoke("outside");
      bus.handle("main", handler);
      function local(ipcRenderer) {
        const bus = require("./local-bus.js");
        ipcRenderer.send("shadowed");
        return bus;
      }
    `);

    expect(ir.coverage).toEqual({
      status: "complete",
      omittedCount: 0,
    });
    expect(origin(topLevelBinding(ir, "ir"))).toEqual({
      specifier: "electron",
      importedPath: ["ipcRenderer"],
      resolutionMode: "require",
    });
    expect(origin(topLevelBinding(ir, "bus"))).toEqual({
      specifier: "electron",
      importedPath: ["ipcMain"],
      resolutionMode: "require",
    });
    expect(origin(topLevelBinding(ir, "forwarded"))).toEqual({
      specifier: "electron",
      importedPath: ["ipcMain"],
      resolutionMode: "require",
    });
    expect(topLevelBinding(ir, "assigned").provenance).toMatchObject({
      status: "ambiguous",
      origins: [{ specifier: "electron", importedPath: ["ipcRenderer"] }],
    });
    expect(ir.moduleLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "require",
          specifier: "electron",
          importedName: "ipcMain",
          localName: "bus",
        }),
      ]),
    );

    const innerBus = bindingsNamed(ir, "bus").find(
      ({ scopeId }) => scopeId !== programScope(ir).scopeId,
    );
    expect(innerBus).toBeDefined();
    if (innerBus === undefined) return;
    expect(origin(innerBus)).toEqual({
      specifier: "./local-bus.js",
      importedPath: [],
      resolutionMode: "require",
    });
    const shadow = onlyBinding(ir, "ipcRenderer");
    expect(shadow.provenance).toEqual({
      status: "unknown",
      origins: [],
      reason: "Parameter provenance depends on caller arguments.",
    });
    const shadowReference = ir.references.find(
      ({ name, bindingId, role }) =>
        name === "ipcRenderer" &&
        bindingId === shadow.bindingId &&
        role === "read",
    );
    expect(shadowReference?.resolution).toBe("resolved");
    expect(shadowReference?.bindingId).not.toBe(
      topLevelBinding(ir, "ir").bindingId,
    );
    if (shadowReference === undefined || shadowReference.bindingId === null)
      throw new Error("Missing shadow reference");
    expect(bindingById(ir, shadowReference.bindingId)).toEqual(shadow);
    expect(
      ir.references.find(
        ({ location }) =>
          location.start.line === shadowReference.location.start.line &&
          location.start.column === shadowReference.location.start.column,
      ),
    ).toEqual(shadowReference);
  });

  it.each([
    `function run(require) { const bus = require("electron").ipcMain; return bus; }`,
    `function run() { const { ipcMain: bus } = require("electron"); function require() {} return bus; }`,
    `{ const bus = require("electron").ipcMain; const require = localLoader; }`,
    `import require from "./loader.js"; const bus = require("electron").ipcMain;`,
  ])(
    "does not assign CommonJS origins to lexically shadowed require",
    (source) => {
      const ir = analyzeJavaScriptSemantics(source);
      const bus = onlyBinding(ir, "bus");
      expect(bus.provenance.origins).toEqual([]);
      expect(ir.moduleLinks.filter(({ kind }) => kind === "require")).toEqual(
        [],
      );
    },
  );

  it("propagates literal, template, object, conditional, and destructured values", () => {
    const ir = analyzeJavaScriptSemantics(`
      const prefix = "rea";
      const suffix = "open";
      const channel = \`${"${prefix}"}:${"${suffix}"}\`;
      const options = {
        channel,
        mode: enabled ? "read" : "write",
      };
      const selected = options.channel;
      const { mode } = options;
      const [first] = ["zero", "one"];
    `);

    expect(topLevelBinding(ir, "channel").value).toEqual({
      status: "literal",
      value: "rea:open",
    });
    expect(topLevelBinding(ir, "selected").value).toEqual({
      status: "literal",
      value: "rea:open",
    });
    expect(topLevelBinding(ir, "mode").value).toEqual({
      status: "union",
      values: ["read", "write"],
    });
    expect(topLevelBinding(ir, "first").value).toEqual({
      status: "literal",
      value: "zero",
    });
  });
});

describe("JavaScript semantic analysis: loop lexical names", () => {
  it.each([
    `for (let value = "inside"; ready; step()) { consume(value); }`,
    `for (const value of entries) { consume(value); }`,
    `for (const value in entries) { consume(value); }`,
  ])("does not leak lexical loop bindings into the enclosing scope", (loop) => {
    const ir = analyzeJavaScriptSemantics(`
      const value = "outside";
      ${loop}
      consume(value);
    `);
    expect(topLevelBinding(ir, "value").value).toEqual({
      status: "literal",
      value: "outside",
    });
    expect(bindingsNamed(ir, "value")).toHaveLength(2);
    const reads = ir.references.filter(
      ({ name, role }) => name === "value" && role === "read",
    );
    expect(reads).toHaveLength(2);
    expect(reads[0]?.bindingId).toEqual(expect.any(String));
    expect(reads[0]?.bindingId).not.toBe(reads[1]?.bindingId);
    expect(reads[1]?.bindingId).toBe(topLevelBinding(ir, "value").bindingId);
  });

  it("resolves closures inside a loop against the loop binding", () => {
    const ir = analyzeJavaScriptSemantics(`
      const value = "outside";
      for (const value of entries) { callbacks.push(() => value); }
      consume(value);
    `);
    const reads = ir.references.filter(
      ({ name, role }) => name === "value" && role === "read",
    );
    expect(reads).toHaveLength(2);
    expect(reads[0]?.bindingId).toEqual(expect.any(String));
    expect(reads[0]?.bindingId).not.toBe(
      topLevelBinding(ir, "value").bindingId,
    );
    expect(reads[1]?.bindingId).toBe(topLevelBinding(ir, "value").bindingId);
    expect(ir.closureCaptures).toContainEqual(
      expect.objectContaining({
        bindingId: reads[0]?.bindingId,
      }),
    );
  });

  it("keeps var loop declarations in the enclosing function", () => {
    const ir = analyzeJavaScriptSemantics(`
      function run() { for (var value of entries) { consume(value); } return value; }
    `);
    const binding = onlyBinding(ir, "value");
    const callable = ir.callables.find(({ name }) => name === "run");
    expect(binding.scopeId).toBe(callable?.bodyScopeId);
    const reads = ir.references.filter(
      ({ name, role }) => name === "value" && role === "read",
    );
    expect(reads).toHaveLength(2);
    expect(reads.map(({ bindingId }) => bindingId)).toEqual([
      binding.bindingId,
      binding.bindingId,
    ]);
  });
});

describe("JavaScript semantic analysis: class expression lexical names", () => {
  it("resolves named class expressions inside the class without changing the outer binding", () => {
    const ir = analyzeJavaScriptSemantics(`
      const Service = "outside";
      const Wrapper = class Service {
        create() { return new Service(); }
      };
      consume(Service);
    `);
    expect(bindingsNamed(ir, "Service")).toHaveLength(2);
    expect(topLevelBinding(ir, "Service").value).toEqual({
      status: "literal",
      value: "outside",
    });
    const references = ir.references.filter(
      ({ name, role }) => name === "Service" && role === "read",
    );
    expect(references).toHaveLength(2);
    expect(references[1]?.bindingId).toBe(
      topLevelBinding(ir, "Service").bindingId,
    );
    expect(references[0]?.bindingId).not.toBe(references[1]?.bindingId);
    expect(references[0]?.resolution).toBe("resolved");
    const classScope = ir.scopes.find(({ kind }) => kind === "class");
    expect(
      bindingsNamed(ir, "Service").some(
        ({ scopeId }) => scopeId === classScope?.scopeId,
      ),
    ).toBe(true);
  });

  it("does not expose a named class expression outside its class", () => {
    const ir = analyzeJavaScriptSemantics(`
      const Wrapper = class Internal { create() { return new Internal(); } };
      consume(Internal);
    `);
    const references = ir.references.filter(
      ({ name, role }) => name === "Internal" && role === "read",
    );
    expect(references.map(({ resolution }) => resolution)).toEqual([
      "resolved",
      "unbound",
    ]);
    expect(topLevelBinding(ir, "Wrapper").provenance.status).toBe("local");
  });
});

describe("JavaScript semantic analysis: class member keys", () => {
  it("does not read an outer binding through noncomputed class member names", () => {
    const ir = analyzeJavaScriptSemantics(`
      const marker = "seed";
      class Holder {
        marker() {}
        static marker() {}
        get marker() { return 1; }
        set marker(value) {}
        marker = 1;
        static marker = 2;
        #marker = 3;
        #read() { return this.#marker; }
      }
    `);
    expect(ir.references.filter(({ name }) => name === "marker")).toEqual([]);
  });

  it("does not read an outer binding through TypeScript class member names", () => {
    const ir = analyzeJavaScriptSemantics(`
      const marker = "seed";
      abstract class Holder {
        declare marker: string;
        abstract marker(): void;
        abstract [marker](): void;
      }
      class Overloads {
        marker(): void;
        marker(value?: number) {}
      }
    `);
    // Abstract signatures, including computed keys, are erased.
    expect(ir.references.filter(({ name }) => name === "marker")).toEqual([]);
  });

  it("does not capture an outer binding through a noncomputed method name", () => {
    const ir = analyzeJavaScriptSemantics(`
      function outer() {
        const marker = 1;
        class Holder { marker() { return 2; } }
        return Holder;
      }
    `);
    expect(ir.closureCaptures).toEqual([]);
  });

  it("keeps reads from computed class keys and field initializers", () => {
    const ir = analyzeJavaScriptSemantics(`
      const marker = "seed";
      class Holder {
        [marker]() {}
        field = marker;
      }
    `);
    const reads = ir.references.filter(
      ({ name, role }) => name === "marker" && role === "read",
    );
    expect(reads.map(({ resolution }) => resolution)).toEqual([
      "resolved",
      "resolved",
    ]);
  });
});

describe("JavaScript semantic analysis: structure 2", () => {
  it("retains ESM and CommonJS relationships in their respective runtime contexts", () => {
    const ir = analyzeJavaScriptSemantics(`
      export { ipcRenderer as bridge } from "electron";
      export * from "./wrapper.js";
      export const localValue = 1;
      export default function namedDefault() {}
    `);
    const commonJs = analyzeCommonJsSemanticFixture(`
      const addon = require("./native.node");
      module.exports.addon = addon;
    `);

    expect([...ir.moduleLinks, ...commonJs.moduleLinks]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "re-export",
          specifier: "electron",
          importedName: "ipcRenderer",
          exportedName: "bridge",
        }),
        expect.objectContaining({
          kind: "re-export",
          specifier: "./wrapper.js",
          importedName: "*",
          exportedName: "*",
        }),
        expect.objectContaining({
          kind: "export",
          localName: "localValue",
          exportedName: "localValue",
        }),
        expect.objectContaining({
          kind: "require",
          specifier: "./native.node",
          localName: "addon",
        }),
        expect.objectContaining({
          kind: "commonjs-export",
          localName: "addon",
          exportedName: "addon",
        }),
        expect.objectContaining({
          kind: "export",
          localName: "namedDefault",
          exportedName: "default",
        }),
      ]),
    );
  });

  it("does not invent export or method names from dynamic keys", () => {
    const ir = analyzeJavaScriptSemantics(`
      const key = resolveKey();
      exports[key] = addon;
      module.exports[key] = addon;
      const target = { [key]() { return 1; } };
      class Holder { [key]() { return 2; } }
    `);
    // The assignment is real, but its name is not knowable, so the only
    // honest exported_name is the wildcard.
    expect(
      ir.moduleLinks
        .filter(({ kind }) => kind === "commonjs-export")
        .map(({ exportedName }) => exportedName),
    ).toEqual(["*", "*"]);
    const names = ir.callables.map(({ name }) => name);
    expect(names).not.toContain("key");
    expect(names.filter((name) => name?.startsWith("[computed@")).length).toBe(
      2,
    );
  });

  it("resolves the value of a simple assignment expression exported through CommonJS", () => {
    const ir = analyzeJavaScriptSemantics(`
      function parse() { return { kind: "result" }; }
      const holder = {};
      module.exports = holder.value = parse;
    `);
    expect(ir.moduleLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "commonjs-export",
          localName: "parse",
          exportedName: "default",
        }),
      ]),
    );
  });

  it.each(["parse", "default"])(
    "does not export a %s property write to a replaced module.exports receiver",
    (name) => {
      const ir = analyzeJavaScriptSemantics(`
        module.exports.${name} = (module.exports = () => ({ kind: "result" }));
      `);
      expect(ir.moduleLinks).toEqual([
        expect.objectContaining({
          kind: "commonjs-export",
          exportedName: "default",
        }),
      ]);
    },
  );
});

describe("CommonJS receiver lifetimes", () => {
  it.each([
    'Object.defineProperty(module.exports, "other", { value: exports });',
    "Object.assign(module.exports, { other: exports });",
  ])(
    "keeps the receiver identity intact when mutating its contents: %s",
    (mutation) => {
      const ir = analyzeJavaScriptSemantics(
        `exports.parse = () => 1; ${mutation}`,
      );
      const exported = ir.moduleLinks.find(
        ({ exportedName }) => exportedName === "parse",
      );
      expect(exported?.callableId).toEqual(expect.any(String));
    },
  );

  it.each([
    "module.exports = {}; exports.parse = () => 1;",
    "exports = {}; exports.parse = () => 1;",
    "exports.parse = () => 1; module.exports = {};",
    "module.exports.parse = () => 1; module.exports = [];",
    'module.exports = {}; exports.status = "enabled";',
    "module.exports = exports = {}; module.exports = {}; exports.parse = () => 1;",
    'module.exports = {}; Reflect.set(module, "other", exports); exports.parse = () => 1;',
    'module.exports = {}; Object.defineProperty(globalThis.module, "exports", { value: exports }); exports.parse = () => 1;',
    "module.exports = {}; let wrapper = module; wrapper = {}; Object.assign(wrapper, { exports }); exports.parse = () => 1;",
  ])(
    "excludes a detached CommonJS receiver across statements: %s",
    (source) => {
      const ir = analyzeJavaScriptSemantics(source);
      expect(
        ir.moduleLinks.filter(
          ({ exportedName }) =>
            exportedName === "parse" || exportedName === "status",
        ),
      ).toEqual([]);
    },
  );

  it.each([
    "exports.parse = () => 1;",
    "module.exports = {}; module.exports.parse = () => 1;",
    "module.exports = {}; exports = module.exports; exports.parse = () => 1;",
    "module.exports = exports = {}; exports.parse = () => 1;",
    "exports = module.exports = {}; exports.parse = () => 1;",
    "module.exports = module.exports; exports.parse = () => 1;",
    "module.exports = external; exports = module.exports; exports.parse = () => 1;",
    "module.exports = external; module.exports.parse = () => 1;",
    "exports.parse = (exports = {} , () => 1);",
    "exports.parse = (module.exports = {}); module.exports = exports;",
    "(module.exports = {}, exports = module.exports, exports.parse = () => 1);",
  ])("retains a connected CommonJS receiver: %s", (source) => {
    expect(analyzeJavaScriptSemantics(source).moduleLinks).toContainEqual(
      expect.objectContaining({
        kind: "commonjs-export",
        exportedName: "parse",
      }),
    );
  });

  it.each([
    "module.exports = external; exports.parse = () => 1;",
    "if (flag) module.exports = {}; exports.parse = () => 1;",
    "flag && (module.exports = {}); exports.parse = () => 1;",
    "holder ||= (module.exports = {}); exports.parse = () => 1;",
    "invoke?.(module.exports = {}); exports.parse = () => 1;",
    "const { value = (module.exports = {}) } = source; exports.parse = () => 1;",
    "module[key] = {}; exports.parse = () => 1;",
    "exports.parse = () => 1; if (flag) module.exports = {};",
    "function replace() { module.exports = {}; } exports.parse = () => 1; replace();",
    "function replace() { exports = {}; } replace(); exports.parse = () => 1;",
    "module.exports = {}; function install() { exports.parse = () => 1; } install();",
    "for (exports of values) {} exports.parse = () => 1;",
    "({ exports } = external); exports.parse = () => 1;",
    "module = {}; module.exports = {}; module.exports.parse = () => 1;",
    'const holder = {}; ({ [(module.exports = exports, "x")]: holder.x } = (module.exports = {})); exports.parse = () => 1;',
    'const { [(module.exports = exports, "x")]: value } = (module.exports = {}); exports.parse = () => 1;',
    "const [value = (module.exports = exports)] = (module.exports = []); exports.parse = () => 1;",
    "module.exports = {}; Object.assign(module, { exports }); exports.parse = () => 1;",
    'module.exports = {}; Object.defineProperty(module, "exports", { value: exports }); exports.parse = () => 1;',
    'module.exports = {}; Reflect.set(module, "exports", exports); exports.parse = () => 1;',
    "module.exports = {}; const assign = Object.assign; assign.call(null, module, { exports }); exports.parse = () => 1;",
    "module.exports = {}; const wrapper = module; Object.assign(wrapper, { exports }); exports.parse = () => 1;",
  ])("keeps uncertain CommonJS receiver identity unresolved: %s", (source) => {
    expect(analyzeJavaScriptSemantics(source).moduleLinks).toContainEqual(
      expect.objectContaining({
        kind: "commonjs-export",
        exportedName: "parse",
        callableId: null,
        localName: null,
      }),
    );
  });
});

describe("CommonJS exports defined with Object.defineProperty", () => {
  const exportsOf = (source: string) =>
    analyzeJavaScriptSemantics(source).moduleLinks.filter(
      ({ kind }) => kind === "commonjs-export",
    );
  const defineParse =
    'Object.defineProperty(exports, "parse", { value: () => 1 });';

  it("retains tsc CommonJS re-exports and data descriptors", () => {
    const links = exportsOf(`
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.VERSION = void 0;
      exports.VERSION = "1.0";
      var client_1 = require("./client");
      Object.defineProperty(exports, "Client", { enumerable: true, get: function () { return client_1.Client; } });
    `);
    expect(links.map(({ exportedName }) => exportedName)).toEqual([
      "__esModule",
      "VERSION",
      "VERSION",
      "Client",
    ]);
    // An accessor's result is not proven by the descriptor.
    expect(links.at(-1)).toMatchObject({
      localName: null,
      callableId: null,
      specifier: null,
    });
  });

  it.each([
    ["() => 1", "parse"],
    ['require("./parser")', "parse"],
    ['require("./parser").parse', "parse"],
    ["parse", "parse"],
    ['holder.parse = require("./parser").parse', "parse"],
    ["first = second = () => 1", "parse"],
  ])(
    "links a data descriptor value %s like the equivalent assignment",
    (value, name) => {
      const strip = (links: ReturnType<typeof exportsOf>) =>
        links.map(({ location: _location, callableId, ...link }) => ({
          ...link,
          callable: callableId !== null,
        }));
      const assigned = exportsOf(`exports.${name} = ${value};`);
      const defined = exportsOf(
        `Object.defineProperty(exports, "${name}", { value: ${value} });`,
      );
      expect(strip(defined)).toEqual(strip(assigned));
      expect(defined).toHaveLength(1);
    },
  );

  it.each([
    defineParse,
    `module.exports = {}; ${defineParse.replace("(exports", "(module.exports")}`,
    `module.exports = {}; exports = module.exports; ${defineParse}`,
  ])("retains a connected receiver: %s", (source) => {
    expect(exportsOf(source)).toContainEqual(
      expect.objectContaining({
        exportedName: "parse",
        callableId: expect.any(String),
      }),
    );
  });

  it.each([
    `module.exports = {}; ${defineParse}`,
    `exports = {}; ${defineParse}`,
    `${defineParse} module.exports = {};`,
  ])("excludes a detached receiver: %s", (source) => {
    expect(
      exportsOf(source).filter(({ exportedName }) => exportedName === "parse"),
    ).toEqual([]);
  });

  it.each([
    `if (flag) module.exports = {}; ${defineParse}`,
    `function replace() { exports = {}; } replace(); ${defineParse}`,
    `module.exports = {}; Object.defineProperty(module, "exports", { value: exports }); ${defineParse}`,
    `if (flag) { ${defineParse} }`,
  ])("keeps an uncertain receiver unresolved: %s", (source) => {
    expect(exportsOf(source)).toContainEqual(
      expect.objectContaining({
        exportedName: "parse",
        callableId: null,
        localName: null,
      }),
    );
  });

  it.each([
    'const Object = { defineProperty() {} }; Object.defineProperty(exports, "parse", { value: 1 });',
    'Object.defineProperty = patched; Object.defineProperty(exports, "parse", { value: 1 });',
    'Object.defineProperty(other, "parse", { value: 1 });',
    'Object.defineProperty(module, "parse", { value: 1 });',
    'function local(exports) { Object.defineProperty(exports, "parse", { value: 1 }); }',
    'Object.defineProperty(exports, "parse");',
    "Object.defineProperty(...args);",
  ])("does not treat other defineProperty calls as exports: %s", (source) => {
    expect(
      exportsOf(source).filter(({ exportedName }) => exportedName === "parse"),
    ).toEqual([]);
  });

  it("keeps a dynamic defined key unknown", () => {
    expect(
      exportsOf("Object.defineProperty(exports, key, { value: 1 });"),
    ).toEqual([expect.objectContaining({ exportedName: "*" })]);
  });
});

describe("JavaScript semantic analysis: write references", () => {
  it("classifies destructuring and loop targets as writes, not reads", () => {
    const ir = analyzeJavaScriptSemantics(`
      let a, b, c;
      ({ a } = source);
      [b] = list;
      ({ nested: { c } } = source);
      for (a of list) {}
      let d;
      try { risky(); } catch ({ message }) { report(message); }
    `);
    const roles = (name: string): string[] =>
      ir.references
        .filter((reference) => reference.name === name)
        .map(({ role }) => role);
    expect(roles("a")).toEqual(["write", "write"]);
    expect(roles("b")).toEqual(["write"]);
    expect(roles("c")).toEqual(["write"]);
    // A catch binding is a declaration, so its only later use is a read.
    expect(roles("message")).toEqual(["read"]);
  });

  it("retains the read a compound assignment or update performs", () => {
    const ir = analyzeJavaScriptSemantics(`
      let total = 0;
      total += 1;
      total++;
      total = 2;
      const observed = total;
    `);
    const roles = ir.references
      .filter(({ name }) => name === "total")
      .map(({ role }) => role);
    expect(roles).toEqual([
      "read",
      "write", // total += 1
      "read",
      "write", // total++
      "write", // total = 2
      "read", // const observed = total
    ]);
  });

  it("treats TypeScript parameter-property declarations as bindings rather than reads", () => {
    const ir = analyzeJavaScriptSemantics(`
      const seed = 1;
      class Service {
        constructor(
          public x: number,
          public y = 1,
          public z = seed,
        ) {
          console.log(this.x);
          console.log(y);
        }
      }
    `);
    const referencesFor = (name: string) =>
      ir.references.filter((reference) => reference.name === name);

    // Parameter properties are definitions, not source identifier reads.
    expect(referencesFor("x")).toEqual([]);
    expect(referencesFor("z")).toEqual([]);

    // Actual reads in constructor body survive.
    expect(referencesFor("y")).toEqual([
      expect.objectContaining({
        name: "y",
        role: "read",
      }),
    ]);

    // Actual reads in parameter default values remain references.
    expect(referencesFor("seed")).toEqual([
      expect.objectContaining({
        name: "seed",
        role: "read",
      }),
    ]);
  });
});

describe("JavaScript semantic analysis: dynamic and case scopes", () => {
  it("marks with and eval as unresolved dynamic scope instead of staying silent", () => {
    const ir = analyzeJavaScriptSemantics(`
      function load(source) {
        with (host) { consume(target); }
        eval("var injected = 1;");
      }
    `);
    const reasons = ir.frontiers
      .filter(({ kind }) => kind === "dynamic-scope")
      .map(({ reason }) => reason);
    expect(reasons).toHaveLength(2);
    expect(reasons.join("\n")).toContain("`with`");
    expect(reasons.join("\n")).toContain("`eval`");
  });

  it("does not assign CommonJS exports to lexically shadowed module or exports", () => {
    const ir = analyzeJavaScriptSemantics(`
      function shadowed(module, exports) {
        module.exports.value = 1;
        exports.other = 2;
        exports[key] = 3;
        module.exports[key] = 4;
        unrelated[key] = 5;
      }
    `);
    expect(
      ir.moduleLinks.filter(({ kind }) => kind === "commonjs-export"),
    ).toEqual([]);
  });

  it("shares one lexical scope across switch cases and isolates static blocks", () => {
    const switchIr = analyzeJavaScriptSemantics(`
      const kind = select();
      switch (kind) {
        case "a": let shared = 1; break;
        case "b": shared = 2; break;
      }
    `);
    // One declaration, one binding — and it belongs to a scope of its own, so
    // it cannot leak past the switch statement.
    const shared = switchIr.bindings.filter(({ name }) => name === "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.scopeId).not.toBe(
      topLevelBinding(switchIr, "kind").scopeId,
    );
    const classIr = analyzeJavaScriptSemantics(`
      class Holder {
        static { let isolated = 1; }
        static { let isolated = 2; }
      }
    `);
    expect(
      classIr.bindings.filter(({ name }) => name === "isolated"),
    ).toHaveLength(2);
  });

  it("keeps function, class, and method identities separate from bindings", () => {
    const ir = analyzeJavaScriptSemantics(`
      class Service {
        run() {}
        get value() { return 1; }
        #privateMethod() {}
      }
      const arrow = () => 1;
      const object = { method() {} };
    `);

    expect(ir.callables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "class", name: "Service" }),
        expect.objectContaining({ kind: "method", name: "run" }),
        expect.objectContaining({ kind: "method", name: "value" }),
        expect.objectContaining({ kind: "method", name: "#privateMethod" }),
        expect.objectContaining({ kind: "function", name: "arrow" }),
        expect.objectContaining({ kind: "method", name: "method" }),
      ]),
    );
    expect(bindingsNamed(ir, "run")).toEqual([]);
    expect(bindingsNamed(ir, "method")).toEqual([]);
  });
});
