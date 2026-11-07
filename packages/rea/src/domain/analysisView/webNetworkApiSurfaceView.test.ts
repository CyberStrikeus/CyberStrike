import { expect, it } from "vitest";
import {
  analysisViewCaptureFixture,
  analysisViewCaptureEvidence,
} from "../../../tests/fixtures/analysisView.js";
import {
  analysisViewRequestSchema,
  projectAnalysisView,
} from "./analysisView.js";
import { projectAnalysisError } from "../analysisErrorProjection.js";

const project = (
  capture = analysisViewCaptureFixture(),
  offset = 0,
  limit = 50,
  parameters: unknown = { sensitive_value_count: 0 },
  includeQueryParameterNames?: boolean,
) => {
  const parent = analysisViewCaptureEvidence(capture);
  return projectAnalysisView(
    {
      evidenceId: parent.evidence_id,
      operation: parent.operation,
      normalizedResult: parent.normalized_result,
      limitations: [],
      parameters,
    },
    {
      kind: "api-surface",
      offset,
      limit,
      ...(includeQueryParameterNames === undefined
        ? {}
        : {
            include_query_parameter_names: includeQueryParameterNames,
          }),
    },
  );
};

it("selects query names without values, retains source ordinals and leaves default groups unchanged", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 3);
  capture.total_records = 3;
  const urls = [
    "https://api.test/products?category=books&page=1&category=repeat#fragment-only",
    "https://api.test/products?category=games&sort=price",
    "https://api.test/health",
  ];
  for (const [index, record] of capture.records.entries())
    record.reported = {
      request: { method: "GET", url: urls[index]! },
      response: { status: 200, content: { mimeType: "application/json" } },
    };
  const selected = project(capture, 0, 50, { sensitive_value_count: 0 }, true);
  const omitted = project(capture);
  const disabled = project(capture, 0, 50, { sensitive_value_count: 0 }, false);
  if (
    !selected.ok ||
    selected.value.kind !== "api-surface" ||
    !omitted.ok ||
    omitted.value.kind !== "api-surface" ||
    !disabled.ok ||
    disabled.value.kind !== "api-surface"
  )
    throw new Error("Expected surfaces");
  expect(disabled.value.groups).toEqual(omitted.value.groups);
  expect(selected.value.groups).toEqual([
    { ...omitted.value.groups[0], query_parameter_names: [] },
    {
      ...omitted.value.groups[1],
      query_parameter_names: [
        { name: "category", record_ordinals: [0, 1] },
        { name: "page", record_ordinals: [0] },
        { name: "sort", record_ordinals: [1] },
      ],
    },
  ]);
  for (const literal of ["books", "games", "repeat", "price", "fragment-only"])
    expect(JSON.stringify(selected.value)).not.toContain(literal);
  expect(selected.value.parent_evidence_id).toBe(
    omitted.value.parent_evidence_id,
  );
});

it("preserves decoded empty and Unicode query names, plus distinctions and caller ordinal order", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = [capture.records[3]!, capture.records[1]!];
  const urls = [
    "https://api.test/a/%2e%2e/products?b=1&a+b=2&a%2Bb=3&=4&%E9%9B%AA=5&b=6&&%FF=7&__proto__=8#ignored=9",
    "https://api.test/a/%2e%2e/products?b=10",
  ];
  capture.records.forEach((record, index) => {
    record.reported = { request: { method: "GET", url: urls[index]! } };
  });
  const result = project(capture, 0, 1, { sensitive_value_count: 0 }, true);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups[0]).toMatchObject({
    path_template: "/a/%2e%2e/products",
    record_ordinals: [3, 1],
    query_parameter_names: [
      { name: "", record_ordinals: [3] },
      { name: "__proto__", record_ordinals: [3] },
      { name: "a b", record_ordinals: [3] },
      { name: "a+b", record_ordinals: [3] },
      { name: "b", record_ordinals: [3, 1] },
      { name: "雪", record_ordinals: [3] },
      { name: "�", record_ordinals: [3] },
    ],
  });
  expect(result.value.records.total).toBe(15);
  expect(result.value.limitations.join(" ")).toContain("ordinal subset");
});

