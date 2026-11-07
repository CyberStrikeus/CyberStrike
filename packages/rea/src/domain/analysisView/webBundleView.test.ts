import { expect, it } from "vitest";
import type { WebBundleAnalysis } from "../webBundleAnalysis.js";
import { AnalysisInputError } from "../analysisErrorCore.js";
import { projectAnalysisError } from "../analysisErrorProjection.js";
import {
  analysisViewRequestSchema,
  projectAnalysisView,
  type AnalysisViewParent,
} from "./analysisView.js";

const sampleAnalysis = (): WebBundleAnalysis => ({
  capture: {
    target_url: "https://example.test/app",
    target_origin: "https://example.test",
    scripts_observed: 3,
    scripts_analyzed: 2,
    source_artifacts: [],
  },
  observations: {
    chunks: {
      nodes: [
        {
          script_key: "app.js",
          url: "https://example.test/app.js",
          artifact_sha256: "a".repeat(64),
          bytes: 1200,
        },
        {
          script_key: "vendor.js",
          url: "https://example.test/vendor.js",
          artifact_sha256: "b".repeat(64),
          bytes: 4500,
        },
      ],
      edges: [],
    },
    routes: [],
    endpoints: [
      {
        value: "/api/users",
        mechanism: "call:fetch",
        location: { script_key: "app.js", line: 10, column: 2 },
      },
      {
        value: "/api/users",
        mechanism: "call:fetch",
        location: { script_key: "vendor.js", line: 42, column: 8 },
      },
      {
        value: "/api/orders",
        mechanism: "call:sendBeacon",
        location: { script_key: "app.js", line: 85, column: 4 },
      },
    ],
    webmcp_declarations: [],
    source_maps: {
      status: "not_requested",
      requested: 0,
      processed: 0,
      items: [],
    },
  },
  inferences: [
    {
      kind: "endpoint_candidate",
      value: "/api/dynamic-user",
      confidence: "low",
      basis: [
        {
          script_key: "app.js",
          artifact_sha256: "a".repeat(64),
          line: 25,
          column: 4,
          detector: "call:client.get:unverified-network-receiver",
        },
      ],
    },
    {
      kind: "vendor_fingerprint",
      value: "React",
      confidence: "high",
      basis: [
        {
          script_key: "vendor.js",
          artifact_sha256: "b".repeat(64),
          line: 1,
          column: 0,
          detector: "vendor:react",
        },
      ],
    },
  ],
  unknowns: [
    {
      dimension: "network",
      reason: "Unverified client receiver",
      affected_script_keys: ["app.js"],
    },
  ],
  completeness: {
    status: "partial",
    parsed_scripts: 2,
    parse_failures: 1,
    visited_ast_nodes: 150,
  },
  limitations: ["Script evaluation was omitted"],
});

const makeParent = (
  overrides?: Partial<WebBundleAnalysis>,
): AnalysisViewParent => ({
  evidenceId: `ev_${"c".repeat(64)}`,
  operation: "analyze_web_bundle",
  limitations: ["Parent run was bounded"],
  normalizedResult: {
    ...sampleAnalysis(),
    ...overrides,
  },
});

