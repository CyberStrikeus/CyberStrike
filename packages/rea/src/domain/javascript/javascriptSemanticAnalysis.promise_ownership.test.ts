import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

it.each([
  {
    source: "const value = (Promise.resolve(1) as Promise<number>);",
    ownership: "assigned",
  },
  {
    source: "const run = () => (Promise.resolve(1) as Promise<number>);",
    ownership: "returned",
  },
  {
    source: "const value = consume(Promise.resolve(1)).then(work);",
    ownership: "unknown",
  },
  {
    source: "const value = consume(Promise.resolve(1));",
    ownership: "unknown",
  },
  {
    source: "async function run() { await consume(Promise.resolve(1)); }",
    ownership: "unknown",
  },
  {
    source: "function run() { return consume(Promise.resolve(1)); }",
    ownership: "unknown",
  },
  { source: "const value = [Promise.resolve(1)];", ownership: "unknown" },
  {
    source: "const value = Promise.all([{promise: Promise.resolve(1)}]);",
    ownership: "unknown",
  },
  { source: "const value = Promise.resolve(1);", ownership: "assigned" },
  {
    source: "async function run() { await Promise.resolve(1); }",
    ownership: "awaited",
  },
  {
    source: "function run() { return Promise.resolve(1); }",
    ownership: "returned",
  },
  {
    source: "const value = Promise.resolve(1).then(work);",
    ownership: "chained",
  },
  {
    source: "const value = Promise.all([Promise.resolve(1)]);",
    ownership: "aggregated",
  },
  { source: "Promise.resolve(1);", ownership: "detached" },
])("retains direct Promise ownership in $source", ({ source, ownership }) => {
  const ir = analyzeJavaScriptSemantics(source);
  const promise = ir.promiseOperations.find(
    ({ method }) => method === "resolve",
  );
  expect(promise).toMatchObject({ ownership });
  if (ownership === "unknown")
    expect(promise).toMatchObject({ ownerBindingId: null, returnSiteId: null });
});

it.each([
  ["Promise.resolve(1)", "resolve"],
  ["((Promise.resolve(1)))", "resolve"],
  ["(Promise.resolve(1) as Promise<number>)", "resolve"],
  ["(Promise.resolve(1) satisfies Promise<number>)", "resolve"],
  ["Promise.resolve(1)!", "resolve"],
  ["((Promise.resolve(1) as Promise<number>)!)", "resolve"],
  ["(new Promise(resolve => resolve(1)) as Promise<number>)", "new"],
  ["(Promise.all([Promise.resolve(1)]) as Promise<number[]>)", "all"],
  ["(Promise.resolve(1).then(value => value) as Promise<number>)", "then"],
])("links the exact arrow return site for %s", (expression, method) => {
  const ir = analyzeJavaScriptSemantics(`const run = () => ${expression};`);
  const callable = ir.callables.find(({ name }) => name === "run");
  expect(callable?.returnSites).toHaveLength(1);
  const site = callable?.returnSites[0];
  if (site === undefined) throw new Error("Expected the arrow return site");
  const promise = ir.promiseOperations.find(
    (operation) => operation.method === method,
  );
  expect(promise).toMatchObject({
    ownership: "returned",
    ownerCallableId: callable?.callableId,
    returnSiteId: site.returnSiteId,
  });
});

it.each([
  "const outer = () => () => (Promise.resolve(1) as Promise<number>);",
  "const outer = () => { const inner = () => Promise.resolve(1)!; return inner; };",
])("keeps a wrapped return owned by its nested arrow: %s", (source) => {
  const ir = analyzeJavaScriptSemantics(source);
  const promise = ir.promiseOperations.find(
    ({ method }) => method === "resolve",
  );
  const owner = ir.callables.find(
    ({ callableId }) => callableId === promise?.ownerCallableId,
  );
  const outer = ir.callables.find(({ name }) => name === "outer");
  const site = owner?.returnSites[0];
  if (site === undefined)
    throw new Error("Expected the nested arrow return site");
  expect(owner?.callableId).not.toBe(outer?.callableId);
  expect(promise).toMatchObject({
    ownership: "returned",
    returnSiteId: site.returnSiteId,
  });
  expect(
    outer?.returnSites.map(({ returnSiteId }) => returnSiteId),
  ).not.toContain(promise?.returnSiteId);
});

it.each([
  ["consume((Promise.resolve(1) as Promise<number>))", "unknown"],
  ["[(Promise.resolve(1) as Promise<number>)]", "unknown"],
  ["({ task: Promise.resolve(1)! })", "unknown"],
  ["(condition ? Promise.resolve(1)! : other)", "unknown"],
  ["((0, Promise.resolve(1)) as Promise<number>)", "unknown"],
  ["await (Promise.resolve(1) as Promise<number>)", "awaited"],
])("does not invent a return link through %s", (expression, ownership) => {
  const ir = analyzeJavaScriptSemantics(
    `const run = async () => ${expression};`,
  );
  expect(
    ir.promiseOperations.find(({ method }) => method === "resolve"),
  ).toMatchObject({
    ownership,
    returnSiteId: null,
  });
});

it("keeps an explicit return statement's full range and the producer's location", () => {
  const source =
    "const run = () => { return (Promise.resolve(1) as Promise<number>); };";
  const ir = analyzeJavaScriptSemantics(source);
  const site = ir.callables.find(({ name }) => name === "run")?.returnSites[0];
  if (site === undefined) throw new Error("Expected a return statement");
  const start = source.indexOf("Promise.resolve(1)");
  expect(ir.promiseOperations[0]).toMatchObject({
    ownership: "returned",
    returnSiteId: site.returnSiteId,
    location: {
      start: { line: 1, column: start },
      end: { line: 1, column: start + "Promise.resolve(1)".length },
    },
  });
  expect(site.location.start.column).toBe(source.indexOf("return"));
});

it("links returned promises to the exact return site in each callable", () => {
  const ir = analyzeJavaScriptSemantics(
    [
      "function first() { return Promise.resolve(1); }",
      "function second() { return Promise.resolve(2); }",
    ].join("\n"),
  );
  const callables = new Map(
    ir.callables.map((callable) => [callable.name, callable]),
  );
  const promises = ir.promiseOperations.filter(
    ({ method }) => method === "resolve",
  );

  expect(promises).toHaveLength(2);
  for (const name of ["first", "second"] as const) {
    const callable = callables.get(name);
    const promise = promises.find(
      ({ ownerCallableId }) => ownerCallableId === callable?.callableId,
    );
    expect(callable?.returnSites).toHaveLength(1);
    expect(promise).toMatchObject({
      ownership: "returned",
      ownerCallableId: callable?.callableId,
      returnSiteId: callable?.returnSites[0]?.returnSiteId,
    });
  }
});

it("does not assign a return site to a Promise owned by a binding", () => {
  const ir = analyzeJavaScriptSemantics(
    "function unrelated() { return Promise.resolve(2); }\nconst pending = Promise.resolve(1);",
  );
  const owned = ir.promiseOperations.find(
    ({ ownerCallableId }) => ownerCallableId !== null,
  );
  const assigned = ir.promiseOperations.find(
    ({ ownerCallableId }) => ownerCallableId === null,
  );

  expect(owned).toMatchObject({
    ownership: "returned",
    returnSiteId: ir.callables.find(({ name }) => name === "unrelated")
      ?.returnSites[0]?.returnSiteId,
  });
  expect(assigned).toMatchObject({
    ownership: "assigned",
    returnSiteId: null,
  });
});
