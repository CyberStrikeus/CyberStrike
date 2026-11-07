import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createEvidence } from "../evidence.js";
import { freezeJsonSnapshot } from "../immutableJson.js";
import { webNetworkCaptureSchema } from "../webNetworkCapture.js";
import { projectAnalysisView } from "./analysisView.js";

const capture = () => {
  const body = Buffer.from("original body");
  const artifact = {
    path: "/recordings/input.saz",
    sha256: "b".repeat(64),
    bytes: 100,
  };
  const decoder = { id: "fixture", name: "Fixture", version: "1" };
  const report = webNetworkCaptureSchema.parse({
    artifact,
    decoder,
    format: "saz",
    runtime_attribution: "unknown",
    limitations: [],
    container: {
      reported: { members: [] },
      numeric_literals: [],
      redactions: [],
      records_pointer: null,
    },
    total_records: 9,
    records: [7, 2].map((ordinal) => ({
      ordinal,
      location: { kind: "archive-members", members: [`raw/${ordinal}_c.txt`] },
      reported: {
        session_id: String(ordinal),
        time: null,
        request: {
          method: "POST",
          url: "https://example.invalid/a",
          body: body.toString(),
        },
      },
      binary_fields: [
        {
          pointer: "/request/body",
          representation: "producer-bytes",
          state: "retained",
          content_base64: body.toString("base64"),
          bytes: body.length,
          sha256: createHash("sha256").update(body).digest("hex"),
        },
      ],
      numeric_literals: [
        {
          pointer: "/time",
          producer_type: "json-number",
          literal: "9007199254740993",
        },
      ],
      redactions: [],
      limitations: [],
    })),
  });
  const evidence = createEvidence({ ...artifact, format: "file" }, decoder, {
    operation: "inspect_web_network_capture",
    parameters: { record_ordinals: [7, 2] },
    result: report,
    confidence: "observed",
    authority: "historical-reference",
  });
  return {
    report,
    parent: {
      evidenceId: evidence.evidence_id,
      operation: evidence.operation,
      normalizedResult: report,
      subject: evidence.subject,
      limitations: evidence.limitations,
    },
  };
};

it("uses qlog event headlines without promoting HTTP-shaped extensions", () => {
  const { report } = capture();
  const first = report.records[0];
  if (first === undefined) throw new Error("Expected a capture record");
  const qlog = webNetworkCaptureSchema.parse({
    ...report,
    format: "qlog",
    qlog: {
      profile: "aioquic-1.5.0-json-0.3",
      scope: "all-recorded-events-before-selection",
      body_bytes: "not-reported",
      clock: {
        unit: "milliseconds",
        domain: "unix-epoch",
        basis: "selected-aioquic-profile-not-producer-authentication",
      },
      traces: [],
    },
    total_records: 1,
    records: [
      {
        ...first,
        ordinal: 0,
        reported: {
          name: "transport:packet_sent",
          time: 1.25,
          request: { url: { payload: "event-extension" } },
          type: { payload: "event-extension" },
        },
        numeric_literals: [],
        binary_fields: [],
      },
    ],
  });
  if (qlog.artifact.sha256 === null) throw new Error("Expected fixture digest");
  const evidence = createEvidence(
    { ...qlog.artifact, sha256: qlog.artifact.sha256, format: "file" },
    qlog.decoder,
    {
      operation: "inspect_web_network_capture",
      parameters: {},
      result: qlog,
      confidence: "observed",
      authority: "historical-reference",
    },
  );
  const preview = projectAnalysisView(
    {
      evidenceId: evidence.evidence_id,
      operation: evidence.operation,
      normalizedResult: qlog,
      subject: evidence.subject,
      limitations: evidence.limitations,
    },
    { kind: "capture", detail: "preview", offset: 0, limit: 1 },
  );
  expect(preview.ok && preview.value).toMatchObject({
    items: [{ reported: { name: "transport:packet_sent", time: 1.25 } }],
  });
  expect(JSON.stringify(preview)).not.toContain("event-extension");
});

