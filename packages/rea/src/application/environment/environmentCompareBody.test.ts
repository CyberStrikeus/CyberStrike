import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
} from "../../../tests/fixtures/analysisView.js";
import {
  environmentServeSource,
  environmentStateServeFixture,
} from "../../../tests/fixtures/environmentServe.js";
import { compareEnvironment } from "./environmentCompare.js";
import { requestBody } from "./environmentCompareProbe.js";
import { REPLAY_BODY_LIMIT_BYTES } from "./environmentSource.js";

const responseCapture = (
  text: string,
  base64?: string,
  mimeType = "application/octet-stream",
  status = 200,
): ReturnType<typeof analysisViewCaptureEvidence> => {
  const capture = environmentManifestCaptureFixture([
    {
      startedDateTime: "2026-10-17T18:00:00.000Z",
      request: { method: "GET", url: "http://app.example/api/blob" },
      response: {
        status,
        content: {
          mimeType,
          text,
          ...(base64 === undefined ? {} : { encoding: "base64" }),
        },
      },
    },
  ]);
  if (base64 !== undefined) {
    const bytes = Buffer.from(base64, "base64");
    capture.records[0]!.binary_fields = [
      {
        pointer: "/response/content/text",
        representation: "har-base64-content",
        state: "retained",
        content_base64: base64,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ];
  }
  return analysisViewCaptureEvidence(capture);
};

const compare = (
  recorded: ReturnType<typeof analysisViewCaptureEvidence>,
  probe: ReturnType<typeof analysisViewCaptureEvidence>,
) => {
  const fixture = environmentStateServeFixture(recorded);
  const report = compareEnvironment({
    source: environmentServeSource(fixture),
    captureValue: recorded,
    probes: [{ label: "probe", value: probe }],
    operation: "environment-compare",
  });
  if (!report.ok) throw report.error;
  return report.value;
};

describe("environment comparison response representation", () => {
  it("distinguishes binary byte ff from its base64 spelling as literal text", () => {
    const binary = responseCapture("/w==", "/w==");
    const literal = responseCapture("/w==");
    const result = compare(binary, literal);
    expect(result.probes[0]?.results[0]?.equal).toBe(false);
    expect(result.probes[0]?.results[0]?.categories).toEqual(["value"]);
  });

  it("compares equal retained binary bytes and valid UTF-8 base64 as text", () => {
    expect(
      compare(responseCapture("/w==", "/w=="), responseCapture("/w==", "/w=="))
        .probes[0]?.results[0]?.equal,
    ).toBe(true);
    expect(
      compare(responseCapture("aGVsbG8=", "aGVsbG8="), responseCapture("hello"))
        .probes[0]?.results[0]?.equal,
    ).toBe(true);
  });

  it.each([
    { representation: "binary", status: 200 },
    { representation: "binary", status: 503 },
    { representation: "text", status: 200 },
    { representation: "text", status: 503 },
  ] as const)(
    "compares a retained $representation body beyond the replay limit by status only ($status)",
    ({ representation, status }) => {
      const recorded = responseCapture("different recorded body");
      const text =
        representation === "binary"
          ? Buffer.alloc(REPLAY_BODY_LIMIT_BYTES + 8, 0xff).toString("base64")
          : "é".repeat(REPLAY_BODY_LIMIT_BYTES / 2 + 4);
      const probe = responseCapture(
        text,
        representation === "binary" ? text : undefined,
        representation === "binary" ? "application/octet-stream" : "text/plain",
        status,
      );
      const result = compare(recorded, probe);
      const equal = status === 200;
      expect(result.probes).toMatchObject([
        {
          steps: 1,
          equal: equal ? 1 : 0,
          normalised: { large_bodies: 1, unobserved_bodies: 0 },
          results: [
            {
              live_status: status,
              env_status: 200,
              equal,
              categories: equal ? [] : ["status"],
              differences: equal
                ? []
                : [
                    {
                      category: "status",
                      pointer: "",
                      live: "503",
                      env: "200",
                    },
                  ],
            },
          ],
        },
      ]);
      expect(result.summary).toMatchObject({
        steps: 1,
        equal: equal ? 1 : 0,
        categories: { status: equal ? 0 : 1, value: 0 },
        normalised: { large_bodies: 1, unobserved_bodies: 0 },
      });
    },
  );

  it("does not conflate a JSON string value with identical plain text", () => {
    const json = responseCapture('"hello"', undefined, "application/json");
    const text = responseCapture("hello");
    expect(compare(json, text).probes[0]?.results[0]?.equal).toBe(false);
  });
});

it.each([
  { mimeType: " TEXT/PLAIN ; charset=utf-8", expected: { value: 1 } },
  { mimeType: "application/problem+json", expected: { value: 1 } },
  { mimeType: "text/problem+json", expected: '{"value":1}' },
])(
  "reads probe request arguments independently of body-size and parameter admission: $mimeType",
  ({ mimeType, expected }) => {
    const capture = environmentManifestCaptureFixture([
      {
        request: {
          method: "POST",
          url: "http://app.example/api/value",
          bodySize: "not-a-size",
          postData: { mimeType, text: '{"value":1}', params: 7 },
        },
      },
    ]);
    expect(requestBody(capture.records[0]!)).toEqual(expected);
  },
);
