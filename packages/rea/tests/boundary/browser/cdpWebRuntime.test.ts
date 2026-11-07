import { createHash } from "node:crypto";
import { describe, expect, it, onTestFinished } from "vitest";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import { observeWebExecutionInputSchema } from "../../../src/domain/webExecution.js";
import { inspectWebEventListenersInputSchema } from "../../../src/domain/webEventListeners.js";
import {
  runtimeSourceA,
  runtimeSourceB,
  startRuntimeBrowser,
} from "../../fixtures/webRuntime.js";
import type { FakeOptions } from "../../fixtures/fakeCdpBrowser.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";

const fixture = async (options: FakeOptions = {}) => {
  const browser = await startRuntimeBrowser(options);
  onTestFinished(() => browser.close());
  const provider = new CdpWebRuntimeProvider();
  const input = {
    cdp_endpoint: browser.endpoint,
    target_id: "allowed-page",
    observation_ms: 5,
  };
  return {
    browser,
    provider,
    execution: observeWebExecutionInputSchema.parse(input),
    listeners: inspectWebEventListenersInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      target_id: "allowed-page",
      selector: "#selected",
    }),
  };
};

describe("native runtime producer boundary", () => {
  it("binds complete producer stacks by script ID and ignores foreign sessions without URL guessing", async () => {
    const { browser, provider, execution } = await fixture();
    const params = {
      requestId: "selected-request",
      frameId: "runtime-main",
      timestamp: 12.5,
      request: {
        url: `${browser.endpoint}/request?caller-value=retained`,
        method: "POST",
      },
      initiator: {
        type: "script",
        producerExtension: "retain-unknown-fields",
        stack: {
          description: "observed-sync-stack",
          callFrames: [
            {
              scriptId: "script-b",
              url: `${browser.endpoint}/same.js`,
              functionName: "alias",
              lineNumber: 0,
              columnNumber: 2,
            },
          ],
          parent: {
            description: "observed-async-stack",
            callFrames: [
              {
                scriptId: "unknown-script",
                url: `${browser.endpoint}/same.js`,
                functionName: "unknown",
                lineNumber: 0,
                columnNumber: 3,
              },
            ],
            parentId: { id: "async-parent", debuggerId: "other-debugger" },
          },
        },
      },
    };
    const result = await provider.observeExecution(
      { ...execution, observation_ms: 30 },
      {
        progress: {
          report: async (update) => {
            if (update.completed !== 1) return;
            browser.emitEvent({
              method: "Network.requestWillBeSent",
              params,
              sessionId: "foreign-session",
            });
            browser.emitEvent({
              method: "Network.requestWillBeSent",
              params,
              sessionId: "session-1",
            });
          },
        },
      },
    );
    if (!result.ok) throw result.error;
    expect(result.value.requests).toHaveLength(1);
    expect(result.value.requests[0]?.reported_initiator).toEqual(
      params.initiator,
    );
    expect(result.value.requests[0]?.callsites).toMatchObject([
      { script_id: "script-b", source_association: "script_id" },
      { script_id: "unknown-script", source_association: "unknown" },
    ]);
    expect(result.value.requests[0]?.async_parent_ids).toEqual([
      { id: "async-parent", debugger_id: "other-debugger" },
    ]);
    expect(result.value.requests[0]?.causal_attribution).toBe("unknown");
  });
});

