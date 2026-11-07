import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  analysisViewCaptureEvidence,
  analysisViewCaptureFixture,
  timedCaptureEvidence,
} from "../../../tests/fixtures/analysisView.js";
import { scenarioCaptureEvidence } from "../../../tests/fixtures/browserScenarioCapture.js";
import { readRecordedRequestLine } from "../../domain/analysisView/webNetworkRouteTemplates.js";
import {
  environmentServeFixture,
  environmentServeSource,
} from "../../../tests/fixtures/environmentServe.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { inspectAnalysisView } from "../analysisView/AnalysisViewService.js";
import type { WebNetworkCaptureRecord } from "../../domain/webNetworkCapture.js";
import {
  loadEnvironmentSource,
  recordedExchange,
  replayedBody,
} from "./environmentSource.js";

it.each([
  { text: "hello", encoding: undefined, expected: "hello" },
  { text: "aGVsbG8=", encoding: "base64", expected: "hello" },
  { text: "68656c6c6f", encoding: "hex", expected: null },
  { text: "aGVsbG8", encoding: "base64url", expected: null },
  { text: "hello", encoding: "", expected: null },
  { text: "hello", encoding: null, expected: null },
  { text: "", encoding: undefined, expected: "" },
  { text: "", encoding: "base64", expected: "" },
])(
  "replays only decoded bodies for the declared encoding $encoding",
  ({ text, encoding, expected }) => {
    const bytes =
      encoding === "base64" ? Buffer.from(text, "base64") : Buffer.alloc(0);
    const record: WebNetworkCaptureRecord = {
      ordinal: 0,
      location: { kind: "json-pointer", pointer: "/log/entries/0" },
      reported: {
        request: { method: "GET", url: "https://example.invalid/hello" },
        response: {
          status: 200,
          content: {
            mimeType: "text/plain",
            text,
            ...(encoding === undefined ? {} : { encoding }),
          },
        },
      },
      numeric_literals: [],
      binary_fields:
        encoding === "base64"
          ? [
              {
                pointer: "/response/content/text",
                representation: "har-base64-content",
                state: "retained",
                content_base64: text,
                bytes: bytes.length,
                sha256: createHash("sha256").update(bytes).digest("hex"),
              },
            ]
          : [],
      redactions: [],
      limitations: [],
    };
    const line = readRecordedRequestLine(record.reported, true, () => true);
    if (line?.kind !== "line")
      throw new Error("Expected a recorded request line");
    const exchange = recordedExchange(record, line);
    expect(exchange.bodyText).toBe(expected);
    expect(replayedBody(exchange)).toEqual(
      expected === null ? { kind: "none" } : { kind: "text", text: expected },
    );
    expect(record.reported).toMatchObject({
      response: {
        content: { text, ...(encoding === undefined ? {} : { encoding }) },
      },
    });
    if (encoding === undefined && text !== "") {
      record.redactions.push({
        pointer: "/response/content",
        reason: "explicit-sensitive-value",
        scope: "property-name",
      });
      expect(recordedExchange(record, line).bodyText).toBeNull();
    }
  },
);

const refusal = (manifest: unknown, evidence: unknown, operation?: string) => {
  const loaded = loadEnvironmentSource(manifest, evidence, operation);
  if (loaded.ok) throw new Error("Expected the pair to be refused");
  return projectAnalysisError(loaded.error);
};

/** Authenticated Evidence whose payload is rewritten; createEvidence recomputes the digest. */
const resealed = (
  evidence: Evidence,
  edit: (result: Record<string, unknown>) => void,
  operation: string = evidence.operation,
): Evidence => {
  const result = structuredClone(evidence.normalized_result) as Record<
    string,
    unknown
  >;
  edit(result);
  return createEvidence(undefined, evidence.provider, {
    operation,
    parameters: structuredClone(evidence.parameters),
    result: result as never,
    confidence: evidence.confidence,
  });
};

/** Re-cite a manifest's parent so pairing passes and the capture parse alone decides. */
const citing = (manifest: Evidence, capture: Evidence): Evidence =>
  resealed(manifest, (result) => {
    result.parent_evidence_id = capture.evidence_id;
  });

const record = (value: unknown, key: string): Record<string, unknown> =>
  (value as Record<string, Record<string, unknown>>)[key] ?? {};

