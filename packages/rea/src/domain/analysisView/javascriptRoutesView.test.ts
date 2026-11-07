import { expect, it } from "vitest";
import { analyzeJavaScriptStaticSource } from "../javascript/javascriptStaticAnalysis.js";
import { completeSemanticSteps } from "../javascript/javascriptSemanticTraversal.js";
import { buildJavaScriptRouteInventorySteps } from "../javascript/javascriptRouteInventory.js";
import { freezeJsonSnapshot } from "../immutableJson.js";
import { projectAnalysisError } from "../analysisErrorProjection.js";
import {
  projectAnalysisView,
  analysisViewRequestSchema,
  type AnalysisViewParent,
} from "./analysisView.js";

const inventory = (
  text = `createBrowserRouter([{path:'/reports',children:[{path:':id'},{path:'settings'}]}]);router.push('/login');`,
) =>
  completeSemanticSteps(
    buildJavaScriptRouteInventorySteps([
      {
        key: "routes.js",
        path: "routes.js",
        url: null,
        sha256: "a".repeat(64),
        container_sha256: null,
        status: "complete",
        reason: null,
        facts: analyzeJavaScriptStaticSource(text).routes!,
      },
    ]),
  );
const parent = (): AnalysisViewParent => ({
  evidenceId: `ev_${"b".repeat(64)}`,
  operation: "analyze_javascript_application",
  limitations: [],
  normalizedResult: {
    input_path: "/gone/app",
    root_artifact_sha256: "c".repeat(64),
    route_inventory: inventory(),
  },
});
const query = (
  source: AnalysisViewParent,
  selection: Record<string, unknown>,
) => {
  const result = projectAnalysisView(
    source,
    analysisViewRequestSchema.parse({
      kind: "javascript-routes",
      ...selection,
    }),
  );
  if (!result.ok) throw result.error;
  if (result.value.kind !== "javascript-routes") throw new Error("Wrong view");
  return result.value;
};
it("returns selected facts with inline provenance and a deduplicated source reference", () => {
  const result = query(parent(), {
    collection: "routes",
    fields: ["path"],
    where: { path_prefix: "/reports" },
    limit: 2,
  });
  expect(result.items).toHaveLength(2);
  expect(result.sources).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    path: "/reports",
    provenance: {
      source_id: result.sources[0]!.id,
      mechanism: "nested-route-object",
    },
  });
  expect(result.items[0]).not.toHaveProperty("classification");
  expect(result.coverage).toMatchObject({
    total: 3,
    next_offset: 2,
    exhausted: false,
  });
  expect(result.source_coverage.application_routes).toBe("unknown");
  expect(result.parent_evidence_id).toBe(parent().evidenceId);
});
it("supports batch IDs, explicit empty selections and stable page order", () => {
  const source = parent(),
    all = query(source, { collection: "routes" });
  const ids = all.items.map((row) => row.id);
  expect(
    query(source, { collection: "routes", where: { ids: [...ids].reverse() } })
      .items,
  ).toEqual(all.items);
  expect(
    query(source, { collection: "routes", where: { ids: [] } }).items,
  ).toEqual([]);
  const next = query(source, { collection: "routes", offset: 1, limit: 1 });
  expect(next.items).toEqual(all.items.slice(1, 2));
  expect(
    query(source, { collection: "routes", fields: [] }).items[0],
  ).not.toHaveProperty("path");
});
it("joins route occurrences and sources without reopening source paths", () => {
  const source = parent(),
    routes = query(source, {
      collection: "routes",
      where: { paths: ["/reports/settings"] },
    });
  const occurrences = query(source, {
    collection: "occurrences",
    where: { route_ids: [routes.items[0]!.id] },
    fields: ["segments"],
  });
  expect(occurrences.items).toHaveLength(1);
  expect(occurrences.items[0]).toMatchObject({
    route_id: routes.items[0]!.id,
    segments: [{ value: "/reports" }, { value: "settings" }],
  });
  const sources = query(source, {
    collection: "sources",
    where: {
      ids: occurrences.sources.map((row) => row.id),
      statuses: ["complete"],
    },
    fields: ["path"],
  });
  expect(sources.items[0]).toMatchObject({
    path: "routes.js",
    status: "complete",
    sha256: "a".repeat(64),
  });
});
it("keeps source gaps separate from pattern counts and preserves partial coverage", () => {
  const source = {
    ...parent(),
    normalizedResult: {
      input_path: "/gone/app",
      root_artifact_sha256: "c".repeat(64),
      route_inventory: inventory(
        `const routes={reports:{settings:{_$:'settings'}}};`,
      ),
    },
  };
  const gaps = query(source, {
    collection: "unknowns",
    where: { kinds: ["interpretation"] },
  });
  expect(gaps.items.length).toBeGreaterThan(0);
  expect(gaps.source_coverage.candidate_enumeration).toBe("partial");
  const summary = query(source, { collection: "summary" });
  expect(summary.summary!.statistics.route_patterns).toBe(1);
  expect(summary.summary!.gaps).toBeGreaterThan(0);
  expect(summary.items).toEqual([]);
});
it("accepts captured-page Evidence with an explicitly absent local artifact", () => {
  const result = query(
    {
      ...parent(),
      operation: "analyze_web_bundle",
      subject: null,
      normalizedResult: {
        capture: { target_url: "https://example.test/" },
        route_inventory: inventory(),
      },
    },
    { collection: "routes" },
  );
  expect(result.artifact).toBeNull();
  expect(result.capture_url).toBe("https://example.test/");
});
it("checks subject identity again after warming an immutable parent", () => {
  const source = parent();
  const sealed = {
    ...source,
    sealedResult: true,
    normalizedResult: freezeJsonSnapshot({
      input_path: "/gone/app",
      root_artifact_sha256: "c".repeat(64),
      route_inventory: inventory(),
    }),
  };
  query(sealed, { collection: "summary" });
  const result = projectAnalysisView(
    {
      ...sealed,
      subject: {
        name: "app",
        local_path: "/different",
        digest: { sha256: "d".repeat(64) },
        format: "javascript-bundle",
        architecture: null,
      },
    },
    analysisViewRequestSchema.parse({
      kind: "javascript-routes",
      collection: "summary",
    }),
  );
  expect(result.ok).toBe(false);
});
it("distinguishes historical unmeasured routes from an empty measured inventory", () => {
  const result = projectAnalysisView(
    {
      ...parent(),
      normalizedResult: {
        input_path: "/gone/app",
        root_artifact_sha256: "c".repeat(64),
      },
    },
    analysisViewRequestSchema.parse({
      kind: "javascript-routes",
      collection: "routes",
    }),
  );
  expect(result.ok).toBe(false);
  expect(
    query(
      {
        ...parent(),
        normalizedResult: {
          input_path: "/gone/app",
          root_artifact_sha256: "c".repeat(64),
          route_inventory: inventory(""),
        },
      },
      { collection: "routes" },
    ).coverage.exhausted,
  ).toBe(true);
});
it("bounds serialized pages before cloning large selected fields and preserves a continuation", () => {
  const text = ["a", "b", "c", "d", "e", "f"]
    .map((key) => `router.push('/${key}${key.repeat(190000)}');`)
    .join("\n");
  const source = {
    ...parent(),
    normalizedResult: {
      input_path: "/gone/app",
      root_artifact_sha256: "c".repeat(64),
      route_inventory: inventory(text),
    },
  };
  const first = query(source, {
    collection: "routes",
    fields: ["path"],
    limit: 100,
  });
  // Each route is ~190KiB; the 1MiB view contract still applies when all facts fit.
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(
    1024 * 1024,
  );
  expect(first.items.length).toBeGreaterThan(0);
  expect(first.byte_limited).toBe(true);
  expect(first.coverage.next_offset).toBe(first.items.length);
});

