import { describe, expect, it } from "vitest";

import {
  analyzeJavaScriptSemantics,
  analyzeParsedJavaScriptSemantics,
} from "./javascriptSemanticAnalysis.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import {
  onlyCallable,
  topLevelBinding,
} from "./javascriptSemanticAnalysis.fixture.js";

describe("JavaScript semantic analysis: dataflow 1", () => {
  it("recovers static object reads, writes, spreads, and destructuring", () => {
    const ir = analyzeJavaScriptSemantics(`
      const source = { token: "TOKEN", count: 1 };
      const { token } = source;
      const copy = { ...source };
      source.count = 2;
      const read = source.token;
    `);

    expect(
      ir.objectOperations.map(({ kind, propertyPath, resolution }) => ({
        kind,
        propertyPath,
        resolution,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "destructure",
          propertyPath: ["token"],
          resolution: "complete",
        },
        { kind: "spread", propertyPath: [], resolution: "complete" },
        { kind: "write", propertyPath: ["count"], resolution: "complete" },
        { kind: "read", propertyPath: ["token"], resolution: "complete" },
      ]),
    );
  });

  it("does not invent property names for dynamic destructuring keys", () => {
    const ir = analyzeJavaScriptSemantics(`
      const source = { token: "TOKEN" };
      const key = getKey();
      const { [key]: dynamic } = source;
      const { ["token"]: literal } = source;
      const { token: renamed } = source;
      const { token } = source;
      const { [1]: numeric } = source;
    `);
    const destructures = ir.objectOperations.filter(
      ({ kind }) => kind === "destructure",
    );

    expect(destructures.map(({ propertyPath }) => propertyPath)).toEqual([
      ["token"],
      ["token"],
      ["token"],
      ["1"],
    ]);
    expect(
      destructures.every(({ resolution }) => resolution === "complete"),
    ).toBe(true);
    expect(topLevelBinding(ir, "dynamic").value.status).toBe("unknown");
  });

  it("does not project positional argument flow after a spread", () => {
    const ir = analyzeJavaScriptSemantics(`
      function target(first, second, third) { return third; }
      target(one, ...rest, three);
    `);

    expect(ir.argumentFlows.map(({ argumentIndex }) => argumentIndex)).toEqual([
      0,
    ]);
  });

  it("retains all statically recovered call, flow, capture, and frontier facts", () => {
    const ir = analyzeJavaScriptSemantics(
      `
        const captured = 1;
        function target(value, other) { return value + other + captured; }
        target(1, 2);
        target(3, 4);
        object[first];
        object[second];
      `,
    );

    expect(ir.callSites).toHaveLength(2);
    expect(ir.callSites.map(({ arguments: args }) => args)).toEqual([
      [
        expect.objectContaining({ index: 0, spread: false }),
        expect.objectContaining({ index: 1, spread: false }),
      ],
      [
        expect.objectContaining({ index: 0, spread: false }),
        expect.objectContaining({ index: 1, spread: false }),
      ],
    ]);
    expect(ir.argumentFlows).toHaveLength(4);
    expect(ir.callReturnFlows).toHaveLength(2);
    expect(ir.closureCaptures).toHaveLength(1);
    expect(ir.frontiers).toHaveLength(2);
    expect(ir.coverage.status).toBe("complete");
  });

  it("recovers only direct return sites with literal and unknown object fields", () => {
    const ir = analyzeJavaScriptSemantics(`
      export default function parseMarkdown(value) {
        if (value.startsWith("# "))
          return { type: "heading", depth: 1, text: value.slice(2) };
        function nested() { return { type: "nested" }; }
        const arrow = () => ({ type: "arrow" });
        void nested; void arrow;
        return { type: "paragraph", text: value.replaceAll("x", "y") };
      }
    `);

    const parse = onlyCallable(ir, "parseMarkdown");
    expect(parse.returnCoverage).toEqual({
      status: "complete",
      retainedCount: 2,
      omittedCount: 0,
    });
    expect(parse.returnSites).toHaveLength(2);
    expect(parse.returnSites[0]?.value).toMatchObject({
      status: "object",
      unknownProperties: false,
      omittedProperties: 0,
      properties: expect.arrayContaining([
        {
          name: "depth",
          presence: "present",
          value: { status: "literal", value: 1 },
        },
        {
          name: "type",
          presence: "present",
          value: { status: "literal", value: "heading" },
        },
        {
          name: "text",
          presence: "present",
          value: {
            status: "unknown",
            reason: "Unsupported CallExpression value.",
          },
        },
      ]),
    });
    expect(onlyCallable(ir, "nested").returnSites).toHaveLength(1);
    expect(onlyCallable(ir, "arrow").returnSites).toHaveLength(1);
    expect(ir.moduleLinks).toContainEqual(
      expect.objectContaining({
        exportedName: "default",
        callableId: parse.callableId,
      }),
    );
  });
});

