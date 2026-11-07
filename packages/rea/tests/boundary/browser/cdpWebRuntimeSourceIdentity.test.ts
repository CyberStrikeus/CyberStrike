import { expect, it, onTestFinished } from "vitest";
import type { CdpEvent } from "../../../src/browser/CdpConnection.js";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import { observeWebExecutionInputSchema } from "../../../src/domain/webExecution.js";
import { inspectWebEventListenersInputSchema } from "../../../src/domain/webEventListeners.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";

it("invalidates retained sources when their execution context is reused during another source read", async () => {
  let emit: ((event: CdpEvent) => void) | undefined;
  const browser = await startRuntimeBrowser({
    commandResult: (command, origin) => {
      if (
        command.method === "Debugger.getScriptSource" &&
        command.params.scriptId === "script-b"
      )
        emit?.({
          sessionId: "session-1",
          method: "Runtime.executionContextCreated",
          params: {
            context: {
              id: 1,
              uniqueId: "replacement-context",
              origin,
              name: "",
              auxData: {
                frameId: "runtime-main",
                isDefault: true,
                type: "default",
              },
            },
          },
        });
      return undefined;
    },
  });
  emit = browser.emitEvent;
  onTestFinished(() => browser.close());
  const result = await new CdpWebRuntimeProvider().observeExecution(
    observeWebExecutionInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      target_id: "allowed-page",
      observation_ms: 5,
    }),
  );
  if (!result.ok) throw result.error;
  expect(result.value.coverage.scripts).toEqual([]);
  expect(result.value.coverage.excluded_scripts).toBe(3);
  expect(result.value.script_inventory.main_document_scripts).toBe(0);
  for (const scriptId of ["script-a", "script-b"])
    expect(
      result.value.sources.find(({ script_id }) => script_id === scriptId),
    ).toMatchObject({ frame_id: null, source: { state: "excluded" } });
  expect(browser.commands.map(({ method }) => method)).toEqual(
    expect.arrayContaining([
      "Profiler.stopPreciseCoverage",
      "Target.detachFromTarget",
    ]),
  );
});

it.each(
  ["listeners", "execution"].flatMap((operation) =>
    ["source_read", "other_source_read", "final_assertion"].map((phase) => ({
      operation,
      phase,
    })),
  ),
)(
  "revalidates $operation joins when a known script changes at $phase",
  async ({ operation, phase }) => {
    let emit: ((event: CdpEvent) => void) | undefined;
    const browser = await startRuntimeBrowser({
      commandResult: (command, origin, reads) => {
        if (
          (phase === "source_read" &&
            command.method === "Debugger.getScriptSource" &&
            command.params.scriptId === "script-a") ||
          (phase === "other_source_read" &&
            command.method === "Debugger.getScriptSource" &&
            command.params.scriptId === "script-b") ||
          (phase === "final_assertion" &&
            command.method === "Page.getFrameTree" &&
            reads === (operation === "listeners" ? 3 : 4))
        )
          emit?.({
            sessionId: "session-1",
            method: "Debugger.scriptParsed",
            params: {
              scriptId: "script-a",
              url: `${origin}/changed.js`,
              executionContextId: 1,
              executionContextAuxData: { frameId: "runtime-main" },
              startLine: 0,
              startColumn: 0,
              endLine: 1,
              endColumn: 0,
              hash: "changed-producer-hash",
              hasSourceURL: true,
              scriptLanguage: "JavaScript",
            },
          });
        if (command.method === "DOMDebugger.getEventListeners")
          return {
            listeners: ["script-a", "script-b"].map((scriptId) => ({
              type: "click",
              useCapture: false,
              passive: true,
              once: false,
              scriptId,
              lineNumber: 0,
              columnNumber: 0,
            })),
          };
        return undefined;
      },
    });
    emit = browser.emitEvent;
    onTestFinished(() => browser.close());
    const provider = new CdpWebRuntimeProvider();
    const scope = { cdp_endpoint: browser.endpoint, target_id: "allowed-page" };
    if (operation === "listeners") {
      const result = await provider.inspectEventListeners(
        inspectWebEventListenersInputSchema.parse({
          ...scope,
          selector: "#selected",
        }),
      );
      if (!result.ok) throw result.error;
      expect(result.value.listeners[0]?.location.source_association).toBe(
        "unknown",
      );
      expect(result.value.sources[0]).toMatchObject({
        frame_id: null,
        source: { state: "excluded" },
      });
    } else {
      const result = await provider.observeExecution(
        observeWebExecutionInputSchema.parse({
          ...scope,
          // This fixture sends a real WebSocket event after the armed receipt.
          // Leave room for transport delivery on a shared CI runner.
          observation_ms: 100,
        }),
        {
          progress: {
            report: async (update) => {
              if (update.completed !== 1) return;
              browser.emitEvent({
                sessionId: "session-1",
                method: "Network.requestWillBeSent",
                params: {
                  requestId: "source-completion-request",
                  frameId: "runtime-main",
                  timestamp: 12,
                  request: {
                    url: `${new URL(browser.endpoint).origin}/selected`,
                    method: "GET",
                  },
                  initiator: {
                    type: "script",
                    stack: {
                      callFrames: [
                        {
                          scriptId: "script-a",
                          url: `${new URL(browser.endpoint).origin}/same.js`,
                          lineNumber: 0,
                          columnNumber: 0,
                          functionName: "selected",
                        },
                      ],
                    },
                  },
                },
              });
            },
          },
        },
      );
      if (!result.ok) throw result.error;
      expect(
        result.value.coverage.scripts.some(
          ({ script_id }) => script_id === "script-a",
        ),
      ).toBe(false);
      expect(result.value.window.end_reason).toBe("window_elapsed");
      expect(result.value.requests).toContainEqual(
        expect.objectContaining({
          request_id: "source-completion-request",
          callsites: expect.arrayContaining([
            expect.objectContaining({
              script_id: "script-a",
              source_association: "unknown",
            }),
          ]),
        }),
      );
      expect(result.value.script_inventory.main_document_scripts).toBe(1);
      expect(
        result.value.sources.find(({ script_id }) => script_id === "script-a"),
      ).toMatchObject({ frame_id: null, source: { state: "excluded" } });
    }
  },
);
