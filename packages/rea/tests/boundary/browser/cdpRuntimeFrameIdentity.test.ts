import { BrowserObservationError } from "../../../src/domain/browserObservationError.js";
import { expect, it } from "vitest";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import { observeWebExecutionInputSchema } from "../../../src/domain/webExecution.js";
import { inspectWebEventListenersInputSchema } from "../../../src/domain/webEventListeners.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";
import type { FakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

const actions = ["execution", "listeners"] as const;
const run = async (
  browser: FakeCdpBrowser,
  action: (typeof actions)[number],
) => {
  const provider = new CdpWebRuntimeProvider();
  const input = {
    cdp_endpoint: browser.endpoint,
    target_id: "allowed-page",
    allowed_origins: [browser.allowedOrigin],
  };
  return action === "execution"
    ? provider.observeExecution(
        observeWebExecutionInputSchema.parse({ ...input, observation_ms: 1 }),
      )
    : provider.inspectEventListeners(
        inspectWebEventListenersInputSchema.parse({
          ...input,
          selector: "#selected",
        }),
      );
};

it.each(
  actions.flatMap((action) =>
    [false, true].flatMap((loader) =>
      ["split", "clear", "inline", "credentials"].map((kind) => ({
        action,
        loader,
        kind,
      })),
    ),
  ),
)(
  "preserves full $kind frame identity in $action evidence with loader=$loader",
  async ({ action, loader, kind }) => {
    const browser = await startRuntimeBrowser({
      commandResult: ({ method }, origin) =>
        method === "Page.getFrameTree"
          ? {
              frameTree: {
                frame: {
                  id: "runtime-main",
                  ...(loader ? { loaderId: "document-1" } : {}),
                  url: `${kind === "credentials" ? origin.replace("://", "://user:password@") : origin}/app?caller=retained#old`,
                  ...(kind === "inline"
                    ? {}
                    : { urlFragment: kind === "clear" ? "" : "#details" }),
                },
              },
            }
          : undefined,
    });
    trackBrowser(browser);
    const result = await run(browser, action);
    if (!result.ok) throw result.error;
    expect(result.value.target).toMatchObject({
      initial_url: `${browser.allowedOrigin}/app?caller=retained${kind === "inline" ? "#old" : kind === "clear" ? "" : "#details"}`,
      origin: browser.allowedOrigin,
      loader_id: loader ? "document-1" : null,
    });
  },
);

const transitions = [
  { kind: "equivalent", loader: false, reason: null },
  { kind: "fragment-change", loader: false, reason: "target_changed" },
  { kind: "fragment-change", loader: true, reason: null },
  { kind: "malformed", loader: false, reason: "protocol_error" },
  { kind: "malformed", loader: true, reason: "protocol_error" },
  { kind: "foreign-malformed", loader: true, reason: "target_not_allowed" },
  { kind: "foreign-loader-change", loader: true, reason: "target_changed" },
  { kind: "foreign", loader: false, reason: "target_changed" },
  { kind: "foreign", loader: true, reason: "target_not_allowed" },
  { kind: "missing", loader: true, reason: "protocol_error" },
  { kind: "frame-change", loader: true, reason: "target_changed" },
  { kind: "loader-change", loader: true, reason: "target_changed" },
  { kind: "unsupported", loader: true, reason: "target_not_allowed" },
] as const;
it.each(
  actions.flatMap((action) => transitions.map((item) => ({ action, ...item }))),
)(
  "checks parsed $kind final identity in $action with loader=$loader",
  async ({ action, kind, loader, reason }) => {
    const browser = await startRuntimeBrowser({
      commandResult: ({ method }, origin, reads) => {
        if (method !== "Page.getFrameTree") return undefined;
        const changed = reads > 1;
        const url = `${origin}/app?caller=retained`;
        return {
          frameTree: {
            frame: {
              id:
                changed && kind === "frame-change"
                  ? "replacement"
                  : "runtime-main",
              ...(loader
                ? {
                    loaderId:
                      changed &&
                      (kind === "loader-change" ||
                        kind === "foreign-loader-change")
                        ? "replacement"
                        : "document-1",
                  }
                : {}),
              ...(changed && kind === "missing"
                ? {}
                : {
                    url:
                      changed &&
                      (kind === "foreign-malformed" ||
                        kind === "foreign" ||
                        kind === "foreign-loader-change")
                        ? "https://foreign.example/app"
                        : changed && kind === "unsupported"
                          ? "about:blank"
                          : changed && kind === "equivalent"
                            ? `${url}#details`
                            : url,
                  }),
              ...(changed && kind === "equivalent"
                ? {}
                : {
                    urlFragment:
                      changed &&
                      (kind === "malformed" || kind === "foreign-malformed")
                        ? 7
                        : changed && kind === "fragment-change"
                          ? "#changed"
                          : "#details",
                  }),
            },
          },
        };
      },
    });
    trackBrowser(browser);
    const result = await run(browser, action);
    if (reason === null) {
      if (!result.ok) throw result.error;
      expect(result.value.target.initial_url).toBe(
        `${browser.allowedOrigin}/app?caller=retained#details`,
      );
    } else {
      expect(result).toMatchObject({ ok: false, error: { reason } });
      if (kind === "foreign" && loader && !result.ok) {
        if (!(result.error instanceof BrowserObservationError))
          throw result.error;
        expect(result.error.detail).toBe(
          `Selected target allowed-page moved to an unselected origin during ${result.error.operation}.`,
        );
      }
    }
    const methods = browser.commands.map(({ method }) => method);
    expect(methods).toContain("Debugger.disable");
    expect(methods).toContain("Target.detachFromTarget");
  },
);
