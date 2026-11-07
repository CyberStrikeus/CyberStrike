import { expect, it } from "vitest";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { onlyCallable } from "./javascriptSemanticAnalysis.fixture.js";

const returned = (body: string) =>
  onlyCallable(
    analyzeJavaScriptSemantics(`export function observe() { ${body} }`),
    "observe",
  ).returnSites[0]?.value;

it.each([
  ["ordinary read", "box.trigger;"],
  ["optional read", "box?.trigger;"],
  ["compound assignment", "box.trigger += 1;"],
  ["update", "box.trigger++;"],
])("invalidates a receiver after a mutating getter's %s", (_name, read) => {
  expect(
    returned(`
    const box = { value: 1, get trigger() { this.value = 2; return 0; } };
    ${read}
    return box.value;
  `),
  ).toMatchObject({ status: "unknown" });
});

it("follows inherited getter selection while preserving own-property shadowing", () => {
  const prototype = "{ get trigger() { this.value = 2; return 0; } }";
  expect(
    returned(`
    const prototype = ${prototype};
    const box = { __proto__: prototype, value: 1 };
    box.trigger;
    return box.value;
  `),
  ).toMatchObject({ status: "unknown" });
  expect(
    returned(`
    const box = { __proto__: ${prototype}, value: 1, trigger: 0 };
    box.trigger;
    return box.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
});

it.each([
  ["simple store", "box.trigger = 2;"],
  ["destructuring store", "({ trigger: box.trigger } = { trigger: 2 });"],
  ["delete", "delete box.trigger;"],
  ["later data property", "box.trigger;", ", trigger: 0"],
])("does not invoke a getter for %s", (_name, operation, later = "") => {
  expect(
    returned(`
    const box = { value: 1, get trigger() { this.value = 2; return 0; } ${later} };
    ${operation}
    return box.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
});

it("preserves an inert getter and a primitive sibling outside the receiver", () => {
  expect(
    returned(`
    const box = { value: 1, get trigger() { return this.value; } };
    box.trigger;
    return box.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
  expect(
    returned(`
    const outer = { kept: "stable", rows: [{ value: 1, get trigger() { this.value = 2; } }] };
    outer.rows[0].trigger;
    return outer.kept;
  `),
  ).toEqual({ status: "literal", value: "stable" });
});

it.each([
  [
    "array element",
    "const rows = [{ value: 1, set trigger(value) { this.value = value; } }];",
    "rows[0]",
  ],
  [
    "inherited setter",
    "const box = { __proto__: { set trigger(value) { this.value = value; } }, value: 1 };",
    "box",
  ],
  [
    "aliased nested receiver",
    "const box = { value: 1, set trigger(value) { this.value = value; } }; const outer = { box };",
    "outer.box",
  ],
])(
  "invalidates the selected %s receiver on assignment",
  (_name, setup, receiver) => {
    expect(
      returned(`${setup} ${receiver}.trigger = 2; return ${receiver}.value;`),
    ).toMatchObject({ status: "unknown" });
  },
);

it("does not inherit a setter through an own data property or copied descriptor", () => {
  for (const box of [
    "{ __proto__: { set trigger(value) { this.value = value; } }, value: 1, trigger: 0 }",
    "{ ...{ set trigger(value) { this.value = value; } }, value: 1 }",
  ]) {
    expect(
      returned(`const box = ${box}; box.trigger = 2; return box.value;`),
    ).toEqual({ status: "literal", value: 1 });
  }
});

it("follows getter-to-getter invocation effects with the selected receiver", () => {
  expect(
    returned(`
    const box = {
      value: 1,
      get trigger() { return this.trigger2; },
      get trigger2() { this.value = 2; return 0; },
    };
    box.trigger;
    return box.value;
  `),
  ).toMatchObject({ status: "unknown" });
});

it.each([
  "const other = {}; other.x = 2; return this.value;",
  "const unused = () => { this.value = 2; }; return 0;",
  "const outer = this; const unused = () => outer.value++; return 0;",
])(
  "keeps the receiver exact when getter effects do not reach it: %s",
  (body) => {
    expect(
      returned(`
    const box = { value: 1, get trigger() { ${body} } };
    box.trigger;
    return box.value;
  `),
    ).toEqual({ status: "literal", value: 1 });
  },
);

it.each([
  "(() => { this.value = 2; })(); return 0;",
  "const change = () => { this.value = 2; }; change(); return 0;",
  "const outer = this; function change() { outer.value = 2; } change(); return 0;",
  "const a = { box: this }; a.box.value = 2; return 0;",
  "const outer = this; function Change() { outer.value = 2; } new Change(); return 0;",
  "const tag = () => { this.value = 2; }; tag``; return 0;",
])(
  "retains effects through invoked local callables and containers: %s",
  (body) => {
    expect(
      returned(`
    const box = { value: 1, get trigger() { ${body} } };
    box.trigger;
    return box.value;
  `),
    ).toMatchObject({ status: "unknown" });
  },
);

it("retains references returned from tagged invocation through the ordinary callee owner", () => {
  expect(
    returned(`
    const shared = { value: 1 };
    const tag = () => shared;
    tag\`\`;
    return shared.value;
  `),
  ).toMatchObject({ status: "unknown" });
  expect(
    returned(`
    const shared = { value: 1 };
    const tag = () => 0;
    tag\`\`;
    return shared.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
});
