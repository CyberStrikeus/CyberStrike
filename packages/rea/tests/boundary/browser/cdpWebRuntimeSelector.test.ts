import { expect, it, onTestFinished } from "vitest";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import { inspectWebEventListenersInputSchema } from "../../../src/domain/webEventListeners.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";

it.each([
  {
    code: -32000,
    message: "DOM Error while querying",
    expected: "AnalysisInputError",
  },
  {
    code: -32000,
    message: "Could not find node with given id",
    expected: "BrowserObservationError",
  },
  {
    code: -32601,
    message: "Method not found",
    expected: "BrowserObservationError",
  },
])(
  "classifies the actual selector rejection $message",
  async ({ code, message, expected }) => {
    const browser = await startRuntimeBrowser({
      commandError: ({ method }) =>
        method === "DOM.querySelector" ? { code, message } : undefined,
    });
    onTestFinished(() => browser.close());
    const result = await new CdpWebRuntimeProvider().inspectEventListeners(
      inspectWebEventListenersInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        selector: "[",
      }),
    );
    if (result.ok)
      throw new Error("Rejected selectors cannot produce listener evidence");
    expect(result.error._tag).toBe(expected);
    expect(result.error.cleanupIncomplete).toBe(false);
    if (result.error._tag === "AnalysisInputError")
      expect(result.error.message).toContain("inspect_web_event_listeners");
  },
);
