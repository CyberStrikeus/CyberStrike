import * as t from "@babel/types";
import { describe, expect, it } from "vitest";

import {
  analyzeJavaScriptSemantics,
  analyzeParsedJavaScriptSemantics,
} from "./javascriptSemanticAnalysis.js";
import { topLevelBinding } from "./javascriptSemanticAnalysis.fixture.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { readExactJavaScriptLiteral } from "./javascriptAstValues.js";

const conditionalCandidates = [
  '"one"',
  '(choice ? "one" : "two")',
  '(choice ? "one" : other ? "two" : "three")',
];
const incompatibleValue = {
  status: "ambiguous",
  reason: "Branches have incompatible values.",
};

const valueOf = (expression: string) =>
  topLevelBinding(
    analyzeJavaScriptSemantics(`const answer = ${expression};`),
    "answer",
  ).value;

describe("exact JavaScript literal reader", () => {
  it("reads cooked atoms and rejects raw-only or interpolated templates", () => {
    const cookedElement = t.templateElement(
      { raw: "raw", cooked: "raw" },
      true,
    );
    cookedElement.value.cooked = "cooked";
    const rawOnlyElement = t.templateElement(
      { raw: "raw", cooked: "raw" },
      true,
    );
    rawOnlyElement.value.cooked = null;
    expect(readExactJavaScriptLiteral(t.stringLiteral(""))).toEqual({
      found: true,
      value: "",
    });
    expect(
      readExactJavaScriptLiteral(t.templateLiteral([cookedElement], [])),
    ).toEqual({ found: true, value: "cooked" });
    expect(
      readExactJavaScriptLiteral(t.templateLiteral([rawOnlyElement], [])),
    ).toEqual({ found: false });
    expect(
      readExactJavaScriptLiteral(
        t.templateLiteral(
          [
            t.templateElement({ raw: "", cooked: "" }, false),
            t.templateElement({ raw: "", cooked: "" }, true),
          ],
          [t.identifier("value")],
        ),
      ),
    ).toEqual({ found: false });
  });
});
const valuesOf = (expressions: readonly string[]) => {
  const ir = analyzeJavaScriptSemantics(
    expressions
      .map(
        (expression, index) =>
          `const candidate${String(index)} = ${expression};`,
      )
      .join("\n"),
  );
  return expressions.map(
    (_, index) => topLevelBinding(ir, `candidate${String(index)}`).value,
  );
};

describe("conditional primitive unions", () => {
  const cases = conditionalCandidates.flatMap((known) =>
    [
      "missing",
      "unsupported()",
      '({ key: "value" })',
      '["value"]',
      '+"invalid"',
      "1e309",
      "1e308 + 1e308",
    ].flatMap((other) => [
      `condition ? ${known} : ${other}`,
      `condition ? ${other} : ${known}`,
    ]),
  );

  it("preserves incompatible alternatives across conditional expressions", () => {
    expect(valuesOf(cases)).toEqual(cases.map(() => incompatibleValue));
  });

  const exactCases = [
    [
      'condition ? (choice ? "two" : "one") : "three"',
      { status: "union", values: ["one", "three", "two"] },
    ],
    [
      'condition ? "three" : (choice ? "two" : "one")',
      { status: "union", values: ["one", "three", "two"] },
    ],
    [
      'condition ? (choice ? "two" : "one") : (other ? "one" : "three")',
      { status: "union", values: ["one", "three", "two"] },
    ],
    [
      'condition ? (choice ? "two" : "one") : (other ? "one" : "two")',
      { status: "union", values: ["one", "two"] },
    ],
    [
      'condition ? (choice ? "one" : "one") : "one"',
      { status: "literal", value: "one" },
    ],
    [
      'condition ? (choice ? "one" : "two") : null',
      { status: "union", values: [null, "one", "two"] },
    ],
    [
      'condition ? null : (choice ? "one" : "two")',
      { status: "union", values: [null, "one", "two"] },
    ],
    ["condition ? null : null", { status: "literal", value: null }],
  ] as const;

  it("retains exact primitive candidates across conditional expressions", () => {
    expect(valuesOf(exactCases.map(([expression]) => expression))).toEqual(
      exactCases.map(([, expected]) => expected),
    );
  });

  it("propagates an incompatible nested branch through an outer union", () => {
    expect(
      valueOf(
        'condition ? (choice ? "one" : "two") : (other ? "three" : missing)',
      ),
    ).toEqual(incompatibleValue);
  });
});