it("checks each parent's subject even after its immutable capture has been validated", () => {
  const { parent } = capture();
  const source = {
    ...parent,
    normalizedResult: freezeJsonSnapshot(parent.normalizedResult),
  };
  expect(projectAnalysisView(source, { kind: "summary" }).ok).toBe(true);
  expect(
    projectAnalysisView({ ...source, subject: null }, { kind: "summary" }).ok,
  ).toBe(false);
  if (source.subject === null) throw new Error("Expected fixture subject");
  expect(
    projectAnalysisView(
      {
        ...source,
        subject: { ...source.subject, digest: { sha256: "e".repeat(64) } },
      },
      { kind: "summary" },
    ).ok,
  ).toBe(false);
  expect(projectAnalysisView(source, { kind: "summary" }).ok).toBe(true);
});

it("keeps selected-record page coverage distinct from capture coverage and unsafe number absence", () => {
  const { parent, report } = capture();
  const summary = projectAnalysisView(parent, { kind: "summary" });
  expect(summary.ok && summary.value).toMatchObject({
    summary: { total_records: 9, retained_records: 2 },
    coverage: { examined: 2, total: 2 },
  });
  const preview = projectAnalysisView(parent, {
    kind: "capture",
    detail: "preview",
    offset: 0,
    limit: 1,
  });
  expect(preview.ok && preview.value).toMatchObject({
    items: [
      {
        ordinal: 7,
        reported: { time: null },
        numeric_literals: [{ pointer: "/time", literal: "9007199254740993" }],
      },
    ],
    coverage: { total: 2, examined: 1, next_offset: 1, exhausted: false },
  });
  expect(JSON.stringify(preview)).not.toContain("original body");
  expect(JSON.stringify(preview)).not.toContain("content_base64");
  const complete = projectAnalysisView(parent, {
    kind: "capture",
    detail: "complete",
    offset: 1,
    limit: 1,
  });
  expect(complete.ok && complete.value).toMatchObject({
    items: [report.records[1]],
    coverage: { total: 2, examined: 1, next_offset: null, exhausted: true },
  });
  const empty = projectAnalysisView(parent, {
    kind: "capture",
    detail: "preview",
    offset: 50,
    limit: 1,
  });
  expect(empty.ok && empty.value).toMatchObject({
    items: [],
    coverage: {
      status: "empty",
      total: 2,
      examined: 0,
      next_offset: null,
      exhausted: true,
    },
  });
});

it("retains explicitly unknown digests and rejects a different subject digest", () => {
  const { parent, report } = capture();
  const unknown = projectAnalysisView(
    {
      ...parent,
      subject: null,
      normalizedResult: {
        ...report,
        artifact: { ...report.artifact, sha256: null },
      },
    },
    { kind: "summary" },
  );
  expect(unknown.ok && unknown.value).toMatchObject({
    artifact: { sha256: null },
  });
  expect(unknown.ok && unknown.value.unknowns.join(" ")).toContain(
    "excluded artifact digest",
  );
  if (parent.subject === null) throw new Error("Expected fixture subject");
  const mismatched = projectAnalysisView(
    {
      ...parent,
      subject: { ...parent.subject, digest: { sha256: "e".repeat(64) } },
    },
    { kind: "summary" },
  );
  expect(mismatched.ok).toBe(false);
});

it("rejects invalid ordinal coverage in a borrowed parent", () => {
  const { parent, report } = capture();
  const result = projectAnalysisView(
    {
      ...parent,
      normalizedResult: {
        ...report,
        records: [report.records[0], report.records[0]],
      },
    },
    { kind: "summary" },
  );
  expect(result.ok).toBe(false);
});

