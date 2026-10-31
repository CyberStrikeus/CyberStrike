import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  SCENARIO_EXCHANGES,
  scenarioCaptureFixture,
} from "../../../tests/fixtures/browserScenarioCapture.js";
import {
  admitScenarioCaptureParent,
  scenarioCaptureRecords,
  scenarioContentMediaType,
} from "./scenarioCaptureRecords.js";
import { EnvironmentManifestAccumulator } from "./EnvironmentManifestAccumulator.js";

const manifestLimitations = (
  projected: ReturnType<typeof scenarioCaptureRecords>,
) => {
  const accumulator = new EnvironmentManifestAccumulator();
  for (const record of projected.records) {
    const added = accumulator.add(
      record,
      projected.responseBodies.get(record.ordinal),
    );
    if (!added.ok) throw added.error;
  }
  const result = accumulator.finish();
  if (!result.ok) throw result.error;
  return result.value.limitations;
};

describe("scenario Content-Type evidence", () => {
  it.each(
    [
      ["application/json", "application/octet-stream"],
      ["application/octet-stream", "application/json"],
      ["application/json", null],
      [null, "application/json"],
      ["application/json", "application/octet-stream", "application/json"],
    ].map((values) => ({ values })),
  )(
    "keeps conflicting or excluded Content-Type declarations unknown: $values",
    ({ values }) => {
      const capture = scenarioCaptureFixture([
        {
          method: "GET",
          url: "/download",
          status: 200,
          responseHeaders: values.map((value, index) => ({
            name: index % 2 === 0 ? "Content-Type" : "content-type",
            value,
          })),
        },
      ]);
      const original = JSON.stringify(capture);
      const content = capture.events.items.find(
        (event) =>
          event.kind === "network-content" && event.phase === "response",
      );
      if (content?.kind !== "network-content")
        throw new Error("Missing content");
      expect(scenarioContentMediaType(content)).toBeUndefined();
      for (const purpose of ["manifest", "replay"] as const) {
        const projected = scenarioCaptureRecords(capture, purpose);
        expect(projected.records[0]?.reported).toMatchObject({
          response: { status: 200, content: { mimeType: "" } },
        });
        const accumulator = new EnvironmentManifestAccumulator();
        for (const record of projected.records) {
          const added = accumulator.add(
            record,
            projected.responseBodies.get(record.ordinal),
          );
          if (!added.ok) throw added.error;
        }
        const manifest = accumulator.finish();
        if (!manifest.ok) throw manifest.error;
        expect(manifest.value.tools).toEqual([]);
      }
      expect(JSON.stringify(capture)).toBe(original);
    },
  );

  it("retains agreeing repeated Content-Type values and independently captured body metadata", () => {
    const capture = scenarioCaptureFixture([
      {
        method: "GET",
        url: "/headers",
        status: 200,
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "content-type", value: "application/json" },
        ],
      },
      {
        method: "GET",
        url: "/body",
        status: 200,
        body: "{}",
        mediaType: "application/json",
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "content-type", value: null },
        ],
      },
    ]);
    const projected = scenarioCaptureRecords(capture, "manifest");
    expect(projected.records).toHaveLength(2);
    for (const record of projected.records)
      expect(record.reported).toMatchObject({
        response: { content: { mimeType: "application/json" } },
      });
  });
});

