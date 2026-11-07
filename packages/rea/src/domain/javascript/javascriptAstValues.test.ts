import * as t from "@babel/types";
import { expect, it } from "vitest";

import {
  semanticMemberChain,
  semanticStaticPropertyKey,
  staticObjectProperty,
  staticObjectPropertyReader,
  staticObjectPropertyNames,
} from "./javascriptAstValues.js";
import { SEMANTIC_EXPRESSION_DEPTH_LIMIT } from "./javascriptSemanticResourceLimits.js";

it("keeps string spread indices separate from named descriptor fields", () => {
  for (const text of ["", "x", "😀", "x".repeat(1_000_000)]) {
    const original = t.objectProperty(
      t.identifier("value"),
      t.identifier("sender"),
    );
    const object = t.objectExpression([
      original,
      t.spreadElement(t.stringLiteral(text)),
    ]);
    const read = staticObjectPropertyReader(object);
    expect(read("value")).toEqual({
      status: "explicit",
      property: original,
      value: original.value,
    });
    expect(read("get")).toEqual({ status: "missing" });
    expect(read("set")).toEqual({ status: "missing" });
    expect(read("0").status).toBe(text.length > 0 ? "dynamic" : "missing");
    expect(read("1").status).toBe(text.length > 1 ? "dynamic" : "missing");
    for (const key of ["00", "-0", "1.0", "length"])
      expect(read(key)).toEqual({ status: "missing" });
    // Nonempty strings keep their indexed inventory partial without expanding
    // it into character-sized AST nodes or a potentially huge key-name array.
    expect(staticObjectPropertyNames(object)).toEqual({
      status: text.length > 0 ? "partial" : "complete",
      names: ["value"],
    });
  }
});

it("keeps numeric overwrite order and constant template string spread keys", () => {
  const property = t.objectProperty(
    t.stringLiteral("0"),
    t.identifier("original"),
  );
  const spread = t.spreadElement(
    t.templateLiteral([t.templateElement({ raw: "x", cooked: "x" }, true)], []),
  );
  expect(
    staticObjectProperty(t.objectExpression([property, spread]), "0").status,
  ).toBe("dynamic");
  expect(
    staticObjectProperty(t.objectExpression([spread, property]), "0"),
  ).toEqual({ status: "explicit", property, value: property.value });
});

it("keeps literal array indices, holes and unknown iterable suffixes separate from names", () => {
  const value = t.objectProperty(t.identifier("value"), t.identifier("sender"));
  for (const elements of [
    [],
    [null, null],
    [t.numericLiteral(1)],
    [null, t.numericLiteral(1)],
    [null, t.spreadElement(t.identifier("input"))],
  ]) {
    const object = t.objectExpression([
      value,
      t.spreadElement(t.arrayExpression(elements)),
    ]);
    const read = staticObjectPropertyReader(object);
    expect(read("value")).toEqual({
      status: "explicit",
      property: value,
      value: value.value,
    });
    expect(read("get")).toEqual({ status: "missing" });
    expect(read("set")).toEqual({ status: "missing" });
    expect(read("0").status).toBe(elements[0] == null ? "missing" : "dynamic");
    expect(read("1").status).toBe(elements[1] == null ? "missing" : "dynamic");
    expect(read("100").status).toBe(
      elements.some((entry) => t.isSpreadElement(entry))
        ? "dynamic"
        : "missing",
    );
    expect(read("length")).toEqual({ status: "missing" });
    expect(staticObjectPropertyNames(object)).toEqual({
      status: elements.some((entry) => entry != null) ? "partial" : "complete",
      names: ["value"],
    });
  }
});

it("preserves ordinary method data values without executing getter effects", () => {
  const method = (name: string, computed = false) =>
    t.objectMethod(
      "method",
      t.identifier(name),
      [],
      t.blockStatement([]),
      computed,
    );
  const getter = t.objectMethod(
    "get",
    t.identifier("helper"),
    [],
    t.blockStatement([]),
  );
  const setter = t.objectMethod(
    "set",
    t.identifier("helper"),
    [t.identifier("value")],
    t.blockStatement([]),
  );
  for (const [member, status] of [
    [method("helper"), "explicit"],
    [setter, "explicit"],
    [method("stdio"), "explicit"],
    [getter, "dynamic"],
    [method("key", true), "dynamic"],
  ] as const) {
    const object = t.objectExpression([
      t.objectProperty(t.identifier("stdio"), t.stringLiteral("inherit")),
      t.spreadElement(t.objectExpression([member])),
    ]);
    expect(staticObjectProperty(object, "stdio").status).toBe(status);
  }
});