describe("JavaScript semantic call result flows", () => {
  it("links only directly assigned scalar call results", () => {
    const ir = analyzeJavaScriptSemantics(`
      function run() {
        const direct = produce();
        const { field } = unpack();
        const nested = outer(inner());
        return direct;
      }
    `);
    const bindingNames = new Map(
      ir.bindings.map(({ bindingId, name }) => [bindingId, name]),
    );

    expect(
      ir.callResultFlows.map(({ bindingId }) => bindingNames.get(bindingId)),
    ).toEqual(["direct", "nested"]);
    expect(ir.callSites).toHaveLength(4);
    expect(ir.callResultFlows.map(({ callSiteId }) => callSiteId)).toEqual([
      ir.callSites[0]?.callSiteId,
      ir.callSites[2]?.callSiteId,
    ]);
  });
});

describe("JavaScript semantic analysis: read-modify-write", () => {
  it.each(["+= 1", "++", "--", "||= 1", "&&= 1", "??= 1"])(
    "retains the property read in a read-modify-write operation: %s",
    (operator) => {
      const ir = analyzeJavaScriptSemantics(`
        const source = { count: 1 };
        source.count ${operator};
      `);
      expect(ir.objectOperations.map(({ kind }) => kind)).toEqual([
        "read",
        "write",
      ]);
    },
  );

  it("keeps plain member assignment write-only and member access read-only", () => {
    const ir = analyzeJavaScriptSemantics(`
      const source = { count: 1 };
      source.count = 2;
      const value = source.count;
    `);
    expect(ir.objectOperations.map(({ kind }) => kind)).toEqual([
      "write",
      "read",
    ]);
  });

  it.each([
    ["destructuring assignment", "[source.count] = [2];"],
    ["destructuring assignment with default", "[source.count = 2] = [];"],
    [
      "nested destructuring assignment",
      "({ value: { count: source.count } } = {});",
    ],
    ["rest destructuring assignment", "[...source.items] = [];"],
    ["for-of head", "for (source.count of [4]) {}"],
    ["for-in head", "for (source.count in { key: true }) {}"],
    ["delete", "delete source.count;"],
  ])("records a member target in %s as a write", (_name, statement) => {
    const ir = analyzeJavaScriptSemantics(`
      const source = { count: 1, items: [] };
      ${statement}
    `);
    expect(ir.objectOperations.map(({ kind }) => kind)).toEqual(["write"]);
  });

  it.each([
    ["non-null update", "source.count!++;"],
    ["non-null compound assignment", "source.count! += 1;"],
    ["cast compound assignment", "(source.count as number) += 1;"],
    ["parenthesized update", "(source.count)++;"],
  ])(
    "retains the property read in a wrapped read-modify-write: %s",
    (_name, statement) => {
      const ir = analyzeJavaScriptSemantics(`
        const source = { count: 1 };
        ${statement}
      `);
      expect(ir.objectOperations.map(({ kind }) => kind)).toEqual([
        "read",
        "write",
      ]);
    },
  );

  it.each([
    ["cast plain assignment", "(source.count as number) = 2;"],
    ["non-null delete", "delete source.count!;"],
  ])("keeps a wrapped %s write-only", (_name, statement) => {
    const ir = analyzeJavaScriptSemantics(`
      const source = { count: 1 };
      ${statement}
    `);
    expect(ir.objectOperations.map(({ kind }) => kind)).toEqual(["write"]);
  });

  it("keeps a member in a destructuring default value a read", () => {
    const ir = analyzeJavaScriptSemantics(`
      const source = { count: 1 };
      let value;
      [value = source.count] = [];
    `);
    expect(ir.objectOperations.map(({ kind }) => kind)).toEqual([
      "destructure",
      "read",
    ]);
  });

  it("does not model a compound binding write as a competing replacement", () => {
    const ir = analyzeJavaScriptSemantics(`
      let count = 1;
      count += 2;
    `);

    expect(topLevelBinding(ir, "count").value).toMatchObject({
      status: "unknown",
    });
  });
});