describe("runtime window and producer granularity", () => {
  it("fails malformed frame identity and completes execution cleanup", async () => {
    const { browser, provider, execution } = await fixture();
    const result = await provider.observeExecution(
      { ...execution, observation_ms: 30_000 },
      {
        progress: {
          report: async (update) => {
            if (update.completed !== 1) return;
            browser.emitEvent({
              method: "Page.frameNavigated",
              sessionId: "session-1",
              params: {
                frame: {
                  id: "other-frame",
                  parentId: 7,
                  url: "https://example.test/child",
                },
              },
            });
          },
        },
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "BrowserObservationError", reason: "protocol_error" },
    });
    expect(
      browser.commands.some(
        (command) => command.method === "Profiler.stopPreciseCoverage",
      ),
    ).toBe(true);
    expect(
      browser.commands.some(
        (command) => command.method === "Target.detachFromTarget",
      ),
    ).toBe(true);
  });

  it("ends at document replacement and leaves coverage explicitly unavailable", async () => {
    const { browser, provider, execution } = await fixture();
    const result = await provider.observeExecution(
      { ...execution, observation_ms: 30_000 },
      {
        progress: {
          report: async (update) => {
            if (update.completed === 1)
              browser.emitEvent({
                method: "Page.frameNavigated",
                sessionId: "session-1",
                params: {
                  frame: {
                    id: "runtime-main",
                    url: `${browser.endpoint}/new-document`,
                  },
                },
              });
          },
        },
      },
    );
    if (!result.ok) throw result.error;
    expect(result.value.window.end_reason).toBe("document_changed");
    expect(result.value.coverage.state).toBe("unavailable");
    expect(result.value.instrumentation.takes_one_resetting_sample).toBe(false);
  });

  it("reports disconnected cleanup as unknown instead of successful detachment", async () => {
    const { provider, execution } = await fixture({
      closeOnMethod: "Profiler.takePreciseCoverage",
    });
    const result = await provider.observeExecution(execution);
    if (result.ok)
      throw new Error("Disconnect cannot confirm instrumentation cleanup");
    expect(result.error.cleanupIncomplete).toBe(true);
  });

  it("retains function-only producer granularity without fabricating zero branches", async () => {
    const { provider, execution } = await fixture({
      commandResult: (command, origin) =>
        command.method === "Profiler.takePreciseCoverage"
          ? {
              timestamp: 13,
              result: [
                {
                  scriptId: "script-a",
                  url: `${origin}/same.js`,
                  functions: [
                    {
                      functionName: "selected",
                      isBlockCoverage: false,
                      ranges: [
                        {
                          startOffset: 0,
                          endOffset: runtimeSourceA.length,
                          count: 1,
                        },
                      ],
                    },
                  ],
                },
              ],
            }
          : undefined,
    });
    const result = await provider.observeExecution(execution);
    if (!result.ok) throw result.error;
    expect(result.value.coverage.scripts[0]?.functions[0]).toMatchObject({
      is_block_coverage: false,
      ranges: [{ count: 1 }],
    });
    expect(result.value.script_inventory.not_reported_script_ids).toContain(
      "script-b",
    );
    expect(result.value.script_inventory.coverage_absence).toBe("unknown");
  });
});

it("joins a reordered multi-script coverage sample by identity and preserves unavailable bounds", async () => {
  const texts = new Map(
    Array.from({ length: 256 }, (_, index) => [
      `script-${index}`,
      `// 🔥\r\n${" ".repeat(index)}function f(){return ${index};}`,
    ]),
  );
  const { browser, provider, execution } = await fixture({
    commandEvents: (command, origin) =>
      command.method === "Debugger.enable"
        ? [...texts.keys(), "foreign-script"].map((scriptId) => ({
            ...(command.sessionId === undefined
              ? {}
              : { sessionId: command.sessionId }),
            method: "Debugger.scriptParsed",
            params: {
              scriptId,
              url: `${origin}/shared.js`,
              executionContextId: scriptId === "foreign-script" ? 99 : 1,
              startLine: 0,
              startColumn: 0,
              endLine: 1,
              endColumn: 0,
            },
          }))
        : undefined,
    commandError: (command) =>
      command.method === "Debugger.getScriptSource" &&
      command.params.scriptId === "script-128"
        ? { code: -32000, message: "Selected source is unavailable" }
        : undefined,
    commandResult: (command, origin) => {
      if (command.method === "Debugger.getScriptSource")
        return { scriptSource: texts.get(String(command.params.scriptId)) };
      if (command.method !== "Profiler.takePreciseCoverage") return undefined;
      return {
        timestamp: 13,
        result: [...texts]
          .reverse()
          .map(([scriptId, text]) => ({
            scriptId,
            url: `${origin}/shared.js`,
            functions: [
              {
                functionName: "f",
                isBlockCoverage: true,
                ranges: [
                  { startOffset: 0, endOffset: text.length, count: 1 },
                  { startOffset: 8, endOffset: 9, count: 0 },
                ],
              },
            ],
          }))
          .concat([
            {
              scriptId: "foreign-script",
              url: `${origin}/shared.js`,
              functions: [],
            },
          ]),
      };
    },
  });
  const result = await provider.observeExecution(execution);
  if (!result.ok) throw result.error;
  expect(result.value.coverage.excluded_scripts).toBe(1);
  expect(
    result.value.coverage.scripts.map(({ script_id }) => script_id),
  ).toEqual([...texts.keys()].reverse());
  for (const script of result.value.coverage.scripts) {
    expect(script.functions[0]?.ranges).toEqual([
      {
        start_offset: 0,
        end_offset: texts.get(script.script_id)?.length,
        count: 1,
        source_bounds:
          script.script_id === "script-128" ? "unknown" : "verified",
      },
      {
        start_offset: 8,
        end_offset: 9,
        count: 0,
        source_bounds:
          script.script_id === "script-128" ? "unknown" : "verified",
      },
    ]);
  }
  expect(
    result.value.sources.find(({ script_id }) => script_id === "script-128")
      ?.source,
  ).toMatchObject({ state: "unavailable" });
  expect(
    browser.commands.some(
      ({ method }) => method === "Profiler.stopPreciseCoverage",
    ),
  ).toBe(true);
  expect(
    browser.commands.some(({ method }) => method === "Target.detachFromTarget"),
  ).toBe(true);
});

