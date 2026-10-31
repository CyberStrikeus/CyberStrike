import { expect, it } from "vitest";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { observeWebSessionInputSchema } from "../../../src/domain/browserSession.js";
import { observeWebExecutionInputSchema } from "../../../src/domain/webExecution.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";
import type { FakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

const operations = ["inspect", "session", "runtime"] as const;
type Operation = (typeof operations)[number];
const run = async (
  browser: FakeCdpBrowser,
  operation: Operation,
  signal?: AbortSignal,
) => {
  const input = {
    cdp_endpoint: browser.endpoint,
    target_id: "allowed-page",
    allowed_origins: [browser.allowedOrigin],
    observation_ms: 1,
  };
  const options = signal === undefined ? {} : { signal };
  switch (operation) {
    case "inspect":
      return new CdpBrowserProvider().inspectPage(
        inspectWebPageInputSchema.parse(input),
        options,
      );
    case "session":
      return new CdpBrowserProvider().observeSession(
        observeWebSessionInputSchema.parse(input),
        options,
      );
    case "runtime":
      return new CdpWebRuntimeProvider().observeExecution(
        observeWebExecutionInputSchema.parse(input),
        options,
      );
  }
};

it.each(
  operations.flatMap((operation) =>
    ["about:blank", "about:srcdoc", "file:///local.html", "not a URL"].flatMap(
      (url) =>
        [7, "bad-fragment"].map((urlFragment) => ({
          operation,
          url,
          urlFragment,
        })),
    ),
  ),
)(
  "retries uncertain initial $url/$urlFragment before $operation authorizes",
  async ({ operation, url, urlFragment }) => {
    let reads = 0;
    const browser = await startRuntimeBrowser({
      commandResult: ({ method }) => {
        if (method !== "Page.getFrameTree" || ++reads > 2) return undefined;
        return {
          frameTree: { frame: { id: "runtime-main", url, urlFragment } },
        };
      },
    });
    trackBrowser(browser);
    const result = await run(browser, operation);
    expect(result.ok).toBe(true);
    expect(reads).toBeGreaterThan(2);
  },
);

it.each(
  operations.flatMap((operation) =>
    [false, true].flatMap((foreign) =>
      [7, "bad-fragment"].map((urlFragment) => ({
        operation,
        foreign,
        urlFragment,
      })),
    ),
  ),
)(
  "rejects known $foreign scope with malformed $urlFragment immediately for $operation",
  async ({ operation, foreign, urlFragment }) => {
    let reads = 0;
    const browser = await startRuntimeBrowser({
      commandResult: ({ method }, origin) => {
        if (method !== "Page.getFrameTree") return undefined;
        reads += 1;
        return {
          frameTree: {
            frame: {
              id: "runtime-main",
              url: foreign ? "https://foreign.example/page" : `${origin}/app`,
              urlFragment,
            },
          },
        };
      },
    });
    trackBrowser(browser);
    const result = await run(browser, operation);
    expect(result).toMatchObject({
      ok: false,
      error: { reason: foreign ? "target_not_allowed" : "protocol_error" },
    });
    if (foreign && !result.ok)
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "target_unavailable",
        message: expect.stringContaining("permitted HTTP(S) origin scope"),
        remediation: { action: expect.stringContaining("allowed_origins") },
        details: { reason: "target_not_allowed" },
      });
    expect(reads).toBe(1);
  },
);

it("bounds unsupported malformed frame retries without authorizing execution", async () => {
  let reads = 0;
  const browser = await startRuntimeBrowser({
    commandResult: ({ method }) => {
      if (method !== "Page.getFrameTree") return undefined;
      reads += 1;
      return {
        frameTree: {
          frame: { id: "runtime-main", url: "about:blank", urlFragment: 7 },
        },
      };
    },
  });
  trackBrowser(browser);
  const result = await run(browser, "runtime");
  expect(result).toMatchObject({
    ok: false,
    error: { reason: "target_not_allowed" },
  });
  if (result.ok) throw new Error("Expected unresolved frame refusal");
  expect(JSON.stringify(projectAnalysisError(result.error))).not.toContain(
    "outside the permitted HTTP(S) origin scope",
  );
  expect(reads).toBe(80);
  expect(browser.commands.map(({ method }) => method)).not.toContain(
    "Debugger.enable",
  );
});

it("preserves cancellation while an unsupported malformed frame awaits authorization", async () => {
  const controller = new AbortController();
  const browser = await startRuntimeBrowser({
    commandResult: ({ method }) => {
      if (method !== "Page.getFrameTree") return undefined;
      setTimeout(() => controller.abort("caller stopped authorization"), 5);
      return {
        frameTree: {
          frame: { id: "runtime-main", url: "about:blank", urlFragment: 7 },
        },
      };
    },
  });
  trackBrowser(browser);
  expect(await run(browser, "inspect", controller.signal)).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      cause: "caller stopped authorization",
    },
  });
  expect(
    browser.commands.filter(({ method }) => method === "Page.getFrameTree"),
  ).toHaveLength(1);
});

// Ordinary startup uncertainty and known policy exits keep their existing semantics.
it.each(
  operations.flatMap((operation) =>
    ["unsupported", "missing", "foreign"].map((kind) => ({ operation, kind })),
  ),
)(
  "preserves $kind authorization behavior for $operation",
  async ({ operation, kind }) => {
    let reads = 0;
    const browser = await startRuntimeBrowser({
      commandResult: ({ method }) => {
        if (method !== "Page.getFrameTree" || ++reads > 2) return undefined;
        return {
          frameTree: {
            frame: {
              id: "runtime-main",
              ...(kind === "missing"
                ? {}
                : {
                    url:
                      kind === "foreign"
                        ? "https://foreign.example/page"
                        : "about:blank",
                  }),
            },
          },
        };
      },
    });
    trackBrowser(browser);
    const result = await run(browser, operation);
    if (kind === "foreign") {
      expect(result).toMatchObject({
        ok: false,
        error: { reason: "target_not_allowed" },
      });
      expect(reads).toBe(1);
    } else {
      expect(result.ok).toBe(true);
      expect(reads).toBeGreaterThan(2);
    }
  },
);