describe("loadEnvironmentSource", () => {
  it("authenticates the pair and indexes every cited record as a replayable exchange", () => {
    const fixture = environmentServeFixture();
    const source = environmentServeSource(fixture);
    expect(source.manifest.kind).toBe("environment-manifest");
    expect(source.manifest.name).toBe("grafana-example");
    expect(source.evidenceId).toBe(fixture.capture.evidence_id);
    expect(source.manifestEvidenceId).toBe(fixture.manifest.evidence_id);
    const cited = new Set(
      source.manifest.tools.flatMap((tool) => tool.record_ordinals),
    );
    expect(new Set(source.exchanges.keys())).toEqual(cited);
    const users = source.manifest.tools.find(
      (tool) => tool.name === "get_users_by_id",
    );
    const user = source.exchanges.get(users?.record_ordinals[0] ?? -1);
    expect(user).toMatchObject({
      path: "/api/users/2",
      query: null,
      status: 200,
      contentType: "application/json",
    });
    expect(user?.bodyText).toContain('"login":"probe"');
    const search = source.manifest.tools.find(
      (tool) => tool.name === "get_search",
    );
    expect(source.exchanges.get(search?.record_ordinals[0] ?? -1)?.query).toBe(
      "?query=probe&type=dash-db",
    );
  });

  it("refuses capture Evidence in a format other than HAR before pairing it", () => {
    const fixture = environmentServeFixture();
    for (const format of ["saz", "mitmproxy"] as const) {
      const evidence = analysisViewCaptureEvidence({
        ...analysisViewCaptureFixture(),
        format,
      });
      expect(refusal(fixture.manifest, evidence)).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["evidence", "normalized_result", "format"],
              expected: "har",
            },
          ],
        },
      });
    }
  });

  it("refuses a manifest whose parent is not the supplied evidence with a typed invalid request", () => {
    const fixture = environmentServeFixture();
    const other = analysisViewCaptureEvidence(analysisViewCaptureFixture());
    const projected = refusal(fixture.manifest, other);
    expect(projected).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      details: {
        operation: "environment-serve",
        issues: [
          {
            path: ["evidence", "evidence_id"],
            reason: "invalid_value",
            expected: fixture.capture.evidence_id,
          },
        ],
      },
    });
    expect(projected.message).toContain("different capture");
  });

  it("refuses manifests of another view kind, non-capture evidence and non-Evidence JSON", async () => {
    const fixture = environmentServeFixture();
    const surface = await inspectAnalysisView({
      source: { kind: "inline", evidence: fixture.capture },
      view: { kind: "api-surface" },
    });
    if (!surface.ok) throw surface.error;
    expect(refusal(surface.value, fixture.capture)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["manifest", "normalized_result", "kind"],
            expected: "environment-manifest",
          },
        ],
      },
    });
    expect(refusal(fixture.manifest, fixture.manifest)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["evidence", "operation"],
            expected: "inspect_web_network_capture or capture_browser_scenario",
          },
        ],
      },
    });
    const malformed = refusal({ evidence_id: "ev_x" }, fixture.capture);
    expect(malformed.code).toBe("invalid_request");
    expect(malformed.details?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.arrayContaining(["manifest"]) }),
      ]),
    );
  });

  it("indexes nothing for a manifest that cites no records and leaves tampered captures to authentication", async () => {
    const fixture = environmentServeFixture();
    const capture = analysisViewCaptureEvidence({
      ...analysisViewCaptureFixture(),
      records: [],
      total_records: 0,
    });
    const manifest = await inspectAnalysisView({
      source: { kind: "inline", evidence: capture },
      view: { kind: "environment-manifest" },
    });
    if (!manifest.ok) throw manifest.error;
    const empty = loadEnvironmentSource(manifest.value, capture);
    if (!empty.ok) throw empty.error;
    expect(empty.value.exchanges.size).toBe(0);
    // Removing records changes the capture's semantic identity, so the pair is
    // refused as an unauthenticated evidence file before any ordinal is looked up.
    const tampered = structuredClone(fixture.capture);
    const result = tampered.normalized_result;
    if (typeof result !== "object" || result === null || Array.isArray(result))
      throw new Error("Capture result must be an object");
    result.records = [];
    expect(refusal(fixture.manifest, tampered)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: expect.arrayContaining(["evidence"]),
          }),
        ]),
      },
    });
  });
});