describe("runtime source and listener identity", () => {
  it("retains same-URL script identities, UTF-16 bounds, nested zero counts and actual cleanup", async () => {
    const { browser, provider, execution } = await fixture();
    const result = await provider.observeExecution(execution);
    if (!result.ok) throw result.error;
    expect(
      result.value.coverage.scripts.map((script) => script.script_id),
    ).toEqual(["script-a", "script-b"]);
    expect(result.value.coverage.excluded_scripts).toBe(1);
    expect(
      result.value.sources.map((script) =>
        script.source.state === "captured" ? script.source.text : null,
      ),
    ).toEqual([runtimeSourceA, runtimeSourceB]);
    const source = result.value.sources[0];
    expect(source?.producer_hash).toBe("producer-reported-hash");
    expect(source?.source).toMatchObject({
      sha256: createHash("sha256").update(runtimeSourceA).digest("hex"),
      utf16_units: runtimeSourceA.length,
      utf8_bytes: Buffer.byteLength(runtimeSourceA),
    });
    expect(
      result.value.coverage.scripts[0]?.functions[0]?.ranges[1],
    ).toMatchObject({ count: 0, source_bounds: "verified" });
    expect(
      browser.commands.some(
        (command) => command.method === "Profiler.stopPreciseCoverage",
      ),
    ).toBe(true);
    expect(
      browser.commands.some(
        (command) => command.method === "Target.detachFromTarget",
      ),
    ).toBe(true);
    expect(
      browser.commands.some((command) =>
        ["Browser.close", "Target.closeTarget", "Runtime.evaluate"].includes(
          command.method,
        ),
      ),
    ).toBe(false);
  });

  it("inspects listener source and releases only its owned object group", async () => {
    const { browser, provider, listeners } = await fixture();
    const result = await provider.inspectEventListeners(listeners);
    if (!result.ok) throw result.error;
    expect(result.value.listeners[0]).toMatchObject({
      type: "click",
      location: {
        script_id: "script-a",
        source_association: "script_id",
        line_number: 1,
      },
      execution: "unknown",
    });
    const resolve = browser.commands.find(
      (command) => command.method === "DOM.resolveNode",
    );
    const release = browser.commands.find(
      (command) => command.method === "Runtime.releaseObjectGroup",
    );
    expect(release?.params.objectGroup).toBe(resolve?.params.objectGroup);
    expect(resolve?.params.objectGroup).toMatch(/^rea-listeners-/u);
  });

  it("returns an explicit missing node without source/handler evaluation", async () => {
    const { provider, listeners } = await fixture();
    const result = await provider.inspectEventListeners({
      ...listeners,
      selector: "#missing",
    });
    if (!result.ok) throw result.error;
    expect(result.value.selected_node.match).toBe("not_found");
    expect(result.value.listeners).toEqual([]);
  });
});