it("preserves sensitive-parent refusal when query names are selected", () => {
  expect(
    project(
      analysisViewCaptureFixture(),
      0,
      50,
      { sensitive_value_count: 1 },
      true,
    ),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisUnsupportedTargetError",
      reason: "sensitive_values_unretained",
    },
  });
});
it("groups only exact formats, preserves literal routes, excludes URLs and produces deterministic digests", () => {
  const result = project();
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(project()).toEqual(result);
  const surface = result.value;
  expect(surface.groups.map((group) => group.path_template)).toEqual([
    "/api/CreateDocument",
    "/api/ListDocuments",
    "/api/Report2",
    "/api/Report3",
    "/api/v1/users",
    "/api/v2/users",
    "/dates/2023-02-29",
    "/dates/{iso-date}",
    "/ids/abc123",
    "/ids/{hex}",
    "/ids/{uuid}",
    "/users/{numeric}",
  ]);
  expect(surface.groups.at(-1)).toMatchObject({
    record_ordinals: [0, 1],
    statuses: [200, 404],
    content_types: ["application/json", "text/plain"],
    flags: ["mixed-statuses", "mixed-content-types"],
    templated_segments: [
      {
        segment_index: 1,
        rule: "numeric",
        basis: "inferred",
        observed_values: ["8812", "9031"],
      },
    ],
  });
  expect(surface.excluded_records).toEqual([
    { ordinal: 13, reason: "url-redacted" },
    { ordinal: 14, reason: "url-unparseable" },
  ]);
  expect(JSON.stringify(surface)).not.toContain("not-in-view");
  expect(JSON.stringify(surface)).not.toContain("雪");
});
it("pages groups independently of record completeness and preserves null digests", () => {
  const capture = analysisViewCaptureFixture();
  capture.artifact.sha256 = null;
  capture.total_records = 30;
  const result = project(capture, 10, 2);
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({
    artifact: { sha256: null },
    coverage: { examined: 2, total: 12, exhausted: true, next_offset: null },
    records: { examined: 15, total: 30, excluded: 2 },
  });
  expect(result.value.limitations.join(" ")).toContain("ordinal subset");
  expect(project(capture, 50, 2)).toMatchObject({
    ok: true,
    value: {
      coverage: { status: "empty", exhausted: true, next_offset: null },
    },
  });
});
it("rejects native captures and malformed parents with typed errors", () => {
  const capture = analysisViewCaptureFixture();
  for (const format of ["mitmproxy", "saz"] as const) {
    capture.format = format;
    expect(project(capture)).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisUnsupportedTargetError" },
    });
  }
  expect(
    projectAnalysisView(
      {
        evidenceId: `ev_${"a".repeat(64)}`,
        operation: "inspect_web_network_capture",
        normalizedResult: {},
        limitations: [],
      },
      { kind: "api-surface", offset: 0, limit: 1 },
    ),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
});

it.each(["api-surface", "environment-manifest", "environment-state"])(
  "preserves nested capture-schema diagnostics for %s",
  (kind) => {
    const capture = analysisViewCaptureFixture();
    const result = projectAnalysisView(
      {
        evidenceId: `ev_${"a".repeat(64)}`,
        operation: "inspect_web_network_capture",
        limitations: [],
        parameters: { sensitive_value_count: 0 },
        normalizedResult: {
          ...capture,
          artifact: { ...capture.artifact, bytes: "invalid" },
        },
      },
      analysisViewRequestSchema.parse({ kind }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected parent admission to fail");
    expect(result.error.cause).toMatchObject({ name: "ZodError" });
    expect(projectAnalysisError(result.error)).toMatchObject({
      details: {
        issues: [
          expect.objectContaining({
            path: ["source", "normalized_result", "artifact", "bytes"],
            reason: "invalid_type",
          }),
        ],
      },
    });
  },
);

it("preserves partial response facts and explains unavailable requests", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 5);
  const values = [
    {
      request: {
        method: "GET",
        url: "https://user:password@api.example.test/1/2?private=value",
      },
      response: { status: 200, content: null },
    },
    { request: { method: null, url: "https://api.example.test/" } },
    null,
    { request: { method: "GET", url: "data:text/plain,hello" } },
    {
      request: { method: "GET", url: "https://api.example.test/1/2" },
      response: { status: null, content: { mimeType: "application/json" } },
    },
  ];
  capture.records.forEach((record, index) => {
    record.reported = values[index] ?? null;
  });
  const result = project(capture);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups).toMatchObject([
    {
      origin: "https://api.example.test",
      path_template: "/{numeric}/{numeric}",
      statuses: [200],
      content_types: ["application/json"],
      templated_segments: [
        { segment_index: 0, observed_values: ["1"] },
        { segment_index: 1, observed_values: ["2"] },
      ],
    },
  ]);
  expect(result.value.excluded_records).toEqual([
    { ordinal: 1, reason: "method-unavailable" },
    { ordinal: 2, reason: "request-unavailable" },
    { ordinal: 3, reason: "url-unparseable" },
  ]);
  expect(result.value.unknowns).not.toEqual([]);
  expect(JSON.stringify(result.value)).not.toContain("password");
  expect(JSON.stringify(result.value)).not.toContain("private");
});