const nativePreview = (
  format: "mitmproxy" | "har",
  request: Readonly<Record<string, unknown>>,
  {
    response = {
      http_version: "HTTP/1.1",
      status_code: 404,
      reason: "Not Found",
      content: "omitted body",
    },
    producerType = "integer",
    sidecars,
    flowType = "http",
    redactions = [],
    binaryFields = [],
  }: {
    readonly response?: Readonly<Record<string, unknown>>;
    readonly producerType?: "integer" | "float";
    readonly flowType?: string | null;
    readonly binaryFields?: readonly Record<string, unknown>[];
    readonly redactions?: readonly {
      pointer: string;
      reason: string;
      scope?: string;
    }[];
    readonly sidecars?: readonly {
      pointer: string;
      producer_type: string;
      literal: string;
    }[];
  } = {},
) => {
  // The bridge records a numeric sidecar for every native number.
  const literals =
    sidecars ??
    Object.entries({ request, response }).flatMap(([side, fields]) =>
      Object.entries(fields)
        .filter(([, value]) => typeof value === "number")
        .map(([field, value]) => ({
          pointer: `/${side}/${field}`,
          producer_type: producerType,
          literal: String(value),
        })),
    );
  const artifact = {
    path: "/recordings/flows.mitm",
    sha256: "c".repeat(64),
    bytes: 100,
  };
  const decoder = { id: "fixture", name: "Fixture", version: "1" };
  const report = webNetworkCaptureSchema.parse({
    artifact,
    decoder,
    format,
    runtime_attribution: "unknown",
    limitations: [],
    container: {
      reported: null,
      numeric_literals: [],
      redactions: [],
      records_pointer: null,
    },
    total_records: 1,
    records: [
      {
        ordinal: 0,
        location: { kind: "byte-range", offset: 0, bytes: 10 },
        reported: {
          ...(flowType === null ? {} : { type: flowType }),
          request: { ...request, headers: [["Accept", "*/*"]] },
          response,
        },
        binary_fields: binaryFields,
        numeric_literals: literals,
        redactions,
        limitations: [],
      },
    ],
  });
  const evidence = createEvidence({ ...artifact, format: "file" }, decoder, {
    operation: "inspect_web_network_capture",
    parameters: {},
    result: report,
    confidence: "observed",
    authority: "historical-reference",
  });
  const preview = projectAnalysisView(
    {
      evidenceId: evidence.evidence_id,
      operation: evidence.operation,
      normalizedResult: report,
      subject: evidence.subject,
      limitations: evidence.limitations,
    },
    { kind: "capture", detail: "preview", offset: 0, limit: 1 },
  );
  if (!preview.ok || preview.value.kind !== "capture")
    throw new Error("Expected a capture preview page.");
  return preview.value;
};

it("previews the mitmproxy request target and status code as headline fields", () => {
  const preview = nativePreview("mitmproxy", {
    host: "example.test",
    port: 443,
    method: "GET",
    scheme: "https",
    authority: "",
    path: "/users/42",
    http_version: "HTTP/1.1",
  });
  expect(preview).toMatchObject({
    items: [
      {
        reported: {
          type: "http",
          request: {
            method: "GET",
            scheme: "https",
            host: "example.test",
            port: 443,
            authority: "",
            path: "/users/42",
            http_version: "HTTP/1.1",
          },
          response: {
            http_version: "HTTP/1.1",
            status_code: 404,
            reason: "Not Found",
          },
        },
        numeric_literals: [
          {
            pointer: "/request/port",
            producer_type: "integer",
            literal: "443",
          },
          {
            pointer: "/response/status_code",
            producer_type: "integer",
            literal: "404",
          },
        ],
      },
    ],
  });
  expect(JSON.stringify(preview)).not.toContain("Accept");
  expect(JSON.stringify(preview)).not.toContain("omitted body");
});

it("previews the asterisk-form OPTIONS target", () => {
  expect(
    nativePreview("mitmproxy", { method: "OPTIONS", path: "*" }).items[0]
      ?.reported,
  ).toMatchObject({ request: { method: "OPTIONS", path: "*" } });
});