describe("runtime lifecycle and invalid producer data", () => {
  it("releases instrumentation after cancellation delivered at the actual armed point", async () => {
    const { browser, provider, execution } = await fixture();
    const controller = new AbortController();
    const result = await provider.observeExecution(
      { ...execution, observation_ms: 30_000 },
      {
        signal: controller.signal,
        progress: {
          report: async (update) => {
            if (update.completed === 1) controller.abort();
          },
        },
      },
    );
    if (result.ok)
      throw new Error("Cancellation must not produce successful evidence");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(
      browser.commands.some(
        (command) => command.method === "Profiler.stopPreciseCoverage",
      ),
    ).toBe(true);
  });

  it("returns cleanup failure when coverage stop cannot be confirmed", async () => {
    const { browser, provider, execution } = await fixture({
      unsupportedMethods: ["Profiler.stopPreciseCoverage"],
    });
    const result = await provider.observeExecution(execution);
    if (result.ok) throw new Error("Failed cleanup must not return success");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(
      browser.commands.some(
        (command) => command.method === "Target.detachFromTarget",
      ),
    ).toBe(true);
  });

  it("preserves the unsupported command reason", async () => {
    const { provider, execution } = await fixture({
      unsupportedMethods: ["Profiler.startPreciseCoverage"],
    });
    const result = await provider.observeExecution(execution);
    if (result.ok) throw new Error("Unsupported instrumentation must fail");
    expect(result.error.userMessage).toContain("Profiler.startPreciseCoverage");
    expect(result.error.userMessage).toContain("Method not found");
  });

  it("rejects a malformed sample and still stops coverage", async () => {
    const { browser, provider, execution } = await fixture({
      commandResult: (command) =>
        command.method === "Profiler.takePreciseCoverage"
          ? { timestamp: 1, result: "wrong" }
          : undefined,
    });
    const result = await provider.observeExecution(execution);
    if (result.ok) throw new Error("Malformed producer coverage must fail");
    expect(result.error._tag).toBe("AnalysisOutputError");
    expect(
      browser.commands.some(
        (command) => command.method === "Profiler.stopPreciseCoverage",
      ),
    ).toBe(true);
  });

  it("rejects a source range measured as UTF-8 bytes instead of UTF-16 units", async () => {
    const { provider, execution } = await fixture({
      commandResult: (command, origin) =>
        command.method === "Profiler.takePreciseCoverage"
          ? {
              timestamp: 13,
              result: [
                {
                  scriptId: "script-a",
                  url: `${origin}/same.js`,
                  functions: [
                    {
                      functionName: "bad",
                      isBlockCoverage: true,
                      ranges: [
                        {
                          startOffset: 0,
                          endOffset: Buffer.byteLength(runtimeSourceA),
                          count: 1,
                        },
                      ],
                    },
                  ],
                },
              ],
            }
          : undefined,
    });
    const result = await provider.observeExecution(execution);
    if (result.ok)
      throw new Error("Byte offsets must not be mislabeled UTF-16");
    expect(result.error._tag).toBe("AnalysisOutputError");
  });
});

describe("runtime document identity and authorization failures", () => {
  it.each(["execution", "listeners"] as const)(
    "rejects newly reported loader identity for %s when the initial loader was unknown",
    async (action) => {
      const { provider, execution, listeners } = await fixture({
        commandResult: (command, origin, frameReads) =>
          command.method === "Page.getFrameTree"
            ? {
                frameTree: {
                  frame: {
                    id: "runtime-main",
                    url: `${origin}/allowed`,
                    ...(frameReads === 1 ? {} : { loaderId: "new-document" }),
                  },
                },
              }
            : undefined,
      });
      const result =
        action === "execution"
          ? await provider.observeExecution(execution)
          : await provider.inspectEventListeners(listeners);
      if (result.ok)
        throw new Error(
          "Unknown loader must not accept a newly reported document identity",
        );
      expect(result.error).toMatchObject({ reason: "target_changed" });
    },
  );

  it.each(["execution", "listeners"] as const)(
    "reports the selected %s operation when the live frame origin is denied",
    async (action) => {
      const { provider, execution, listeners } = await fixture({
        commandResult: (command) =>
          command.method === "Page.getFrameTree"
            ? {
                frameTree: {
                  frame: {
                    id: "runtime-main",
                    url: "https://unselected.example/document",
                    loaderId: "denied",
                  },
                },
              }
            : undefined,
      });
      const result =
        action === "execution"
          ? await provider.observeExecution(execution)
          : await provider.inspectEventListeners(listeners);
      if (result.ok) throw new Error("Unselected live origin must be denied");
      expect(result.error).toMatchObject({
        reason: "target_not_allowed",
        operation:
          action === "execution"
            ? "observe_web_execution"
            : "inspect_web_event_listeners",
      });
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "target_unavailable",
        message: expect.stringContaining("permitted HTTP(S) origin scope"),
        remediation: { action: expect.stringContaining("allowed_origins") },
      });
    },
  );

  it("keeps runtime document-scope recovery when the producer retains the same document identity", async () => {
    const { provider, listeners } = await fixture({
      commandResult: ({ method }, origin, frameReads) =>
        method === "Page.getFrameTree"
          ? {
              frameTree: {
                frame: {
                  id: "runtime-main",
                  loaderId: "document-1",
                  url:
                    frameReads === 1
                      ? origin + "/app"
                      : "https://outside.example/page",
                },
              },
            }
          : undefined,
    });
    const result = await provider.inspectEventListeners(listeners);
    if (result.ok) throw new Error("Expected runtime document-scope refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "target_unavailable",
      message: expect.stringContaining("moved to an unselected origin"),
      remediation: { action: expect.stringContaining("allowed_origins") },
      details: {
        operation: "inspect_web_event_listeners",
        reason: "target_not_allowed",
      },
    });
  });
});
