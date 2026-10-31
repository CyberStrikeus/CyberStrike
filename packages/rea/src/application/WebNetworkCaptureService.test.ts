import { expect, it } from "vitest";
import { WebNetworkCaptureService } from "./WebNetworkCaptureService.js";
import { historicalHar } from "../../tests/fixtures/historicalHar.js";
import { err, ok } from "../domain/result.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { parseEvidence } from "../domain/evidence.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import {
  webNetworkCaptureSchema,
  type WebNetworkCapture,
} from "../domain/webNetworkCapture.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";

it.each(["REDACTED", "[", "]", "/capture.har"])(
  "excludes sensitive path text even when a replacement marker would collide: %s",
  async (literal) => {
    const report = fixture();
    report.artifact.path = `/capture.har/${literal}`;
    const result = await new WebNetworkCaptureService({
      inspect: () => Promise.resolve(ok(report)),
    }).inspect({
      capture_path: report.artifact.path,
      format: "har",
      sensitive_values: [literal],
    });
    if (!result.ok) throw result.error;
    expect(result.value.subject?.local_path).not.toContain(literal);
    expect(result.value.parameters.capture_path).not.toContain(literal);
    expect(
      result.value.locations.every(
        (location) =>
          location.kind !== "artifact-path" || !location.path.includes(literal),
      ),
    ).toBe(true);
    expect(result.value.subject?.digest.sha256).toBe(report.artifact.sha256);
  },
);

it("records an explicit capture deadline and omits the default", async () => {
  const seen: Array<number | undefined> = [];
  const service = new WebNetworkCaptureService({
    inspect: (input) => {
      seen.push(input.capture_timeout_ms);
      return Promise.resolve(ok(fixture()));
    },
  });
  const explicit = await service.inspect({
    capture_path: "/capture.har",
    format: "har",
    capture_timeout_ms: 250,
  });
  if (!explicit.ok) throw explicit.error;
  expect(explicit.value.parameters.capture_timeout_ms).toBe(250);
  const omitted = await service.inspect({
    capture_path: "/capture.har",
    format: "har",
  });
  if (!omitted.ok) throw omitted.error;
  expect(omitted.value.parameters).not.toHaveProperty("capture_timeout_ms");
  expect(seen).toEqual([250, undefined]);
});

it("keeps observed artifact identity when the entire sensitive path is excluded", async () => {
  const result = await new WebNetworkCaptureService({
    inspect: () => Promise.resolve(ok(fixture())),
  }).inspect({
    capture_path: "/capture.har",
    format: "har",
    sensitive_values: ["/", "[", "REDACTED"],
  });
  if (!result.ok) throw result.error;
  expect(result.value.subject).toMatchObject({
    local_path: "",
    digest: { sha256: "a".repeat(64) },
  });
  expect(result.value.locations).toEqual([]);
});

const fixture = (): WebNetworkCapture => ({
  decoder: { id: "test-historical-port", name: "test port", version: "1" },
  container: {
    reported: null,
    numeric_literals: [],
    redactions: [],
    records_pointer: "/log/entries",
  },
  total_records: 1,
  records: [
    {
      ordinal: 0,
      location: { kind: "json-pointer", pointer: "/log/entries/0" },
      reported: historicalHar().log.entries[0] ?? null,
      numeric_literals: [],
      binary_fields: [],
      redactions: [],
      limitations: [],
    },
  ],
  artifact: { path: "/capture.har", sha256: "a".repeat(64), bytes: 10 },
  format: "har",
  runtime_attribution: "unknown",
  limitations: ["historical fixture"],
});

it.each(["a".repeat(64), "aaaa"])(
  "marks an explicitly sensitive artifact digest unknown without inventing another identity: %s",
  async (literal) => {
    const result = await new WebNetworkCaptureService({
      inspect: () => Promise.resolve(ok(fixture())),
    }).inspect({
      capture_path: "/capture.har",
      format: "har",
      sensitive_values: [literal],
    });
    if (!result.ok) throw result.error;
    expect(result.value.subject).toBeNull();
    expect(result.value.normalized_result).toMatchObject({
      artifact: { path: "/capture.har", sha256: null, bytes: 10 },
    });
    expect(result.value.parameters.capture_path).toBe("/capture.har");
    expect(result.value.locations).toEqual([
      { kind: "artifact-path", path: "/capture.har" },
    ]);
    expect(parseEvidence(result.value)).toEqual(result.value);
  },
);