it.each([
  [
    "an ambiguous absolute path",
    "mitmproxy",
    "https:user:password@example.test/a",
  ],
  ["a network-path reference", "mitmproxy", "//user:password@example.test/a"],
  [
    "a slash-backslash reference",
    "mitmproxy",
    "/\\user:password@example.test/a",
  ],
  [
    "a slash-backslash reference with an unparseable port",
    "mitmproxy",
    "/\\user:password@example.test:65536/a",
  ],
  ["a path with an at-sign", "mitmproxy", "/users/password@example"],
  ["a slash-tab reference", "mitmproxy", "/\t/user:password@example.test/a"],
  ["an oversized path", "mitmproxy", `/${"password".repeat(1024)}`],
  ["a nested path value", "mitmproxy", { content: "password ".repeat(64) }],
  ["a path in a non-mitmproxy record", "har", "/users/password"],
] as const)("keeps %s out of the preview", (_label, format, path) => {
  const preview = nativePreview(format, { method: "GET", path });
  const [item] = preview.items;
  expect(item?.reported).toMatchObject({ request: { method: "GET" } });
  expect(JSON.stringify(item?.reported)).not.toContain("password");
  if (format === "har")
    expect(JSON.stringify(item?.reported)).not.toContain("status_code");
});

it("bounds the serialized mitmproxy headline of each preview record", () => {
  const control = "\u0001".repeat(8 * 1024);
  const malformed = nativePreview("mitmproxy", {
    method: "GET",
    scheme: control,
    host: control,
    port: control,
    authority: control,
    path: `/${control}`,
  });
  expect(malformed.items[0]?.reported).toMatchObject({
    request: { method: "GET" },
  });
  expect(
    Buffer.byteLength(JSON.stringify(malformed.items[0]?.reported)),
  ).toBeLessThan(1024);
  const escaped = nativePreview("mitmproxy", {
    method: "GET",
    path: `/${'"'.repeat(2 * 1024 - 1)}`,
  });
  expect(escaped.items[0]?.reported).toMatchObject({
    request: { path: `/${'"'.repeat(2 * 1024 - 1)}` },
  });
  expect(
    Buffer.byteLength(JSON.stringify(escaped.items[0]?.reported)),
  ).toBeLessThan(5 * 1024);
});

it("keeps producer floats out of integer mitmproxy headline slots", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", port: 443, path: "/a" },
    {
      response: {
        http_version: "HTTP/1.1",
        status_code: 404,
        reason: "Not Found",
      },
      producerType: "float",
    },
  ).items[0]?.reported;
  expect(reported).toMatchObject({
    request: { method: "GET", path: "/a" },
    response: { reason: "Not Found" },
  });
  expect(reported).not.toMatchObject({ request: { port: 443 } });
  expect(reported).not.toMatchObject({ response: { status_code: 404 } });
});

it.each([
  [
    "an oversized literal",
    [
      {
        pointer: "/request/port",
        producer_type: "integer",
        literal: "4".repeat(100_000),
      },
    ],
  ],
  [
    "a literal that does not represent the value",
    [{ pointer: "/request/port", producer_type: "integer", literal: "444" }],
  ],
  [
    "duplicate sidecars",
    [
      { pointer: "/request/port", producer_type: "integer", literal: "443" },
      { pointer: "/request/port", producer_type: "integer", literal: "443" },
    ],
  ],
])(
  "keeps a port whose sidecar has %s out of the preview",
  (_label, sidecars) => {
    const [item] = nativePreview(
      "mitmproxy",
      { method: "GET", port: 443, path: "/a" },
      { response: { http_version: "HTTP/1.1", reason: "OK" }, sidecars },
    ).items;
    expect(item?.reported).toEqual({
      type: "http",
      request: { method: "GET", path: "/a" },
      response: { http_version: "HTTP/1.1", reason: "OK" },
    });
    expect(item?.numeric_literals).toEqual([]);
  },
);

