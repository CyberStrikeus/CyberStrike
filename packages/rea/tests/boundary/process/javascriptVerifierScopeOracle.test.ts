import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { z } from "zod";

import {
  matchesStructuredScopeExpectation,
  structuredScopeExpectationsSchema,
} from "../../../scripts/lib/javascript-file-scope-oracle.mjs";

const scopeSchema = z.object({
  properties: z.record(z.string(), z.unknown()),
  evidence: z.object({
    authority: z.string(),
    state: z.string(),
    confidence: z.string(),
  }),
});
const cohortSchema = z.object({
  timeout: z.object({
    result: z.object({
      structured_scopes: z.array(
        z.object({ path: z.string(), scopes: z.array(scopeSchema) }),
      ),
    }),
  }),
});
const report = z
  .object({
    cohorts: z.object({ baseline: cohortSchema, final: cohortSchema }),
  })
  .parse(
    JSON.parse(
      await readFile(
        new URL(
          "../../../docs/verification/javascript-interruption-applicability-2026-10-15.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
const retainedMapScopes = (cohort: z.infer<typeof cohortSchema>) => {
  const row = cohort.timeout.result.structured_scopes.find(
    ({ path }) => path === "ElectronAppWrapper.js.map",
  );
  if (row === undefined || row.scopes.length !== 1)
    throw new Error("Missing real Joplin scope snapshot");
  return row.scopes;
};
const correct = retainedMapScopes(report.cohorts.final);
const expected = {
  operation: "parse-local-source-map",
  analysis_status: "not-started",
} as const;

it("accepts the retained real source-map phase and rejects the actual baseline misattribution", () => {
  expect(matchesStructuredScopeExpectation(correct, expected)).toBe(true);
  expect(
    matchesStructuredScopeExpectation(
      retainedMapScopes(report.cohorts.baseline),
      expected,
    ),
  ).toBe(false);
});

it.each([
  {
    name: "another structured phase",
    operation: "parse-package-json",
    analysis_status: "not-started",
  },
  {
    name: "an entered phase",
    operation: "parse-local-source-map",
    analysis_status: "interrupted",
  },
  {
    name: "missing phase-entry status",
    operation: "parse-local-source-map",
    analysis_status: undefined,
  },
])(
  "rejects $name even with artifact-byte authority",
  ({ operation, analysis_status }) => {
    const altered = correct.map((scope) => ({
      ...scope,
      properties: { ...scope.properties, operation, analysis_status },
    }));
    expect(matchesStructuredScopeExpectation(altered, expected)).toBe(false);
  },
);

it("rejects absent gaps, missing expectations and mixed conflicting observations", () => {
  expect(matchesStructuredScopeExpectation([], expected)).toBe(false);
  expect(matchesStructuredScopeExpectation(correct, undefined)).toBe(false);
  const conflict = correct.map((scope) => ({
    ...scope,
    properties: { ...scope.properties, analysis_status: "interrupted" },
  }));
  expect(
    matchesStructuredScopeExpectation([...correct, ...conflict], expected),
  ).toBe(false);
});

it("parses explicit per-path expectations without borrowing the production phase map", () => {
  expect(
    structuredScopeExpectationsSchema.parse({
      "ElectronAppWrapper.js.map": expected,
    }),
  ).toEqual({ "ElectronAppWrapper.js.map": expected });
  expect(
    structuredScopeExpectationsSchema.safeParse({
      map: { ...expected, analysis_status: "unknown" },
    }).success,
  ).toBe(false);
});

it("retains prototype-named source paths in independent expectations", () => {
  const input = Object.fromEntries([
    ["__proto__", expected],
    ["constructor", expected],
  ]);
  const parsed = structuredScopeExpectationsSchema.parse(input);
  expect(Object.keys(parsed)).toEqual(["__proto__", "constructor"]);
  expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
  expect(parsed["__proto__"]).toEqual(expected);
});

it("validates prototype-named expectations and retains the nonempty path policy", () => {
  for (const entry of [
    null,
    { ...expected, operation: "wrong" },
    { ...expected, analysis_status: "wrong" },
  ])
    expect(
      structuredScopeExpectationsSchema.safeParse(
        Object.fromEntries([["__proto__", entry]]),
      ).success,
    ).toBe(false);
  expect(
    structuredScopeExpectationsSchema.safeParse({ "": expected }).success,
  ).toBe(false);
});
