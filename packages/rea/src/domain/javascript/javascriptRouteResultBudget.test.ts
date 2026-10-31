import { expect, it } from "vitest";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { javaScriptRouteSourceFactsSchema } from "./javascriptRouteFacts.js";
import { fitJavaScriptRouteSourceFacts } from "./javascriptRouteResultBudget.js";

const facts = () =>
  analyzeJavaScriptStaticSource(
    `createBrowserRouter([{path:'/reports',children:[{path:'settings'},{path:'history'}]}]);`,
  ).routes!;
it("borrows complete source facts when the actual enclosing result has room", () => {
  const input = facts();
  expect(
    fitJavaScriptRouteSourceFacts(
      input,
      Buffer.byteLength(JSON.stringify(input)),
    ),
  ).toBe(input);
});
it("preserves a bounded prefix with exact locations and explicit result capacity", () => {
  const input = facts(),
    original = JSON.stringify(input),
    selected = fitJavaScriptRouteSourceFacts(input, 700)!;
  expect(selected.candidates.length).toBeGreaterThan(0);
  expect(selected.candidates.length).toBeLessThan(input.candidates.length);
  expect(selected.candidates).toEqual(
    input.candidates.slice(0, selected.candidates.length),
  );
  expect(selected.capacity).toEqual({
    kind: "result-bytes",
    limit_bytes: 700,
    preceding_work_capacity: null,
  });
  expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThanOrEqual(700);
  expect(JSON.stringify(input)).toBe(original);
  expect(javaScriptRouteSourceFactsSchema.safeParse(selected).success).toBe(
    true,
  );
});
it("preserves earlier work capacity and uncertainty when transport admission also truncates", () => {
  const input = facts();
  input.capacity = {
    kind: "route-work-or-facts",
    limit_bytes: 4096,
    accounted_fact_bytes: 2000,
    accounted_work_bytes: 2000,
  };
  input.unresolved.push({
    mechanism: "nested-route-object",
    location: input.candidates[0]!.location,
    reason: 'Unknown parent: "é💫"',
  });
  const selected = fitJavaScriptRouteSourceFacts(input, 800)!;
  expect(selected.unresolved).toEqual(input.unresolved);
  expect(selected.capacity).toMatchObject({
    kind: "result-bytes",
    preceding_work_capacity: input.capacity,
  });
  expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThanOrEqual(800);
});
it("omits an unmeasured facet when even its capacity envelope cannot fit", () => {
  expect(fitJavaScriptRouteSourceFacts(facts(), 0)).toBeUndefined();
  expect(fitJavaScriptRouteSourceFacts(facts(), 1)).toBeUndefined();
});