it.each(["tcp", null])(
  "adds no mitmproxy headline fields to a %s flow",
  (flowType) => {
    const reported = nativePreview(
      "mitmproxy",
      { method: "GET", path: "/a", port: 443 },
      { flowType },
    ).items[0]?.reported;
    expect(reported).toEqual({
      ...(flowType === null ? {} : { type: flowType }),
      request: { method: "GET" },
      response: { http_version: "HTTP/1.1", reason: "Not Found" },
    });
  },
);

it("keeps a string target that carries a numeric sidecar out of the preview", () => {
  const [item] = nativePreview(
    "mitmproxy",
    { method: "GET", path: "/a" },
    {
      response: { http_version: "HTTP/1.1", reason: "OK" },
      sidecars: [
        {
          pointer: "/request/path",
          producer_type: "integer",
          literal: "9".repeat(100_000),
        },
      ],
    },
  ).items;
  expect(item?.reported).toEqual({
    type: "http",
    request: { method: "GET" },
    response: { http_version: "HTTP/1.1", reason: "OK" },
  });
  expect(item?.numeric_literals).toEqual([]);
});

it("keeps a mitmproxy headline the record marks as redacted out of the preview", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", host: "secret", path: "/a" },
    {
      response: { http_version: "HTTP/1.1", reason: "OK" },
      redactions: [
        { pointer: "/request/host", reason: "explicit-sensitive-value" },
      ],
    },
  ).items[0]?.reported;
  expect(reported).toEqual({
    type: "http",
    request: { method: "GET", path: "/a" },
    response: { http_version: "HTTP/1.1", reason: "OK" },
  });
});

it("rejects a non-number integer headline without throwing", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", path: "/a", port: { toString: null } },
    {
      response: { http_version: "HTTP/1.1", reason: "OK" },
      sidecars: [
        { pointer: "/request/port", producer_type: "integer", literal: "443" },
      ],
    },
  ).items[0]?.reported;
  expect(reported).toEqual({
    type: "http",
    request: { method: "GET", path: "/a" },
    response: { http_version: "HTTP/1.1", reason: "OK" },
  });
});

it.each([
  ["the request", "/request", { method: "GET" }],
  ["the record root", "", {}],
] as const)(
  "keeps mitmproxy headlines under a redacted %s out of the preview",
  (_label, pointer, request) => {
    const reported = nativePreview(
      "mitmproxy",
      { method: "GET", host: "secret", path: "/secret" },
      {
        response: { http_version: "HTTP/1.1", reason: "OK" },
        redactions: [{ pointer, reason: "explicit-sensitive-value" }],
      },
    ).items[0]?.reported;
    expect(JSON.stringify(reported)).not.toContain("secret");
    expect(reported).toMatchObject({ request });
  },
);

it("keeps a mitmproxy headline with a redacted byte descriptor out of the preview", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", host: "example.test", path: "/secret" },
    {
      response: { http_version: "HTTP/1.1", reason: "OK" },
      binaryFields: [
        {
          pointer: "/request/path",
          representation: "producer-bytes",
          state: "redacted",
          content_base64: null,
          bytes: null,
          sha256: null,
        },
      ],
    },
  ).items[0]?.reported;
  expect(reported).toMatchObject({
    request: { method: "GET", host: "example.test" },
  });
  expect(JSON.stringify(reported)).not.toContain("secret");
});

it("adds no mitmproxy headline fields when the flow type is redacted", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", path: "/a" },
    {
      response: { http_version: "HTTP/1.1", reason: "OK" },
      redactions: [{ pointer: "/type", reason: "explicit-sensitive-value" }],
    },
  ).items[0]?.reported;
  expect(reported).toMatchObject({ request: { method: "GET" } });
  expect(reported).not.toMatchObject({ request: { path: "/a" } });
});

