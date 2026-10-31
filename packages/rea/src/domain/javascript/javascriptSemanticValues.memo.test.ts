import { expect, it, vi } from "vitest";

import {
  analyzeJavaScriptSemantics,
  indexJavaScriptBindingsSteps,
} from "./javascriptSemanticAnalysis.js";
import { SemanticDependencyProofs } from "./javascriptSemanticDependencies.js";
import { SEMANTIC_EXPRESSION_DEPTH_LIMIT } from "./javascriptSemanticResourceLimits.js";
import type { JavaScriptSemanticValue } from "./javascriptSemanticValueTypes.js";
import {
  clearSemanticValueCaches,
  evaluateSemanticBinding,
  evaluateSemanticProvenance,
} from "./javascriptSemanticValues.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";

const property = (
  value: JavaScriptSemanticValue,
  name: string,
): JavaScriptSemanticValue => {
  if (value.status !== "object")
    throw new Error(`Expected object at ${name}, got ${value.status}`);
  const result = value.properties.find((entry) => entry.name === name)?.value;
  if (result === undefined) throw new Error(`Missing ${name}`);
  return result;
};

it("reuses dependency-aware read snapshots across a reconvergent value chain", () => {
  const measure = (depth: number) => {
    const source = `let a0=1;${Array.from(
      { length: depth },
      (_, index) => `let a${index + 1}=a${index}+a${index};`,
    ).join(
      "",
    )}const saved=a${depth};${Array.from({ length: depth + 1 }, (_, index) => `a${index}=0;`).join("")}`;
    const parsed = parseJavaScriptSource(source, "saved-chain.js");
    if (parsed === null) throw new Error("Expected parsed source");
    const steps = indexJavaScriptBindingsSteps(parsed.program);
    let step = steps.next();
    while (step.done !== true) step = steps.next();
    const state = step.value;
    const saved = [...state.bindingsById.values()].find(
      ({ name }) => name === "saved",
    );
    if (saved === undefined) throw new Error("Missing saved binding");
    const binding = vi.spyOn(SemanticDependencyProofs.prototype, "binding");
    try {
      expect(evaluateSemanticBinding(saved, state)).toEqual({
        status: "literal",
        value: 2 ** depth,
      });
      return binding.mock.calls.length;
    } finally {
      binding.mockRestore();
    }
  };
  const small = measure(8);
  const large = measure(12);
  expect(small).toBeGreaterThan(0);
  expect(large).toBeLessThan(3 * small);
});

it("preserves the remaining depth budget when reusing a read snapshot", () => {
  const depth = 12;
  const nesting = SEMANTIC_EXPRESSION_DEPTH_LIMIT - depth;
  const source = `let a0=1;${Array.from({ length: depth }, (_, index) => `let a${index + 1}=a${index}+a${index};`).join("")}
const root={shallow:a${depth},deep:${"[".repeat(nesting)}a${depth}${"]".repeat(nesting)},after:a${depth}};
${Array.from({ length: depth + 1 }, (_, index) => `a${index}=0;`).join("")}`;
  const parsed = parseJavaScriptSource(source, "snapshot-depth.js");
  if (parsed === null) throw new Error("Expected parsed source");
  const steps = indexJavaScriptBindingsSteps(parsed.program);
  let step = steps.next();
  while (step.done !== true) step = steps.next();
  const state = step.value;
  const root = [...state.bindingsById.values()].find(
    ({ name }) => name === "root",
  );
  if (root === undefined) throw new Error("Missing root binding");
  const result = evaluateSemanticBinding(root, state);
  for (const key of ["shallow", "after"])
    expect(property(result, key)).toEqual({
      status: "literal",
      value: 2 ** depth,
    });
  let leaf = property(result, "deep");
  while (leaf.status === "array") {
    const item = leaf.items[0];
    if (item === undefined) throw new Error("Missing nested item");
    leaf = item.value;
  }
  expect(leaf).toMatchObject({
    status: "unknown",
    resourceLimit: "expression-depth",
  });
});