describe("logical primitive unions", () => {
  // Each left-hand set can select the unresolved right-hand operand at runtime.
  const operators = [
    {
      operator: "||",
      alternatives: [
        '""',
        '(choice ? "" : "one")',
        '(choice ? "" : other ? "one" : "two")',
      ],
    },
    {
      operator: "&&",
      alternatives: [
        '"one"',
        '(choice ? 0 : "one")',
        '(choice ? 0 : other ? "one" : "two")',
      ],
    },
    {
      operator: "??",
      alternatives: [
        "null",
        '(choice ? null : "one")',
        '(choice ? null : other ? "one" : "two")',
      ],
    },
  ];
  const cases = operators.flatMap(({ operator, alternatives }) =>
    alternatives.flatMap((known) =>
      ["missing", "unsupported()"].flatMap((other) => [
        `${known} ${operator} ${other}`,
        `${other} ${operator} ${known}`,
      ]),
    ),
  );

  it("preserves unresolved alternatives across logical expressions", () => {
    expect(valuesOf(cases)).toEqual(cases.map(() => incompatibleValue));
  });

  const exactCases = [
    [
      '(choice ? "" : "one") || "two"',
      { status: "union", values: ["", "one", "two"] },
    ],
    [
      '(choice ? 0 : "one") && "two"',
      { status: "union", values: [0, "one", "two"] },
    ],
    [
      '(choice ? null : "one") ?? "two"',
      { status: "union", values: [null, "one", "two"] },
    ],
    ['"one" || "one"', { status: "literal", value: "one" }],
    ["null ?? null", { status: "literal", value: null }],
  ] as const;

  it("retains conservative primitive unions across logical expressions", () => {
    expect(valuesOf(exactCases.map(([expression]) => expression))).toEqual(
      exactCases.map(([, expected]) => expected),
    );
  });

  const unevaluatedCases = [
    'true ? "one" : missing',
    '"one" || missing',
    "false && missing",
    '"one" ?? missing',
  ];

  it("selects an established branch without evaluating an unreachable operand", () => {
    expect(valuesOf(unevaluatedCases)).toEqual([
      { status: "literal", value: "one" },
      { status: "literal", value: "one" },
      { status: "literal", value: false },
      { status: "literal", value: "one" },
    ]);
  });
});

describe("semantic primitive resource observations", () => {
  it.each([
    {
      name: "member",
      source: (large: string) =>
        `const answer = (${JSON.stringify(large)}).field;`,
    },
    {
      name: "destructuring",
      source: (large: string) =>
        `const { nested: { answer } } = { nested: ${JSON.stringify(large)} };`,
    },
  ])("preserves a limiting value through $name projection", ({ source }) => {
    const ir = analyzeJavaScriptSemantics(source("x".repeat(200_000)));
    expect(topLevelBinding(ir, "answer").value).toMatchObject({
      status: "unknown",
      resourceLimit: "primitive-bytes",
    });
    expect(ir.coverage).toMatchObject({
      status: "partial",
      resourceLimits: ["primitive-bytes"],
    });
  });

  it("records an encountered bound without weakening a selected healthy sibling", () => {
    const ir = analyzeJavaScriptSemantics(
      `const answer = ({ ignored: ${JSON.stringify("x".repeat(200_000))}, kept: 7 }).kept;`,
    );
    expect(topLevelBinding(ir, "answer").value).toEqual({
      status: "literal",
      value: 7,
    });
    expect(ir.coverage).toMatchObject({
      status: "partial",
      resourceLimits: ["primitive-bytes"],
    });
  });
});

describe("configuration default normalization", () => {
  it.each(["quoted", "template"])(
    "normalizes a bare %s configuration default",
    (syntax) => {
      const large = "x".repeat(200_000);
      const expression =
        syntax === "quoted" ? JSON.stringify(large) : `\`${large}\``;
      const ir = analyzeJavaScriptSemantics(
        `process.env.MODE ?? ${expression};`,
      );
      const operation = ir.configurationOperations.find(
        ({ kind }) => kind === "default",
      );
      expect(
        typeof operation?.value === "string" ? operation.value.length : 0,
      ).toBeLessThanOrEqual(174_762);
      expect(operation).toMatchObject({
        value: null,
        resolution: "partial",
        valueResourceLimit: "primitive-bytes",
      });
      expect(ir.coverage).toMatchObject({
        status: "partial",
        resourceLimits: ["primitive-bytes"],
      });
    },
  );

  it.each([null, false, 0, ""])(
    "keeps an exact bounded configuration default %j",
    (value) => {
      const ir = analyzeJavaScriptSemantics(
        `process.env.MODE ?? ${JSON.stringify(value)};`,
      );
      expect(
        ir.configurationOperations.find(({ kind }) => kind === "default"),
      ).toMatchObject({ value, resolution: "complete" });
      expect(ir.coverage.resourceLimits ?? []).toEqual([]);
    },
  );
});

