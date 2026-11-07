import { describe, expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { onlyCallable } from "./javascriptSemanticAnalysis.fixture.js";

const resultValue = (body: string) =>
  onlyCallable(
    analyzeJavaScriptSemantics(`export function result() { ${body} }`),
    "result",
  ).returnSites[0]?.value;

describe("bounded paths through dynamic selectors and class origins", () => {
  it("bounds linked-list walks through class instances", () => {
    const start = performance.now();
    const analysis = analyzeJavaScriptSemantics(`
      class List { tail = null; }
      export function walk() {
        const list = new List();
        let node = list.tail;
        while (node) { use(node.value.parent); node = node.previous; }
        return 42;
      }
    `);
    expect(onlyCallable(analysis, "walk").returnSites[0]?.value).toEqual({
      status: "literal",
      value: 42,
    });
    expect(performance.now() - start).toBeLessThan(2000);
  }, 30000);

  it("retains effects through class getter aliases while bounding loop paths", () => {
    expect(
      resultValue(`
      const shared = { value: 1 };
      class List { get tail() { return { value: shared }; } }
      let node = new List().tail;
      while (node) { use(node.value); node = node.previous; }
      return shared.value;
    `)?.status,
    ).toBe("unknown");
  });

  it("bounds dynamic-key setter loops that also create literal containers", () => {
    const start = performance.now();
    const analysis = analyzeJavaScriptSemantics(`
      export function set(root, keys, value) {
        let node = root;
        for (const [index, key] of keys.entries()) {
          if (index === keys.length - 1) { node[key] = value; return root; }
          const child = node[key];
          if (isObject(child)) { node = child; continue; }
          const fresh = isIndex(keys[index + 1]) ? [] : {};
          node[key] = fresh;
          node = fresh;
        }
        return root;
      }
      export function unaffected() { return 42; }
    `);
    expect(onlyCallable(analysis, "unaffected").returnSites[0]?.value).toEqual({
      status: "literal",
      value: 42,
    });
    expect(onlyCallable(analysis, "set").returnSites[0]?.value.status).toBe(
      "unknown",
    );
    expect(performance.now() - start).toBeLessThan(2000);
  }, 30000);

  it("retains shared-child mutations reached by dynamic-key alias loops", () => {
    expect(
      resultValue(`
      const shared = { value: 1 };
      const source = { child: { next: shared }, keep: 3 };
      let node = source.child;
      while (flag) { node = node[key] || {}; node.value = 2; }
      return shared.value;
    `)?.status,
    ).toBe("unknown");
    expect(
      resultValue(`
      const source = { child: { value: 1 }, keep: 3 };
      let node = source.child;
      while (flag) { node = node[key] || {}; node.value = 2; }
      return source.keep;
    `),
    ).toEqual({ status: "literal", value: 3 });
  });
});

describe("bounded member path propagation", () => {
  it("bounds cyclic member paths with no observed container origin", () => {
    const branches = Array.from(
      { length: 16 },
      (_, index) => `if (flag === ${index}) node = node.m${index};`,
    ).join(" else ");
    const start = performance.now();
    const callable = onlyCallable(
      analyzeJavaScriptSemantics(
        `export function result(seed) { let node=seed; while(node) { ${branches} use(node.state); } return seed.keep; }`,
      ),
      "result",
    );
    expect(callable.returnSites[0]?.value.status).toBe("unknown");
    expect(performance.now() - start).toBeLessThan(2000);
  }, 30000);

  it("preserves Array prototype effects through an otherwise unknown alias", () => {
    expect(
      resultValue(
        "const values=[1]; const prototype=Array.prototype; prototype[Symbol.iterator]=custom; for(const item of values) { mutate(item); } return values[0];",
      )?.status,
    ).toBe("unknown");
  });

  it("bounds loops derived from a scalar member while preserving sibling facts", () => {
    const branches = Array.from(
      { length: 16 },
      (_, index) => `if (flag === ${index}) node = node.m${index};`,
    ).join(" else ");
    const start = performance.now();
    expect(
      resultValue(
        `const source={child:1,keep:{value:3}}; let node=source.child; while(node) { ${branches} use(node.state); } return source.keep.value;`,
      ),
    ).toEqual({ status: "literal", value: 3 });
    expect(performance.now() - start).toBeLessThan(2000);
  }, 30000);

  // A dynamic self alias escapes its repeated prefix, which conservatively
  // covers every child; a static key without that slot keeps the literal.
  it.each([
    ["node = node[key]", "node.name.toLowerCase();", "unknown"],
    ["node = node[key]", "mutate(node);", "unknown"],
    ["node = node[key]", "node.value = 2;", "unknown"],
    ["node = node.next", "node.value = 2;", "literal"],
  ])(
    "bounds a self alias below an observed container: %s; %s",
    (alias, effect, status) => {
      const start = performance.now();
      const value = resultValue(
        `class Item {} const seed = { child: { value: 1 } }; let node = flag ? seed : new Item(); while ((${alias})) ${effect} return seed.child.value;`,
      );
      expect(performance.now() - start).toBeLessThan(2000);
      expect(value?.status).toBe(status);
    },
    30000,
  );

  it.each([
    ["child:external,", "child", "present"],
    ["", "missing", "unknown-coverage"],
  ])(
    "retains slot presence below an unobserved container: %s",
    (property, name, presence) => {
      expect(
        resultValue(
          `const source={${property}keep:3}; const alias=source.${name}; alias.deep.value=2; return source;`,
        ),
      ).toMatchObject({
        status: "object",
        properties: expect.arrayContaining([
          {
            name,
            presence,
            value: {
              status: "unknown",
              reason: "This property may have been mutated.",
            },
          },
          {
            name: "keep",
            presence: "present",
            value: { status: "literal", value: 3 },
          },
        ]),
      });
    },
  );

  it.each([
    ["use(node);", "m0.value", "unknown"],
    ["node.value = 2;", "m0.value", "unknown"],
    ["node.value = 2;", "mode", "literal"],
  ])(
    "bounds a loop that reassigns one reference through many members: %s seed.%s",
    (effect, read, status) => {
      const branches = Array.from(
        { length: 9 },
        (_, index) => `if (flag === ${index}) node = node.m${index};`,
      ).join(" else ");
      const start = performance.now();
      const value = resultValue(
        `const seed = { mode: "initial", m0: { value: 1 } }; let node = seed; while (node) { ${branches} ${effect} } return seed.${read};`,
      );
      expect(performance.now() - start).toBeLessThan(2000);
      expect(value?.status).toBe(status);
    },
    30000,
  );

  it.each([
    ["const alias = flag ? owner.child : owner; alias.value = 2;", "value"],
    ["const alias = flag ? owner : owner.child; alias.value = 2;", "value"],
    ["const alias = flag ? owner.child : owner; alias[key] = 2;", "value"],
    [
      "const alias = flag ? owner.child : owner; alias.child = 2;",
      "child.value",
    ],
    [
      "let alias = owner; let i = 0; while (i++ < 1) { alias = flag ? alias.child : alias; alias.value = 2; }",
      "value",
    ],
    [
      "let alias = owner; let i = 0; while (i++ < 1) { alias = flag ? alias.child : alias; alias.value = 2; }",
      "child.value",
    ],
  ])(
    "keeps a write that reaches a child through a longer path: %s",
    (body, read) => {
      expect(
        resultValue(
          `const shared = { value: 1, child: { value: 1 } }; const owner = { child: shared }; ${body} return shared.${read};`,
        )?.status,
      ).toBe("unknown");
    },
  );

  it.each([
    "mutate(source.left, source.right);",
    "const alias = flag ? source.left : source.right; mutate(alias);",
    "const copy = flag ? [source.left] : [source.right]; mutate(copy);",
    "const alias = flag ? source.left : source.right; alias.value = 2;",
  ])("keeps members outside the mutated paths: %s", (body) => {
    expect(
      resultValue(
        `const source = { left: { value: 1 }, right: { value: 2 }, keep: { value: 3 } }; ${body} return source.keep.value;`,
      ),
    ).toEqual({ status: "literal", value: 3 });
  });
});

describe("distinct observable mutation paths", () => {
  it.each([
    ["alias.value = 2;", "left"],
    ["alias.value = 2;", "right"],
    ["mutate(alias);", "left"],
    ["mutate(alias);", "right"],
  ])(
    "propagates both conditional paths to shared bindings: %s %s",
    (effect, target) => {
      expect(
        resultValue(
          `const left={value:1}; const right={value:2}; const source={left,right}; const alias=flag?source.left:source.right; ${effect} return ${target}.value;`,
        )?.status,
      ).toBe("unknown");
    },
  );

  it.each(["mutate(alias);", "alias.value = 2;"])(
    "preserves sibling facts below a shared prefix: %s",
    (effect) => {
      expect(
        resultValue(
          `const shared={left:{value:1},right:{value:2},keep:{value:3}}; const source={nested:shared}; const alias=flag?source.nested.left:source.nested.right; ${effect} return shared.keep.value;`,
        ),
      ).toEqual({ status: "literal", value: 3 });
    },
  );
});

describe("reference lifetimes across calls and shallow copies", () => {
  it("bounds dynamic destructuring across shared alias branches", () => {
    const declarations = Array.from(
      { length: 9 },
      (_, index) =>
        `const alias${index + 1} = { left: alias${index}, right: alias${index} };`,
    ).join("\n");
    const pattern = "{ [key]: ".repeat(9) + "[copy]" + " }".repeat(9);
    const start = performance.now();
    resultValue(
      `const alias0 = [1]; ${declarations} const ${pattern} = alias9; return alias0[0];`,
    );
    expect(performance.now() - start).toBeLessThan(2000);
  }, 30000);

  it("bounds conditional shallow-copy traversal while retaining shared children", () => {
    const declarations = Array.from(
      { length: 20 },
      (_, i) =>
        `const alias${i + 1} = flag ? {...alias${i}, a${i}:{}} : {...alias${i}, b${i}:{}};`,
    ).join("\n");
    const start = performance.now();
    expect(
      resultValue(
        `const alias0 = { value: { token: 1 } }; ${declarations} consume(alias20); return alias0.value.token;`,
      )?.status,
    ).toBe("unknown");
    expect(performance.now() - start).toBeLessThan(2000);
  }, 30000);

  it.each([
    ["child: {}", "child: {}", "literal"],
    ["child: {}", "other: {}", "unknown"],
  ])(
    "retains exclusions common to both branches: %s / %s",
    (left, right, status) => {
      expect(
        resultValue(
          `const source = {child:{value:1}}; const copy = flag ? {...source, ${left}} : {...source, ${right}}; consume(copy); return source.child.value;`,
        )?.status,
      ).toBe(status);
    },
  );

  it.each([
    "mutate(alias)",
    "alias.method()",
    "new Factory(alias)",
    "tag`${alias}`",
    "alias.tag``",
    "mutate((0, alias))",
  ])("drops replaced call origins for %s", (call) => {
    expect(
      resultValue(
        `const source={value:1}; let alias=source; alias={}; ${call}; return source.value;`,
      ),
    ).toEqual({ status: "literal", value: 1 });
  });

  it.each([
    "mutate(alias); alias={};",
    "if(flag) alias={}; mutate(alias);",
    "alias={}; if(flag) mutate(alias);",
    "alias={}; flag && mutate(alias);",
    "alias={}; flag ? mutate(alias) : noop();",
    "function invoke(){mutate(alias);} alias={}; invoke();",
    "alias={}; mutate(alias); alias=source;",
  ])("retains uncertain call ordering: %s", (body) => {
    expect(
      resultValue(
        `const source={value:1}; let alias=source; ${body} return source.value;`,
      )?.status,
    ).toBe("unknown");
  });

  it.each([
    ["let {...copy}={child};", "copy={child:{}};", "copy.child.value=2;"],
    ["let [...copy]=[child];", "copy=[{}];", "copy[0].value=2;"],
    ["let {copy=child}={};", "copy={};", "copy.value=2;"],
    ["let [copy=child]=[];", "copy={};", "mutate(copy);"],
  ])(
    "drops replaced rest/default origins: %s",
    (declaration, rebind, mutation) => {
      expect(
        resultValue(
          `const child={value:1}; ${declaration} ${rebind} ${mutation} return child.value;`,
        ),
      ).toEqual({ status: "literal", value: 1 });
      expect(
        resultValue(
          `const child={value:1}; ${declaration} if(flag) ${rebind} ${mutation} return child.value;`,
        )?.status,
      ).toBe("unknown");
    },
  );
});

describe("capture ordering within declarations and expressions", () => {
  it.each([
    "const ignored = mutate(source);",
    "void mutate(source);",
    "consume(mutate(source));",
  ])("preserves a primitive before a later nested call: %s", (escape) => {
    expect(
      resultValue(
        `const source={value:1}; const snapshot=source.value; ${escape} return snapshot;`,
      ),
    ).toEqual({ status: "literal", value: 1 });
    expect(
      resultValue(
        `const source={value:1}; ${escape} const snapshot=source.value; return snapshot;`,
      )?.status,
    ).toBe("unknown");
  });

  it("preserves a primitive before an awaited escape", () => {
    const value = onlyCallable(
      analyzeJavaScriptSemantics(`export async function result() {
        const source={value:1}; const snapshot=source.value;
        await mutate(source); return snapshot;
      }`),
      "result",
    ).returnSites[0]?.value;
    expect(value).toEqual({ status: "literal", value: 1 });
  });

  it.each([
    "({value:1} as {value:number})",
    "({value:1} satisfies {value:number})",
    "({value:1})!",
  ])("classifies transparent initializer wrappers: %s", (source) => {
    expect(
      resultValue(
        `const source=${source}; const snapshot=source.value; mutate(source); return snapshot;`,
      ),
    ).toEqual({ status: "literal", value: 1 });
    expect(
      resultValue(
        `const source=${source}; mutate(source); const snapshot=source.value; return snapshot;`,
      )?.status,
    ).toBe("unknown");
  });

  it.each(["(source as {value:number})", "(source satisfies {value:number})"])(
    "captures through a wrapped alias: %s",
    (alias) => {
      expect(
        resultValue(
          `const source={value:1}; const alias=${alias}; const snapshot=alias.value; mutate(alias); return snapshot;`,
        ),
      ).toEqual({ status: "literal", value: 1 });
    },
  );

  it.each([
    ["{child:{}}", "{child:copy=fallback}"],
    ["[{}]", "[copy=fallback]"],
  ])("guards fallback selection before escape: %s", (source, pattern) => {
    expect(
      resultValue(
        `const fallback={value:1}; const source=${source}; const ${pattern}=source; mutate(copy); return fallback.value;`,
      ),
    ).toEqual({ status: "literal", value: 1 });
    expect(
      resultValue(
        `const fallback={value:1}; const source=${source}; mutate(source); const ${pattern}=source; mutate(copy); return fallback.value;`,
      )?.status,
    ).toBe("unknown");
  });

  it.each([
    "const source={value:1}, snapshot=source.value; mutate(source);",
    "const source={value:1}, snapshot=source.value, ignored=mutate(source);",
  ])("preserves sequential declarator captures: %s", (body) => {
    expect(resultValue(`${body} return snapshot;`)).toEqual({
      status: "literal",
      value: 1,
    });
  });

  it("retains an escape in an earlier declarator", () => {
    expect(
      resultValue(
        "const source={value:1}, ignored=mutate(source), snapshot=source.value; return snapshot;",
      )?.status,
    ).toBe("unknown");
  });
});

describe("primitive snapshots across calls", () => {
  it.each([
    "const [copy] = source;",
    "const copy = [...source];",
    "for (const copy of source) {}",
  ])("preserves snapshots taken before custom iteration: %s", (iteration) => {
    expect(
      resultValue(`
        const source = { *[Symbol.iterator]() { yield this; }, value: 1 };
        const snapshot = source.value;
        ${iteration}
        return snapshot;
      `),
    ).toEqual({ status: "literal", value: 1 });
  });

  it.each([
    "const [copy] = alias;",
    "const copy = [...alias];",
    "for (const copy of alias) {}",
  ])("ignores iterable aliases replaced before %s", (iteration) => {
    expect(
      resultValue(`
        const source = { *[Symbol.iterator]() { yield this; }, value: 1 };
        let alias = source;
        alias = [];
        ${iteration}
        return source.value;
      `),
    ).toEqual({ status: "literal", value: 1 });
  });

  it.each([
    ["const snapshot=source.value;", "snapshot"],
    ["const {value:snapshot}=source;", "snapshot"],
    ["const copy={value:source.value};", "copy.value"],
    ['const copy={["snapshot"]:source.value};', "copy.snapshot"],
    ['const copy={[""]:source.value};', 'copy[""]'],
    ["const copy={[0]:source.value};", "copy[0]"],
    ['const copy={[("snapshot" as string)]:source.value};', "copy.snapshot"],
    ["const copy=[source.value];", "copy[0]"],
  ])("preserves primitive capture before escape: %s", (capture, result) => {
    expect(
      resultValue(
        `const source={value:1}; ${capture} mutate(source); return ${result};`,
      ),
    ).toEqual({ status: "literal", value: 1 });
    expect(
      resultValue(
        `const source={value:1}; mutate(source); ${capture} return ${result};`,
      )?.status,
    ).toBe("unknown");
  });

  it.each([
    ["const copy={value:source.value};", "copy.value"],
    ["const copy=[source.value];", "copy[0]"],
  ])(
    "retains a literal field's earlier primitive capture: %s",
    (copy, read) => {
      expect(
        resultValue(
          `const source={value:1}; ${copy} mutate(source); const snapshot=${read}; mutate(copy); return snapshot;`,
        ),
      ).toEqual({ status: "literal", value: 1 });
      expect(
        resultValue(
          `const source={value:1}; mutate(source); ${copy} const snapshot=${read}; mutate(copy); return snapshot;`,
        )?.status,
      ).toBe("unknown");
    },
  );

  it.each([
    ["const copy={child:source.child};", "copy.child"],
    ["const copy=[source.child];", "copy[0]"],
  ])(
    "keeps a shared child uncertain across both capture points: %s",
    (copy, read) => {
      expect(
        resultValue(
          `const source={child:{value:1}}; ${copy} mutate(source); const snapshot=${read}; mutate(copy); return snapshot.value;`,
        )?.status,
      ).toBe("unknown");
    },
  );

  it.each([
    "const alias=source; const snapshot=alias.value; mutate(alias); return snapshot;",
    "const alias=source.child; const snapshot=alias.value; mutate(alias); return snapshot;",
  ])("captures through an earlier intermediate reference: %s", (body) => {
    expect(
      resultValue(`const source={value:1,child:{value:1}}; ${body}`),
    ).toEqual({ status: "literal", value: 1 });
  });

  it("does not read a later alias initializer at an earlier capture point", () => {
    expect(
      resultValue(
        "const source={value:1}; var alias; const snapshot=alias?.value; mutate(source); alias=source; return snapshot;",
      )?.status,
    ).toBe("unknown");
  });

  it("does not treat a persistent child as freshly allocated with its wrapper", () => {
    const ir = analyzeJavaScriptSemantics(
      "const child={value:1}; export function result(){const source={child}; const alias=source.child; const snapshot=alias.value; mutate(alias); return snapshot;}",
    );
    expect(onlyCallable(ir, "result").returnSites[0]?.value.status).toBe(
      "unknown",
    );
  });

  it("keeps persistent sources uncertain across function activations", () => {
    const ir = analyzeJavaScriptSemantics(
      "const source={value:1}; export function result(){const snapshot=source.value; mutate(source); return snapshot;}",
    );
    expect(onlyCallable(ir, "result").returnSites[0]?.value.status).toBe(
      "unknown",
    );
  });

  it("keeps reads from earlier loop iterations uncertain", () => {
    expect(
      resultValue(
        "const source={value:1}; for(let i=0;i<2;i++){const snapshot=source.value; mutate(source); if(i===1)return snapshot;}",
      )?.status,
    ).toBe("unknown");
  });

  it.each([
    "const copy={child:source.child}; return copy.child.value;",
    "const copy=source.child; return copy.value;",
    "const copy=[source.child]; return copy[0].value;",
  ])("keeps shared children live: %s", (body) => {
    expect(
      resultValue(
        `const source={child:{value:1}}; ${body.replace("return", "mutate(source); return")}`,
      )?.status,
    ).toBe("unknown");
  });
});

describe("references captured before an intermediate rebind", () => {
  it.each([
    ["const saved=alias;", "alias=saved;", "mutate(alias);"],
    ["const saved=alias;", "alias=saved;", "alias.value=9;"],
    ["const saved={child:alias};", "alias=saved.child;", "mutate(alias);"],
    ["const {...saved}={child:alias};", "alias=saved.child;", "mutate(alias);"],
    ["const [...saved]=[alias];", "alias=saved[0];", "mutate(alias);"],
    ["const {saved=alias}={};", "alias=saved;", "mutate(alias);"],
  ])("follows an alias restored from %s", (capture, restore, effect) => {
    expect(
      resultValue(
        `const source={value:1}; let alias=source; ${capture} ${restore} ${effect} return source.value;`,
      )?.status,
    ).toBe("unknown");
  });

  it.each([
    ["const saved=alias;", "mutate(saved);"],
    ["const saved={child:alias};", "mutate(saved.child);"],
    ["const {...saved}={child:alias};", "mutate(saved.child);"],
    ["const [...saved]=[alias];", "mutate(saved[0]);"],
    ["const {saved=alias}={};", "mutate(saved);"],
    ["const [saved=alias]=[];", "mutate(saved);"],
    ["const saved=alias;", "saved.method();"],
    ["const saved=alias;", "mutate(alias,saved);"],
    ["const saved=alias;", "mutate(saved,alias);"],
  ])("preserves the original reference captured by %s", (capture, effect) => {
    expect(
      resultValue(
        `const source={value:1}; let alias=source; ${capture} alias={}; ${effect} return source.value;`,
      )?.status,
    ).toBe("unknown");
    expect(
      resultValue(
        `const source={value:1}; let alias=source; alias={}; ${capture} ${effect} return source.value;`,
      ),
    ).toEqual({ status: "literal", value: 1 });
  });

  it.each([
    [
      "let {...alias}={child:source};",
      "alias={child:{}};",
      "saved.child.value=9;",
    ],
    ["let [...alias]=[source];", "alias=[{}];", "saved[0].value=9;"],
    ["let {alias=source}={};", "alias={};", "saved.value=9;"],
    ["let [alias=source]=[];", "alias={};", "saved.value=9;"],
  ])(
    "preserves a saved rest/default reference from %s",
    (declaration, rebind, effect) => {
      expect(
        resultValue(
          `const source={value:1}; ${declaration} const saved=alias; ${rebind} ${effect} return source.value;`,
        )?.status,
      ).toBe("unknown");
      expect(
        resultValue(
          `const source={value:1}; ${declaration} ${rebind} const saved=alias; ${effect} return source.value;`,
        ),
      ).toEqual({ status: "literal", value: 1 });
    },
  );
});
