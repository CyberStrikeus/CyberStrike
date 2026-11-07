import { describe, expect, it } from "vitest";

import { CdpCaptureEvents } from "../../../src/browser/CdpCaptureEvents.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { CDP_CAPTURE_SCRIPT_METADATA_LIMITS } from "../../../src/browser/CdpCaptureEventTypes.js";

describe("CDP script metadata admission", () => {
  it("retains an invalid source-map declaration as unknown", () => {
    const events = captureEvents();
    events.beginAuthorizedFrame("frame-1");
    for (const [scriptId, sourceMapURL] of [
      ["bad", null],
      ["absent", undefined],
      ["empty", ""],
    ] as const) {
      events.ingest({
        method: "Debugger.scriptParsed",
        params: {
          scriptId,
          url: "https://app.example/app.js",
          sourceMapURL,
        },
      });
      expect(events.scripts.get(scriptId)?.sourceMapUrl).toBeNull();
    }
    expect(events.completeness.snapshot().excluded).toContainEqual({
      section: "source_maps",
      reason: "invalid_protocol_value",
      count: 1,
    });
  });

  it("releases a replaced script ID's prior bytes and resets admission on a new document", () => {
    const events = captureEvents();
    const origin = "https://app.example";
    events.beginAuthorizedFrame("frame-1");
    const emit = (scriptId: string, bytes: number): void => {
      events.ingest({
        method: "Debugger.scriptParsed",
        params: {
          scriptId,
          url: `${origin}/app.js`,
          sourceMapURL: `/maps/${"x".repeat(bytes)}.map`,
        },
      });
    };

    emit("same-id", 3 * 1024 * 1024);
    emit("same-id", 2 * 1024 * 1024);
    emit("next-id", 1024 * 1024);

    expect(events.scripts.get("same-id")?.sourceMapUrl).toContain(
      "x".repeat(2 * 1024 * 1024),
    );
    expect(events.scripts.get("next-id")?.sourceMapUrl).toContain(
      "x".repeat(1024 * 1024),
    );
    expect(events.retainedScriptMetadataBytes).toBeLessThanOrEqual(
      CDP_CAPTURE_SCRIPT_METADATA_LIMITS.retainedBytes,
    );
    const normalizedAway = `./`.repeat(1_200_000) + "map.js.map";
    events.ingest({
      method: "Debugger.scriptParsed",
      params: {
        scriptId: "normalized-url",
        url: `${origin}/app.js`,
        sourceMapURL: normalizedAway,
      },
    });
    expect(events.scripts.get("normalized-url")?.sourceMapUrl).toBe(
      `${origin}/map.js.map`,
    );

    events.beginAuthorizedFrame("frame-2");
    emit("new-document", 5 * 1024 * 1024);
    emit("new-document", 1024 * 1024);
    events.recordScriptMetadataBudgetExclusions();
    expect(
      events.completeness
        .snapshot()
        .excluded.find(
          ({ section, reason }) =>
            section === "source_maps" && reason === "resource_budget_exhausted",
        ),
    ).toBeUndefined();

    events.beginAuthorizedFrame("frame-3");
    emit("new-document", 3 * 1024 * 1024);
    expect(events.scripts.get("new-document")?.sourceMapUrl).toContain(
      "x".repeat(3 * 1024 * 1024),
    );
  });

  it("does not retain IDs for scripts rejected by byte or record limits", () => {
    const events = captureEvents();
    const origin = "https://app.example";
    events.beginAuthorizedFrame("frame-1");
    const emit = (scriptId: string): void => {
      events.ingest({
        method: "Debugger.scriptParsed",
        params: { scriptId, url: `${origin}/app.js` },
      });
    };

    emit("x".repeat(CDP_CAPTURE_SCRIPT_METADATA_LIMITS.retainedBytes + 1));
    for (
      let index = 0;
      index < CDP_CAPTURE_SCRIPT_METADATA_LIMITS.scripts;
      index += 1
    )
      emit(`script-${String(index)}`);
    for (let index = 0; index < 10; index += 1)
      emit(`rejected-${String(index)}`);

    expect(events.scripts.size).toBe(
      CDP_CAPTURE_SCRIPT_METADATA_LIMITS.scripts,
    );
    expect(events.scriptMetadataBudgetOmissionsById.size).toBe(0);
    expect(events.rejectedScriptMetadataBudgetCount).toBe(11);
    events.recordScriptMetadataBudgetExclusions();
    expect(
      events.completeness
        .snapshot()
        .excluded.find(
          ({ section, reason }) =>
            section === "scripts" && reason === "resource_budget_exhausted",
        ),
    ).toEqual({
      section: "scripts",
      reason: "resource_budget_exhausted",
      count: 11,
    });
  });
});

const captureEvents = (): CdpCaptureEvents =>
  new CdpCaptureEvents(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: "http://127.0.0.1:9222",
      allowed_origins: ["https://app.example"],
      target_id: "page",
      observation_ms: 0,
    }),
    new Set(["https://app.example"]),
  );

it.each([
  {
    name: "absent auxiliary data",
    auxiliary: undefined,
    frame: "frame-1",
    invalid: false,
  },
  {
    name: "conflicting frame",
    auxiliary: { frameId: "other-frame" },
    frame: null,
    invalid: true,
  },
  {
    name: "empty frame",
    auxiliary: { frameId: "" },
    frame: null,
    invalid: true,
  },
  {
    name: "null frame",
    auxiliary: { frameId: null },
    frame: null,
    invalid: true,
  },
  {
    name: "numeric frame",
    auxiliary: { frameId: 7 },
    frame: null,
    invalid: true,
  },
  {
    name: "malformed auxiliary data",
    auxiliary: null,
    frame: null,
    invalid: true,
  },
])(
  "keeps script ownership uncertain for $name",
  ({ auxiliary, frame, invalid }) => {
    const events = captureEvents();
    events.beginAuthorizedFrame("frame-1");
    events.ingest({
      method: "Runtime.executionContextCreated",
      params: { context: { id: 7, auxData: { frameId: "frame-1" } } },
    });
    events.ingest({
      method: "Debugger.scriptParsed",
      params: {
        scriptId: "script",
        url: "https://app.example/app.js",
        executionContextId: 7,
        ...(auxiliary === undefined
          ? {}
          : { executionContextAuxData: auxiliary }),
      },
    });
    const script = events.scripts.get("script");
    if (script === undefined)
      throw new Error("Expected retained script metadata");
    expect(script.frameId).toBe(frame);
    expect(events.frameForScript(script, new Set(["frame-1"]))).toBe(frame);
    expect(
      events.completeness
        .snapshot()
        .excluded.filter(({ section }) => section === "scripts"),
    ).toEqual(
      invalid
        ? [{ section: "scripts", reason: "invalid_protocol_value", count: 1 }]
        : [],
    );
  },
);

it("rejects an empty script ID before retaining its metadata", () => {
  const events = captureEvents();
  events.beginAuthorizedFrame("frame-1");
  events.ingest({
    method: "Debugger.scriptParsed",
    params: { scriptId: "", url: "https://app.example/app.js" },
  });
  expect(events.scripts.size).toBe(0);
  expect(events.retainedScriptMetadataBytes).toBe(0);
  expect(events.completeness.snapshot().excluded).toContainEqual({
    section: "scripts",
    reason: "invalid_protocol_value",
    count: 1,
  });
});
