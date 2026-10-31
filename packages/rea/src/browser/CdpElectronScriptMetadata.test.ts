import { describe, expect, it, vi } from "vitest";

import { DEFAULT_ASAR_HEADER_ADMISSION } from "../config/asarHeaderAdmission.js";
import { inspectElectronPageInputSchema } from "../domain/javascript/electronObservation.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import type { CdpContextFrameClaim } from "./CdpScriptContextFacts.js";
import type { CdpConnection } from "./CdpConnection.js";
import {
  ingestElectronScriptEvent,
  type ElectronScriptDraft,
} from "./CdpElectronScriptEvents.js";
import { captureElectronScripts } from "./CdpElectronScripts.js";

// Exercise the existing byte-admission boundary without allocating an 8 MiB fixture.
vi.mock("./CdpCaptureEventTypes.js", () => ({
  CDP_CAPTURE_SCRIPT_METADATA_LIMITS: { retainedBytes: 2048, scripts: 50_000 },
}));

const oversizedClaim = "\0".repeat(400);

describe("Electron script metadata byte admission", () => {
  it("retains actual frame claims and later fitting observations after an escaped claim exceeds the allowance", () => {
    const scripts: ElectronScriptDraft[] = [];
    const completeness = new CdpCaptureCompleteness();
    const retention = { bytes: 2 };
    for (const [scriptId, frameId] of [
      ["prefix", "reported-frame"],
      ["oversized", oversizedClaim],
      ["suffix", ""],
    ]) {
      ingestElectronScriptEvent({
        event: {
          method: "Debugger.scriptParsed",
          params: {
            scriptId,
            url: "file:///fixture/app.js",
            executionContextId: 7,
            executionContextAuxData: { frameId },
          },
        },
        scripts,
        executionContextFrames: new Map<string, CdpContextFrameClaim>([
          ["7", { state: "observed", frameId: "context-frame" }],
        ]),
        completeness,
        retention,
      });
    }

    expect(oversizedClaim.length).toBeLessThan(2048);
    expect(scripts.map((script) => script.scriptId)).toEqual([
      "prefix",
      "suffix",
    ]);
    expect(scripts[0]).toMatchObject({
      frameId: null,
      frameClaims: {
        script_event_frame_id: "reported-frame",
        execution_context_frame_id: "context-frame",
      },
    });
    expect(scripts[1]?.frameClaims.script_event_frame_id).toBe("");
    expect(retention.bytes).toBe(
      jsonValueByteLength(scripts.map((script) => ({ ...script }))),
    );
    expect(retention.bytes).toBeLessThanOrEqual(2048);
    expect(completeness.snapshot().excluded).toContainEqual({
      section: "scripts",
      reason: "resource_budget_exhausted",
      count: 1,
    });
  });

  it("accounts for frame claims in normalized metadata before hashing and retains fitting siblings", async () => {
    const completeness = new CdpCaptureCompleteness();
    const scripts: ElectronScriptDraft[] = [
      "prefix",
      "oversized",
      "suffix",
    ].map((scriptId) => ({
      scriptId,
      rawUrl: import.meta.url,
      hash: scriptId,
      length: null,
      isModule: null,
      language: null,
      frameId: null,
      hasSourceUrl: null,
      frameClaims: {
        script_event_frame_id:
          scriptId === "oversized" ? oversizedClaim : "reported-frame",
        execution_context_frame_id: "context-frame",
      },
    }));
    const capture = await captureElectronScripts({
      connection: {
        send: async () => {
          throw new Error("Source capture was not selected");
        },
      } as unknown as CdpConnection,
      sessionId: undefined,
      request: inspectElectronPageInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "page",
        include_script_sources: false,
      }),
      scripts,
      frameScopeForScript: () => ({ state: "unknown", frameId: null }),
      completeness,
      asarHeaderAdmission: DEFAULT_ASAR_HEADER_ADMISSION,
    });

    expect(capture.total).toBe(2);
    expect(capture.items.map((item) => item.cdp_hash).sort()).toEqual([
      "prefix",
      "suffix",
    ]);
    expect(capture.items[0]).toMatchObject({
      frame_id: null,
      frame_scope: "unknown",
      frame_claims: {
        script_event_frame_id: "reported-frame",
        execution_context_frame_id: "context-frame",
      },
    });
    expect(
      jsonValueByteLength(
        capture.items.map(({ source: _source, ...metadata }) => metadata),
      ),
    ).toBeLessThanOrEqual(2048);
    expect(completeness.snapshot().excluded).toContainEqual({
      section: "scripts",
      reason: "resource_budget_exhausted",
      count: 1,
    });
  });
});