it("keeps encoded segments literal and distinguishes origin and method", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 4);
  const urls = [
    "https://a.test/%31",
    "https://a.test/1",
    "https://b.test/1",
    "https://a.test/1",
  ];
  capture.records.forEach((record, index) => {
    record.reported = {
      request: { method: index === 3 ? "POST" : "GET", url: urls[index]! },
      response: {
        status: 200,
        content: { mimeType: "application/json; charset=utf-8" },
      },
    };
  });
  const result = project(capture, 0, 2);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.coverage).toMatchObject({
    total: 4,
    next_offset: 2,
    exhausted: false,
  });
  expect(result.value.groups[0]?.path_template).toBe("/%31");
});

it("refuses parents whose sensitive declarations it cannot check", () => {
  for (const parameters of [{ sensitive_value_count: 1 }, {}, null]) {
    const result = project(analysisViewCaptureFixture(), 0, 50, parameters);
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisUnsupportedTargetError" },
    });
    if (result.ok) continue;
    expect(result.error).toMatchObject({
      reason: "sensitive_values_unretained",
    });
    expect(result.error.message).not.toContain("path templates");
  }
});

it("rejects cyclic captures and accessor members without invoking them", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  let accessed = false;
  const accessor = {
    get records() {
      accessed = true;
      return [];
    },
  };
  const hiddenAccessor = Object.defineProperty({}, "records", {
    get() {
      accessed = true;
      return [];
    },
  });
  const inherited = Object.create({ records: [] }) as unknown;
  for (const normalizedResult of [cyclic, accessor, hiddenAccessor, inherited])
    expect(
      projectAnalysisView(
        {
          evidenceId: `ev_${"a".repeat(64)}`,
          operation: "inspect_web_network_capture",
          normalizedResult,
          limitations: [],
        },
        { kind: "api-surface", offset: 0, limit: 1 },
      ),
    ).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
  expect(accessed).toBe(false);
});

it("treats HAR missing-response sentinels as unknown", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 1);
  capture.records[0]!.reported = {
    request: { method: "GET", url: "https://api.example.test/a" },
    response: { status: 0, content: { mimeType: " ; charset=utf-8" } },
  };
  const result = project(capture);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups[0]).toMatchObject({
    statuses: [],
    content_types: [],
  });
  expect(result.value.unknowns).not.toEqual([]);
});

it("refuses a path whose templated representation exceeds projection capacity", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 1);
  capture.records[0]!.reported = {
    request: {
      method: "GET",
      url: `https://api.example.test${"/1".repeat(800_000)}`,
    },
  };
  expect(project(capture)).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError" },
  });
});

it("scans highly segmented literal paths and keeps recorded dot segments", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 3);
  const urls = [
    `https://api.example.test${"/a".repeat(90_000)}`,
    "https://api.example.test/a/%2e%2e/admin",
    "https://api.example.test/admin",
  ];
  capture.records.forEach((record, index) => {
    record.reported = { request: { method: "GET", url: urls[index] ?? null } };
  });
  const result = project(capture);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups.map((group) => group.path_template)).toEqual(
    expect.arrayContaining(["/a/%2e%2e/admin", "/admin"]),
  );
  expect(result.value.groups).toHaveLength(3);
});

it("excludes slashless URL spellings instead of reading their paths", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 4);
  const urls = [
    "https:user:pass@example.test/path",
    "https:123/456",
    "https:///user:pass@example.test/path",
    "https://\\user:pass@example.test/path",
  ];
  capture.records.forEach((record, index) => {
    record.reported = { request: { method: "GET", url: urls[index] ?? null } };
  });
  const result = project(capture);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups).toEqual([]);
  expect(result.value.excluded_records).toEqual([
    { ordinal: 0, reason: "url-unparseable" },
    { ordinal: 1, reason: "url-unparseable" },
    { ordinal: 2, reason: "url-unparseable" },
    { ordinal: 3, reason: "url-unparseable" },
  ]);
  expect(JSON.stringify(result.value)).not.toContain("pass");
});