describe("loadEnvironmentSource payload attribution", () => {
  it("reports capture payload failures beneath normalized_result instead of the supported operation", () => {
    const fixture = environmentServeFixture();
    for (const operation of [
      "inspect_web_network_capture",
      "capture_browser_scenario",
    ]) {
      const capture = createEvidence(undefined, fixture.capture.provider, {
        operation,
        parameters: {},
        result: {},
        confidence: "observed",
      });
      for (const command of ["environment-serve", "environment-export"]) {
        const loaded = loadEnvironmentSource(
          citing(fixture.manifest, capture),
          capture,
          command,
        );
        if (loaded.ok || !(loaded.error instanceof AnalysisInputError))
          throw new Error("Expected an input refusal");
        expect(loaded.error.issues.length).toBeGreaterThan(0);
        for (const issue of loaded.error.issues)
          expect(issue.path.slice(0, 2)).toEqual([
            "evidence",
            "normalized_result",
          ]);
        expect(loaded.error.cause).toBeInstanceOf(Error);
        expect(projectAnalysisError(loaded.error)).toMatchObject({
          code: "invalid_request",
          category: "invalid_input",
          details: { operation: command },
        });
      }
    }
  });

  it("reports the full path of a nested capture payload field", () => {
    const fixture = environmentServeFixture();
    const har = resealed(fixture.capture, (result) => {
      record(result, "artifact").sha256 = 42;
    });
    expect(refusal(citing(fixture.manifest, har), har).details?.issues).toEqual(
      [
        expect.objectContaining({
          path: ["evidence", "normalized_result", "artifact", "sha256"],
          reason: "invalid_type",
        }),
      ],
    );
    const scenario = resealed(scenarioCaptureEvidence(), (result) => {
      record(result, "browser").product = 7;
    });
    expect(
      refusal(citing(fixture.manifest, scenario), scenario).details?.issues,
    ).toEqual([
      expect.objectContaining({
        path: ["evidence", "normalized_result", "browser", "product"],
        reason: "invalid_type",
      }),
    ]);
  });

  it("still blames the operation of Evidence no capture schema owns", () => {
    const fixture = environmentServeFixture();
    const other = resealed(fixture.capture, () => {}, "inspect_other_capture");
    expect(
      refusal(citing(fixture.manifest, other), other).details?.issues,
    ).toEqual([
      expect.objectContaining({
        path: ["evidence", "operation"],
        expected: "inspect_web_network_capture or capture_browser_scenario",
      }),
    ]);
  });

  it("separates the manifest operation, view kind and view payload failures", () => {
    const fixture = environmentServeFixture();
    expect(refusal(fixture.capture, fixture.capture).details?.issues).toEqual([
      expect.objectContaining({
        path: ["manifest", "operation"],
        expected: "inspect_analysis_view",
      }),
    ]);
    const malformed = resealed(fixture.manifest, (result) => {
      result.name = 7;
    });
    expect(refusal(malformed, fixture.capture).details?.issues).toEqual([
      expect.objectContaining({
        path: ["manifest", "normalized_result", "name"],
        reason: "invalid_type",
      }),
    ]);
    const unknownKind = resealed(fixture.manifest, (result) => {
      result.kind = "not-a-view";
    });
    expect(refusal(unknownKind, fixture.capture).details?.issues).toEqual([
      expect.objectContaining({
        path: ["manifest", "normalized_result", "kind"],
        expected: "environment-manifest",
      }),
    ]);
  });
});

describe("loadEnvironmentSource recorded request lines", () => {
  it("keeps the delimiter of an explicit empty query in the recorded exchange", async () => {
    const evidence = timedCaptureEvidence([
      ["GET", "/api/users/2?", { id: 2 }],
      ["GET", "/api/users/3", { id: 3 }],
    ]);
    const manifest = await inspectAnalysisView({
      source: { kind: "inline", evidence },
      view: { kind: "environment-manifest" },
    });
    if (!manifest.ok) throw manifest.error;
    const loaded = loadEnvironmentSource(manifest.value, evidence);
    if (!loaded.ok) throw loaded.error;
    expect(loaded.value.exchanges.get(0)?.query).toBe("?");
    expect(loaded.value.exchanges.get(1)?.query).toBeNull();
  });
});
