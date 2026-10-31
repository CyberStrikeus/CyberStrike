import { expect, it, onTestFinished } from "vitest";
import { WebRuntimeService } from "../../../src/application/WebRuntimeService.js";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { observeWebSessionInputSchema } from "../../../src/domain/browserSession.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  webExecutionSchema,
  webExecutionObservationSchema,
} from "../../../src/domain/webExecution.js";
import {
  webEventListenersSchema,
  webEventListenersObservationSchema,
} from "../../../src/domain/webEventListeners.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";
import { waitFor } from "./cdpBrowserProvider.support.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

it.each(["observe", "inspect"] as const)(
  "retains truthful %s facts after rejected cleanup and preserves the successful control",
  async (operation) => {
    let deny = false;
    const browser = await startRuntimeBrowser({
      commandError: (command) =>
        deny && command.method === "Page.disable"
          ? { code: -32000, message: "injected cleanup rejection" }
          : undefined,
    });
    const provider = new CdpWebRuntimeProvider();
    onTestFinished(async () => {
      await provider.close();
      await browser.close();
    });
    const service = new WebRuntimeService(provider);
    const input = { cdp_endpoint: browser.endpoint, target_id: "allowed-page" };
    const run = () =>
      operation === "observe"
        ? service.observe({ ...input, observation_ms: 5 })
        : service.inspect({ ...input, selector: "#missing" });
    const healthy = await run();
    if (!healthy.ok) throw healthy.error;
    const cleanup = (
      value: ReturnType<typeof parseEvidence>["normalized_result"],
    ) =>
      operation === "observe"
        ? webExecutionObservationSchema.parse(value).instrumentation.cleanup
        : webEventListenersObservationSchema.parse(value).cleanup;
    expect(cleanup(healthy.value.normalized_result)).toBe("confirmed");
    deny = true;
    const failed = await run();
    if (failed.ok) throw new Error("Rejected cleanup cannot be successful");
    expect(failed.error.cleanupIncomplete).toBe(true);
    const partial = parseEvidence(failed.error.partialObservation);
    expect(cleanup(partial.normalized_result)).toBe("unconfirmed");
    expect(
      (operation === "observe"
        ? webExecutionSchema
        : webEventListenersSchema
      ).safeParse(partial.normalized_result).success,
    ).toBe(false);
    expect(partial.normalized_result).toMatchObject(
      operation === "observe"
        ? {
            target: { target_id: "allowed-page" },
            coverage: { state: "captured" },
            sources: expect.any(Array),
          }
        : {
            target: { target_id: "allowed-page" },
            selected_node: { match: "not_found" },
            listeners: [],
          },
    );
    expect(JSON.stringify(failed.error.diagnostics)).toContain("Page.disable");
    expect(browser.commands.map(({ method }) => method)).toContain(
      "Target.detachFromTarget",
    );
    expect(browser.commands.map(({ method }) => method)).not.toContain(
      "Browser.close",
    );
    expect(browser.commands.map(({ method }) => method)).not.toContain(
      "Target.closeTarget",
    );
  },
);

it("classifies failures by their admitted document request and retires completed identities", async () => {
  const browser = await startFakeCdpBrowser();
  const provider = new CdpBrowserProvider();
  onTestFinished(async () => {
    await provider.close();
    await browser.close();
  });
  const result = await provider.observeSession(
    observeWebSessionInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 20,
    }),
    {
      progress: {
        report: async (update) => {
          if (update.completed !== 1) return;
          const request = (
            id: string | number,
            type: string,
            frameId: string,
            redirect = false,
          ) =>
            browser.emitEvent({
              method: "Network.requestWillBeSent",
              sessionId: "session-1",
              params: {
                requestId: id,
                type,
                frameId,
                loaderId: "observed-loader",
                request: {
                  url: `${browser.allowedOrigin}/destination`,
                  method: "GET",
                },
                timestamp: 100,
                ...(redirect
                  ? {
                      redirectResponse: {
                        url: `${browser.allowedOrigin}/prior`,
                        status: 302,
                      },
                    }
                  : {}),
              },
            });
          const fail = (id: string, type: string) =>
            browser.emitEvent({
              method: "Network.loadingFailed",
              sessionId: "session-1",
              params: {
                requestId: id,
                type,
                timestamp: 101,
                errorText: "net::ERR_CONNECTION_REFUSED",
              },
            });
          request("image", "Image", "frame-main");
          fail("image", "Image");
          request("child", "Document", "child-frame");
          fail("child", "Document");
          fail("unobserved", "Document");
          request(42, "Document", "frame-main");
          request("complete", "Document", "frame-main");
          browser.emitEvent({
            method: "Network.loadingFinished",
            sessionId: "session-1",
            params: { requestId: "complete", timestamp: 101 },
          });
          fail("complete", "Document");
          request("reused", "Document", "frame-main");
          request("reused", "Image", "frame-main");
          fail("reused", "Image");
          request("navigation", "Document", "frame-main", true);
          fail("navigation", "Document");
          fail("navigation", "Document");
        },
      },
    },
  );
  if (!result.ok) throw result.error;
  expect(
    result.value.timeline.map(({ type, request_id }) => [type, request_id]),
  ).toEqual([
    ["redirect", "navigation"],
    ["load_failed", "navigation"],
  ]);
  expect(result.value.completeness.excluded).toContainEqual({
    section: "timeline",
    reason: "invalid_protocol_value",
    count: 1,
  });
  expect(result.value.timeline[1]).toMatchObject({
    frame_id: "frame-main",
    loader_id: "observed-loader",
    detail: "net::ERR_CONNECTION_REFUSED",
  });
});

it.each([false, true])(
  "keeps cleanup facts truthful when cancellation arrives during finalization (rejected=$0)",
  async (reject) => {
    const controller = new AbortController();
    const reason = { stop: "during final cleanup" };
    const browser = await startRuntimeBrowser({
      commandError: (command) => {
        if (command.method !== "Page.disable") return undefined;
        controller.abort(reason);
        return reject
          ? { code: -32000, message: "injected cleanup rejection after abort" }
          : undefined;
      },
    });
    const provider = new CdpWebRuntimeProvider();
    onTestFinished(async () => {
      await provider.close();
      await browser.close();
    });
    const result = await new WebRuntimeService(provider).observe(
      {
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 5,
      },
      { signal: controller.signal },
    );
    if (result.ok)
      throw new Error("Finalization cancellation must be retained");
    const primary = result.error.cleanupPrimary ?? result.error;
    expect(primary).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect(primary.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(reject);
    const partial = parseEvidence(result.error.partialObservation);
    expect(
      webExecutionObservationSchema.parse(partial.normalized_result)
        .instrumentation.cleanup,
    ).toBe(reject ? "unconfirmed" : "confirmed");
    await waitFor(
      () => browser.activeConnectionCount() === 0,
      "Runtime transport did not close after finalization",
    );
  },
);
