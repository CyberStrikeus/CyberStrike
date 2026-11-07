import type { CdpContextFrameClaim } from "./CdpScriptContextFacts.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import { describe, expect, it } from "vitest";

import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import { CdpCaptureEvents } from "./CdpCaptureEvents.js";
import {
  ingestElectronScriptEvent,
  type ElectronScriptDraft,
} from "./CdpElectronScriptEvents.js";

describe("CDP execution-context retention", () => {
  it.each([
    {
      frameId: "",
      hasSourceURL: true,
      expectedFrame: null,
      expectedLabel: true,
    },
    {
      frameId: "frame-other",
      hasSourceURL: true,
      expectedFrame: null,
      expectedLabel: true,
    },
    {
      frameId: "frame-main",
      hasSourceURL: "invalid",
      expectedFrame: "frame-main",
      expectedLabel: null,
    },
  ])(
    "keeps contradictory Electron ownership and invalid source labels uncertain: $frameId/$hasSourceURL",
    ({ frameId, hasSourceURL, expectedFrame, expectedLabel }) => {
      const scripts: ElectronScriptDraft[] = [];
      const completeness = new CdpCaptureCompleteness();
      const retention = { bytes: 2 };
      ingestElectronScriptEvent({
        event: {
          method: "Debugger.scriptParsed",
          params: {
            scriptId: "script",
            url: "file:///fixture/app.js",
            executionContextId: 7,
            executionContextAuxData: { frameId },
            hasSourceURL,
          },
        },
        scripts,
        retention,
        executionContextFrames: new Map<string, CdpContextFrameClaim>([
          ["7", { state: "observed", frameId: "frame-main" }],
        ]),
        completeness,
      });
      expect(scripts[0]).toMatchObject({
        frameId: expectedFrame,
        hasSourceUrl: expectedLabel,
        frameClaims: {
          script_event_frame_id: frameId,
          execution_context_frame_id: "frame-main",
        },
      });
      expect(retention.bytes).toBe(
        jsonValueByteLength(scripts.map((script) => ({ ...script }))),
      );
      expect(completeness.snapshot().excluded).toContainEqual({
        section: "scripts",
        reason: "invalid_protocol_value",
        count: 1,
      });
    },
  );
  it("removes stale frame attribution when execution contexts are destroyed", () => {
    const request = inspectWebPageInputSchema.parse({
      cdp_endpoint: "http://127.0.0.1:9222",
      allowed_origins: ["https://app.example.test"],
      target_id: "page-1",
    });
    const browser = new CdpCaptureEvents(
      request,
      new Set(["https://app.example.test"]),
    );
    browser.beginAuthorizedFrame("frame-old");
    browser.ingest({
      method: "Runtime.executionContextCreated",
      params: { context: { id: 7, auxData: { frameId: "frame-old" } } },
    });
    browser.ingest({
      method: "Runtime.executionContextDestroyed",
      params: { executionContextId: 7 },
    });
    browser.ingest({
      method: "Debugger.scriptParsed",
      params: {
        scriptId: "script-1",
        url: "https://app.example.test/app.js",
        executionContextId: 7,
      },
    });
    const script = browser.scripts.get("script-1");
    if (script === undefined) throw new TypeError("Expected captured script");
    expect(browser.frameForScript(script, new Set(["frame-old"]))).toBeNull();

    const electronFrames = new Map<string, CdpContextFrameClaim>();
    const retention = { bytes: 2 };
    const completeness = new CdpCaptureCompleteness();
    ingestElectronScriptEvent({
      event: {
        method: "Runtime.executionContextCreated",
        params: { context: { id: 7, auxData: { frameId: "frame-old" } } },
      },
      scripts: [],
      retention,
      executionContextFrames: electronFrames,
      completeness,
    });
    ingestElectronScriptEvent({
      event: { method: "Runtime.executionContextsCleared", params: {} },
      scripts: [],
      retention,
      executionContextFrames: electronFrames,
      completeness,
    });
    expect(electronFrames.size).toBe(0);
  });

  it("keeps a script on the frame stored when it was parsed", () => {
    const request = inspectWebPageInputSchema.parse({
      cdp_endpoint: "http://127.0.0.1:9222",
      allowed_origins: ["https://app.example.test"],
      target_id: "page-1",
    });
    const browser = new CdpCaptureEvents(
      request,
      new Set(["https://app.example.test"]),
    );
    browser.beginAuthorizedFrame("frame-old");
    browser.beginAuthorizedFrame("frame-new");
    browser.ingest({
      method: "Runtime.executionContextCreated",
      params: { context: { id: 7, auxData: { frameId: "frame-old" } } },
    });
    browser.ingest({
      method: "Debugger.scriptParsed",
      params: {
        scriptId: "script-1",
        url: "https://app.example.test/app.js",
        executionContextId: 7,
      },
    });
    browser.ingest({
      method: "Runtime.executionContextCreated",
      params: { context: { id: 7, auxData: { frameId: "frame-new" } } },
    });
    const script = browser.scripts.get("script-1");
    if (script === undefined) throw new TypeError("Expected captured script");
    expect(
      browser.frameForScript(script, new Set(["frame-old", "frame-new"])),
    ).toBe("frame-old");
  });
});