describe("JavaScript semantic analysis: wrapped binding targets", () => {
  it("records a wrapped identifier update as a read before a write", () => {
    const ir = analyzeJavaScriptSemantics(`
      let count = 1;
      count! += 1;
      (count as number)++;
      const copy = count!;
    `);
    expect(
      ir.references
        .filter(({ name }) => name === "count")
        .map(({ role }) => role),
    ).toEqual(["read", "write", "read", "write", "read"]);
    expect(topLevelBinding(ir, "count").value).toMatchObject({
      status: "unknown",
    });
  });

  it("records a wrapped identifier assignment as a write of its value", () => {
    const ir = analyzeJavaScriptSemantics(`
      let count = 1;
      count! = 2;
    `);
    expect(
      ir.references
        .filter(({ name }) => name === "count")
        .map(({ role }) => role),
    ).toEqual(["write"]);
  });
});

describe("JavaScript semantic analysis: dataflow 2", () => {
  it("retains partial property coverage and empty returns", () => {
    const partial = analyzeJavaScriptSemantics(`
      const spread = () => ({ type: "spread", ...dynamic });
      const computed = () => ({ type: "computed", [key]: 1 });
      function noReturn() { throw new Error("stop"); }
      function emptyReturn() { return; }
    `);
    expect(onlyCallable(partial, "spread").returnSites[0]?.value).toMatchObject(
      {
        status: "object",
        unknownProperties: true,
        omittedProperties: null,
      },
    );
    expect(
      onlyCallable(partial, "computed").returnSites[0]?.value,
    ).toMatchObject({
      status: "object",
      unknownProperties: true,
      omittedProperties: 1,
    });
    expect(onlyCallable(partial, "noReturn").returnSites).toEqual([]);
    expect(onlyCallable(partial, "emptyReturn").returnSites[0]?.value).toEqual({
      status: "unknown",
      reason: "Return has no value.",
    });
  });

  it("preserves initializer uncertainty, assignment ambiguity and alias cycles", () => {
    const ambiguous = analyzeJavaScriptSemantics(`
      let current = "first";
      current = "second";
      const left = right;
      const right = left;
    `);
    expect(topLevelBinding(ambiguous, "current").value).toMatchObject({
      status: "ambiguous",
    });
    expect(topLevelBinding(ambiguous, "left").value).toMatchObject({
      status: "unknown",
      reason: "Binding right has no proven initializer at this read.",
    });
    expect(topLevelBinding(ambiguous, "right").provenance).toMatchObject({
      status: "cycle",
    });
  });

  it("does not invent exact module paths for dynamic property access", () => {
    const ir = analyzeJavaScriptSemantics(`
      const key = getKey();
      const dynamicMember = require("electron")[key];
      const { [key]: dynamicBinding } = require("electron");
    `);

    expect(topLevelBinding(ir, "dynamicMember").provenance).toMatchObject({
      status: "unknown",
      origins: [],
    });
    expect(topLevelBinding(ir, "dynamicBinding").provenance).toMatchObject({
      status: "unknown",
      origins: [],
    });
    expect(
      ir.moduleLinks.filter(({ localName }) =>
        ["dynamicMember", "dynamicBinding"].includes(localName ?? ""),
      ),
    ).toEqual([]);
  });

  it("retains all scopes, bindings, and references without truncation", () => {
    const ir = analyzeJavaScriptSemantics(
      `
        const retained = "yes";
        const omitted = "no";
        retained;
        function nested(value) { return retained + value; }
      `,
    );

    expect(ir.bindings.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["retained", "omitted", "value"]),
    );
    expect(ir.callables.map(({ name }) => name)).toContain("nested");
    expect(ir.coverage.status).toBe("complete");
    expect(ir.references.filter(({ name }) => name === "retained")).toEqual([
      expect.objectContaining({
        resolution: "resolved",
        bindingId: topLevelBinding(ir, "retained").bindingId,
      }),
      expect.objectContaining({
        resolution: "resolved",
        bindingId: topLevelBinding(ir, "retained").bindingId,
      }),
    ]);
  });
});

