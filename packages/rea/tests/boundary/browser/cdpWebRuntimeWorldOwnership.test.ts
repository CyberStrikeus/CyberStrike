import { describe, expect, it, onTestFinished } from "vitest";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import { observeWebExecutionInputSchema } from "../../../src/domain/webExecution.js";
import { inspectWebEventListenersInputSchema } from "../../../src/domain/webEventListeners.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";

const unknownWorld = { frameId: "runtime-main" };
const defaultWorld = { ...unknownWorld, isDefault: true, type: "default" };
const isolatedWorld = { ...unknownWorld, isDefault: false, type: "isolated" };

describe("runtime execution world ownership", () => {
  it.each([
    { name: "isolated context", context: isolatedWorld, script: isolatedWorld },
    {
      name: "isolated script metadata",
      context: undefined,
      script: isolatedWorld,
    },
    { name: "unknown world", context: unknownWorld, script: unknownWorld },
    {
      name: "contradictory worlds",
      context: isolatedWorld,
      script: defaultWorld,
    },
    {
      name: "isolated script with default context",
      context: defaultWorld,
      script: isolatedWorld,
    },
    {
      name: "worker context",
      context: { ...unknownWorld, type: "worker" },
      script: unknownWorld,
    },
  ])(
    "does not attribute $name to website execution or listeners",
    async ({ context, script }) => {
      const browser = await startRuntimeBrowser({
        commandEvents: (command, origin) => {
          if (command.method === "Runtime.enable")
            return context === undefined
              ? []
              : [
                  {
                    sessionId: "session-1",
                    method: "Runtime.executionContextCreated",
                    params: {
                      context: {
                        id: 1,
                        origin,
                        name: "reported-world",
                        auxData: context,
                      },
                    },
                  },
                ];
          if (command.method === "Debugger.enable")
            return ["script-a", "script-b"].map((scriptId) => ({
              sessionId: "session-1",
              method: "Debugger.scriptParsed",
              params: {
                scriptId,
                url: `${origin}/same.js`,
                executionContextId: 1,
                executionContextAuxData: script,
                startLine: 0,
                startColumn: 0,
                endLine: 1,
                endColumn: 0,
              },
            }));
          return undefined;
        },
      });
      onTestFinished(() => browser.close());
      const provider = new CdpWebRuntimeProvider();
      const scope = {
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
      };
      const execution = await provider.observeExecution(
        observeWebExecutionInputSchema.parse({ ...scope, observation_ms: 5 }),
      );
      if (!execution.ok) throw execution.error;
      expect(execution.value.coverage.scripts).toEqual([]);
      expect(execution.value.coverage.excluded_scripts).toBe(3);
      expect(execution.value.script_inventory.main_document_scripts).toBe(0);
      const listeners = await provider.inspectEventListeners(
        inspectWebEventListenersInputSchema.parse({
          ...scope,
          selector: "#selected",
        }),
      );
      if (!listeners.ok) throw listeners.error;
      expect(listeners.value.listeners[0]?.location.source_association).toBe(
        "unknown",
      );
      expect(listeners.value.sources[0]).toMatchObject({
        source: { state: "excluded" },
      });
      expect(
        listeners.value.sources[0]?.reported_script_context_aux_data,
      ).toEqual(script);
      expect(listeners.value.sources[0]?.reported_execution_context).toEqual(
        context === undefined
          ? null
          : {
              id: 1,
              origin: new URL(browser.endpoint).origin,
              name: "reported-world",
              auxData: context,
            },
      );
      expect(
        browser.commands.filter(
          ({ method }) => method === "Debugger.getScriptSource",
        ),
      ).toEqual([]);
    },
  );
});