describe("scenarioCaptureRecords", () => {
  it("projects each transaction, in request order, as a HAR-shaped record with its retained bytes", () => {
    const projected = scenarioCaptureRecords(
      scenarioCaptureFixture(),
      "manifest",
    );
    expect(projected.totalRecords).toBe(SCENARIO_EXCHANGES.length);
    expect(projected.records.map((record) => record.ordinal)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    const user = projected.records[1];
    expect(user?.reported).toEqual({
      request: {
        method: "GET",
        url: "http://127.0.0.1:3101/api/users/2",
        bodySize: -1,
      },
      response: {
        status: 200,
        content: {
          mimeType: "application/json",
          text: Buffer.from('{"id":2,"login":"probe"}').toString("base64"),
          encoding: "base64",
        },
      },
    });
    expect(user?.binary_fields).toMatchObject([
      { pointer: "/response/content/text", state: "retained", bytes: 24 },
    ]);
    expect(user?.location).toEqual({
      kind: "json-pointer",
      pointer: "/events/items/3",
    });
    // A JSON request body becomes postData, so the manifest can read its key types.
    expect(projected.records[4]?.reported).toMatchObject({
      request: {
        postData: {
          mimeType: "application/json",
          text: '{"title":"Lighthouse Rota"}',
        },
      },
    });
    // A redacted URL is withheld rather than templated; a failed request has no response.
    expect(projected.records[5]?.reported).toMatchObject({
      request: { url: null },
    });
    expect(projected.records[7]?.reported).toEqual({
      request: {
        method: "GET",
        url: "http://127.0.0.1:3101/api/slow",
        bodySize: -1,
      },
    });
    expect(manifestLimitations(projected)).toContain(
      "1 of 7 scenario transactions with a usable request line retained no response body; tools citing them replay only the recorded status and content type, either of which may be absent.",
    );
  });

  it("records a hidden request body as absent only when the request names no Content-Type", () => {
    const toggle = {
      method: "PUT",
      url: "/api/entries/1/bookmark",
      status: 204,
      requestBodyHidden: true,
    } as const;
    const projected = scenarioCaptureRecords(
      scenarioCaptureFixture([
        { ...toggle, requestHeaderNames: ["accept", "authorization"] },
        { ...toggle, requestHeaderNames: ["accept", "Content-Type"] },
      ]),
      "manifest",
    );
    expect(projected.records.map((entry) => entry.reported)).toMatchObject([
      { request: { bodySize: 0 } },
      { request: { bodySize: -1 } },
    ]);
  });

  it("leaves a transaction that cannot be attributed to one request and response unrepresented", () => {
    const capture = scenarioCaptureFixture(SCENARIO_EXCHANGES.slice(1, 2));
    const response = capture.events.items.find(
      (event) => event.kind === "response",
    );
    if (response === undefined) throw new Error("Fixture lacks a response");
    const duplicated = {
      ...capture,
      events: {
        ...capture.events,
        items: [...capture.events.items, { ...response, sequence: 99 }],
      },
    };
    const projected = scenarioCaptureRecords(duplicated, "manifest");
    expect(projected.records[0]?.reported).toEqual({});
    // The shared request-line owner rejects this ambiguous transaction before body counting.
    expect(
      manifestLimitations(projected).some((limitation) =>
        limitation.includes("scenario transactions with a usable request line"),
      ),
    ).toBe(false);
  });

  it("replays a redacted body's markers, counts it, and treats a body redaction emptied as not retained", () => {
    const capture = scenarioCaptureFixture(SCENARIO_EXCHANGES.slice(1, 3));
    const redacted =
      (transaction: string, bytes: Buffer) =>
      (event: (typeof capture.events.items)[number]) =>
        event.kind === "network-content" &&
        event.phase === "response" &&
        event.transaction_id === transaction &&
        event.body.state === "captured"
          ? {
              ...event,
              body: {
                ...event.body,
                content: bytes.toString("base64"),
                bytes: bytes.length,
                sha256: createHash("sha256").update(bytes).digest("hex"),
                redacted: true,
              },
            }
          : event;
    const marker = Buffer.from('{"token":"[REDACTED:owner_token]"}');
    const projected = scenarioCaptureRecords(
      {
        ...capture,
        events: {
          ...capture.events,
          items: capture.events.items
            .map(redacted("request-1", marker))
            .map(redacted("request-2", Buffer.alloc(0))),
        },
      },
      "manifest",
    );
    expect(projected.records[0]?.reported).toMatchObject({
      response: { content: { text: marker.toString("base64") } },
    });
    expect(projected.records[1]?.reported).toMatchObject({
      response: { status: 200, content: { mimeType: "application/json" } },
    });
    expect(projected.records[1]?.reported).not.toHaveProperty(
      "response.content.text",
    );
    expect(projected.records[1]?.binary_fields).toEqual([]);
    expect(manifestLimitations(projected)).toEqual(
      expect.arrayContaining([
        "1 of 2 scenario transactions with a usable request line retained no response body; tools citing them replay only the recorded status and content type, either of which may be absent.",
        "1 of 2 scenario transactions with a usable request line retained a response body with declared secret values replaced by redaction markers; tools citing them replay the redacted bytes.",
      ]),
    );
  });
});

it("reserves retained request-body expansion before schema decoding or projection", () => {
  const capture = scenarioCaptureFixture([
    {
      method: "POST",
      url: "/api/items",
      status: 201,
      mediaType: "application/json",
      body: "{}",
      requestMediaType: "application/json",
      requestBody: JSON.stringify({ value: "x".repeat(16 * 1024) }),
    },
  ]);
  const decoder = vi.spyOn(TextDecoder.prototype, "decode");
  try {
    const projected = admitScenarioCaptureParent(
      {
        evidenceId: `ev_${"a".repeat(64)}`,
        operation: "capture_browser_scenario",
        normalizedResult: capture,
        limitations: [],
      },
      "environment-manifest",
      new EnvironmentManifestAccumulator(128 * 1024),
    );
    expect(projected).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisResourceConstraintError", resource: "memory" },
    });
    expect(decoder).not.toHaveBeenCalled();
  } finally {
    decoder.mockRestore();
  }
});

