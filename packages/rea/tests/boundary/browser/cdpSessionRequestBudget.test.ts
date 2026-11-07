import { expect, it, onTestFinished, vi } from "vitest";
import { CdpConnection } from "../../../src/browser/CdpConnection.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { observeWebSessionInputSchema } from "../../../src/domain/browserSession.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

// Scale only the existing retained-event allowance to exercise refusal without
// allocating megabytes. The real HTTP/WebSocket owner and producer parser run.
vi.mock("../../../src/domain/webRuntime.js", async (importOriginal) => {
  const domain =
    await importOriginal<typeof import("../../../src/domain/webRuntime.js")>();
  return {
    ...domain,
    WEB_RUNTIME_LIMITS: {
      ...domain.WEB_RUNTIME_LIMITS,
      retainedEventBytes: 128,
    },
  };
});

it.each([1, 2])(
  "refuses active document identity retention at progress stage %s before reporting a complete session",
  async (stage) => {
    let received: () => void = () => {};
    const delivered = new Promise<void>((resolve) => {
      received = resolve;
    });
    const onEvent = CdpConnection.prototype.onEvent;
    const delivery = vi
      .spyOn(CdpConnection.prototype, "onEvent")
      .mockImplementation(function (this: CdpConnection, listener) {
        return onEvent.call(this, (event) => {
          listener(event);
          if (event.method === "Network.requestWillBeSent") received();
        });
      });
    const browser = await startFakeCdpBrowser({ commandEvents: () => [] });
    const provider = new CdpBrowserProvider();
    onTestFinished(async () => {
      delivery.mockRestore();
      await provider.close();
      await browser.close();
    });
    const result = await provider.observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        allowed_origins: [browser.allowedOrigin],
        observation_ms: 5,
      }),
      {
        signal: AbortSignal.timeout(2_000),
        progress: {
          report: async (update) => {
            if (update.completed === stage) {
              browser.emitEvent({
                method: "Network.requestWillBeSent",
                sessionId: "session-1",
                params: {
                  requestId: "r".repeat(128),
                  type: "Document",
                  frameId: "frame-main",
                  loaderId: "loader",
                  timestamp: 100,
                  request: {
                    url: `${browser.allowedOrigin}/page`,
                    method: "GET",
                  },
                },
              });
              // Observe actual parser/listener delivery before final progress resolves.
              await delivered;
            }
          },
        },
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "BrowserObservationError",
        reason: "payload_limit",
        detail: expect.stringContaining("Active document request identities"),
      },
    });
    expect(browser.commands.map(({ method }) => method)).toContain(
      "Target.detachFromTarget",
    );
  },
);
