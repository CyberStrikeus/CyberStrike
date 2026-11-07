import { expect, it } from "vitest";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { onlyCallable } from "./javascriptSemanticAnalysis.fixture.js";

const returned = (body: string) =>
  onlyCallable(
    analyzeJavaScriptSemantics(`export function observe() { ${body} }`),
    "observe",
  ).returnSites[0]?.value;

it.each([
  "const copy = { ...state };",
  "const { trigger } = state;",
  "let trigger; ({ trigger } = state);",
  "const { ...copy } = state;",
  "const outer = { state }; const { state: { trigger } } = outer;",
])(
  "indexes implicit getter invocation through the shared pattern/copy owner: %s",
  (read) => {
    expect(
      returned(`
    const state = { value: 1, get trigger() { this.value = 2; return 0; } };
    ${read}
    return state.value;
  `)?.status,
    ).toBe("unknown");
  },
);

it("keeps copied own data properties separate from inherited getters and excluded rest keys", () => {
  expect(
    returned(`
    const state = { __proto__: { get trigger() { this.value = 2; return 0; } }, value: 1 };
    const copy = { ...state };
    return state.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
  expect(
    returned(`
    const state = { value: 1, get trigger() { return 0; } };
    const { trigger, ...copy } = state;
    return state.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
});

it.each([
  "const key = { [state]: 0 };",
  "const result = state + '';",
  "const result = +state;",
  "const result = `${state}`;",
])(
  "retains receiver uncertainty after implicit primitive conversion: %s",
  (operation) => {
    expect(
      returned(`
    const state = { [Symbol.toPrimitive]() { this.value = 2; return 'key'; }, value: 1 };
    ${operation}
    return state.value;
  `)?.status,
    ).toBe("unknown");
  },
);

it("keeps noncoercing operations and primitive operands precise", () => {
  expect(
    returned(`
    const state = { [Symbol.toPrimitive]() { this.value = 2; return 'key'; }, value: 1 };
    const same = state === state;
    const truthy = !state;
    const primitive = 2 + 3;
    return state.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
});

it.each(["using", "await using"])(
  "retains %s disposal effects at lexical scope exit",
  (kind) => {
    const source = `${kind === "await using" ? "async " : ""}function observe() {
    const state = { [Symbol.dispose]() { this.value = 2; }, value: 1 };
    { ${kind} owned = state; }
    return state.value;
  }`;
    const ir = analyzeJavaScriptSemantics(source);
    expect(onlyCallable(ir, "observe").returnSites[0]?.value.status).toBe(
      "unknown",
    );
  },
);

it("preserves scalar snapshots selected before disposal", () => {
  expect(
    returned(`
    const state = { [Symbol.dispose]() { this.value = 2; }, value: 1 };
    const snapshot = state.value;
    { using owned = state; }
    return snapshot;
  `),
  ).toEqual({ status: "literal", value: 1 });
  expect(
    returned(`
    const state = { [Symbol.dispose]() { this.value = 2; }, value: 1 };
    using owned = state;
    return state.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
});

it("keeps the disposer receiver captured before an outer binding replacement", () => {
  expect(
    returned(`
    let state = { [Symbol.dispose]() { this.value = 2; }, value: 1 };
    const original = state;
    { using owned = state; state = { value: 3 }; }
    return original.value;
  `)?.status,
  ).toBe("unknown");
  expect(
    returned(`
    const state = { [Symbol.dispose]() { this.value = 2; }, value: 1 };
    { using nothing = null; }
    return state.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
});

it("projects supported class getter effects through inherited receiver fields", () => {
  expect(
    returned(`
    const shared = { value: 1 };
    class Base { get trigger() { this.state.value = 2; return 0; } }
    class Box extends Base { state = shared; }
    new Box().trigger;
    return shared.value;
  `)?.status,
  ).toBe("unknown");
});

it("retains shared child effects from selected setters", () => {
  expect(
    returned(`
    const shared = { value: 1 };
    const box = { shared, set trigger(value) { this.shared.value = value; } };
    box.trigger = 2;
    return shared.value;
  `)?.status,
  ).toBe("unknown");
});

it("exposes custom instanceof receivers but keeps object equality noncoercing", () => {
  expect(
    returned(`
    const state = { value: 1, [Symbol.hasInstance]() { this.value = 2; return false; } };
    const result = {} instanceof state;
    return state.value;
  `)?.status,
  ).toBe("unknown");
  expect(
    returned(`
    const state = { value: 1 };
    const target = { [Symbol.hasInstance](value) { value.value = 2; return false; } };
    const result = state instanceof target;
    return state.value;
  `)?.status,
  ).toBe("unknown");
  expect(
    returned(`
    const state = { value: 1, [Symbol.toPrimitive]() { this.value = 2; return 0; } };
    const equal = state == state; const unequal = state != {};
    return state.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
});

it("exposes class private storage reached by an invoked getter", () => {
  expect(
    returned(`
    const shared = { value: 1 };
    class Box { #state = shared; get trigger() { this.#state.value = 2; return 0; } }
    new Box().trigger;
    return shared.value;
  `)?.status,
  ).toBe("unknown");
});

it("retains disposal of per-iteration resources through existing loop origins", () => {
  expect(
    returned(`
    const state = { value: 1, [Symbol.dispose]() { this.value = 2; } };
    for (using owned of [state]) {}
    return state.value;
  `)?.status,
  ).toBe("unknown");
});

it("does not expose a returned resource as an unchanged object snapshot", () => {
  const value = returned(`
    const state = { value: 1, [Symbol.dispose]() { this.value = 2; } };
    using owned = state;
    return state;
  `);
  expect(
    value?.status === "object"
      ? value.properties.find(({ name }) => name === "value")?.value.status
      : value?.status,
  ).toBe("unknown");
});

it("retains earlier iteration disposal uncertainty for reused outer resources", () => {
  expect(
    returned(`
    const state = { value: 1, [Symbol.dispose]() { this.value = 2; } };
    for (const index of [0, 1]) {
      using owned = state;
      const snapshot = state.value;
      if (index === 1) return snapshot;
    }
  `)?.status,
  ).toBe("unknown");
});

it("follows superclass getter effects through the selected receiver", () => {
  expect(
    returned(`
    const shared = { value: 1 };
    class Base { get trigger2() { this.state.value = 2; return 0; } }
    class Box extends Base { state = shared; get trigger2() { return 0; } get trigger() { return super.trigger2; } }
    new Box().trigger;
    return shared.value;
  `)?.status,
  ).toBe("unknown");
});

it("summarizes per-iteration disposal inside invoked getters", () => {
  expect(
    returned(`
    const shared = {value: 1, [Symbol.dispose]() {this.value = 2;}};
    const box = {state: shared, get trigger() {for (using owned of [this.state]) {} return 0;}};
    box.trigger;
    return shared.value;
  `)?.status,
  ).toBe("unknown");
});

it("keeps same-receiver equality in an inert getter precise", () => {
  expect(
    returned(`
    const state = {value: 1, get trigger() {return this == this;}};
    state.trigger;
    return state.value;
  `),
  ).toEqual({ status: "literal", value: 1 });
});

it("keeps intrinsic symbol keys separate from string overwrites without claiming complete inventory", () => {
  expect(
    returned(
      `const state={value:1,[Symbol.toPrimitive](){return 0;}};return state.value;`,
    ),
  ).toEqual({ status: "literal", value: 1 });
  const ir = analyzeJavaScriptSemantics(
    `const state={value:1,[Symbol.toPrimitive](){return 0;}};`,
  );
  expect(ir.bindings.find(({ name }) => name === "state")?.value).toMatchObject(
    { status: "object", unknownProperties: true, omittedProperties: 1 },
  );
  expect(
    returned(
      `const Symbol={toPrimitive:"value"};const state={value:1,[Symbol.toPrimitive]:2};return state.value;`,
    )?.status,
  ).toBe("unknown");
});

it("exposes shared fields when a constructed receiver is passed to an opaque call", () => {
  expect(
    returned(
      `const shared={value:1};class Box{state=shared;} const box=new Box(); unknown(box);return shared.value;`,
    )?.status,
  ).toBe("unknown");
});