it("returns a typed retained-parent resource error when even a summary identity exceeds the page budget", () => {
  const source = {
    ...parent(),
    operation: "analyze_web_bundle",
    normalizedResult: {
      capture: {
        target_url: "https://example.test/" + "a".repeat(1024 * 1024),
      },
      route_inventory: inventory(),
    },
  };
  const result = projectAnalysisView(
    source,
    analysisViewRequestSchema.parse({
      kind: "javascript-routes",
      collection: "summary",
    }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected a resource error");
  expect(result.error.message).toContain("cannot fit");
});

it("explains how to recover an oversized route row without changing the parent", () => {
  const source = {
    ...parent(),
    normalizedResult: {
      input_path: "/gone/app",
      root_artifact_sha256: "c".repeat(64),
      route_inventory: inventory(`router.push('/${"a".repeat(1_100_000)}');`),
    },
  };
  const selection = { collection: "routes", limit: 1 };
  const result = projectAnalysisView(
    source,
    analysisViewRequestSchema.parse({
      kind: "javascript-routes",
      ...selection,
    }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected an oversized-row refusal");
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    code: "resource_constraint",
    retryable: false,
    details: {
      reported_limits: {
        parent_evidence_id: source.evidenceId,
        limit_bytes: 1024 * 1024,
      },
    },
  });
  expect(projected.remediation.action).toContain("select fewer fields");
  expect(projected.remediation.action).toContain("no runtime override");
  expect(projected.remediation.action).toContain("caller-supplied bundle");
  const narrow = query(source, {
    ...selection,
    fields: ["classification", "confidence"],
  });
  expect(narrow.items).toHaveLength(1);
  expect(narrow.items[0]).not.toHaveProperty("path");
});

it.each(["summary", "routes"] as const)(
  "includes the sealed digest in the %s byte ceiling",
  (collection) => {
    const source = {
      ...parent(),
      operation: "analyze_web_bundle",
      normalizedResult: {
        capture: { target_url: "https://example.test/" },
        route_inventory: inventory("route('/only');"),
      },
    };
    const selection =
      collection === "summary"
        ? { collection }
        : { collection, fields: ["path"], limit: 1 };
    const bytes = Buffer.byteLength(JSON.stringify(query(source, selection)));
    source.normalizedResult.capture.target_url += "a".repeat(
      1024 * 1024 - bytes + 1,
    );
    const result = projectAnalysisView(
      source,
      analysisViewRequestSchema.parse({
        kind: "javascript-routes",
        ...selection,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a sealed-page resource error");
    expect(result.error.message).toContain("cannot fit");
  },
);
it("admits a summary that fits exactly after sealing", () => {
  const source = {
    ...parent(),
    operation: "analyze_web_bundle",
    normalizedResult: {
      capture: { target_url: "https://example.test/" },
      route_inventory: inventory("route('/only');"),
    },
  };
  const selection = { collection: "summary" };
  const bytes = Buffer.byteLength(JSON.stringify(query(source, selection)));
  source.normalizedResult.capture.target_url += "a".repeat(1024 * 1024 - bytes);
  expect(Buffer.byteLength(JSON.stringify(query(source, selection)))).toBe(
    1024 * 1024,
  );
});
