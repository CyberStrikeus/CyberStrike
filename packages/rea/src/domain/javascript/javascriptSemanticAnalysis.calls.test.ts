import { describe, expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import {
  bindingById,
  onlyCallable,
  topLevelBinding,
} from "./javascriptSemanticAnalysis.fixture.js";

describe("JavaScript semantic call result use", () => {
  it.each([
    'consume("unique");',
    'consume("unique")!;',
    'consume("unique") as unknown;',
    '(consume("unique") as unknown)!;',
  ])("does not treat %s as a used call result", (source) => {
    const ir = analyzeJavaScriptSemantics(source);
    expect(ir.callSites[0]?.resultUsed).toBe(false);
  });

  it("treats an asserted call initializer as a used result", () => {
    const used = analyzeJavaScriptSemantics(
      'const value = consume("unique")!;',
    );
    expect(used.callSites[0]?.resultUsed).toBe(true);
  });

  it.each([
    'for (notify("token"); running;) {}',
    'for (; running; notify("token")) {}',
    'for (notify("token")!; running;) {}',
  ])("does not treat %s as a used call result", (source) => {
    const ir = analyzeJavaScriptSemantics(source);
    const call = ir.callSites.find((site) =>
      site.arguments.some((argument) => argument.literal === "token"),
    );
    expect(call?.resultUsed).toBe(false);
  });

  it("treats a for-loop variable initializer call as a used result", () => {
    const ir = analyzeJavaScriptSemantics(
      'for (const value = notify("token"); running;) {}',
    );
    expect(ir.callSites[0]?.resultUsed).toBe(true);
  });
});

describe("JavaScript semantic analysis: calls 1", () => {
  it("does not assign computed method-name reads to method closures", () => {
    const ir = analyzeJavaScriptSemantics(`
      function outer() {
        const name = "m";
        const object = { [name]() { return 1; }, ["literal"]() { return 2; } };
        class Example {
          [name]() { return 3; }
          ["literal"]() { return 4; }
        }
      }
    `);
    expect(ir.closureCaptures).toEqual([]);

    const bodyRead = analyzeJavaScriptSemantics(`
      function outer() {
        const value = 1;
        const object = { method() { return value; } };
      }
    `);
    expect(bodyRead.closureCaptures).toHaveLength(1);
  });

  it("links exact local calls to parameters, returns, and closure captures", () => {
    const ir = analyzeJavaScriptSemantics(`
      const prefix = "rea";
      function render(value, { mode }) {
        return prefix + value + mode;
      }
      const alias = render;
      const result = alias(input, { mode: "fast" });
    `);

    expect(ir.schema).toBe("JavaScriptSemanticIR");
    const render = onlyCallable(ir, "render");
    const call = ir.callSites.find(
      ({ calleeCallableIds }) => calleeCallableIds[0] === render.callableId,
    );
    expect(call).toMatchObject({
      kind: "call",
      callerCallableId: null,
      resolution: "exact",
      calleeCallableIds: [render.callableId],
      arguments: [
        { index: 0, spread: false },
        { index: 1, spread: false },
      ],
    });
    if (call === undefined) throw new Error("Missing render call");
    expect(
      ir.argumentFlows
        .filter(({ callSiteId }) => callSiteId === call.callSiteId)
        .map(({ argumentIndex, parameterBindingId }) => ({
          argumentIndex,
          parameter: bindingById(ir, parameterBindingId)?.name,
        })),
    ).toEqual([
      { argumentIndex: 0, parameter: "value" },
      { argumentIndex: 1, parameter: "mode" },
    ]);
    expect(ir.callReturnFlows).toEqual([
      expect.objectContaining({
        callSiteId: call.callSiteId,
        callableId: render.callableId,
        returnSiteId: render.returnSites[0]?.returnSiteId,
      }),
    ]);
    expect(ir.closureCaptures).toEqual([
      expect.objectContaining({
        callableId: render.callableId,
        bindingId: topLevelBinding(ir, "prefix").bindingId,
      }),
    ]);
    expect(ir.frontiers).toEqual([]);
  });

  it("recovers explicit Promise ownership, chains, aggregation, and awaits", () => {
    const ir = analyzeJavaScriptSemantics(`
      async function run(value) {
        const base = Promise.resolve(value);
        const chained = base.then(work).finally(cleanup);
        await chained;
        Promise.resolve(value).then(work);
        return Promise.all([base, Promise.resolve(value)]);
      }
      const settled = Promise.allSettled([Promise.resolve(1)]);
    `);

    expect(
      ir.promiseOperations.map(
        ({ kind, method, ownership, sourceResolution }) => ({
          kind,
          method,
          ownership,
          sourceResolution,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "static",
          method: "resolve",
          ownership: "assigned",
          sourceResolution: "complete",
        },
        {
          kind: "chain",
          method: "then",
          ownership: "chained",
          sourceResolution: "complete",
        },
        {
          kind: "chain",
          method: "finally",
          ownership: "assigned",
          sourceResolution: "complete",
        },
        {
          kind: "awaited-expression",
          method: "await",
          ownership: "awaited",
          sourceResolution: "complete",
        },
        {
          kind: "chain",
          method: "then",
          ownership: "detached",
          sourceResolution: "complete",
        },
        {
          kind: "aggregate",
          method: "all",
          ownership: "returned",
          sourceResolution: "complete",
        },
        {
          kind: "aggregate",
          method: "allSettled",
          ownership: "assigned",
          sourceResolution: "complete",
        },
      ]),
    );
    const aggregate = ir.promiseOperations.find(
      ({ method }) => method === "all",
    );
    expect(aggregate?.sourcePromiseIds).toHaveLength(2);
    expect(aggregate?.returnSiteId).toBeTypeOf("string");
  });
});

describe("JavaScript semantic analysis: computed method keys", () => {
  it("evaluates computed method keys in the enclosing callable", () => {
    const ir = analyzeJavaScriptSemantics(`
      function outer() {
        const name = "m";
        const pick = () => "n";
        const obj = { [name]() { return 1; }, [pick()]() { return name; } };
        class C { [name]() { return 2; } [pick()]() { return 3; } }
      }
    `);

    const outer = onlyCallable(ir, "outer");
    const pickCall = ir.callSites.find(
      ({ calleeCallableIds }) => calleeCallableIds.length === 1,
    );
    expect(pickCall).toMatchObject({
      callerCallableId: outer.callableId,
      resolution: "exact",
    });
    expect(
      ir.callSites.filter(
        ({ callerCallableId, calleeCallableIds, resolution }) =>
          callerCallableId === outer.callableId &&
          calleeCallableIds.length === 1 &&
          resolution === "exact",
      ),
    ).toHaveLength(2);
    // Only the method body that reads `name` captures it; the computed keys
    // are evaluated outside every method environment.
    expect(
      ir.closureCaptures.map(({ callableId, bindingId }) => ({
        owner: ir.callables.find(
          (callable) => callable.callableId === callableId,
        )?.kind,
        binding: bindingById(ir, bindingId)?.name,
      })),
    ).toEqual([{ owner: "method", binding: "name" }]);
  });

  it("keeps ordinary nested method-body reads uncertain", () => {
    const ir = analyzeJavaScriptSemantics(`
      function outer() {
        const pick = () => "n";
        return { method() { return pick(); } };
      }
    `);
    const pick = onlyCallable(ir, "pick");
    const pickCall = ir.callSites.find(({ calleeCallableIds }) =>
      calleeCallableIds.includes(pick.callableId),
    );
    expect(pickCall).toMatchObject({
      resolution: "ambiguous",
      calleeCallableIds: [pick.callableId],
    });
  });

  it("keeps callables nested in a computed method key in their own frames", () => {
    const ir = analyzeJavaScriptSemantics(`
      function outer() {
        const name = "m";
        const pick = () => "n";
        return { [(() => pick())()]() { return name; } };
      }
    `);

    const outer = onlyCallable(ir, "outer");
    const pick = onlyCallable(ir, "pick");
    const keyArrow = ir.callables.find(
      ({ kind, name }) => kind === "function" && name === null,
    );
    const method = ir.callables.find(({ kind }) => kind === "method");
    expect(keyArrow).toBeDefined();
    expect(method).toBeDefined();
    const callerOf = (calleeCallableId: string | undefined) =>
      ir.callSites.find(({ calleeCallableIds }) =>
        calleeCallableIds.includes(calleeCallableId ?? ""),
      )?.callerCallableId;
    expect(callerOf(pick.callableId)).toBe(keyArrow?.callableId);
    expect(callerOf(keyArrow?.callableId)).toBe(outer.callableId);
    expect(
      ir.closureCaptures.map(({ callableId, bindingId }) => ({
        callableId,
        binding: bindingById(ir, bindingId)?.name,
      })),
    ).toEqual(
      expect.arrayContaining([
        { callableId: keyArrow?.callableId, binding: "pick" },
        { callableId: method?.callableId, binding: "name" },
      ]),
    );
  });

  it("attributes effects in computed method keys to the enclosing callable", () => {
    const ir = analyzeJavaScriptSemantics(`
      import { spawn } from "node:child_process";
      function outer(config) {
        return {
          [fetch("/x")]() {},
          [setTimeout(tick, 1)]() {},
          [Promise.resolve(1)]() {},
          [spawn("ls")]() {},
          [config.key]() {},
        };
      }
      class C { [fetch("/y")]() {} }
    `);

    const outer = onlyCallable(ir, "outer");
    const owners = (
      operations: readonly { readonly ownerCallableId: string | null }[],
    ) => operations.map(({ ownerCallableId }) => ownerCallableId);
    const methodIds = new Set(
      ir.callables
        .filter(({ kind }) => kind === "method")
        .map(({ callableId }) => callableId),
    );
    expect(methodIds.size).toBe(6);
    const classId = onlyCallable(ir, "C").callableId;
    expect(owners(ir.requestOperations).sort()).toEqual(
      [outer.callableId, classId].sort(),
    );
    expect(owners(ir.timerOperations)).toEqual([outer.callableId]);
    expect(owners(ir.promiseOperations)).toEqual([outer.callableId]);
    expect(owners(ir.childProcessSpawns)).toEqual([outer.callableId]);
    expect(
      ir.objectOperations.filter(({ propertyPath }) =>
        propertyPath?.includes("key"),
      ),
    ).toEqual([expect.objectContaining({ ownerCallableId: outer.callableId })]);
    for (const owner of [
      ...owners(ir.requestOperations),
      ...owners(ir.timerOperations),
      ...owners(ir.promiseOperations),
      ...owners(ir.childProcessSpawns),
      ...owners(ir.objectOperations),
    ])
      expect(methodIds.has(owner ?? "")).toBe(false);
  });
});

it("does not treat a shadowed Promise binding as the intrinsic", () => {
  const ir = analyzeJavaScriptSemantics(`
      function run(Promise) {
        return Promise.resolve(1).then(work);
      }
    `);

  expect(ir.promiseOperations).toEqual([
    expect.objectContaining({
      kind: "chain",
      method: "then",
      ownership: "returned",
      sourcePromiseIds: [],
      sourceResolution: "unresolved",
    }),
  ]);
});

describe("JavaScript semantic analysis: callable fingerprints", () => {
  it("fingerprints formatting and local-name changes identically", () => {
    const left = analyzeJavaScriptSemantics(`
      function calculate(value) {
        const result = value + 1;
        return result;
      }
    `);
    const right = analyzeJavaScriptSemantics(
      "function renamed(input){const output=input+1;return output}",
    );
    const changed = analyzeJavaScriptSemantics(
      "function renamed(input){const output=input+2;return output}",
    );

    expect(left.functionFingerprints).toHaveLength(1);
    expect(right.functionFingerprints).toHaveLength(1);
    expect(changed.functionFingerprints).toHaveLength(1);
    expect(left.functionFingerprints[0]?.components).toEqual(
      right.functionFingerprints[0]?.components,
    );
    expect(
      changed.functionFingerprints[0]?.components.literalSetSha256,
    ).toEqual(expect.any(String));
    expect(left.functionFingerprints[0]?.components.literalSetSha256).toEqual(
      expect.any(String),
    );
    expect(
      changed.functionFingerprints[0]?.components.literalSetSha256,
    ).not.toBe(left.functionFingerprints[0]?.components.literalSetSha256);
  });

  it("keeps nested callable syntax out of its owner's fingerprint", () => {
    const analyze = (nested: number, owned: number) =>
      analyzeJavaScriptSemantics(`
        function outer() {
          function inner() { return ${nested}; }
          const object = { method() { return ${nested}; } };
          class Nested { method() { return ${nested}; } }
          return ${owned};
        }
      `);
    const first = analyze(1, 2);
    const changedNested = analyze(3, 2);
    const changedOwner = analyze(1, 4);
    const syntax = (ir: typeof first) =>
      ir.functionFingerprints.map(({ components }) => ({
        ast: components.normalizedAstSha256,
        control: components.controlFlowSha256,
        literals: components.literalSetSha256,
      }));
    const original = syntax(first);
    expect(original).toHaveLength(4);
    expect(syntax(changedNested)[0]).toEqual(original[0]);
    for (const index of [1, 2, 3])
      expect(syntax(changedNested)[index]).not.toEqual(original[index]);
    expect(syntax(changedOwner)[0]).not.toEqual(original[0]);
    expect(syntax(changedOwner).slice(1)).toEqual(original.slice(1));
  });

  it("keeps fingerprint relations ordered and effects scoped to their owner", () => {
    const ordered = analyzeJavaScriptSemantics(`
      function first() {}
      function second(one, two) {}
      function ordered() { first(); second(1, 2); }
      function timerOwner() { setTimeout(work, 10); }
      function networkOwner() { fetch('/data'); }
      function noEffects() { return 1; }
    `);
    const reversed = analyzeJavaScriptSemantics(`
      function first() {}
      function second(one, two) {}
      function ordered() { second(1, 2); first(); }
      function timerOwner() { setTimeout(work, 10); }
      function networkOwner() { fetch('/data'); }
      function noEffects() { return 1; }
    `);
    const fingerprint = (ir: typeof ordered, name: string) =>
      ir.functionFingerprints.find((value) =>
        ir.callables.some(
          (callable) =>
            callable.callableId === value.callableId && callable.name === name,
        ),
      );

    const orderedDigest = fingerprint(ordered, "ordered")?.components
      .relationShapeSha256;
    const reversedDigest = fingerprint(reversed, "ordered")?.components
      .relationShapeSha256;
    expect(orderedDigest).toEqual(expect.any(String));
    expect(reversedDigest).toEqual(expect.any(String));
    expect(orderedDigest).not.toBe(reversedDigest);
    expect(fingerprint(ordered, "timerOwner")?.components.effects).toContain(
      "timer",
    );
    expect(fingerprint(ordered, "networkOwner")?.components.effects).toContain(
      "network",
    );
    expect(fingerprint(ordered, "noEffects")?.components.effects).toEqual([]);
    expect(
      fingerprint(ordered, "timerOwner")?.components.effects,
    ).not.toContain("network");
    expect(
      fingerprint(ordered, "networkOwner")?.components.effects,
    ).not.toContain("timer");
  });
});

it("retains ambiguous local callees and explicit dynamic frontiers", () => {
  const ir = analyzeJavaScriptSemantics(`
      function left(value) { return value; }
      function right(value) { return value; }
      const selected = chooseLeft ? left : right;
      selected(input);
      receiver[key](input);
      external(input);
    `);

  const selected = ir.callSites.find(
    ({ resolution }) => resolution === "ambiguous",
  );
  expect(selected?.calleeCallableIds).toEqual(
    [
      onlyCallable(ir, "left").callableId,
      onlyCallable(ir, "right").callableId,
    ].sort(),
  );
  expect(
    ir.argumentFlows.filter(
      ({ callSiteId }) => callSiteId === selected?.callSiteId,
    ),
  ).toHaveLength(2);
  expect(ir.frontiers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "dynamic-call",
        reason: expect.stringMatching(/ambiguous/iu),
      }),
      expect.objectContaining({
        kind: "dynamic-property",
        reason: expect.stringMatching(/computed member/iu),
      }),
      expect.objectContaining({
        kind: "dynamic-call",
        reason: "Unresolved call target external.",
      }),
    ]),
  );
});

describe("JavaScript semantic rest parameter flow", () => {
  it.each([
    {
      parameters: "first, ...rest",
      arguments: "1, 2, 3",
      expected: [
        [0, "first"],
        [1, "rest"],
        [2, "rest"],
      ],
    },
    {
      parameters: "...rest",
      arguments: "1, 2, 3",
      expected: [
        [0, "rest"],
        [1, "rest"],
        [2, "rest"],
      ],
    },
    {
      parameters: "first, second",
      arguments: "1, 2, 3",
      expected: [
        [0, "first"],
        [1, "second"],
      ],
    },
    {
      parameters: "first, ...rest",
      arguments: "1, ...values, 3",
      expected: [[0, "first"]],
    },
  ])(
    "links exact positions for ($parameters) called with ($arguments)",
    ({ parameters, arguments: arguments_, expected }) => {
      const ir = analyzeJavaScriptSemantics(
        `function collect(${parameters}) { return 1; } collect(${arguments_});`,
      );
      expect(
        ir.argumentFlows.map(({ argumentIndex, parameterBindingId }) => [
          argumentIndex,
          bindingById(ir, parameterBindingId)?.name,
        ]),
      ).toEqual(expected);
    },
  );
});