it.each([
  ["the flow type", "/type"],
  ["the record root", ""],
])(
  "adds no mitmproxy headline fields when %s carries a numeric sidecar",
  (_label, pointer) => {
    const reported = nativePreview(
      "mitmproxy",
      { method: "GET", path: "/a" },
      {
        response: { http_version: "HTTP/1.1", reason: "OK" },
        sidecars: [{ pointer, producer_type: "integer", literal: "1" }],
      },
    ).items[0]?.reported;
    expect(reported).toMatchObject({ request: { method: "GET" } });
    expect(reported).not.toMatchObject({ request: { path: "/a" } });
  },
);

const retainedBytes = (pointer: string, text: string) => {
  const bytes = Buffer.from(text);
  return {
    pointer,
    representation: "producer-bytes",
    state: "retained",
    content_base64: bytes.toString("base64"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

it("adds no mitmproxy headline fields when the flow type was producer bytes", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", path: "/a" },
    {
      response: { http_version: "HTTP/1.1", reason: "OK" },
      binaryFields: [retainedBytes("/type", "http")],
    },
  ).items[0]?.reported;
  expect(reported).toMatchObject({ type: "http", request: { method: "GET" } });
  expect(reported).not.toMatchObject({ request: { path: "/a" } });
});

it("keeps mitmproxy headlines under a byte-valued side out of the preview", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", path: "/a", port: 443 },
    {
      response: { http_version: "HTTP/1.1", reason: "OK", status_code: 200 },
      binaryFields: [
        retainedBytes("/request", "GET /a"),
        retainedBytes("/response", "200"),
      ],
    },
  ).items[0]?.reported;
  expect(reported).toEqual({
    type: "http",
    request: { method: "GET" },
    response: { http_version: "HTTP/1.1", reason: "OK" },
  });
});

it("previews a byte-backed path but not a byte-backed port", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", path: "/a", port: 443 },
    {
      response: { http_version: "HTTP/1.1", reason: "OK" },
      binaryFields: [
        retainedBytes("/request/path", "/a"),
        retainedBytes("/request/port", "443"),
      ],
    },
  ).items[0]?.reported;
  expect(reported).toEqual({
    type: "http",
    request: { method: "GET", path: "/a" },
    response: { http_version: "HTTP/1.1", reason: "OK" },
  });
});

it("adds no mitmproxy headline fields when the flow type has a child facet", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", path: "/a" },
    {
      response: { http_version: "HTTP/1.1", reason: "OK" },
      sidecars: [
        { pointer: "/type/child", producer_type: "integer", literal: "1" },
      ],
    },
  ).items[0]?.reported;
  expect(reported).toMatchObject({ request: { method: "GET" } });
  expect(reported).not.toMatchObject({ request: { path: "/a" } });
});

it.each([
  [
    "a child sidecar",
    {
      sidecars: [
        { pointer: "/request/path/0", producer_type: "integer", literal: "1" },
      ],
    },
  ],
  [
    "a child redaction",
    {
      redactions: [
        { pointer: "/request/path/0", reason: "explicit-sensitive-value" },
      ],
    },
  ],
  [
    "HAR content bytes",
    {
      binaryFields: [
        {
          ...retainedBytes("/request/path", "/a"),
          representation: "har-base64-content",
        },
      ],
    },
  ],
  [
    "bytes that are not its text",
    { binaryFields: [retainedBytes("/request/path", "/b")] },
  ],
  [
    "a byte count that is not its text",
    { binaryFields: [{ ...retainedBytes("/request/path", "/a"), bytes: 3 }] },
  ],
  [
    "a digest that is not its text",
    {
      binaryFields: [
        { ...retainedBytes("/request/path", "/a"), sha256: "0".repeat(64) },
      ],
    },
  ],
] as const)(
  "keeps a mitmproxy path with %s out of the preview",
  (_label, facets) => {
    const reported = nativePreview(
      "mitmproxy",
      { method: "GET", host: "example.test", path: "/a" },
      { response: { http_version: "HTTP/1.1", reason: "OK" }, ...facets },
    ).items[0]?.reported;
    expect(reported).toEqual({
      type: "http",
      request: { method: "GET", host: "example.test" },
      response: { http_version: "HTTP/1.1", reason: "OK" },
    });
  },
);