it("limits unary-plus keys to transparent numeric literals", () => {
  const wrapped = t.tsAsExpression(t.numericLiteral(1), t.tsNumberKeyword());
  expect(semanticStaticPropertyKey(t.unaryExpression("+", wrapped), true)).toBe(
    "1",
  );
  for (const argument of [
    t.stringLiteral("1"),
    t.bigIntLiteral(1n),
    t.identifier("input"),
  ])
    expect(
      semanticStaticPropertyKey(t.unaryExpression("+", argument), true),
    ).toBeNull();
});

it("bounds nested inline object spreads without losing a shallow final property", () => {
  let object = t.objectExpression([
    t.objectProperty(t.identifier("stdio"), t.stringLiteral("inherit")),
  ]);
  for (let depth = 0; depth < SEMANTIC_EXPRESSION_DEPTH_LIMIT; depth++)
    object = t.objectExpression([t.spreadElement(object)]);
  expect(staticObjectProperty(object, "stdio").status).toBe("explicit");
  expect(
    staticObjectProperty(t.objectExpression([t.spreadElement(object)]), "stdio")
      .status,
  ).toBe("dynamic");
});

it("collects complete own-key sets through bounded literal spreads", () => {
  const names = staticObjectPropertyNames(
    t.objectExpression([
      t.spreadElement(
        t.objectExpression([
          t.objectProperty(t.identifier("query"), t.objectExpression([])),
          t.objectProperty(t.identifier("shared"), t.numericLiteral(1)),
        ]),
      ),
      t.objectProperty(t.identifier("direct"), t.objectExpression([])),
      t.objectProperty(t.identifier("shared"), t.numericLiteral(2)),
    ]),
  );
  expect(names).toEqual({
    status: "complete",
    names: ["query", "shared", "direct"],
  });
});

it("keeps key enumeration unknown when object membership is unresolved", () => {
  const dynamicSpread = t.identifier("dynamicProperties");
  const computedKey = t.identifier("propertyName");
  const cases = [
    t.objectExpression([
      t.spreadElement(dynamicSpread),
      t.objectProperty(t.identifier("direct"), t.objectExpression([])),
    ]),
    t.objectExpression([
      t.objectProperty(computedKey, t.objectExpression([]), true),
      t.objectProperty(t.identifier("direct"), t.objectExpression([])),
    ]),
    t.objectExpression([
      t.spreadElement(
        t.objectExpression([
          t.objectMethod(
            "get",
            t.identifier("query"),
            [],
            t.blockStatement([]),
          ),
        ]),
      ),
    ]),
  ];
  for (const object of cases)
    expect(staticObjectPropertyNames(object).status).toBe("partial");
});

it("retains known keys alongside unresolved object membership", () => {
  expect(
    staticObjectPropertyNames(
      t.objectExpression([
        t.spreadElement(t.identifier("dynamicProperties")),
        t.objectProperty(t.identifier("direct"), t.objectExpression([])),
        t.objectProperty(
          t.identifier("propertyName"),
          t.objectExpression([]),
          true,
        ),
      ]),
    ),
  ).toEqual({ status: "partial", names: ["direct"] });
});

it("does not claim a complete key set after exceeding spread depth", () => {
  let object = t.objectExpression([
    t.objectProperty(t.identifier("query"), t.objectExpression([])),
  ]);
  for (let depth = 0; depth < SEMANTIC_EXPRESSION_DEPTH_LIMIT; depth++)
    object = t.objectExpression([t.spreadElement(object)]);
  expect(staticObjectPropertyNames(object).status).toBe("complete");
  expect(
    staticObjectPropertyNames(t.objectExpression([t.spreadElement(object)]))
      .status,
  ).toBe("partial");
});

it("enumerates a wide inline spread without a variadic call overflow", () => {
  const properties = Array.from({ length: 130_000 }, (_, index) =>
    t.objectProperty(t.identifier(`key${index}`), t.numericLiteral(index)),
  );
  const result = staticObjectPropertyNames(
    t.objectExpression([t.spreadElement(t.objectExpression(properties))]),
  );
  expect(result.status).toBe("complete");
  if (result.status === "complete") {
    expect(result.names).toHaveLength(properties.length);
    expect(result.names[0]).toBe("key0");
    expect(result.names.at(-1)).toBe("key129999");
  }
});

it("excludes prototype setters from own keys but preserves other __proto__ forms", () => {
  const setter = t.objectProperty(
    t.identifier("__proto__"),
    t.objectExpression([
      t.objectProperty(t.identifier("inherited"), t.numericLiteral(1)),
    ]),
  );
  expect(
    staticObjectPropertyNames(
      t.objectExpression([
        setter,
        t.objectProperty(t.identifier("own"), t.numericLiteral(2)),
      ]),
    ),
  ).toEqual({ status: "complete", names: ["own"] });

  const ownForms = [
    t.objectProperty(t.stringLiteral("__proto__"), t.numericLiteral(1), true),
    t.objectProperty(
      t.identifier("__proto__"),
      t.identifier("__proto__"),
      false,
      true,
    ),
    t.objectMethod(
      "method",
      t.identifier("__proto__"),
      [],
      t.blockStatement([]),
    ),
  ];
  for (const member of ownForms)
    expect(staticObjectPropertyNames(t.objectExpression([member]))).toEqual({
      status: "complete",
      names: ["__proto__"],
    });
});

