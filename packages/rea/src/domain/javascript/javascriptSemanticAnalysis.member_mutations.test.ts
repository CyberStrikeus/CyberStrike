import { describe, expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { onlyCallable } from "./javascriptSemanticAnalysis.fixture.js";

const resultValue = (body: string) =>
  onlyCallable(
    analyzeJavaScriptSemantics(`export function result() { ${body} }`),
    "result",
  ).returnSites[0]?.value;

it.each([
  ["field = shared;", "declare field: { mode: string };", "new Derived()"],
  [
    "get field() { return shared; }",
    "declare field: { mode: string };",
    "new Derived()",
  ],
  [
    "static field = shared;",
    "declare static field: { mode: string };",
    "Derived",
  ],
  [
    "static get field() { return shared; }",
    "declare static field: { mode: string };",
    "Derived",
  ],
])(
  "follows inherited references past erased class fields: %s",
  (base, declaration, receiver) => {
    expect(
      resultValue(`
    const shared = { mode: "initial" };
    class Base { ${base} }
    class Derived extends Base { ${declaration} }
    ${receiver}.field.mode = "updated";
    return shared.mode;
  `)?.status,
    ).toBe("unknown");
  },
);

it.each(["field;", "field = { mode: 'other' };"])(
  "preserves a real derived field's shadowing: %s",
  (field) => {
    expect(
      resultValue(`
      const shared = { mode: "initial" };
      class Base { field = shared; }
      class Derived extends Base { ${field} }
      const instance = new Derived();
      if (instance.field) instance.field.mode = "updated";
      return shared.mode;
    `),
    ).toEqual({ status: "literal", value: "initial" });
  },
);

it("follows inherited references past an abstract field declaration", () => {
  expect(
    resultValue(`
    const shared = { mode: "initial" };
    class Base { field = shared; }
    abstract class Derived extends Base { abstract field: { mode: string }; }
    const Constructor = Derived as unknown as new () => Base;
    new Constructor().field.mode = "updated";
    return shared.mode;
  `)?.status,
  ).toBe("unknown");
});

const mutations = [
  'const shared = { mode: "initial" }; const options = { [key]: shared }; options.foo.mode = "updated"; return shared.mode;',
  'const shared = { mode: "initial" }; const original = [shared]; const copy = [...original]; copy[0].mode = "updated"; return shared.mode;',
  'const original = { nested: { mode: "initial" } }; const copy = { ...original }; copy.nested.mode = "updated"; return original.nested.mode;',
  'const shared = { mode: "initial" }; const options = flag ? shared : { mode: "other" }; options.mode = "updated"; return shared.mode;',
  'const child = { mode: "initial" }; const options = { layer: { child } }; options.layer.child.mode = "updated"; return child.mode;',
  'const options = { mode: "initial" }; options.mode = "updated"; return options.mode;',
  "const options = { count: 1 }; options.count += 1; return options.count;",
  "const options = { count: 1 }; options.count++; return options.count;",
  'const options = { mode: "initial" }; delete options.mode; return options.mode;',
  'const options = ["initial"]; options[0] = "updated"; return options[0];',
  'const options = { nested: { mode: "initial" } }; options.nested.mode = "updated"; return options.nested.mode;',
  'const options = { mode: "initial" }; const alias = options; alias.mode = "updated"; return options.mode;',
  'const options = { nested: { mode: "initial" } }; const { nested } = options; nested.mode = "updated"; return options.nested.mode;',
  'const nested = { mode: "initial" }; const options = { nested }; options.nested.mode = "updated"; return nested.mode;',
  'const options = { mode: "initial" }; [options.mode] = ["updated"]; return options.mode;',
  'const options = { mode: "initial" }; for (options.mode of ["updated"]) {} return options.mode;',
  'const options = { mode: "initial" }; const key = getKey(); options[key] = "updated"; return options.mode;',
];

describe("JavaScript semantic values after explicit property mutations", () => {
  it.each(mutations)("keeps the mutated value unknown: %s", (body) => {
    expect(resultValue(body)?.status).toBe("unknown");
  });

  it("keeps an unrelated shadowed object literal known", () => {
    expect(
      resultValue(`
      const options = { mode: "initial" };
      { const options = { mode: "inner" }; options.mode = "updated"; }
      return options.mode;
    `),
    ).toEqual({ status: "literal", value: "initial" });
  });

  it("keeps scalar slots in a spread source known after a copy slot write", () => {
    expect(
      resultValue(`
      const original = { mode: "initial" };
      const copy = { ...original };
      copy.mode = "updated";
      return original.mode;
    `),
    ).toEqual({ status: "literal", value: "initial" });
  });

  it("keeps conditional object branches unknown after a property write", () => {
    expect(
      resultValue(`
      const options = flag ? { mode: "initial" } : { mode: "other" };
      options.mode = "updated";
      return options.mode;
    `)?.status,
    ).toBe("unknown");
  });

  it("keeps a copied primitive initializer known", () => {
    expect(
      resultValue(`
      const mode = "initial";
      const options = { mode };
      options.mode = "updated";
      return mode;
    `),
    ).toEqual({ status: "literal", value: "initial" });
  });

  it("does not propagate writes through an alias after an unconditional rebind", () => {
    expect(
      resultValue(`
        const shared = { mode: "initial" };
        let alias = shared;
        alias = { mode: "other" };
        alias.mode = "updated";
        return shared.mode;
      `),
    ).toEqual({ status: "literal", value: "initial" });
  });

  it.each([
    'if (flag) alias = { mode: "other" }; alias.mode = "updated";',
    'flag && (alias = { mode: "other" }); alias.mode = "updated";',
    'flag ||= (alias = { mode: "other" }); alias.mode = "updated";',
    'alias ||= { mode: "other" }; alias.mode = "updated";',
    'alias ??= { mode: "other" }; alias.mode = "updated";',
  ])(
    "keeps possible source aliases unknown across conditional rebinds",
    (body) => {
      expect(
        resultValue(`
        const shared = { mode: "initial" };
        let alias = shared;
        ${body}
        return shared.mode;
      `)?.status,
      ).toBe("unknown");
    },
  );

  it("keeps mutation under a bare conditional unknown across a rebind", () => {
    expect(
      resultValue(`
        const shared = { mode: "initial" };
        let alias = shared;
        alias = { mode: "other" };
        if (flag) alias.mode = "updated";
        return shared.mode;
      `)?.status,
    ).toBe("unknown");
  });

  it("does not treat a short-circuit assignment RHS as an unconditional value", () => {
    expect(
      resultValue(`
        let value;
        value &&= 2;
        return value;
      `)?.status,
    ).toBe("unknown");
  });

  it("keeps possible alias mutations conservative across short-circuit assignment", () => {
    expect(
      resultValue(`
        const shared = { mode: "initial" };
        let alias = shared;
        alias &&= { mode: "other" };
        alias.mode = "updated";
        return shared.mode;
      `)?.status,
    ).toBe("unknown");
  });

  it("propagates short-circuit assignment mutations to the RHS alias candidate", () => {
    expect(
      resultValue(`
        const shared = { mode: "initial" };
        const other = { mode: "other" };
        let alias = shared;
        alias &&= other;
        alias.mode = "updated";
        return other.mode;
      `)?.status,
    ).toBe("unknown");
  });

  it("retains ordinary immutable object and array projection", () => {
    expect(
      resultValue(
        'const options = { mode: ["initial"] }; return options.mode[0];',
      ),
    ).toEqual({ status: "literal", value: "initial" });
  });
});

it("invalidates a shared value reached through an object-literal prototype getter", () => {
  const value = resultValue(`
    const shared = { x: 1 };
    const proto = { get v() { return shared; } };
    const box = { __proto__: proto };
    box.v.x = 2;
    return shared.x;
  `);
  expect(
    value?.status === "unknown" ||
      (value?.status === "literal" && value.value === 2),
  ).toBe(true);
});

it("does not follow an object-literal prototype getter past an own property", () => {
  expect(
    resultValue(`
      const shared = { x: 1 };
      const proto = { get v() { return shared; } };
      const box = { __proto__: proto, v: { x: 3 } };
      box.v.x = 2;
      return shared.x;
    `),
  ).toEqual({ status: "literal", value: 1 });
});

describe("JavaScript semantic mutations through getter results (#1494)", () => {
  it.each([
    [
      "object getter",
      "const shared = { value: 1 }; const box = { get value() { return shared; } }; box.value.value = 2; return shared.value;",
    ],
    [
      "class instance getter",
      "const shared = { value: 1 }; class Box { get value() { return shared; } } const box = new Box(); box.value.value = 2; return shared.value;",
    ],
    [
      "static getter",
      "const shared = { value: 1 }; class Box { static get value() { return shared; } } Box.value.value = 2; return shared.value;",
    ],
    [
      "copied getter result",
      "const shared = { value: 1 }; const box = { get value() { return shared; } }; const alias = box.value; alias.value = 2; return shared.value;",
    ],
  ])("marks shared returned objects uncertain through %s", (_shape, body) => {
    expect(resultValue(body)?.status).toBe("unknown");
  });

  it.each([
    [
      "last duplicate object getter wins",
      "const shared = { value: 1 }; const box = { get value() { return shared; }, get value() { return { value: 2 }; } }; box.value.value = 3; return shared.value;",
      "literal",
    ],
    [
      "a later data property replaces an object getter",
      "const shared = { value: 1 }; const box = { get value() { return shared; }, value: { value: 2 } }; box.value.value = 3; return shared.value;",
      "literal",
    ],
    [
      "a later object spread replaces an earlier getter",
      "const shared = { value: 1 }; const box = { get value() { return shared; }, ...{ value: { value: 2 } } }; box.value.value = 3; return shared.value;",
      "literal",
    ],
    [
      "a dynamic computed getter can replace a static getter",
      "const shared = { value: 1 }; const key = 'value'; const box = { get value() { return { value: 2 }; }, get [key]() { return shared; } }; box.value.value = 3; return shared.value;",
      "unknown",
    ],
    [
      "a dynamic instance property can select a class getter",
      "const shared = { value: 1 }; const key = getKey(); class Box { get value() { return shared; } } const box = new Box(); box[key].value = 3; return shared.value;",
      "unknown",
    ],
    [
      "a dynamic static property can select a class getter",
      "const shared = { value: 1 }; const key = getKey(); class Box { static get value() { return shared; } } Box[key].value = 3; return shared.value;",
      "unknown",
    ],
    [
      "a paired object setter keeps its getter result",
      "const shared = { value: 1 }; const box = { get value() { return shared; }, set value(next) {} }; box.value.value = 3; return shared.value;",
      "unknown",
    ],
    [
      "a paired class setter keeps its getter result",
      "const shared = { value: 1 }; class Box { get value() { return shared; } set value(next) {} } const box = new Box(); box.value.value = 3; return shared.value;",
      "unknown",
    ],
    [
      "a later class field replaces a getter",
      "const shared = { value: 1 }; class Box { get value() { return shared; } value = { value: 2 }; } const box = new Box(); box.value.value = 3; return shared.value;",
      "literal",
    ],
    [
      "a class field shadows a getter even when declared earlier",
      "const shared = { value: 1 }; class Box { value = { value: 2 }; get value() { return shared; } } const box = new Box(); box.value.value = 3; return shared.value;",
      "literal",
    ],
    [
      "last duplicate class getter wins",
      "const shared = { value: 1 }; class Box { get value() { return shared; } get value() { return { value: 2 }; } } const box = new Box(); box.value.value = 3; return shared.value;",
      "literal",
    ],
    [
      "follows an inherited getter",
      "const shared = { value: 1 }; class Base { get value() { return shared; } } class Derived extends Base {} const box = new Derived(); box.value.value = 3; return shared.value;",
      "unknown",
    ],
    [
      "follows every possible conditional superclass getter",
      "const shared = { value: 1 }; class Fresh { get value() { return { value: 2 }; } } class Shared { get value() { return shared; } } class Derived extends (flag ? Fresh : Shared) {} const box = new Derived(); box.value.value = 3; return shared.value;",
      "unknown",
    ],
    [
      "includes an unknown computed getter that can shadow a static getter",
      "const shared = { value: 1 }; const key = getKey(); class Box { get value() { return { value: 2 }; } get [key]() { return shared; } } const box = new Box(); box.value.value = 3; return shared.value;",
      "unknown",
    ],
    [
      "a later known getter shadows an earlier unknown computed getter",
      "const shared = { value: 1 }; const key = getKey(); class Box { get [key]() { return shared; } get value() { return { value: 2 }; } } const box = new Box(); box.value.value = 3; return shared.value;",
      "literal",
    ],
    [
      "follows an aliased class constructor",
      "const shared = { value: 1 }; class Box { get value() { return shared; } } const Alias = Box; const box = new Alias(); box.value.value = 3; return shared.value;",
      "unknown",
    ],
    [
      "follows an inline class constructor",
      "const shared = { value: 1 }; const box = new (class { get value() { return shared; } })(); box.value.value = 3; return shared.value;",
      "unknown",
    ],
  ])("%s", (_case, body, status) => {
    expect(resultValue(body)?.status).toBe(status);
  });

  it("retains conservative unknowns for fresh getter reads and saved results", () => {
    expect(
      resultValue(
        "const box = { get value() { return { x: 1 }; } }; const first = box.value; first.x = 2; return box.value.x;",
      )?.status,
    ).toBe("unknown");
    expect(
      resultValue(
        "const box = { get value() { return { x: 1 }; } }; const saved = box.value; saved.x = 2; return saved.x;",
      )?.status,
    ).toBe("unknown");
  });

  it("does not invalidate unrelated state through a fresh getter result", () => {
    expect(
      resultValue(
        "const shared = { value: 1 }; const box = { get fresh() { return { value: 2 }; } }; box.fresh.value = 3; return shared.value;",
      ),
    ).toEqual({ status: "literal", value: 1 });
  });

  it("keeps a shared value known when its getter is never read", () => {
    expect(
      resultValue(
        "const shared = { value: 1 }; const box = { get value() { return shared; } }; return shared.value;",
      ),
    ).toEqual({ status: "literal", value: 1 });
  });

  it("keeps a shared value known after an optional getter read or ordinary method read", () => {
    expect(
      resultValue(
        "const shared = { value: 1 }; const box = { get value() { return shared; } }; const alias = box?.value; return shared.value;",
      ),
    ).toEqual({ status: "literal", value: 1 });
    expect(
      resultValue(
        "const shared = { value: 1 }; const box = { value() { return shared; } }; const alias = box.value; return shared.value;",
      ),
    ).toEqual({ status: "literal", value: 1 });
  });
});

it.each([
  [
    "instance getter assignment",
    "const shared = { value: 1 }; class Box { get value() { return shared; } } const box = new Box(); box.value = {}; return shared.value;",
  ],
  [
    "instance getter deletion",
    "const shared = { value: 1 }; class Box { get value() { return shared; } } const box = new Box(); delete box.value; return shared.value;",
  ],
  [
    "static getter assignment",
    "const shared = { value: 1 }; class Box { static get value() { return shared; } } Box.value = {}; return shared.value;",
  ],
  [
    "static getter deletion",
    "const shared = { value: 1 }; class Box { static get value() { return shared; } } delete Box.value; return shared.value;",
  ],
])(
  "does not follow a class getter for direct property replacement or deletion (%s)",
  (_name, body) => {
    expect(resultValue(body)).toEqual({ status: "literal", value: 1 });
  },
);

describe("JavaScript semantic values after mutable references escape", () => {
  it("preserves copied scalar slots while invalidating shared children of an escaped object spread", () => {
    expect(
      resultValue(`
      const source = { kind: "record", child: { value: 1 } };
      const copy = { ...source };
      mutate(copy);
      return source;
    `),
    ).toMatchObject({
      status: "object",
      properties: [
        { name: "child", value: { status: "unknown" }, presence: "present" },
        { name: "kind", value: { status: "literal", value: "record" } },
      ],
    });
  });

  it("invalidates shared array children without invalidating copied primitives", () => {
    expect(
      resultValue(`
      const child = { value: 1 };
      const source = [child, "TOKEN"];
      const copy = [...source];
      mutate(copy);
      return { token: source[1], value: child.value };
    `),
    ).toMatchObject({
      status: "object",
      properties: [
        { name: "token", value: { status: "literal", value: "TOKEN" } },
        { name: "value", value: { status: "unknown" } },
      ],
    });
  });

  it("keeps primitive spread arguments known", () => {
    expect(
      resultValue(
        'const values = ["TOKEN"]; consume(...values); return values[0];',
      ),
    ).toEqual({ status: "literal", value: "TOKEN" });
  });

  it("does not treat a member constructor as a call with its container as receiver", () => {
    expect(
      resultValue(`
      const namespace = { token: "TOKEN", Factory: class {} };
      new namespace.Factory();
      return namespace.token;
    `),
    ).toEqual({ status: "literal", value: "TOKEN" });
  });

  it("does not reuse an initializer projection cached before call mutations were collected", () => {
    expect(
      resultValue(`
      const source = { value: 1 };
      function observe() { consume(copy); }
      mutate(source);
      const copy = source.value;
      return copy;
    `)?.status,
    ).toBe("unknown");
  });

  it.each([
    "mutate(source as unknown);",
    "mutate((0, source));",
    "let alias; mutate(alias = source);",
    "mutate(flag ? source : {});",
    "let alias = source; mutate(alias ||= {});",
    "let alias = source; mutate(alias ??= {});",
  ])("follows a reference through %s", (invocation) => {
    expect(
      resultValue(`
      const source = { value: 1 };
      ${invocation}
      return source.value;
    `)?.status,
    ).toBe("unknown");
  });
});

describe("JavaScript escaped references through async and destructuring syntax", () => {
  it("follows an awaited object argument", () => {
    const ir = analyzeJavaScriptSemantics(`export async function result() {
      const source = { value: 1 };
      mutate(await source);
      return source.value;
    }`);
    expect(onlyCallable(ir, "result").returnSites[0]?.value.status).toBe(
      "unknown",
    );
  });

  it.each([
    "const { ...copy } = source; mutate(copy);",
    "const { ...copy } = source; mutate(copy.child);",
    "const [ ...copy ] = [source.child]; mutate(copy);",
    "const [ first, ...copy ] = [null, source.child]; mutate(copy[0]);",
    "const [ ...[copy] ] = [source.child]; mutate(copy);",
    "const [ ...[copy = source.child] ] = []; mutate(copy);",
    "const { value = source.child } = {}; mutate(value);",
    "const [ value = source.child ] = []; mutate(value);",
  ])("follows shared references through %s", (invocation) => {
    expect(
      resultValue(`
      const source = { kind: "record", child: { value: 1 } };
      ${invocation}
      return source;
    `),
    ).toMatchObject({
      status: "object",
      properties: [
        { name: "child", value: { status: "unknown" }, presence: "present" },
        { name: "kind", value: { status: "literal", value: "record" } },
      ],
    });
  });

  it("keeps an unused default reference unchanged when destructuring a defined value", () => {
    expect(
      resultValue(`
      const source = { value: "TOKEN" };
      const { value = source } = { value: 1 };
      mutate(value);
      return source.value;
    `),
    ).toEqual({ status: "literal", value: "TOKEN" });
  });

  it("keeps an unused nested default reference unchanged", () => {
    expect(
      resultValue(`
      const unused = { value: "TOKEN" };
      const { box: { value = unused } = { value: 1 } } = {};
      mutate(value);
      return unused.value;
    `),
    ).toEqual({ status: "literal", value: "TOKEN" });
  });

  it("reconsiders a destructuring fallback after later collection finds an escape", () => {
    expect(
      resultValue(`
      const fallback = { value: 1 };
      const source = { child: { value: 2 } };
      function observe() { mutate(copy); }
      remove(source);
      const { child: copy = fallback } = source;
      mutate(copy);
      return fallback.value;
    `)?.status,
    ).toBe("unknown");
  });

  it("follows a fallback write when the original projection appeared primitive", () => {
    expect(
      resultValue(`
      const fallback = { value: 1 };
      const source = { child: 1 };
      function observe() { copy.value = 2; }
      remove(source);
      const { child: copy = fallback } = source;
      observe();
      return fallback.value;
    `)?.status,
    ).toBe("unknown");
  });

  it("keeps fresh rest-copy slot writes from changing the original", () => {
    expect(
      resultValue(`
      const source = { child: { value: "TOKEN" } };
      const { ...copy } = source;
      copy.child = {};
      return source.child.value;
    `),
    ).toEqual({ status: "literal", value: "TOKEN" });
  });

  it("follows writes to shared children of rest copies", () => {
    expect(
      resultValue(`
      const source = { kind: "record", child: { value: 1 } };
      const { ...copy } = source;
      copy.child.value = 2;
      return { kind: source.kind, value: source.child.value };
    `),
    ).toMatchObject({
      status: "object",
      properties: [
        { name: "kind", value: { status: "literal", value: "record" } },
        { name: "value", value: { status: "unknown" } },
      ],
    });
  });

  it.each([
    "const source = { skipped: {}, child: { value: 1 } }; const { skipped, ...copy } = source; mutate(copy); return source.child.value;",
    "const source = [{}, { value: 1 }]; const [head, ...copy] = source; mutate(copy[0]); return source[1].value;",
    "const source = [{}, { value: 1 }]; const [head, ...copy] = source; copy[0].value = 2; return source[1].value;",
    "const source = { child: { value: 1 } }; const copy = { child: {}, ...source }; mutate(copy.child); return source.child.value;",
    "const source = { child: { value: 1 } }; const copy = { ...source, [key]: {} }; mutate(copy.child); return source.child.value;",
    "const source = [{ value: 1 }]; const copy = [{}, ...source]; mutate(copy[1]); return source[0].value;",
    "const source = [{ value: 1 }]; const copy = [...other, ...source]; mutate(copy[0]); return source[0].value;",
    "const source = [{ value: 1 }]; mutate([... [...source]]); return source[0].value;",
    "const child = { value: 1 }; const source = { child, *[Symbol.iterator]() { yield this.child; } }; const copy = [{}, ...source]; mutate(copy[1]); return child.value;",
    "const child = { value: 1 }; const source = { child, *[Symbol.iterator]() { yield null; yield this.child; } }; const [head, ...copy] = source; mutate(copy); return child.value;",
    "const child = { value: 1 }; const source = [child]; source[Symbol.iterator] = function* () { yield null; yield this[0]; }; const [head, ...copy] = source; mutate(copy); return child.value;",
    "const child = { value: 1 }; const source = [null, child]; source.__proto__ = { *[Symbol.iterator]() { yield this[1]; } }; const copy = [{}, ...source]; mutate(copy[1]); return child.value;",
    "const source = [{ value: 1 }, {}]; Array.prototype[Symbol.iterator] = function* () { yield null; yield this[0]; }; const [head, ...copy] = source; mutate(copy[0]); return source[0].value;",
    "const source = [null, { value: 1 }]; const prototype = Array.prototype; prototype[Symbol.iterator] = function* () { yield this[1]; }; const copy = [{}, ...source]; mutate(copy[1]); return source[1].value;",
    "const source = [null, { value: 1 }]; const other = []; other.__proto__[Symbol.iterator] = function* () { yield this[1]; }; const copy = [{}, ...source]; mutate(copy[1]); return source[1].value;",
    "const source = { child: { value: 1 } }; const copy = { ...source, get child() { return source.child; } }; mutate(copy.child); return source.child.value;",
    "const source = { child: { value: 1 } }; const copy = { ...source, get child() { return source.child; }, set child(value) {} }; mutate(copy.child); return source.child.value;",
  ])("preserves uncertainty for retained shared children: %s", (body) => {
    expect(resultValue(body)?.status).toBe("unknown");
  });

  it("finishes repeated alias branches without expanding identical escape paths", () => {
    const declarations = Array.from({ length: 24 }, (_, index) => {
      const name = `alias${String(index + 1)}`;
      const previous = `alias${String(index)}`;
      return `let ${name} = ${previous}; ${name} = ${previous};`;
    }).join("\n");
    expect(
      resultValue(`
      let alias0 = { value: 1 };
      ${declarations}
      mutate(alias24);
      return alias0.value;
    `)?.status,
    ).toBe("unknown");
  });
});

describe("JavaScript shared array iteration", () => {
  it.each([
    "mutate(...source);",
    "mutate?.(...source);",
    "new Factory(...source);",
    "const copy = [...source]; mutate(copy);",
    "const copy = [{}, ...source]; mutate(copy[1]);",
    "const copy = [...source]; copy[0].value = 2;",
    "const [...copy] = source; mutate(copy);",
    "const [...copy] = source; copy[0].value = 2;",
    "const wrapper = { source }; const { source: [...copy] } = wrapper; mutate(copy);",
    "const [copy] = source; mutate(copy);",
    "let copy; [copy] = source; mutate(copy);",
    "const { nested: [copy] } = { nested: source }; mutate(copy);",
    "for (const copy of source) mutate(copy);",
    "let copy; for (copy of source) mutate(copy);",
  ])("invalidates an iterable that yields itself through %s", (effect) => {
    expect(
      resultValue(`
        const source = { *[Symbol.iterator]() { yield this; }, value: "TOKEN" };
        ${effect}
        return source.value;
      `)?.status,
    ).toBe("unknown");
  });

  it.each([
    "const [copy] = source;",
    "const copy = [...source];",
    "for (const copy of source) {}",
    "const { nested: [copy] } = { nested: source };",
    "const [...[[copy]]] = [source];",
    "const [...{ 0: [copy] }] = [source];",
    "for (const [copy] of [source]) {}",
    "const { missing: [copy] = source } = {};",
    "function consume([copy] = source) {} consume();",
    "function* copies() { yield* source; } consume(copies());",
  ])("accounts for custom iterator receiver effects in %s", (iteration) => {
    expect(
      resultValue(`
        const source = { *[Symbol.iterator]() { this.value = "changed"; yield this; }, value: "TOKEN" };
        ${iteration}
        return source.value;
      `)?.status,
    ).toBe("unknown");
  });

  it.each([
    "const [copy] = source;",
    "const copy = [...source];",
    "for (const copy of source) {}",
    "const { nested: [copy] } = { nested: source };",
    "const [...[[copy]]] = [source];",
    "const [...{ 0: [copy] }] = [source];",
    "for (const [copy] of [source]) {}",
  ])("preserves ordinary array values after %s", (iteration) => {
    expect(
      resultValue(`const source = ["TOKEN"]; ${iteration} return source[0];`),
    ).toEqual({ status: "literal", value: "TOKEN" });
  });

  it.each([
    "const { nested: [copy] = source } = { nested: [] };",
    "const [[copy] = source] = [[]];",
    "const { a: { b: [copy] = source } = { b: [] } } = {};",
    "for (const { nested: [copy] = source } of [{ nested: [] }]) {}",
    "for (const [[copy] = source] of [[[]]]) {}",
    "for (const { nested: [copy] = source } of []) {}",
  ])("does not execute unused iterator defaults in %s", (iteration) => {
    expect(
      resultValue(`
        const source = { *[Symbol.iterator]() { yield this; }, value: "TOKEN" };
        ${iteration}
        return source.value;
      `),
    ).toEqual({ status: "literal", value: "TOKEN" });
  });

  it.each([
    "source[Symbol.iterator] = function* () { yield this; };",
    "Array.prototype[Symbol.iterator] = function* () { yield this; };",
  ])("invalidates a custom array iterator's root after %s", (override) => {
    expect(
      resultValue(`
        const source = ["TOKEN"];
        ${override}
        mutate(...source);
        return source[0];
      `)?.status,
    ).toBe("unknown");
  });

  it.each(["globalThis", "global", "window", "self"])(
    "retains uncertainty after %s.Array.prototype changes",
    (globalName) => {
      expect(
        resultValue(`
        const source = [null, { value: 1 }];
        ${globalName}.Array.prototype[Symbol.iterator] = function* () { yield this[1]; };
        const copy = [{}, ...source];
        mutate(copy[1]);
        return source[1].value;
      `)?.status,
      ).toBe("unknown");
    },
  );

  it("respects a shadowed global object when checking iteration", () => {
    expect(
      resultValue(`
      const globalThis = { Array: { prototype: {} } };
      globalThis.Array.prototype[Symbol.iterator] = function* () { yield null; };
      const source = [{ value: "TOKEN" }];
      const [head, ...copy] = source;
      mutate(copy);
      return source[0].value;
    `),
    ).toEqual({ status: "literal", value: "TOKEN" });
  });
});

const unchangedProperties = [
  'const source = { only: { value: "TOKEN" } }; const { only, ...copy } = source; mutate(copy); return source.only.value;',
  'const source = [{ value: "TOKEN" }]; const [head, ...copy] = source; mutate(copy); return source[0].value;',
  'const source = { child: { value: "TOKEN" } }; const copy = { ...source, child: { value: 2 } }; mutate(copy.child); return source.child.value;',
  'const source = [{ value: "TOKEN" }]; const copy = [{ value: 0 }, ...source]; mutate(copy[0]); return source[0].value;',
  'const source = { child: { value: "TOKEN" } }; const copy = { ...source, ["child"]: { value: 2 } }; mutate(copy); return source.child.value;',
  'const child = { value: "TOKEN" }; const copy = { child, child: {} }; mutate(copy); return child.value;',
  'const source = [{ value: "TOKEN" }, { value: 2 }]; const [head, ...copy] = source; mutate(copy[0]); return source[0].value;',
  'const source = [{ value: "TOKEN" }, { value: 2 }]; const copy = [{}, ...source]; mutate(copy[2]); return source[0].value;',
  'const source = [{ value: "TOKEN" }]; const copy = [, ...source]; mutate(copy[0]); return source[0].value;',
  'const source = [{ value: "TOKEN" }]; const copy = [...source]; mutate(copy["01"]); return source[0].value;',
  'const source = { only: { value: "TOKEN" } }; const { ["only"]: consumed, ...copy } = source; mutate(copy); return source.only.value;',
  'const source = { child: { value: "TOKEN" } }; const copy = { ...source, child() {} }; mutate(copy); return source.child.value;',
  'const source = { token: "TOKEN", count: 1 }; source.count = 2; return source.token;',
  'const source = { token: "TOKEN", count: 1 }; const alias = source; alias.count++; return source.token;',
  'const source = { token: "TOKEN", count: 1 }; delete source.count; return source.token;',
  'const source = { nested: { token: "TOKEN", count: 1 } }; source.nested.count = 2; return source.nested.token;',
  'const source = { nested: { token: "TOKEN", count: 1 } }; const { nested } = source; nested.count = 2; return source.nested.token;',
  'const child = { token: "TOKEN", count: 1 }; const source = { child }; source.child.count = 2; return child.token;',
  'const source = ["TOKEN", 1]; source[1] = 2; return source[0];',
  'const source = ["TOKEN"]; source.extra = 2; return source[0];',
  'const source = ["TOKEN"]; source["01"] = 2; return source[0];',
  'const source = ["TOKEN"]; source[1000000000] = 2; return source[0];',
  'const child = { token: "TOKEN", count: 1 }; const source = [child]; source[0].count = 2; return child.token;',
  'const source = { token: "TOKEN" }; source.added = 2; return source.token;',
  'const source = { token: "TOKEN", count: 1, other: 1 }; source.count = 2; source.other = 2; return source.token;',
  'const left = { token: "TOKEN", count: 1 }; const right = { count: 1 }; const source = { left, right }; source.right.count = 2; return left.count + ":" + left.token;',
];

describe("JavaScript semantic values for properties unaffected by a mutation", () => {
  it.each(unchangedProperties)("retains an unaffected property: %s", (body) => {
    expect(resultValue(body)).toEqual({
      status: "literal",
      value: body.includes("left.count") ? "1:TOKEN" : "TOKEN",
    });
  });

  it("keeps the changed slot unknown alongside an unchanged literal slot", () => {
    expect(
      resultValue(
        'const source = { token: "TOKEN", count: 1 }; source.count = 2; return source.count;',
      )?.status,
    ).toBe("unknown");
  });
});

describe("property mutations through TypeScript satisfies aliases", () => {
  it.each([
    'const shared = { mode: "initial" }; const alias = shared satisfies { mode: string }; alias.mode = "updated"; return shared.mode;',
    'const shared = { nested: { mode: "initial" } }; const alias = shared satisfies { nested: { mode: string } }; alias.nested.mode = "updated"; return shared.nested.mode;',
    'const shared = { mode: "initial" }; const alias = (shared satisfies { mode: string }) as { mode: string }; delete alias.mode; return shared.mode;',
    "const shared = [1]; const alias = shared satisfies number[]; alias[0]++; return shared[0];",
  ])("keeps the mutated value unknown: %s", (body) => {
    expect(resultValue(body)?.status).toBe("unknown");
  });

  it("retains the untouched property through a satisfies alias", () => {
    expect(
      resultValue(`
      const shared = { mode: "initial", token: "TOKEN" };
      const alias = shared satisfies { mode: string; token: string };
      alias.mode = "updated";
      return shared.token;
    `),
    ).toEqual({ status: "literal", value: "TOKEN" });
  });
});

describe("property mutation collection on minified bundles", () => {
  it("records each write to one object without replaying earlier writes", () => {
    const writes = Array.from(
      { length: 2000 },
      (_, index) => `source.p${index} = ${index};`,
    ).join(" ");
    const value = resultValue(
      `const source = { token: "TOKEN" }; ${writes} return [source.token, source.p1999];`,
    );
    expect(value).toMatchObject({
      status: "array",
      items: [
        { value: { status: "literal", value: "TOKEN" } },
        { value: { status: "unknown" } },
      ],
    });
  }, 30000);

  it("indexes many returned object methods instead of rescanning the object", () => {
    const methods = Array.from(
      { length: 2000 },
      (_, index) => `m${index}() { return shared; }`,
    ).join(",");
    const writes = Array.from(
      { length: 2000 },
      (_, index) => `box.m${index}().p${index} = ${index};`,
    ).join(" ");
    const value = resultValue(
      `const shared = { token: "TOKEN" }; const box = { ${methods} }; ${writes} return shared.token;`,
    );
    expect(value?.status).toBe("unknown");
  }, 30000);
});

describe("results of methods on an escaped receiver", () => {
  it("makes every method's distinct result uncertain, not only the called one", () => {
    expect(
      resultValue(
        'const first = { t: "A" }; const second = { t: "B" }; const kept = { t: "C" }; const box = { a() { return first; }, b() { return second; }, c() { return first; } }; box.a(); return [first.t, second.t, kept.t];',
      ),
    ).toMatchObject({
      status: "array",
      items: [
        { value: { status: "unknown" } },
        { value: { status: "unknown" } },
        { value: { status: "literal", value: "C" } },
      ],
    });
  });

  it("keeps a shared result uncertain across a wide escaped receiver (#1495)", () => {
    const count = 2000;
    const methods = Array.from(
      { length: count },
      (_, index) => `m${index}() { return shared; },`,
    ).join(" ");
    const calls = Array.from(
      { length: count },
      (_, index) => `box.m${index}().p${index} = ${index};`,
    ).join(" ");
    const value = resultValue(
      `const shared = { token: "TOKEN" }; const box = { ${methods} }; ${calls} return [shared.token];`,
    );
    expect(value).toMatchObject({
      status: "array",
      items: [{ value: { status: "unknown" } }],
    });
  }, 30000);
});

it.each([
  ["named", "@dec abstract slot: { mode: string };"],
  ["computed literal", '@dec abstract ["slot"]: { mode: string };'],
])(
  "retains the possible inherited alias through a decorated abstract %s field",
  (_name, field) => {
    // An emit that erases the field lets this write reach Base.slot. The
    // analysis must still invalidate shared even if another emit shadows it.
    const setup = `
      function dec(...args: unknown[]) {}
      const shared = { mode: "initial" };
      class Base { slot = shared; }
      abstract class Derived extends Base { ${field} }
      const Constructor = Derived as unknown as new () => Base;
    `;
    expect(resultValue(`${setup} return shared.mode;`)).toEqual({
      status: "literal",
      value: "initial",
    });
    expect(
      resultValue(`
        ${setup}
        new Constructor().slot.mode = "updated";
        return shared.mode;
      `),
    ).toMatchObject({ status: "unknown" });
  },
);