describe("JavaScript semantic analysis: mapped arguments writes", () => {
  const commonJs = (source: string) => {
    const parsed = parseJavaScriptSource(source, "mapped-arguments.cjs");
    if (parsed === null) throw new Error("Expected CommonJS fixture to parse");
    return analyzeParsedJavaScriptSemantics(parsed);
  };
  const returnField = (source: string) => {
    const value = onlyCallable(commonJs(source), "read").returnSites[0]?.value;
    if (value?.status !== "object")
      throw new Error("Expected an object return value");
    const field = value.properties.find(({ name }) => name === "value");
    if (field === undefined) throw new Error("Expected returned value field");
    return field.value;
  };

  it.each([
    ["direct arguments write", "arguments[0] = 2;"],
    ["stable arguments alias write", "const args = arguments; args[0] = 2;"],
    ["array assignment pattern write", "[arguments[0]] = [2];"],
    [
      "nested object assignment pattern write",
      "({ nested: arguments[0] } = { nested: 2 });",
    ],
  ])("does not retain a stale literal after a %s", (_name, write) => {
    expect(
      returnField(
        `function read(value) { value = 1; ${write} return { value }; }`,
      ).status,
    ).not.toBe("literal");
  });

  it.each([
    [
      "strict function",
      'function read(value) { "use strict"; value = 1; arguments[0] = 2; return { value }; }',
    ],
    [
      "default parameter",
      "function read(value = 0) { value = 1; arguments[0] = 2; return { value }; }",
    ],
    [
      "no arguments write",
      "function read(value) { value = 1; return { value }; }",
    ],
  ])("keeps the independent parameter value for a %s", (_name, fn) => {
    expect(returnField(fn)).toEqual({ status: "literal", value: 1 });
  });

  it("retains uncertainty when source mode cannot establish sloppy semantics", () => {
    const parsed = parseJavaScriptSource(
      "function read(value) { value = 1; arguments[0] = 2; return { value }; }",
    );
    if (parsed === null) throw new Error("Expected fixture to parse");
    const value = onlyCallable(analyzeParsedJavaScriptSemantics(parsed), "read")
      .returnSites[0]?.value;
    if (value?.status !== "object")
      throw new Error("Expected an object return value");
    const property = value.properties.find(({ name }) => name === "value");
    expect(property).toBeDefined();
    expect(property?.value.status).not.toBe("literal");
  });
});

describe("primitive addition values", () => {
  it.each([
    ["true + 1", 2],
    ["null + 2", 2],
    ["false + true", 1],
    ['"x" + false', "xfalse"],
    ['null + "x"', "nullx"],
    ["3 + 4", 7],
    ['1 + 2 + "3"', "33"],
    ['1 + (2 + "3")', "123"],
    ['(1 + 2) + ("3" + 4)', "334"],
  ])("recovers %s using primitive coercion", (expression, expected) => {
    const ir = analyzeJavaScriptSemantics(`const answer = ${expression};`);
    expect(topLevelBinding(ir, "answer").value).toEqual({
      status: "literal",
      value: expected,
    });
  });
});