it.each([
  ["path", { method: "GET", path: "/\ud800" }, { method: "GET" }],
  [
    "host",
    { method: "GET", host: "a\udc00.test", path: "/a" },
    { method: "GET", path: "/a" },
  ],
])(
  "keeps a mitmproxy %s with an unpaired surrogate out of the preview",
  (_field, request, expected) => {
    const reported = nativePreview("mitmproxy", request, {
      response: { http_version: "HTTP/1.1", reason: "OK" },
    }).items[0]?.reported;
    expect(reported).toEqual({
      type: "http",
      request: expected,
      response: { http_version: "HTTP/1.1", reason: "OK" },
    });
  },
);

it("keeps an unpaired-surrogate path out despite replacement-character bytes", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", path: "/\ud800" },
    {
      response: { http_version: "HTTP/1.1", reason: "OK" },
      binaryFields: [retainedBytes("/request/path", "/�")],
    },
  ).items[0]?.reported;
  expect(reported).toEqual({
    type: "http",
    request: { method: "GET" },
    response: { http_version: "HTTP/1.1", reason: "OK" },
  });
});

it("keeps mitmproxy headlines under a numeric sidecar out of the preview", () => {
  const [item] = nativePreview(
    "mitmproxy",
    { method: "GET", path: "/a", port: 443 },
    {
      response: { http_version: "HTTP/1.1", reason: "OK", status_code: 200 },
      sidecars: [
        { pointer: "/request", producer_type: "integer", literal: "7" },
        { pointer: "/request/port", producer_type: "integer", literal: "443" },
        {
          pointer: "/response/status_code",
          producer_type: "integer",
          literal: "200",
        },
      ],
    },
  ).items;
  expect(item?.reported).toEqual({
    type: "http",
    request: { method: "GET" },
    response: { http_version: "HTTP/1.1", reason: "OK", status_code: 200 },
  });
  expect(item?.numeric_literals).toEqual([
    {
      pointer: "/response/status_code",
      producer_type: "integer",
      literal: "200",
    },
  ]);
});

it("keeps sibling mitmproxy headlines next to an omitted property name", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", host: "example.test", path: "/a" },
    {
      response: { http_version: "HTTP/1.1", reason: "OK" },
      redactions: [
        {
          pointer: "/request",
          reason: "explicit-sensitive-value",
          scope: "property-name",
        },
      ],
    },
  ).items[0]?.reported;
  expect(reported).toMatchObject({
    request: { method: "GET", host: "example.test", path: "/a" },
  });
});

it("selects mitmproxy target fields from the request and the status from the response only", () => {
  const reported = nativePreview(
    "mitmproxy",
    { method: "GET", path: "/a", status_code: 200 },
    {
      response: { http_version: "HTTP/1.1", reason: "OK", path: "/extension" },
    },
  ).items[0]?.reported;
  expect(reported).toEqual({
    type: "http",
    request: { method: "GET", path: "/a" },
    response: { http_version: "HTTP/1.1", reason: "OK" },
  });
});

it.each(["scheme", "host", "port", "authority"])(
  "keeps a userinfo-bearing mitmproxy %s out of the preview",
  (field) => {
    const preview = nativePreview("mitmproxy", {
      method: "GET",
      path: "/users/42",
      [field]: "user:password@example.test",
    });
    const reported = preview.items[0]?.reported;
    expect(reported).toMatchObject({
      request: { method: "GET", path: "/users/42" },
    });
    expect(JSON.stringify(reported)).not.toContain("password");
  },
);
