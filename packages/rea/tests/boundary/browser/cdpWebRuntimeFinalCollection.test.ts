import { describe, expect, it, onTestFinished } from "vitest";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import type { CdpEvent } from "../../../src/browser/CdpConnection.js";
import { observeWebExecutionInputSchema } from "../../../src/domain/webExecution.js";
import { inspectWebEventListenersInputSchema } from "../../../src/domain/webEventListeners.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";

describe("runtime final collection boundaries", () => {
  it("retains a script parsed during the final resetting coverage command", async () => {
    let emitEvent: ((event: CdpEvent) => void) | undefined;
    const browser = await startRuntimeBrowser({
      commandResult: (command, origin) => {
        if (command.method === "Profiler.takePreciseCoverage") {
          emitEvent?.({
            method: "Debugger.scriptParsed",
            sessionId: "session-1",
            params: {
              scriptId: "late-script",
              url: `${origin}/late.js`,
              executionContextId: 1,
              executionContextAuxData: { frameId: "runtime-main" },
              startLine: 0,
              startColumn: 0,
              endLine: 0,
              endColumn: 1,
            },
          });
          return {
            timestamp: 12,
            result: [
              {
                scriptId: "late-script",
                url: `${origin}/late.js`,
                functions: [
                  {
                    functionName: "late",
                    isBlockCoverage: true,
                    ranges: [{ startOffset: 0, endOffset: 1, count: 1 }],
                  },
                ],
              },
            ],
          };
        }
        if (
          command.method === "Debugger.getScriptSource" &&
          command.params.scriptId === "late-script"
        )
          return { scriptSource: ";" };
        return undefined;
      },
    });
    emitEvent = browser.emitEvent;
    onTestFinished(() => browser.close());
    const result = await new CdpWebRuntimeProvider().observeExecution(
      observeWebExecutionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 5,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.coverage.scripts[0]).toMatchObject({
      script_id: "late-script",
      functions: [{ ranges: [{ count: 1, source_bounds: "verified" }] }],
    });
    expect(
      result.value.sources.find(({ script_id }) => script_id === "late-script")
        ?.source,
    ).toMatchObject({ state: "captured", text: ";" });
    expect(result.value.coverage.excluded_scripts).toBe(0);
  });

  it.each(["#selected", "#missing"])(
    "rejects known malformed source metadata during final listener assertion for %s",
    async (selector) => {
      let emitEvent: ((event: CdpEvent) => void) | undefined;
      const browser = await startRuntimeBrowser({
        commandResult: (command, _origin, reads) => {
          if (command.method === "Page.getFrameTree" && reads === 3)
            emitEvent?.({
              method: "Debugger.scriptParsed",
              sessionId: "session-1",
              params: {},
            });
          return undefined;
        },
      });
      emitEvent = browser.emitEvent;
      onTestFinished(() => browser.close());
      const result = await new CdpWebRuntimeProvider().inspectEventListeners(
        inspectWebEventListenersInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          target_id: "allowed-page",
          selector,
        }),
      );
      if (result.ok)
        throw new Error(
          "Known producer failure cannot return partial listener success",
        );
      expect(result.error._tag).toBe("AnalysisOutputError");
    },
  );
});

describe("runtime fatal protocol stream", () => {
  it.each(["{not-json", JSON.stringify({ method: 42 })])(
    "stops an armed command-free window on malformed wire data %s",
    async (message) => {
      const browser = await startRuntimeBrowser();
      onTestFinished(() => browser.close());
      const result = await new CdpWebRuntimeProvider().observeExecution(
        observeWebExecutionInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          target_id: "allowed-page",
          observation_ms: 2_147_483_647,
        }),
        {
          signal: AbortSignal.timeout(2_000),
          progress: {
            report: async (update) => {
              if (update.completed === 1) browser.emitRawMessage(message);
            },
          },
        },
      );
      if (result.ok)
        throw new Error(
          "Malformed wire data must not produce successful evidence",
        );
      expect(result.error).toMatchObject({
        cleanupIncomplete: true,
        diagnostics: {
          primary_error: {
            details: {
              reason: expect.stringMatching(/protocol|malformed/iu),
            },
          },
          cleanup_error: {
            details: {
              diagnostics: {
                previous_error: expect.stringMatching(/protocol|malformed/iu),
                cleanup_failures: expect.arrayContaining([
                  expect.stringMatching(/protocol|malformed/iu),
                ]),
              },
            },
          },
        },
      });
    },
  );
});