describe("semantic primitive allocation and binding reuse", () => {
  it.each(["quoted", "template"])(
    "applies the normalized byte boundary to %s literals",
    (syntax) => {
      // Six estimated JSON bytes per UTF-16 code unit plus two quotes:
      // 174762 code units fit; one more exceeds the 1 MiB bound.
      for (const length of [174_762, 174_763]) {
        const text = "x".repeat(length);
        const expression =
          syntax === "quoted" ? JSON.stringify(text) : `\`${text}\``;
        const ir = analyzeJavaScriptSemantics(`const answer = ${expression};`);
        const value = topLevelBinding(ir, "answer").value;
        if (length === 174_762) {
          expect(value.status).toBe("literal");
          if (value.status !== "literal")
            throw new Error("Expected exact value");
          expect(typeof value.value === "string" && value.value.length).toBe(
            length,
          );
          expect(ir.coverage.resourceLimits ?? []).toEqual([]);
        } else {
          expect(value.status).toBe("unknown");
          expect(value).toMatchObject({ resourceLimit: "primitive-bytes" });
          expect(ir.coverage).toMatchObject({
            status: "partial",
            omittedCount: null,
            resourceLimits: ["primitive-bytes"],
          });
        }
      }
    },
  );

  it("returns an explicit unknown before expanding a large addition product", () => {
    const term = '(choice ? "a" : "b")';
    const expression = Array.from({ length: 20 }, () => term).join(" + ");
    const value = valueOf(expression);
    expect(value).toMatchObject({
      status: "unknown",
      resourceLimit: "primitive-candidates",
      reason: expect.stringMatching(/primitive candidate budget exceeded/i),
    });
    expect(
      analyzeJavaScriptSemantics(`const answer = ${expression};`).coverage,
    ).toMatchObject({
      status: "partial",
      omittedCount: null,
      resourceLimits: ["primitive-candidates"],
    });
  });

  it("bounds derived single-string growth before concatenation or key serialization", () => {
    const declarations = ['const value0 = "x";'];
    for (let index = 1; index <= 100; index += 1) {
      const previous = `value${String(index - 1)}`;
      declarations.push(
        `const value${String(index)} = ${previous} + ${previous};`,
      );
    }
    declarations.push("const answer = value100;");
    const ir = analyzeJavaScriptSemantics(declarations.join("\n"));
    expect(topLevelBinding(ir, "answer").value).toMatchObject({
      status: "unknown",
      resourceLimit: "primitive-bytes",
      reason: expect.stringMatching(/primitive string-byte budget exceeded/i),
    });
    expect(ir.coverage).toMatchObject({
      status: "partial",
      omittedCount: null,
      resourceLimits: expect.arrayContaining(["primitive-bytes"]),
    });
  });

  it("memoizes by resolved binding without crossing shadowing or mutation", () => {
    const ir = analyzeJavaScriptSemantics(`
      const shared = "outer";
      function readsOuter() { return shared; }
      function readsShadow() { const shared = "inner"; return shared; }
      function readsMutation() {
        let shared = "before";
        shared = "after";
        return shared;
      }
    `);
    expect(topLevelBinding(ir, "shared").value).toEqual({
      status: "literal",
      value: "outer",
    });
    expect(
      ir.callables.find(({ name }) => name === "readsOuter")?.returnSites[0]
        ?.value,
    ).toEqual({
      status: "literal",
      value: "outer",
    });
    expect(
      ir.callables.find(({ name }) => name === "readsShadow")?.returnSites[0]
        ?.value,
    ).toEqual({
      status: "literal",
      value: "inner",
    });
    expect(
      ir.callables.find(({ name }) => name === "readsMutation")?.returnSites[0]
        ?.value,
    ).toEqual({ status: "literal", value: "after" });
  });

  it("retains a large derived string while its aggregate JSON estimate fits", () => {
    const part = "x".repeat(32_768);
    const ir = analyzeJavaScriptSemantics(
      `const left = ${JSON.stringify(part)}; const right = ${JSON.stringify(part)}; const answer = left + right;`,
    );
    expect(topLevelBinding(ir, "answer").value).toMatchObject({
      status: "literal",
      value: expect.stringMatching(/^x+$/u),
    });
    const value = topLevelBinding(ir, "answer").value;
    if (value.status !== "literal" || typeof value.value !== "string")
      throw new Error("Expected exact derived string");
    expect(value.value.length).toBe(65_536);
    expect(ir.coverage.status).toBe("complete");
  });

  it("retains exact candidates for a near-budget Cartesian workload", () => {
    const left = "l".repeat(85);
    const right = "r".repeat(85);
    const expression = Array.from(
      { length: 7 },
      () =>
        `(${JSON.stringify(left)} + (${`choice ? ${JSON.stringify(left)} : ${JSON.stringify(right)}`}))`,
    ).join(" + ");
    const value = valueOf(expression);
    expect(value.status).toBe("union");
    if (value.status !== "union")
      throw new Error("Expected exact primitive union");
    expect(value.values).toHaveLength(128);
    expect(
      value.values.every(
        (candidate) =>
          typeof candidate === "string" && candidate.length === 1_190,
      ),
    ).toBe(true);
  });
});