it("projects the unknown-subject explanation before generating its Evidence ID", async () => {
  const result = await new WebNetworkCaptureService({
    inspect: () => Promise.resolve(ok(fixture())),
  }).inspect({
    capture_path: "/capture.har",
    format: "har",
    sensitive_values: ["a"],
  });
  if (!result.ok) throw result.error;
  expect(result.value.subject).toBeNull();
  expect(result.value.limitations.every((text) => !text.includes("a"))).toBe(
    true,
  );
  expect(parseEvidence(result.value)).toEqual(result.value);
});

it("rejects an adapter omitting its original observed digest before caller projection", async () => {
  const report = fixture();
  report.artifact.sha256 = null;
  const result = await new WebNetworkCaptureService({
    inspect: () => Promise.resolve(ok(report)),
  }).inspect({ capture_path: report.artifact.path, format: "har" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error._tag).toBe("AnalysisOutputError");
});

it("retains valid completed capture Evidence on late cancellation and preserves invalid output", async () => {
  const controller = new AbortController();
  const report = fixture();
  const late = await new WebNetworkCaptureService({
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(report));
    },
  }).inspect(
    { capture_path: report.artifact.path, format: "har" },
    { signal: controller.signal },
  );
  expect(late.ok).toBe(false);
  if (!late.ok) {
    expect(late.error).toBeInstanceOf(AnalysisCancelledError);
    expect(parseEvidence(late.error.partialObservation)).toMatchObject({
      operation: "inspect_web_network_capture",
      normalized_result: expect.objectContaining({ total_records: 1 }),
    });
  }

  const malformed = fixture();
  malformed.artifact.path = "/other.har";
  const outputController = new AbortController();
  const invalid = await new WebNetworkCaptureService({
    inspect: () => {
      outputController.abort();
      return Promise.resolve(ok(malformed));
    },
  }).inspect(
    { capture_path: "/capture.har", format: "har" },
    { signal: outputController.signal },
  );
  expect(invalid.ok).toBe(false);
  if (!invalid.ok) expect(invalid.error).toBeInstanceOf(AnalysisOutputError);
});