it("bounds reconvergent read work when the expression depth budget is exhausted", () => {
  const depth = SEMANTIC_EXPRESSION_DEPTH_LIMIT;
  const source = `let a0=1;${Array.from({ length: depth }, (_, index) => `let a${index + 1}=a${index}+a${index};`).join("")}
const saved=a${depth};${Array.from({ length: depth + 1 }, (_, index) => `a${index}=0;`).join("")}`;
  const parsed = parseJavaScriptSource(source, "snapshot-limit.js");
  if (parsed === null) throw new Error("Expected parsed source");
  const steps = indexJavaScriptBindingsSteps(parsed.program);
  let step = steps.next();
  while (step.done !== true) step = steps.next();
  const state = step.value;
  const saved = [...state.bindingsById.values()].find(
    ({ name }) => name === "saved",
  );
  if (saved === undefined) throw new Error("Missing saved binding");
  const original = SemanticDependencyProofs.prototype.binding;
  let visits = 0;
  const binding = vi
    .spyOn(SemanticDependencyProofs.prototype, "binding")
    .mockImplementation(function (this: SemanticDependencyProofs, name) {
      if (++visits > 16 * depth)
        throw new Error("Unbounded snapshot dependency evaluation");
      return original.call(this, name);
    });
  try {
    expect(evaluateSemanticBinding(saved, state)).toMatchObject({
      status: "unknown",
      resourceLimit: "expression-depth",
    });
  } finally {
    binding.mockRestore();
  }
});

it.each([false, true])(
  "isolates captured parameter values from the assigned binding cache (prewarmed: %s)",
  (prewarmed) => {
    const parsed = parseJavaScriptSource(
      `export function read(x) {
        const earlier = x;
        x = 2;
        const later = x;
        return { earlier, later };
      }`,
      "captured-parameter.js",
    );
    if (parsed === null) throw new Error("Expected parsed source");
    const steps = indexJavaScriptBindingsSteps(parsed.program);
    let step = steps.next();
    while (step.done !== true) step = steps.next();
    const state = step.value;
    const bindings = new Map(
      [...state.bindingsById.values()].map((binding) => [
        binding.name,
        binding,
      ]),
    );
    const assigned = bindings.get("x");
    const earlier = bindings.get("earlier");
    const later = bindings.get("later");
    if (assigned === undefined || earlier === undefined || later === undefined)
      throw new Error("Missing capture bindings");
    if (prewarmed)
      expect(evaluateSemanticBinding(assigned, state)).toEqual({
        status: "literal",
        value: 2,
      });
    expect(evaluateSemanticBinding(earlier, state).status).toBe("unknown");
    expect(evaluateSemanticBinding(later, state)).toEqual({
      status: "literal",
      value: 2,
    });
    expect(evaluateSemanticBinding(assigned, state)).toEqual({
      status: "literal",
      value: 2,
    });
  },
);

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "keeps forward object references unknown across read snapshots (prewarmed: %s, rebound: %s)",
  (prewarmed, rebound) => {
    const parsed = parseJavaScriptSource(
      `
${rebound ? "let" : "const"} a = { shared: common, own: "a" };
${rebound ? "let" : "const"} b = { shared: common, own: "b" };
const common = { a, b };
const result = { first: a, second: b };
${rebound ? "a=0; b=0;" : ""}
`,
      "cycles.js",
    );
    if (parsed === null) throw new Error("Expected parsed source");
    const steps = indexJavaScriptBindingsSteps(parsed.program);
    let step = steps.next();
    while (step.done !== true) step = steps.next();
    const state = step.value;
    const binding = [...state.bindingsById.values()].find(
      (entry) => entry.name === "result",
    );
    if (binding === undefined) throw new Error("Missing result binding");
    if (prewarmed)
      for (const entry of state.bindingsById.values())
        if (entry.name === "a" || entry.name === "b")
          evaluateSemanticBinding(entry, state);
    const value = evaluateSemanticBinding(binding, state);
    // These object initializers read common before its lexical declaration.
    // Expanding them into an abstract cycle would invent a runtime value.
    for (const [side, own] of [
      ["first", "a"],
      ["second", "b"],
    ] as const) {
      const object = property(value, side);
      expect(property(object, "shared")).toEqual({
        status: "unknown",
        reason: "Binding common has no proven initializer at this read.",
      });
      expect(property(object, "own")).toEqual({
        status: "literal",
        value: own,
      });
    }
  },
);

it.each([
  ["const", ""],
  ["let", "target={value:2};"],
])(
  "invalidates retained %s alias values at the producing mutation boundary",
  (kind, later) => {
    const parsed = parseJavaScriptSource(
      `${kind} target = { value: 1 }; const alias = target; const root = { alias }; ${later}`,
      "mutation.js",
    );
    if (parsed === null) throw new Error("Expected parsed source");
    const steps = indexJavaScriptBindingsSteps(parsed.program);
    let step = steps.next();
    while (step.done !== true) step = steps.next();
    const state = step.value;
    const target = [...state.bindingsById.values()].find(
      ({ name }) => name === "target",
    );
    const root = [...state.bindingsById.values()].find(
      ({ name }) => name === "root",
    );
    if (target === undefined || root === undefined)
      throw new Error("Missing binding");
    expect(
      property(
        property(evaluateSemanticBinding(root, state), "alias"),
        "value",
      ),
    ).toEqual({ status: "literal", value: 1 });
    target.memberWrites.push({ path: ["value"], node: undefined });
    clearSemanticValueCaches(state);
    expect(
      property(property(evaluateSemanticBinding(root, state), "alias"), "value")
        .status,
    ).toBe("unknown");
  },
);