const query = (
  source: AnalysisViewParent,
  selection: Record<string, unknown>,
) => {
  const result = projectAnalysisView(
    source,
    analysisViewRequestSchema.parse(selection),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

it.each([undefined, null, "https://example.test"])(
  "preserves historical omitted and explicit target origins: %s",
  (origin) => {
    const report = sampleAnalysis();
    if (origin === undefined) delete report.capture.target_origin;
    else report.capture.target_origin = origin;
    const parent = makeParent(report);
    for (const selection of [
      { kind: "summary" },
      { kind: "web-bundle", collection: "summary" },
      { kind: "web-bundle", collection: "endpoints", fields: ["value"] },
    ]) {
      const view = query(parent, selection);
      if (origin === undefined)
        expect(view).not.toHaveProperty("target_origin");
      else expect(view).toHaveProperty("target_origin", origin);
      if (
        view.kind === "summary" ||
        (view.kind === "web-bundle" && view.summary !== null)
      ) {
        if (origin === undefined)
          expect(view.summary).not.toHaveProperty("target_origin");
        else expect(view.summary).toHaveProperty("target_origin", origin);
      }
    }
  },
);

it("counts the distinct full parent/report limitation union before bounding", () => {
  const base = makeParent({
    limitations: [
      "Parent run was bounded",
      "Script evaluation was omitted",
      "x".repeat(100_000),
    ],
  });
  const parent = {
    ...base,
    limitations: [...base.limitations, "Parent-only condition"],
  };
  for (const selection of [
    { kind: "summary" },
    { kind: "web-bundle", collection: "summary" },
  ]) {
    const view = query(parent, selection);
    expect(view).toHaveProperty("summary.limitation_count", 4);
    expect(view.limitations).not.toContain("x".repeat(100_000));
    expect(view.limitations).toContainEqual(
      expect.stringContaining("additional limitations omitted"),
    );
  }
});

it("retains distinct structured unknown scopes on filtered pages", () => {
  const unknowns = [
    {
      dimension: "parse",
      reason: "Source unavailable",
      affected_script_keys: ["app.js"],
    },
    {
      dimension: "parse",
      reason: "Source unavailable",
      affected_script_keys: ["vendor.js"],
    },
  ];
  const parent = makeParent({ unknowns });
  for (const collection of ["endpoints", "inferences"]) {
    const view = query(parent, {
      kind: "web-bundle",
      collection,
      script_keys: ["app.js"],
      fields: ["value"],
    });
    expect(view).toHaveProperty("source_unknowns", unknowns);
    expect(view).toHaveProperty("completeness.status", "partial");
  }
});

it("pages endpoints and concatenated pages match original records exactly, preserving duplicates", () => {
  const parent = makeParent();
  const page1 = query(parent, {
    kind: "web-bundle",
    collection: "endpoints",
    offset: 0,
    limit: 2,
  });
  const page2 = query(parent, {
    kind: "web-bundle",
    collection: "endpoints",
    offset: 2,
    limit: 2,
  });

  expect(page1.kind).toBe("web-bundle");
  expect(page2.kind).toBe("web-bundle");
  if (page1.kind !== "web-bundle" || page2.kind !== "web-bundle") return;

  expect(page1.items).toHaveLength(2);
  expect(page2.items).toHaveLength(1);
  expect(page1.coverage).toMatchObject({
    status: "page",
    examined: 2,
    total: 3,
    next_offset: 2,
    exhausted: false,
  });
  expect(page2.coverage).toMatchObject({
    status: "page",
    examined: 1,
    total: 3,
    next_offset: null,
    exhausted: true,
  });

  const concatenated = [...page1.items, ...page2.items];
  const original = sampleAnalysis().observations.endpoints;
  expect(concatenated).toEqual(
    original.map((row, source_index) => ({ source_index, ...row })),
  );
  // Preserves duplicate "/api/users" at different locations
  expect(concatenated[0]!.value).toBe("/api/users");
  expect(concatenated[1]!.value).toBe("/api/users");
  const first = concatenated[0]!;
  const second = concatenated[1]!;
  if (!("location" in first) || !("location" in second)) {
    throw new Error("Expected endpoint rows with location");
  }
  expect(first.location).not.toEqual(second.location);
});

it("filters endpoints by values, script_keys, mechanisms, and field projections", () => {
  const parent = makeParent();
  const filtered = query(parent, {
    kind: "web-bundle",
    collection: "endpoints",
    values: ["/api/orders"],
    fields: ["value"],
  });

  if (filtered.kind !== "web-bundle")
    throw new Error("Expected web-bundle view");
  expect(filtered.items).toEqual([{ source_index: 2, value: "/api/orders" }]);
  expect(filtered.coverage.total).toBe(1);

  const byScript = query(parent, {
    kind: "web-bundle",
    collection: "endpoints",
    script_keys: ["vendor.js"],
  });
  if (byScript.kind !== "web-bundle")
    throw new Error("Expected web-bundle view");
  expect(byScript.items).toHaveLength(1);
  const item = byScript.items[0]!;
  if (!("location" in item)) {
    throw new Error("Expected endpoint row with location");
  }
  expect(item.location).toMatchObject({ script_key: "vendor.js" });
});

it("pages inference records and filters by kind (endpoint_candidate)", () => {
  const parent = makeParent();
  const candidatesOnly = query(parent, {
    kind: "web-bundle",
    collection: "inferences",
    kinds: ["endpoint_candidate"],
  });

  if (candidatesOnly.kind !== "web-bundle")
    throw new Error("Expected web-bundle view");
  expect(candidatesOnly.items).toHaveLength(1);
  expect(candidatesOnly.items[0]).toMatchObject({
    kind: "endpoint_candidate",
    value: "/api/dynamic-user",
    confidence: "low",
  });
  expect(candidatesOnly.coverage).toMatchObject({
    total: 1,
    exhausted: true,
  });
});

it("preserves partial producer coverage even when view pagination is exhausted", () => {
  const parent = makeParent({
    completeness: {
      status: "partial",
      parsed_scripts: 1,
      parse_failures: 1,
      visited_ast_nodes: 50,
    },
  });

  const page = query(parent, {
    kind: "web-bundle",
    collection: "endpoints",
    offset: 0,
    limit: 10,
  });

  if (page.kind !== "web-bundle") throw new Error("Expected web-bundle view");
  expect(page.coverage.exhausted).toBe(true);
  // Must remain "partial" and never be upgraded to "complete"
  expect(page.completeness.status).toBe("partial");
  expect(page.completeness.parse_failures).toBe(1);
});

it("serves web bundle summary via kind: summary and kind: web-bundle collection: summary", () => {
  const parent = makeParent();

  const summaryView = query(parent, { kind: "summary" });
  expect(summaryView.kind).toBe("summary");
  if (summaryView.kind === "summary") {
    expect(summaryView.summary).toMatchObject({
      target_url: "https://example.test/app",
      counts: {
        endpoints: 3,
        inferences: 2,
        endpoint_candidates: 1,
      },
      completeness: { status: "partial" },
    });
  }

  const collectionSummary = query(parent, {
    kind: "web-bundle",
    collection: "summary",
  });
  expect(collectionSummary.kind).toBe("web-bundle");
  if (collectionSummary.kind === "web-bundle") {
    expect(collectionSummary.summary).toMatchObject({
      target_url: "https://example.test/app",
      counts: {
        endpoints: 3,
        inferences: 2,
        endpoint_candidates: 1,
      },
    });
  }
});

it("returns an empty page when offset is beyond total items", () => {
  const parent = makeParent();
  const empty = query(parent, {
    kind: "web-bundle",
    collection: "endpoints",
    offset: 100,
    limit: 10,
  });

  if (empty.kind !== "web-bundle") throw new Error("Expected web-bundle view");
  expect(empty.items).toEqual([]);
  expect(empty.coverage).toMatchObject({
    status: "empty",
    examined: 0,
    total: 3,
    next_offset: null,
    exhausted: true,
  });
});

it("returns typed AnalysisResourceConstraintError when a single record exceeds 1 MiB", () => {
  const hugeEndpoint = {
    value: "/api/" + "x".repeat(1024 * 1024),
    mechanism: "call:fetch",
    location: { script_key: "app.js", line: 1, column: 0 },
  };
  const parent = makeParent({
    observations: {
      ...sampleAnalysis().observations,
      endpoints: [hugeEndpoint],
    },
  });

  const result = projectAnalysisView(
    parent,
    analysisViewRequestSchema.parse({
      kind: "web-bundle",
      collection: "endpoints",
    }),
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected resource error");
  expect(result.error._tag).toBe("AnalysisResourceConstraintError");
  expect(result.error.message).toContain("byte budget");
  expect(projectAnalysisError(result.error).remediation.action).toContain(
    "select fewer fields",
  );
});

it.each([undefined, ["call:fetch"]])(
  "counts all matching rows after a byte-limited page: %s",
  (mechanisms) => {
    const largeRecord = (index: number) => ({
      value: `/api/${index}/` + "x".repeat(300_000),
      mechanism: "call:fetch",
      location: { script_key: "app.js", line: index, column: 0 },
    });
    const parent = makeParent({
      observations: {
        ...sampleAnalysis().observations,
        endpoints: [
          largeRecord(1),
          largeRecord(2),
          largeRecord(3),
          largeRecord(4),
        ],
      },
    });

    const page = query(parent, {
      kind: "web-bundle",
      collection: "endpoints",
      limit: 10,
      mechanisms,
    });

    if (page.kind !== "web-bundle") throw new Error("Expected web-bundle view");
    expect(page.byte_limited).toBe(true);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThan(4);
    expect(page.coverage.next_offset).toBe(page.items.length);
    expect(page.coverage.exhausted).toBe(false);
    expect(page.coverage.total).toBe(4);
  },
);

it.each(["indices", "values", "script_keys", "mechanisms"])(
  "treats an explicit empty %s selector as an empty selection",
  (selector) => {
    const page = query(makeParent(), {
      kind: "web-bundle",
      collection: "endpoints",
      [selector]: [],
    });
    expect(page).toHaveProperty("items", []);
    expect(page.coverage).toMatchObject({
      total: 0,
      exhausted: true,
      next_offset: null,
    });
  },
);

it("rejects non-web-bundle parent operation with invalid_value", () => {
  const invalidParent: AnalysisViewParent = {
    evidenceId: `ev_${"d".repeat(64)}`,
    operation: "analyze_javascript_application",
    limitations: [],
    normalizedResult: sampleAnalysis(),
  };

  const result = projectAnalysisView(
    invalidParent,
    analysisViewRequestSchema.parse({
      kind: "web-bundle",
      collection: "endpoints",
    }),
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failure");
  if (!(result.error instanceof AnalysisInputError)) throw result.error;
  expect(result.error.issues[0]!.message).toContain(
    "Web-bundle views require analyze_web_bundle",
  );
  expect(result.error.issues[0]!.reason).toBe("invalid_value");
});

it("continues filtered pages by matching ordinal while preserving original indices", () => {
  const report = sampleAnalysis();
  const row = report.observations.endpoints[0]!;
  const endpoints = [
    { ...row, mechanism: "call:sendBeacon" },
    { ...row, location: { ...row.location, script_key: "vendor.js" } },
    row,
    { ...row, value: "/api/orders" },
    { ...row, location: { ...row.location, line: 99 } },
    { ...row, location: { ...row.location, line: 100 } },
    { ...row, location: { ...row.location, script_key: "vendor.js" } },
  ];
  const parent = makeParent({
    observations: { ...report.observations, endpoints },
  });
  const selection = {
    kind: "web-bundle",
    collection: "endpoints",
    script_keys: ["app.js"],
    values: ["/api/users"],
    mechanisms: ["call:fetch"],
    limit: 2,
  };
  const first = query(parent, selection);
  if (first.kind !== "web-bundle") throw new Error("Expected web-bundle page");
  expect(first.coverage).toMatchObject({
    total: 3,
    examined: 2,
    next_offset: 2,
    exhausted: false,
  });
  const second = query(parent, {
    ...selection,
    offset: first.coverage.next_offset,
  });
  if (second.kind !== "web-bundle") throw new Error("Expected web-bundle page");
  expect(second.coverage).toMatchObject({
    total: 3,
    examined: 1,
    next_offset: null,
    exhausted: true,
  });
  expect([...first.items, ...second.items]).toEqual(
    [2, 4, 5].map((source_index) => ({
      source_index,
      ...endpoints[source_index],
    })),
  );
});

it("preserves parent artifact identity across summary and page views", () => {
  const artifact = { path: "/app.js", sha256: "e".repeat(64) };
  const parent: AnalysisViewParent = {
    ...makeParent(),
    artifact,
  };

  const summary = query(parent, { kind: "summary" });
  expect(summary.artifact).toEqual(artifact);

  const page = query(parent, {
    kind: "web-bundle",
    collection: "endpoints",
  });
  expect(page.artifact).toEqual(artifact);
});

it("filters endpoints by indices and inferences by script_keys and fields", () => {
  const parent = makeParent();

  const byIndex = query(parent, {
    kind: "web-bundle",
    collection: "endpoints",
    indices: [1],
  });
  if (byIndex.kind !== "web-bundle")
    throw new Error("Expected web-bundle view");
  expect(byIndex.items).toHaveLength(1);
  expect(byIndex.items[0]).toMatchObject({
    value: "/api/users",
    location: { script_key: "vendor.js" },
  });

  const byScriptKey = query(parent, {
    kind: "web-bundle",
    collection: "inferences",
    script_keys: ["vendor.js"],
    fields: ["kind", "value"],
  });
  if (byScriptKey.kind !== "web-bundle")
    throw new Error("Expected web-bundle view");
  expect(byScriptKey.items).toEqual([
    { source_index: 1, kind: "vendor_fingerprint", value: "React" },
  ]);
});

it("correctly counts zero findings in summary for an empty web bundle", () => {
  const emptyParent = makeParent({
    observations: {
      chunks: { nodes: [], edges: [] },
      routes: [],
      endpoints: [],
      webmcp_declarations: [],
      source_maps: {
        status: "not_requested",
        requested: 0,
        processed: 0,
        items: [],
      },
    },
    inferences: [],
  });

  const summary = query(emptyParent, { kind: "summary" });
  if (summary.kind !== "summary") throw new Error("Expected summary");
  expect(summary.summary).toMatchObject({
    counts: {
      endpoints: 0,
      inferences: 0,
      endpoint_candidates: 0,
      chunks: 0,
      routes: 0,
    },
  });
});

it("rejects malformed parent analysis report", () => {
  const malformedParent: AnalysisViewParent = {
    evidenceId: `ev_${"e".repeat(64)}`,
    operation: "analyze_web_bundle",
    limitations: [],
    normalizedResult: { malformed: true },
  };

  const result = projectAnalysisView(
    malformedParent,
    analysisViewRequestSchema.parse({
      kind: "web-bundle",
      collection: "endpoints",
    }),
  );

  expect(result.ok).toBe(false);
});