it.each([
  {
    name: "missing auxiliary data",
    replacement: { id: 7 },
    expectedClaim: { state: "missing", frameId: undefined },
  },
  {
    name: "missing frame",
    replacement: { id: 7, auxData: {} },
    expectedClaim: { state: "missing", frameId: undefined },
  },
  {
    name: "empty frame",
    replacement: { id: 7, auxData: { frameId: "" } },
    expectedClaim: { state: "invalid", frameId: "" },
  },
  {
    name: "null frame",
    replacement: { id: 7, auxData: { frameId: null } },
    expectedClaim: { state: "invalid", frameId: undefined },
  },
  {
    name: "numeric frame",
    replacement: { id: 7, auxData: { frameId: 42 } },
    expectedClaim: { state: "invalid", frameId: undefined },
  },
  {
    name: "malformed auxiliary data",
    replacement: { id: 7, auxData: null },
    expectedClaim: { state: "invalid", frameId: undefined },
  },
])(
  "removes reused context authority after $name without rebinding earlier scripts",
  ({ replacement, expectedClaim }) => {
    const browser = new CdpCaptureEvents(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        allowed_origins: ["https://app.example.test"],
        target_id: "page-1",
      }),
      new Set(["https://app.example.test"]),
    );
    browser.beginAuthorizedFrame("frame-old");
    const scripts: ElectronScriptDraft[] = [];
    const executionContextFrames = new Map<string, CdpContextFrameClaim>();
    const completeness = new CdpCaptureCompleteness();
    const retention = { bytes: 2 };
    const events = [
      {
        method: "Runtime.executionContextCreated",
        params: { context: { id: 7, auxData: { frameId: "frame-old" } } },
      },
      {
        method: "Debugger.scriptParsed",
        params: {
          scriptId: "before",
          url: "https://app.example.test/app.js",
          executionContextId: 7,
        },
      },
      {
        method: "Runtime.executionContextCreated",
        params: { context: replacement },
      },
      {
        method: "Debugger.scriptParsed",
        params: {
          scriptId: "after",
          url: "https://app.example.test/app.js",
          executionContextId: 7,
        },
      },
    ];
    for (const event of events) {
      browser.ingest(event);
      ingestElectronScriptEvent({
        event,
        scripts,
        executionContextFrames,
        completeness,
        retention,
      });
    }
    const before = browser.scripts.get("before");
    const after = browser.scripts.get("after");
    if (before === undefined || after === undefined)
      throw new Error("Expected both script records");
    expect(browser.frameForScript(before, new Set(["frame-old"]))).toBe(
      "frame-old",
    );
    expect(browser.frameForScript(after, new Set(["frame-old"]))).toBeNull();
    expect(after.frameId).toBeNull();
    expect(
      scripts.map(({ scriptId, frameId }) => ({ scriptId, frameId })),
    ).toEqual([
      { scriptId: "before", frameId: "frame-old" },
      { scriptId: "after", frameId: null },
    ]);
    expect(executionContextFrames.get("7")).toEqual(expectedClaim);
    expect(browser.executionContextFrames.get("7")).toEqual(expectedClaim);
    expect(retention.bytes).toBe(
      jsonValueByteLength(scripts.map((script) => ({ ...script }))),
    );
  },
);