it("projects completed raw capture facts on failure through the caller's selection and sensitivity rules", async () => {
  const report = fixture();
  report.artifact.path = "/private-marker/capture.har";
  report.limitations = ["private-marker producer limitation"];
  const reason = { request: "cancel after decoder completion" };
  const error = new AnalysisCancelledError("inspect_web_network_capture", {
    cause: reason,
    partialObservation: report,
  });
  const result = await new WebNetworkCaptureService({
    inspect: () => Promise.resolve({ ok: false, error }),
  }).inspect({
    capture_path: report.artifact.path,
    format: "har",
    record_ordinals: [0],
    sensitive_values: ["private-marker"],
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Cancellation must remain the primary result");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
  const partial = parseEvidence(result.error.partialObservation);
  expect(partial).toMatchObject({
    operation: "inspect_web_network_capture",
    parameters: { record_ordinals: [0] },
    subject: { local_path: "" },
    normalized_result: {
      artifact: { path: "", sha256: "a".repeat(64) },
      records: [{ ordinal: 0 }],
    },
  });
  expect(JSON.stringify(partial)).not.toContain("private-marker");
});

it("does not expose a malformed capture-shaped partial observation", async () => {
  const malformed = fixture();
  malformed.artifact.path = "/private-marker";
  malformed.artifact.sha256 = "invalid";
  const error = new AnalysisCancelledError("inspect_web_network_capture", {
    partialObservation: malformed,
  });
  const result = await new WebNetworkCaptureService({
    inspect: () => Promise.resolve({ ok: false, error }),
  }).inspect({
    capture_path: "/capture.har",
    format: "har",
    sensitive_values: ["private-marker"],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.partialObservation).toBeUndefined();
});

it("keeps a redacted cleanup error linked to its live owner through service close", async () => {
  const report = fixture();
  const cleanupPath = "/tmp/private-marker-capture-root";
  const lease = new AnalysisCleanupLease(async () => {}, [cleanupPath]);
  const original = new ProviderCleanupError(
    "test-capture",
    [cleanupPath],
    { reason: "private-marker cleanup remains pending" },
    {
      operation: "inspect_web_network_capture",
      partialObservation: report,
    },
  );
  new AnalysisCleanupLeaseGroup(original, [lease]);
  const service = new WebNetworkCaptureService({
    inspect: () => Promise.resolve(err(original)),
    close: () => lease.release(),
  });
  const result = await service.inspect({
    capture_path: report.artifact.path,
    format: "har",
    sensitive_values: ["private-marker"],
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Retained cleanup must remain a failure");
  const returnedError = result.error;
  expect(returnedError.cleanupIncomplete).toBe(true);
  expect(returnedError.cleanupResources).toEqual([
    "/tmp/[REDACTED]-capture-root",
  ]);
  expect(JSON.stringify(projectAnalysisError(returnedError))).not.toContain(
    "private-marker",
  );
  expect(parseEvidence(returnedError.partialObservation)).toMatchObject({
    operation: "inspect_web_network_capture",
  });

  await service.close();
  expect(returnedError.cleanupIncomplete).toBe(false);
  expect(returnedError.cleanupResources).toEqual([]);
});

it.each([
  ["producer"],
  ["artifact"],
  ["coordinates"],
  ["producer", "REDACTED", "…"],
  ["producer", "[", "]"],
])(
  "excludes declared literals from all authored limitations: %j",
  async (...literals) => {
    const report = fixture();
    report.artifact.path = "/artifact/capture.har";
    report.limitations = [
      "Historical producer artifact coordinates are retained.",
    ];
    const first = report.records[0];
    if (first === undefined) throw new Error("fixture missing record");
    first.limitations = ["This is producer-decoded artifact evidence."];
    const result = await new WebNetworkCaptureService({
      inspect: () => Promise.resolve(ok(report)),
    }).inspect({
      capture_path: report.artifact.path,
      format: "har",
      sensitive_values: literals,
    });
    if (!result.ok) throw result.error;
    const projected = webNetworkCaptureSchema.parse(
      result.value.normalized_result,
    );
    const texts = [
      result.value.limitations,
      projected.limitations,
      ...projected.records.map((record) => record.limitations),
    ].flat();
    for (const literal of literals)
      expect(texts.every((text) => !text.includes(literal))).toBe(true);
    expect(result.value.subject?.digest.sha256).toBe(report.artifact.sha256);
    expect(projected.decoder).toEqual(report.decoder);
    expect(projected.records[0]?.reported).toEqual(first.reported);
  },
);

it("keeps explicitly sensitive values out of Evidence parameters and preserves historical authority", async () => {
  const service = new WebNetworkCaptureService({
    inspect: () => Promise.resolve(ok(fixture())),
  });
  const result = await service.inspect({
    capture_path: "/capture.har",
    format: "har",
    sensitive_values: ["explicit-private-value"],
  });
  if (!result.ok) throw result.error;
  expect(result.value.parameters).toMatchObject({
    sensitive_value_count: 1,
    record_ordinals: [0],
  });
  expect(JSON.stringify(result.value)).not.toContain("explicit-private-value");
  expect(result.value.authority).toBe("historical-reference");
  expect(result.value.provider).toEqual(fixture().decoder);
});

it.each(["har", "ha"])(
  "omits a format parameter containing a declared sensitive literal: %s",
  async (literal) => {
    const result = await new WebNetworkCaptureService({
      inspect: () => Promise.resolve(ok(fixture())),
    }).inspect({
      capture_path: "/capture.har",
      format: "har",
      sensitive_values: [literal],
    });
    if (!result.ok) throw result.error;
    expect(result.value.parameters).not.toHaveProperty("format");
    expect(JSON.stringify(result.value.parameters)).not.toContain(literal);
    expect(result.value.normalized_result).toMatchObject({ format: "har" });
  },
);

it.each([
  { record_ordinals: [0, 0] },
  { record_ordinals: [1] },
  { capture_path: "relative.har" },
])("rejects invalid caller selection %j", async (extra) => {
  const result = await new WebNetworkCaptureService({
    inspect: () => Promise.resolve(ok(fixture())),
  }).inspect({ capture_path: "/capture.har", format: "har", ...extra });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error._tag).toBe("AnalysisInputError");
});

it("reports an ordinal past the capture's records as an out-of-range selection", async () => {
  const report = fixture();
  const result = await new WebNetworkCaptureService({
    inspect: () => Promise.resolve(ok(report)),
  }).inspect({
    capture_path: "/capture.har",
    format: "har",
    record_ordinals: [0, 5],
  });
  if (result.ok) throw new Error("expected an out-of-range ordinal");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [
        {
          path: ["record_ordinals", 1],
          reason: "out_of_range",
          minimum: 0,
          maximum: report.total_records - 1,
        },
      ],
    },
  });
});

it("rejects a port changing the artifact identity or producer ordinal sequence", async () => {
  const report = fixture();
  report.artifact.path = "/different.har";
  const result = await new WebNetworkCaptureService({
    inspect: () => Promise.resolve(ok(report)),
  }).inspect({ capture_path: "/capture.har", format: "har" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error._tag).toBe("AnalysisOutputError");
});

it("applies an explicit sensitive path literal after verifying the selected artifact", async () => {
  const result = await new WebNetworkCaptureService({
    inspect: () => Promise.resolve(ok(fixture())),
  }).inspect({
    capture_path: "/capture.har",
    format: "har",
    sensitive_values: ["capture.har"],
  });
  if (!result.ok) throw result.error;
  expect(JSON.stringify(result.value)).not.toContain("capture.har");
  expect(result.value.parameters.capture_path).toBe("");
});

it.each(["log", "entries"])(
  "excludes a sensitive producer coordinate without inventing a replacement: %s",
  async (literal) => {
    const result = await new WebNetworkCaptureService({
      inspect: () => Promise.resolve(ok(fixture())),
    }).inspect({
      capture_path: "/capture.har",
      format: "har",
      sensitive_values: [literal],
    });
    if (!result.ok) throw result.error;
    expect(result.value.normalized_result).toMatchObject({
      container: { records_pointer: null },
      records: [
        {
          ordinal: 0,
          location: { kind: "unknown", reason: "explicit-sensitive-value" },
        },
      ],
    });
    expect(JSON.stringify(result.value)).not.toContain(literal);
  },
);

it("excludes an escaped sensitive sidecar coordinate while preserving its reported field", async () => {
  const report = fixture();
  report.container.reported = { "field/name": 42 };
  report.container.numeric_literals = [
    { pointer: "/field~1name", producer_type: "json-number", literal: "42" },
  ];
  report.container.redactions = [
    { pointer: "/field~1name", reason: "explicit-sensitive-value" },
  ];
  const result = await new WebNetworkCaptureService({
    inspect: () => Promise.resolve(ok(report)),
  }).inspect({
    capture_path: "/capture.har",
    format: "har",
    sensitive_values: ["~1"],
  });
  if (!result.ok) throw result.error;
  expect(result.value.normalized_result).toMatchObject({
    container: {
      reported: { "field/name": 42 },
      numeric_literals: [],
      redactions: [],
    },
  });
  expect(JSON.stringify(result.value)).not.toContain("~1");
});

it.each([
  { literal: "12345", input: { record_ordinals: [12345] } },
  { literal: "Each", input: { record_ordinals: [0, 0] } },
  { literal: "absolute", input: { capture_path: "relative.har" } },
  { literal: "secret", input: { mysecret: true } },
])(
  "excludes declared text from application-generated input errors: $literal",
  async ({ literal, input }) => {
    const result = await new WebNetworkCaptureService({
      inspect: () => Promise.resolve(ok(fixture())),
    }).inspect({
      capture_path: "/capture.har",
      format: "har",
      sensitive_values: [literal],
      ...input,
    });
    if (result.ok) throw new Error("Expected invalid selection");
    expect(result.error._tag).toBe("AnalysisInputError");
    expect(JSON.stringify(projectAnalysisError(result.error))).not.toContain(
      literal,
    );
  },
);

it.each(["12345", "67890", "234", "789"])(
  "excludes sensitive native byte-range coordinates: %s",
  async (literal) => {
    const report = fixture();
    report.format = "mitmproxy";
    report.artifact.path = "/capture.mitm";
    const record = report.records[0];
    if (record === undefined) throw new Error("record missing");
    record.location = { kind: "byte-range", offset: 12345, bytes: 67890 };
    const result = await new WebNetworkCaptureService({
      inspect: () => Promise.resolve(ok(report)),
    }).inspect({
      capture_path: report.artifact.path,
      format: "mitmproxy",
      sensitive_values: [literal],
    });
    if (!result.ok) throw result.error;
    expect(result.value.normalized_result).toMatchObject({
      records: [
        { location: { kind: "unknown", reason: "explicit-sensitive-value" } },
      ],
    });
    expect(result.value.raw_result).toBeNull();
    expect(parseEvidence(result.value)).toEqual(result.value);
  },
);

it("preserves a pre-abort reason without entering the capture adapter", async () => {
  const reason = new Error("stop historical capture inspection");
  const controller = new AbortController();
  controller.abort(reason);
  let providerCalls = 0;
  const service = new WebNetworkCaptureService({
    inspect: async () => {
      providerCalls += 1;
      return ok(fixture());
    },
  });

  const result = await service.inspect(
    {
      capture_path: "/capture.har",
      format: "har",
      sensitive_values: [],
    },
    { signal: controller.signal },
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
  }
  expect(providerCalls).toBe(0);
});

it("reports malformed retained facts while keeping their cleanup owner retryable", async () => {
  const report = fixture();
  report.artifact.sha256 = "invalid";
  const lease = new AnalysisCleanupLease(async () => {}, [
    "/tmp/private-marker-root",
  ]);
  const cleanup = new ProviderCleanupError(
    "test-historical-port",
    ["/tmp/private-marker-root"],
    { reason: "close denied" },
    { operation: "inspect_web_network_capture", partialObservation: report },
  );
  new AnalysisCleanupLeaseGroup(cleanup, [lease]);
  const service = new WebNetworkCaptureService({
    inspect: async () => err(cleanup),
    close: async () => {
      await lease.release();
    },
  });
  const result = await service.inspect({
    capture_path: "/capture.har",
    format: "har",
    sensitive_values: ["private-marker"],
  });
  if (result.ok) throw new Error("Expected malformed retained evidence");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupPrimary).toBeInstanceOf(AnalysisOutputError);
  expect(result.error.partialObservation).toBeUndefined();
  expect(JSON.stringify(projectAnalysisError(result.error))).not.toContain(
    "private-marker",
  );
  await service.close();
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(projectAnalysisError(result.error).code).toBe("unreadable_output");
});

it("rejects relative descriptor paths before starting a capture decoder", async () => {
  const service = new WebNetworkCaptureService({
    inspect: () => {
      throw new Error("Invalid input must fail before provider admission");
    },
  });
  const result = await service.inspect({
    capture_path: "/capture.har",
    format: "har",
    record_ordinals: [0],
    protobuf: {
      schema: {
        descriptor_set_path: "relative.pb",
        message_type: "capture.Message",
      },
    },
  });
  if (result.ok) throw new Error("Expected typed invalid input");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [{ path: ["protobuf", "schema", "descriptor_set_path"] }],
    },
  });
});