it("reserves request text even when another event's body was not captured", () => {
  const capture = scenarioCaptureFixture([
    {
      method: "GET",
      url: "/api/items",
      status: 200,
      mediaType: "application/json",
      body: "[]",
    },
    {
      method: "POST",
      url: "/api/items",
      status: 201,
      mediaType: "application/json",
      body: "{}",
      requestMediaType: "application/json",
      requestBody: JSON.stringify({ value: "x".repeat(2 * 1024 * 1024) }),
    },
  ]);
  // The first response's body has no content, as a body that was not requested has.
  const items = capture.events.items.map((event) =>
    event.kind === "network-content" && event.transaction_id === "request-1"
      ? { ...event, body: { state: "not_requested" as const } }
      : event,
  );
  const decoder = vi.spyOn(TextDecoder.prototype, "decode");
  try {
    // The capture's containers fit this budget; only its request text does not.
    const projected = admitScenarioCaptureParent(
      {
        evidenceId: `ev_${"a".repeat(64)}`,
        operation: "capture_browser_scenario",
        normalizedResult: { ...capture, events: { ...capture.events, items } },
        limitations: [],
      },
      "environment-manifest",
      new EnvironmentManifestAccumulator(8 * 1024 * 1024),
    );
    expect(projected).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisResourceConstraintError", resource: "memory" },
    });
    expect(decoder).not.toHaveBeenCalled();
  } finally {
    decoder.mockRestore();
  }
});

it("does not decode request text when projecting replay records", () => {
  const capture = scenarioCaptureFixture();
  const decoder = vi.spyOn(TextDecoder.prototype, "decode");
  try {
    const projected = scenarioCaptureRecords(capture, "replay");
    expect(projected.records[4]?.reported).toMatchObject({
      request: { method: "POST", url: "http://127.0.0.1:3101/api/folders" },
    });
    expect(projected.records[4]?.reported).not.toHaveProperty(
      "request.postData",
    );
    expect(decoder).not.toHaveBeenCalled();
    expect(projected.records[4]?.binary_fields).toHaveLength(1);
  } finally {
    decoder.mockRestore();
  }
});

it("distinguishes a retained empty request from missing or redacted request bytes", () => {
  const captured = scenarioCaptureFixture([
    {
      method: "POST",
      url: "/api/items/1/archive",
      status: 204,
      requestBody: "",
      requestMediaType: "application/json",
    },
  ]);
  expect(
    scenarioCaptureRecords(captured, "manifest").records[0]?.reported,
  ).toMatchObject({ request: { bodySize: 0 } });
  const redacted = {
    ...captured,
    events: {
      ...captured.events,
      items: captured.events.items.map((event) =>
        event.kind === "network-content" &&
        event.phase === "request" &&
        event.body.state === "captured"
          ? { ...event, body: { ...event.body, redacted: true } }
          : event,
      ),
    },
  };
  expect(
    scenarioCaptureRecords(redacted, "manifest").records[0]?.reported,
  ).toMatchObject({ request: { bodySize: -1 } });
  const missing = scenarioCaptureFixture([
    { method: "POST", url: "/api/items/1/archive", status: 204 },
  ]);
  expect(
    scenarioCaptureRecords(missing, "manifest").records[0]?.reported,
  ).toMatchObject({ request: { bodySize: -1 } });
});