describe("semantic expression depth bounds", () => {
  it("returns an explicit unknown for a deeply nested unary AST without throwing", () => {
    const parsed = parseJavaScriptSource("const answer = true;");
    const declaration = parsed?.program.body[0];
    const declarator = t.isVariableDeclaration(declaration)
      ? declaration.declarations[0]
      : undefined;
    if (parsed === null || !t.isVariableDeclarator(declarator))
      throw new Error("Expected parsed binding initializer");
    let expression: t.Expression = t.booleanLiteral(true);
    for (let index = 0; index < 5_000; index += 1)
      expression = t.unaryExpression("!", expression, true);
    declarator.init = expression;

    const ir = analyzeParsedJavaScriptSemantics(parsed);
    expect(ir.coverage).toMatchObject({
      status: "partial",
      omittedCount: null,
      resourceLimits: ["expression-depth"],
    });
    expect(topLevelBinding(ir, "answer").value).toEqual({
      status: "unknown",
      resourceLimit: "expression-depth",
      reason: expect.stringMatching(
        /semantic expression depth budget exceeded/i,
      ),
    });
  });

  it("bounds nested conditional evaluation and provenance walks", () => {
    const parsed = parseJavaScriptSource("const answer = true;");
    const declaration = parsed?.program.body[0];
    const declarator = t.isVariableDeclaration(declaration)
      ? declaration.declarations[0]
      : undefined;
    if (parsed === null || !t.isVariableDeclarator(declarator))
      throw new Error("Expected parsed binding initializer");
    let expression: t.Expression = t.booleanLiteral(true);
    for (let index = 0; index < 5_000; index += 1)
      expression = t.conditionalExpression(
        t.identifier("condition"),
        expression,
        t.booleanLiteral(false),
      );
    declarator.init = expression;

    const ir = analyzeParsedJavaScriptSemantics(parsed);
    const value = topLevelBinding(ir, "answer").value;
    expect(value).toMatchObject({
      status: "unknown",
      resourceLimit: "expression-depth",
      reason: expect.stringMatching(
        /semantic expression depth budget exceeded/i,
      ),
    });
  });

  it("counts erased TypeScript wrappers on a return against expression depth", () => {
    const source = "function answer() { return true; }";
    const parsed = parseJavaScriptSource(source);
    const declaration = parsed?.program.body[0];
    const statement = t.isFunctionDeclaration(declaration)
      ? declaration.body.body[0]
      : undefined;
    const argument = t.isReturnStatement(statement)
      ? statement.argument
      : undefined;
    if (parsed === null || !t.isReturnStatement(statement) || argument == null)
      throw new Error("Expected a returned value");
    let expression = argument;
    for (let index = 0; index < 300; index += 1)
      expression = t.tsAsExpression(expression, t.tsBooleanKeyword());
    statement.argument = expression;

    const ir = analyzeParsedJavaScriptSemantics(parsed);
    const site = ir.callables.find((item) => item.name === "answer")
      ?.returnSites[0];
    expect(site?.value).toMatchObject({
      status: "unknown",
      resourceLimit: "expression-depth",
    });
    const literalStart = source.indexOf("true");
    expect(site?.valueExpressionLocation).toEqual({
      start: { line: 1, column: literalStart },
      end: { line: 1, column: literalStart + "true".length },
    });
  });

  it("counts erased TypeScript wrappers against expression depth", () => {
    const parsed = parseJavaScriptSource("const answer = true;");
    const declaration = parsed?.program.body[0];
    const declarator = t.isVariableDeclaration(declaration)
      ? declaration.declarations[0]
      : undefined;
    if (parsed === null || !t.isVariableDeclarator(declarator))
      throw new Error("Expected parsed binding initializer");
    let expression: t.Expression = t.booleanLiteral(true);
    for (let index = 0; index < 300; index += 1)
      expression = t.tsAsExpression(expression, t.tsStringKeyword());
    declarator.init = expression;

    const ir = analyzeParsedJavaScriptSemantics(parsed);
    expect(topLevelBinding(ir, "answer").value).toMatchObject({
      status: "unknown",
      resourceLimit: "expression-depth",
    });
  });

  it("preserves exact shallow addition alternatives", () => {
    expect(valueOf('(choice ? "a" : "b") + (other ? "1" : "2")')).toEqual({
      status: "union",
      values: ["a1", "a2", "b1", "b2"],
    });
  });
});
