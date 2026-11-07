import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const routeEndpoints = (source: string) =>
  analyzeJavaScriptStaticSource(source)
    .endpoints.filter(({ kind }) => kind === "route")
    .map(({ value, mechanism, interpretation }) => ({
      value,
      mechanism,
      interpretation,
    }));

it("reads exact route-property templates and leaves interpolated values unknown", () => {
  expect(
    routeEndpoints(`
      const routes = [
        { path: \`settings\`, component: Settings },
        { route: \`users/\${userId}\`, component: User },
        { path: "/login", element: login },
      ];
    `),
  ).toEqual([
    {
      value: "settings",
      mechanism: "property:path",
      interpretation: undefined,
    },
    {
      value: "/login",
      mechanism: "property:path",
      interpretation: undefined,
    },
  ]);
});

it("keeps route properties on router records exact", () => {
  expect(
    routeEndpoints(`
      const routes = [
        { path: "admin", children: [] },
        { _$: "route", path: "typed" },
      ];
    `).map(({ value, interpretation }) => [value, interpretation]),
  ).toEqual([
    ["admin", undefined],
    ["typed", undefined],
  ]);
});

it("reports path properties outside router records only as candidates", () => {
  expect(
    routeEndpoints(`
      const patch = [{ type: "set", path: "updatedAt", value: 1 }];
      const worktree = { path: "", head: "" };
      const routes = [{ path: "/bare" }];
    `),
  ).toEqual([
    {
      value: "updatedAt",
      mechanism: "property:path",
      interpretation: "candidate",
    },
    { value: "", mechanism: "property:path", interpretation: "candidate" },
    {
      value: "/bare",
      mechanism: "property:path",
      interpretation: "candidate",
    },
  ]);
});

it("preserves every repeated path property's candidate and source order", () => {
  const count = 256;
  const endpoints = routeEndpoints(
    `const record = { ${Array.from({ length: count }, (_, i) => `path: "p${String(i)}"`).join(", ")} };`,
  );
  expect(endpoints).toEqual(
    Array.from({ length: count }, (_, i) => ({
      value: `p${String(i)}`,
      mechanism: "property:path",
      interpretation: "candidate",
    })),
  );
});