const balancedOr = (names: string[]): string => {
  if (names.length === 1) return names[0]!;
  const middle = Math.floor(names.length / 2);
  return `(${balancedOr(names.slice(0, middle))} || ${balancedOr(names.slice(middle))})`;
};

it("shares dependency proofs across a shallow wide reconvergent graph", () => {
  const measure = (width: number) => {
    const imports = Array.from({ length: width }, (_, index) => `l${index}`);
    const aliases = Array.from({ length: width }, (_, index) => `a${index}`);
    const source = `${imports.map((name) => `import * as ${name} from "fs";`).join("\n")}
const shared = ${balancedOr(imports)};
function consumer() {
${aliases.map((name) => `const ${name} = shared;`).join("\n")}
const root = ${balancedOr(aliases)};
}`;
    const parsed = parseJavaScriptSource(source, "wide.js");
    if (parsed === null) throw new Error("Expected parsed source");
    const steps = indexJavaScriptBindingsSteps(parsed.program);
    let step = steps.next();
    while (step.done !== true) step = steps.next();
    const state = step.value;
    const rootBinding = [...state.bindingsById.values()].find(
      ({ name }) => name === "root",
    );
    if (rootBinding === undefined) throw new Error("Missing root binding");
    // One root query simultaneously retains every alias memo in this family.
    // Separate per-binding provenance queries have baseline repeated traversal;
    // they must not be confused with this cache's retained closure expansion.
    // Count representation construction and union work, not elapsed time/heap.
    // Binding-ID additions also discriminate the superseded flattened Sets.
    let bindingMemberships = 0;
    let proofBranches = 0;
    let unionCalls = 0;
    const add = Set.prototype.add;
    const freeze = Object.freeze;
    const union = SemanticDependencyProofs.prototype.union;
    const addSpy = vi.spyOn(Set.prototype, "add").mockImplementation(function (
      this: Set<unknown>,
      value: unknown,
    ) {
      if (typeof value === "string" && value.includes("binding:"))
        bindingMemberships++;
      return add.call(this, value);
    });
    const freezeSpy = vi.spyOn(Object, "freeze").mockImplementation((value) => {
      if (
        typeof value === "object" &&
        value !== null &&
        Object.hasOwn(value, "zero") &&
        Object.hasOwn(value, "one") &&
        Object.keys(value).length === 2
      )
        proofBranches++;
      return freeze(value);
    });
    const unionSpy = vi
      .spyOn(SemanticDependencyProofs.prototype, "union")
      .mockImplementation(function (
        this: SemanticDependencyProofs,
        first,
        second,
      ) {
        unionCalls++;
        return union.call(this, first, second);
      });
    try {
      expect(evaluateSemanticBinding(rootBinding, state).status).toBe(
        "ambiguous",
      );
      expect(evaluateSemanticProvenance(rootBinding, state).origins).toEqual([
        { specifier: "fs", importedPath: [] },
      ]);
    } finally {
      unionSpy.mockRestore();
      freezeSpy.mockRestore();
      addSpy.mockRestore();
    }
    const result = analyzeJavaScriptSemantics(source);
    expect(result.coverage).toEqual({ status: "complete", omittedCount: 0 });
    for (const name of [...imports, ...aliases, "shared", "root"])
      expect(
        result.bindings.filter((entry) => entry.name === name),
      ).toHaveLength(1);
    const root = result.bindings.find((entry) => entry.name === "root");
    expect(root?.value.status).toBe("ambiguous");
    expect(root?.provenance.origins).toEqual([
      { specifier: "fs", importedPath: [] },
    ]);
    return {
      storage: bindingMemberships + proofBranches,
      work: bindingMemberships + unionCalls,
    };
  };
  // Balanced depths remain small; doubling both independent widths must not
  // quadruple proof construction/work while all meaningful aliases survive.
  const small = measure(32);
  const large = measure(64);
  expect(small.storage).toBeGreaterThan(0);
  expect(small.work).toBeGreaterThan(0);
  expect(large.storage).toBeLessThan(small.storage * 3);
  expect(large.work).toBeLessThan(small.work * 3);
});