it("excludes control-only authorities instead of publishing their userinfo", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 3);
  const urls = [
    "https://\t/user:pass@example.test/path",
    "https://\n/user:pass@example.test/path",
    "https://\r/user:pass@example.test/path",
  ];
  capture.records.forEach((record, index) => {
    record.reported = { request: { method: "GET", url: urls[index] ?? null } };
  });
  const result = project(capture);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups).toEqual([]);
  expect(result.value.excluded_records).toEqual([
    { ordinal: 0, reason: "url-unparseable" },
    { ordinal: 1, reason: "url-unparseable" },
    { ordinal: 2, reason: "url-unparseable" },
  ]);
  expect(JSON.stringify(result.value)).not.toContain("pass");
});

it("keeps distinct content types without repeating a retained essence", () => {
  const capture = analysisViewCaptureFixture();
  const record = capture.records[0]!;
  const types = ["text/plain", "application/json", "text/plain"];
  capture.records = types.map((mimeType, ordinal) => ({
    ...record,
    ordinal,
    reported: {
      request: { method: "GET", url: "https://api.example.test/a" },
      response: { status: 200, content: { mimeType } },
    },
  }));
  capture.total_records = capture.records.length;
  const result = project(capture);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups[0]?.content_types).toEqual([
    "application/json",
    "text/plain",
  ]);
});

it("charges repeated observed values once when merging", () => {
  const capture = analysisViewCaptureFixture();
  const record = capture.records[0]!;
  const path = "/1".repeat(800);
  capture.records = Array.from({ length: 1_000 }, (_, ordinal) => ({
    ...record,
    ordinal,
    reported: {
      request: { method: "GET", url: `https://api.example.test${path}` },
    },
  }));
  capture.total_records = capture.records.length;
  const result = project(capture);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups).toHaveLength(1);
  expect(result.value.groups[0]?.templated_segments).toHaveLength(800);
});

it("keeps a recorded literal placeholder apart from a templated segment", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 2);
  const urls = [
    "https://api.example.test/users/{numeric}",
    "https://api.example.test/users/123",
  ];
  capture.records.forEach((record, index) => {
    record.reported = { request: { method: "GET", url: urls[index] ?? null } };
  });
  const result = project(capture);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups).toHaveLength(2);
  expect(
    result.value.groups.map((group) => group.templated_segments.length).sort(),
  ).toEqual([0, 1]);
});

it("treats malformed media types as unknown and keeps source limitations", () => {
  const capture = analysisViewCaptureFixture();
  const caveat =
    "HAR text is producer-decoded Unicode. Original body bytes remain unknown.";
  const captureCaveat = "Producer omitted exchanges before capture startup.";
  capture.limitations = [captureCaveat, caveat];
  const malformed = [
    "text /plain",
    "unknown",
    "\u00a0text/plain\u00a0",
    "\u000btext/plain\u000b",
    "\u000ctext/plain\u000c",
    "text/K",
  ];
  capture.records = malformed.map((_, ordinal) => ({
    ...capture.records[0]!,
    ordinal,
  }));
  capture.total_records = capture.records.length;
  capture.records.forEach((record, index) => {
    record.limitations = [caveat];
    record.reported = {
      request: { method: "GET", url: "https://api.example.test/a" },
      response: {
        status: 200,
        content: { mimeType: malformed[index]! },
      },
    };
  });
  const result = project(capture);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups[0]).toMatchObject({
    content_types: [],
    flags: [],
  });
  expect(result.value.unknowns).not.toEqual([]);
  expect(result.value.limitations).toContain(caveat);
  expect(result.value.limitations).toContain(captureCaveat);
  expect(result.value.limitations.filter((item) => item === caveat)).toEqual([
    caveat,
  ]);
});

it("compares media types case-insensitively and counts templated groups across pages", () => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 3);
  const reported = [
    ["https://api.example.test/a", "Application/JSON"],
    ["https://api.example.test/a", " \tapplication/json\t ; charset=utf-8"],
    ["https://api.example.test/users/7", "application/json"],
  ];
  capture.records.forEach((record, index) => {
    const [url, mimeType] = reported[index] ?? [];
    record.reported = {
      request: { method: "GET", url: url ?? null },
      response: { status: 200, content: { mimeType: mimeType ?? null } },
    };
  });
  const result = project(capture, 0, 1);
  if (!result.ok || result.value.kind !== "api-surface")
    throw new Error("Expected surface");
  expect(result.value.groups[0]).toMatchObject({
    path_template: "/a",
    content_types: ["application/json"],
    flags: [],
  });
  expect(result.value.templated_groups).toBe(1);
});