it("keeps inherited lookup uncertain after a top-level prototype setter", () => {
  const setter = t.objectProperty(
    t.identifier("__proto__"),
    t.objectExpression([
      t.objectProperty(t.identifier("inherited"), t.numericLiteral(1)),
    ]),
  );
  expect(
    staticObjectProperty(t.objectExpression([setter]), "inherited").status,
  ).toBe("dynamic");
  expect(
    staticObjectProperty(
      t.objectExpression([
        setter,
        t.objectProperty(t.identifier("inherited"), t.numericLiteral(2)),
      ]),
      "inherited",
    ).status,
  ).toBe("explicit");
  expect(
    staticObjectProperty(
      t.objectExpression([
        t.objectProperty(t.identifier("inherited"), t.numericLiteral(2)),
        setter,
      ]),
      "inherited",
    ).status,
  ).toBe("explicit");
  const spreadSource = t.objectExpression([
    setter,
    t.objectProperty(t.identifier("visible"), t.numericLiteral(3)),
  ]);
  expect(
    staticObjectProperty(
      t.objectExpression([t.spreadElement(spreadSource)]),
      "inherited",
    ).status,
  ).toBe("missing");
});

it("omits prototype setters copied by literal object spread", () => {
  const source = t.objectExpression([
    t.objectProperty(
      t.identifier("__proto__"),
      t.objectExpression([
        t.objectProperty(t.identifier("hidden"), t.numericLiteral(1)),
      ]),
    ),
    t.objectProperty(t.identifier("visible"), t.numericLiteral(2)),
  ]);
  expect(
    staticObjectPropertyNames(t.objectExpression([t.spreadElement(source)])),
  ).toEqual({ status: "complete", names: ["visible"] });
});

it("shares static member paths and stops before unadmitted path expansion", () => {
  const root = t.identifier("registry");
  const selected = t.optionalMemberExpression(
    t.memberExpression(
      t.tsAsExpression(root, t.tsUnknownKeyword()),
      t.stringLiteral("query"),
      true,
    ),
    t.identifier("nested"),
    false,
    true,
  );
  expect(semanticMemberChain(selected)).toEqual({
    root,
    members: ["query", "nested"],
  });
  expect(
    semanticMemberChain(t.memberExpression(root, t.identifier("key"), true)),
  ).toBeUndefined();
  let admitted = 0;
  expect(semanticMemberChain(selected, () => ++admitted < 2)).toBeUndefined();
  expect(admitted).toBe(2);
});

it("retains exact ordinary method data nodes while keeping accessors unknown", () => {
  const method = t.objectMethod(
    "method",
    t.identifier("value"),
    [],
    t.blockStatement([]),
  );
  const getter = t.objectMethod(
    "get",
    t.identifier("value"),
    [],
    t.blockStatement([]),
  );
  expect(staticObjectProperty(t.objectExpression([method]), "value")).toEqual({
    status: "explicit",
    property: method,
    value: method,
  });
  expect(staticObjectProperty(t.objectExpression([getter]), "value")).toEqual({
    status: "dynamic",
  });
});

it("keeps primitive unary results propertyless and typeof results index-only", () => {
  const value = t.objectProperty(t.identifier("value"), t.identifier("sender"));
  const index = t.objectProperty(
    t.stringLiteral("0"),
    t.stringLiteral("prior"),
  );
  for (const operator of ["+", "-", "~", "!", "void", "delete"] as const) {
    const object = t.objectExpression([
      value,
      index,
      t.spreadElement(t.unaryExpression(operator, t.numericLiteral(1))),
    ]);
    expect(staticObjectProperty(object, "value")).toEqual({
      status: "explicit",
      property: value,
      value: value.value,
    });
    expect(staticObjectProperty(object, "0")).toEqual({
      status: "explicit",
      property: index,
      value: index.value,
    });
  }
  const object = t.objectExpression([
    value,
    index,
    t.spreadElement(t.unaryExpression("typeof", t.identifier("input"))),
  ]);
  expect(staticObjectProperty(object, "value")).toEqual({
    status: "explicit",
    property: value,
    value: value.value,
  });
  expect(staticObjectProperty(object, "0")).toEqual({ status: "dynamic" });
});