it("uses immutable exact identity proofs and shares unchanged union branches", () => {
  const proofs = SemanticDependencyProofs.forBindings([
    "a",
    "b",
    "c",
    "d",
    "e",
  ]);
  const a = proofs.binding("a");
  const b = proofs.binding("b");
  const c = proofs.binding("c");
  const ab = proofs.union(a, b);
  const abc = proofs.union(ab, c);
  expect(proofs.union(abc, ab)).toBe(abc);
  expect(proofs.binding("a")).toBe(a);
  expect(Object.isFrozen(abc)).toBe(true);
  expect(["a", "b", "c", "d", "e"].map((id) => proofs.has(abc, id))).toEqual([
    true,
    true,
    true,
    false,
    false,
  ]);
  expect(proofs.has(undefined, "a")).toBe(false);
  expect(proofs.intersects(abc, new Map([["d", 0]]))).toBe(false);
  expect(proofs.intersects(abc, new Map([["c", 0]]))).toBe(true);
  const single = SemanticDependencyProofs.forBindings(["only"]);
  expect(single.has(single.binding("only"), "only")).toBe(true);
  expect(single.has(undefined, "only")).toBe(false);
  expect(() => proofs.binding("unindexed")).toThrow(
    "Unindexed semantic dependency",
  );
});

it("preserves exact union membership through repeated overlapping proof pairs", () => {
  const names = ["a", "b", "c", "d", "e"];
  const proofs = SemanticDependencyProofs.forBindings(names);
  const subsets = Array.from({ length: 2 ** names.length }, (_, mask) => {
    const members = names.filter((_, index) => (mask & (1 << index)) !== 0);
    return {
      members,
      proof: members.reduce<ReturnType<typeof proofs.binding>>(
        (proof, name) => proofs.union(proof, proofs.binding(name)),
        undefined,
      ),
    };
  });
  for (const first of subsets)
    for (const second of subsets) {
      const expected = new Set([...first.members, ...second.members]);
      for (const union of [
        proofs.union(first.proof, second.proof),
        proofs.union(second.proof, first.proof),
        proofs.union(first.proof, second.proof),
      ])
        expect(names.filter((name) => proofs.has(union, name))).toEqual(
          [...expected].sort(),
        );
      expect(names.filter((name) => proofs.has(first.proof, name))).toEqual(
        first.members,
      );
      expect(names.filter((name) => proofs.has(second.proof, name))).toEqual(
        second.members,
      );
    }
});

it("shares identity layout without retaining unions across query lifetimes", () => {
  const layout = SemanticDependencyProofs.forBindings(["a", "b", "c"]);
  const first = layout.forQuery();
  const second = layout.forQuery();
  const a = first.binding("a");
  const b = first.binding("b");
  const ab = first.union(a, b);
  expect(first.union(a, b)).toBe(ab);
  expect(first.union(b, a)).toBe(ab);
  expect(second.binding("a")).toBe(a);
  const fresh = second.union(a, b);
  expect(fresh).not.toBe(ab);
  expect(["a", "b", "c"].map((name) => second.has(fresh, name))).toEqual([
    true,
    true,
    false,
  ]);
});

it("releases query union ownership when state-owned values are invalidated", () => {
  const parsed = parseJavaScriptSource(
    "const a=1; const result=a+a;",
    "queries.js",
  );
  if (parsed === null) throw new Error("Expected parsed source");
  const steps = indexJavaScriptBindingsSteps(parsed.program);
  let step = steps.next();
  while (step.done !== true) step = steps.next();
  const state = step.value;
  const result = [...state.bindingsById.values()].find(
    ({ name }) => name === "result",
  );
  if (result === undefined) throw new Error("Missing result binding");
  const union = SemanticDependencyProofs.prototype.union;
  const owners = new Set<SemanticDependencyProofs>();
  const spy = vi
    .spyOn(SemanticDependencyProofs.prototype, "union")
    .mockImplementation(function (
      this: SemanticDependencyProofs,
      first,
      second,
    ) {
      owners.add(this);
      return union.call(this, first, second);
    });
  try {
    expect(evaluateSemanticBinding(result, state)).toEqual({
      status: "literal",
      value: 2,
    });
    expect(owners.size).toBe(1);
    const firstOwners = new Set(owners);
    owners.clear();
    clearSemanticValueCaches(state);
    expect(evaluateSemanticBinding(result, state)).toEqual({
      status: "literal",
      value: 2,
    });
    expect(owners.size).toBe(1);
    expect([...owners].some((owner) => firstOwners.has(owner))).toBe(false);
  } finally {
    spy.mockRestore();
  }
});