describe("array positional value recovery", () => {
  it("keeps holes at their actual destructuring indices", () => {
    const ir = analyzeJavaScriptSemantics(`
      const list = ["zero", , "two"];
      const [first, second, third] = list;
    `);
    expect(topLevelBinding(ir, "first").value).toEqual({
      status: "literal",
      value: "zero",
    });
    expect(topLevelBinding(ir, "second").value.status).toBe("unknown");
    expect(topLevelBinding(ir, "third").value).toEqual({
      status: "literal",
      value: "two",
    });
  });

  it("projects canonical array indices without treating arbitrary strings as indices", () => {
    const ir = analyzeJavaScriptSemantics(`
      const list = ["zero", "one"];
      const numeric = list[1];
      const quoted = list["1"];
      const leadingZero = list["01"];
      const negative = list[-1];
    `);
    for (const name of ["numeric", "quoted"])
      expect(topLevelBinding(ir, name).value).toEqual({
        status: "literal",
        value: "one",
      });
    for (const name of ["leadingZero", "negative"])
      expect(topLevelBinding(ir, name).value.status).toBe("unknown");
  });

  it("does not shift trailing values across an unknown spread", () => {
    const ir = analyzeJavaScriptSemantics(`
      const values = ["first", ...unknownValues, "last"];
      const [first, second] = values;
    `);
    expect(topLevelBinding(ir, "first").value).toEqual({
      status: "literal",
      value: "first",
    });
    expect(topLevelBinding(ir, "second").value.status).toBe("unknown");
  });
});

describe("object value overwrite boundaries", () => {
  it("uses the last named property and keeps later exact overwrites", () => {
    const ir = analyzeJavaScriptSemantics(`
      const duplicate = { key: "old", key: "new" };
      const selected = duplicate.key;
      const later = { key: "old", ...unknownObject, key: "final" };
      const final = later.key;
    `);
    expect(topLevelBinding(ir, "selected").value).toEqual({
      status: "literal",
      value: "new",
    });
    expect(topLevelBinding(ir, "final").value).toEqual({
      status: "literal",
      value: "final",
    });
  });
  it("does not retain an exact earlier value after an unknown overwrite", () => {
    const ir = analyzeJavaScriptSemantics(`
      const spread = { key: "old", ...unknownObject };
      const dynamic = { key: "old", [unknownKey]: "new" };
      const method = { key: "old", key() { return "new"; } };
      const spreadValue = spread.key;
      const dynamicValue = dynamic.key;
      const methodValue = method.key;
    `);
    for (const name of ["spreadValue", "dynamicValue", "methodValue"])
      expect(topLevelBinding(ir, name).value.status).toBe("unknown");
  });
  it("admits literal computed keys while excluding prototype setters", () => {
    const ir = analyzeJavaScriptSemantics(`
      const object = { ["key"]: "value", __proto__: { prototype: true } };
      const selected = object.key;
      const prototype = object.__proto__;
    `);
    expect(topLevelBinding(ir, "selected").value).toEqual({
      status: "literal",
      value: "value",
    });
    expect(topLevelBinding(ir, "prototype").value.status).toBe("unknown");
  });
});

it("retains shorthand __proto__ as an own data property", () => {
  const ir = analyzeJavaScriptSemantics(`
    const __proto__ = "own";
    const object = { __proto__ };
    const selected = object.__proto__;
  `);
  expect(topLevelBinding(ir, "selected").value).toEqual({
    status: "literal",
    value: "own",
  });
});

describe("nonfinite static values", () => {
  it.each(['+"not-a-number"', '-"not-a-number"', "1e308 + 1e308", "1e309"])(
    "keeps %s unknown instead of publishing a non-JSON number",
    (expression) => {
      const ir = analyzeJavaScriptSemantics(`const answer = ${expression};`);
      expect(topLevelBinding(ir, "answer").value.status).toBe("unknown");
    },
  );
  it("does not collapse an uncertain nonfinite branch to its finite alternative", () => {
    const ir = analyzeJavaScriptSemantics(
      'const answer = condition ? 1 : +"invalid";',
    );
    expect(topLevelBinding(ir, "answer").value.status).toBe("ambiguous");
  });
});

