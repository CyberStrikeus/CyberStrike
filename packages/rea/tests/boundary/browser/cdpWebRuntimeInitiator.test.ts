import { describe, expect, it, onTestFinished } from "vitest";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import { observeWebExecutionInputSchema } from "../../../src/domain/webExecution.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";

describe("runtime initiator URL representation", () => {
  it.each(["before", "after"])(
    "omits proven transport userinfo and preserves declared names with metadata %s the request",
    async (ordering) => {
      const browser = await startRuntimeBrowser();
      onTestFinished(() => browser.close());
      const resourceUrl =
        browser.endpoint.replace("http://", "http://transport:credential@") +
        "/resource.js?caller=value#fragment";
      const declaredUrl =
        browser.endpoint.replace("http://", "http://declared:label@") +
        "/declaration.js?caller=value#fragment";
      const metadata = (
        scriptId: string,
        url: string,
        hasSourceURL: boolean,
      ) => ({
        scriptId,
        url,
        hasSourceURL,
        executionContextId: 999,
        startLine: 0,
        startColumn: 0,
        endLine: 1,
        endColumn: 0,
      });
      const frames = [
        {
          scriptId: "resource-script",
          url: resourceUrl,
          functionName: "resource",
          lineNumber: 0,
          columnNumber: 0,
        },
        {
          scriptId: "declared-script",
          url: declaredUrl,
          functionName: "declared",
          lineNumber: 0,
          columnNumber: 0,
        },
      ];
      const initiator = {
        type: "script",
        url: resourceUrl,
        lineNumber: 0,
        producerExtension: { url: declaredUrl, opaque: "keep caller data" },
        stack: {
          description: "producer sync",
          callFrames: [frames[0]],
          parent: {
            description: "producer async",
            callFrames: [frames[1]],
            parentId: { id: "retained-parent" },
          },
        },
      };
      const result = await new CdpWebRuntimeProvider().observeExecution(
        observeWebExecutionInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          target_id: "allowed-page",
          observation_ms: 30,
        }),
        {
          progress: {
            report: async (update) => {
              if (update.completed !== 1) return;
              const scripts = () => {
                for (const params of [
                  metadata("resource-script", resourceUrl, false),
                  metadata("declared-script", declaredUrl, true),
                ])
                  browser.emitEvent({
                    method: "Debugger.scriptParsed",
                    params,
                    sessionId: "session-1",
                  });
              };
              if (ordering === "before") scripts();
              browser.emitEvent({
                method: "Network.requestWillBeSent",
                sessionId: "session-1",
                params: {
                  requestId: "request",
                  frameId: "runtime-main",
                  timestamp: 12,
                  request: {
                    url: `${browser.endpoint}/selected`,
                    method: "GET",
                  },
                  initiator,
                },
              });
              if (ordering === "after") scripts();
            },
          },
        },
      );
      if (!result.ok) throw result.error;
      const sanitized = `${browser.endpoint}/resource.js?caller=value#fragment`;
      expect(result.value.requests[0]?.reported_initiator).toEqual({
        ...initiator,
        url: sanitized,
        stack: {
          ...initiator.stack,
          callFrames: [{ ...frames[0], url: sanitized }],
        },
      });
      expect(result.value.requests[0]?.callsites.map(({ url }) => url)).toEqual(
        [sanitized, declaredUrl, sanitized],
      );
      expect(
        result.value.sources.find(
          ({ script_id }) => script_id === "resource-script",
        )?.url,
      ).toBe(sanitized);
      expect(
        result.value.sources.find(
          ({ script_id }) => script_id === "declared-script",
        )?.url,
      ).toBe(declaredUrl);
      expect(JSON.stringify(result.value)).not.toContain(
        "transport:credential@",
      );
      expect(JSON.stringify(result.value)).toContain("declared:label@");
    },
  );
});