describe("binding write invalidation", () => {
  it.each(["in", "of"])(
    "retains prototype uncertainty for an empty template in for-%s",
    (operator) => {
      const ir = analyzeJavaScriptSemantics(`
        String.prototype.extra = "possible inherited key";
        let selected = "before";
        for (selected ${operator} \`\`) {}
        const observed = selected;
      `);
      expect(
        topLevelBinding(ir, "selected").definitions.some(
          ({ kind }) => kind === "assignment",
        ),
      ).toBe(true);
      expect(topLevelBinding(ir, "observed").value.status).not.toBe("literal");
    },
  );

  it.each(
    [
      { input: '"abc"', empty: false },
      { input: "`abc`", empty: false },
      { input: "`\\u0061`", empty: false },
      { input: '""', empty: true },
      { input: "``", empty: true },
      { input: "`\\\n`", empty: true },
    ].flatMap((literal) =>
      ["in", "of"].flatMap((operator) =>
        ["selected", "[selected]"].map((head) => ({
          ...literal,
          operator,
          head,
        })),
      ),
    ),
  )(
    "preserves writes for $head $operator $input (empty=$empty)",
    ({ input, empty, operator, head }) => {
      const ir = analyzeJavaScriptSemantics(`
        let selected = "before";
        for (${head} ${operator} ${input}) {}
        const observed = selected;
        export function result() { return observed; }
      `);
      expect(
        topLevelBinding(ir, "selected").definitions.some(
          ({ kind }) => kind === "assignment",
        ),
      ).toBe(!empty);
      const value = topLevelBinding(ir, "observed").value;
      if (empty) expect(value).toEqual({ status: "literal", value: "before" });
      else expect(value).not.toEqual({ status: "literal", value: "before" });
      expect(onlyCallable(ir, "result").returnSites[0]?.value).toEqual(value);
    },
  );

  it.each([
    ["let value = 1; value++; const observed = value;", "unknown"],
    ["let value = 1; --value; const observed = value;", "unknown"],
    [
      'let value = "old"; [value] = ["new"]; const observed = value;',
      "ambiguous",
    ],
    [
      'let value = "old"; ({key: value} = {key: "new"}); const observed = value;',
      "ambiguous",
    ],
    [
      'let value = "old"; for (value of ["new"]) {} const observed = value;',
      "ambiguous",
    ],
    [
      'let value = "old"; for (value in {new: true}) {} const observed = value;',
      "ambiguous",
    ],
  ] as const)(
    "does not retain an exact initializer across %s",
    (source, status) => {
      const ir = analyzeJavaScriptSemantics(source);
      expect(topLevelBinding(ir, "observed").value.status).toBe(status);
      expect(
        topLevelBinding(ir, "value").definitions.some(
          ({ kind }) => kind === "assignment",
        ),
      ).toBe(true);
    },
  );

  it("does not treat destructuring keys or member owners as assigned bindings", () => {
    const ir = analyzeJavaScriptSemantics(`
      const key = "stable";
      const owner = "stable";
      let target = "old";
      ({key: target} = {key: "new"});
      ({owner: object.slot} = {owner: "new"});
      const preservedKey = key;
      const preservedOwner = owner;
    `);
    for (const name of ["preservedKey", "preservedOwner"])
      expect(topLevelBinding(ir, name).value).toEqual({
        status: "literal",
        value: "stable",
      });
  });
});

describe("JavaScript semantic analysis: unknown default inputs", () => {
  it.each([
    'function launch(mode = "safe") { return mode; }',
    'function launch({ mode } = { mode: "safe" }) { return mode; }',
    'function launch([mode] = ["safe"]) { return mode; }',
  ])("does not assume an optional argument is omitted: %s", (source) => {
    const ir = analyzeJavaScriptSemantics(source);
    expect(onlyCallable(ir, "launch").returnSites[0]?.value.status).toBe(
      "unknown",
    );
  });

  it("preserves known declaration inputs and unknown catch bindings", () => {
    const ir = analyzeJavaScriptSemantics(`
      const { mode: retained = "fallback" } = { mode: "actual" };
      function caught() {
        try { risky(); } catch ({ message = "fallback" }) { return message; }
      }
    `);
    expect(topLevelBinding(ir, "retained").value).toMatchObject({
      status: "literal",
      value: "actual",
    });
    expect(onlyCallable(ir, "caught").returnSites[0]?.value.status).toBe(
      "unknown",
    );
  });
});
