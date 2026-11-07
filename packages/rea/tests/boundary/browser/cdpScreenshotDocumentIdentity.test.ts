import { crc32 } from "node:zlib";
import { describe, expect, it, onTestFinished } from "vitest";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { captureWebScreenshotInputSchema } from "../../../src/domain/webScreenshot.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  startFakeCdpBrowser,
  type FakeOptions,
} from "../../fixtures/fakeCdpBrowser.js";
import { frameNavigated } from "./cdpBrowserProvider.support.js";

const captureWithFake = async (options: FakeOptions) => {
  const browser = await startFakeCdpBrowser(options);
  onTestFinished(() => browser.close());
  const result = await new CdpBrowserProvider().captureScreenshot(
    captureWebScreenshotInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
    }),
  );
  return { browser, result };
};

// These wire tests validate PNG headers; actual rendering has its own browser lane.
const screenshotData = (width: number, height: number) => {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  );
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return { data: bytes.toString("base64") };
};

const withCssViewport = (metrics: Readonly<Record<string, unknown>>) => ({
  ...metrics,
  cssVisualViewport: metrics.visualViewport,
});

describe("screenshot authorization during metrics reads", () => {
  it("explains current-document origin refusal without suggesting host installation repair", async () => {
    const { browser, result } = await captureWithFake({
      attachedFrameUrl: "https://outside.example.test/",
    });
    if (result.ok) throw new Error("Expected a scope refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "target_unavailable",
      message: expect.stringContaining(
        "outside the permitted HTTP(S) origin scope",
      ),
      remediation: { action: expect.stringContaining("allowed_origins") },
      details: { reason: "target_not_allowed" },
    });
    expect(
      browser.commands.some(
        ({ method }) => method === "Page.captureScreenshot",
      ),
    ).toBe(false);
  });
  it.each([
    { stage: 1, expectedCaptures: 0 },
    { stage: 2, expectedCaptures: 1 },
  ])(
    "stops capture after scope loss during metrics read $stage",
    async ({ stage, expectedCaptures }) => {
      let reads = 0;
      const { browser, result } = await captureWithFake({
        eventsBeforeReply: ["Page.getLayoutMetrics"],
        commandResult: ({ method }) =>
          method === "Page.getLayoutMetrics"
            ? withCssViewport({
                visualViewport: {
                  pageX: 0,
                  pageY: 0,
                  clientWidth: 2,
                  clientHeight: 2,
                  scale: 1,
                },
              })
            : undefined,
        commandEvents: (command) =>
          command.method === "Page.getLayoutMetrics" && ++reads === stage
            ? [
                frameNavigated(command, {
                  id: "frame-main",
                  loaderId: "outside-loader",
                  url: "https://outside.test/",
                }),
              ]
            : undefined,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { reason: "target_not_allowed" },
      });
      expect(
        browser.commands.filter(
          ({ method }) => method === "Page.captureScreenshot",
        ),
      ).toHaveLength(expectedCaptures);
      await expect.poll(() => browser.activeConnectionCount()).toBe(0);
    },
  );

  it.each(["navigation", "uncertain identity"])(
    "stops before the first screenshot after %s during metrics",
    async (change) => {
      const { browser, result } = await captureWithFake({
        eventsBeforeReply: ["Page.getLayoutMetrics"],
        commandEvents: (command, origin) =>
          command.method === "Page.getLayoutMetrics"
            ? [
                frameNavigated(
                  command,
                  change === "navigation"
                    ? {
                        id: "frame-main",
                        loaderId: "new-loader",
                        url: `${origin}/app`,
                      }
                    : {
                        id: "candidate-root",
                        parentId: "candidate-root",
                        url: `${origin}/app`,
                      },
                ),
              ]
            : undefined,
      });
      expect(result).toMatchObject({
        ok: false,
        error: {
          reason: change === "navigation" ? "target_changed" : "protocol_error",
        },
      });
      expect(
        browser.commands.some(
          ({ method }) => method === "Page.captureScreenshot",
        ),
      ).toBe(false);
    },
  );
});

describe("screenshot initial root identity", () => {
  it.each(
    [
      { label: "missing", identity: {} },
      { label: "wrong type", identity: { id: 7 } },
      { label: "empty", identity: { id: "" } },
      { label: "parented", identity: { id: "frame-main", parentId: "parent" } },
      {
        label: "malformed parent",
        identity: { id: "frame-main", parentId: null },
      },
      {
        label: "self parent",
        identity: { id: "frame-main", parentId: "frame-main" },
      },
    ].flatMap(({ label, identity }) =>
      [false, true].map((withChild) => ({ label, identity, withChild })),
    ),
  )(
    "rejects $label root identity without borrowing a child ($withChild)",
    async ({ identity, withChild }) => {
      const { browser, result } = await captureWithFake({
        commandResult: ({ method }, origin) =>
          method === "Page.getFrameTree"
            ? {
                frameTree: {
                  frame: { ...identity, url: origin + "/app" },
                  ...(withChild
                    ? {
                        childFrames: [
                          {
                            frame: {
                              id: "frame-child",
                              parentId: "frame-main",
                              url: origin + "/child",
                            },
                          },
                        ],
                      }
                    : {}),
                },
              }
            : undefined,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { reason: "protocol_error" },
      });
      if (result.ok) throw new Error("Expected malformed root refusal");
      const projection = projectAnalysisError(result.error);
      expect(projection.message).not.toContain(
        "outside the permitted HTTP(S) origin scope",
      );
      expect(projection.remediation.action).not.toContain("allowed_origins");
      expect(browser.commands.map(({ method }) => method)).not.toContain(
        "Page.getLayoutMetrics",
      );
      expect(browser.commands.map(({ method }) => method)).not.toContain(
        "Page.captureScreenshot",
      );
      await expect.poll(() => browser.activeConnectionCount()).toBe(0);
    },
  );

  it("retains a known foreign origin refusal when the root ID is malformed", async () => {
    const { browser, result } = await captureWithFake({
      commandResult: ({ method }) =>
        method === "Page.getFrameTree"
          ? {
              frameTree: {
                frame: { id: 7, url: "https://outside.example/page" },
              },
            }
          : undefined,
    });
    if (result.ok) throw new Error("Expected known origin refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      message: expect.stringContaining(
        "outside the permitted HTTP(S) origin scope",
      ),
      remediation: { action: expect.stringContaining("allowed_origins") },
      details: { reason: "target_not_allowed" },
    });
    expect(browser.commands.map(({ method }) => method)).not.toContain(
      "Page.captureScreenshot",
    );
  });
});

describe("screenshot viewport freshness", () => {
  it.each([
    { phase: "normal capture", stage: 2, imageSize: 4, captures: 1 },
    { phase: "before recovery", stage: 2, imageSize: 1, captures: 1 },
    { phase: "during recovery", stage: 3, imageSize: 1, captures: 2 },
  ])(
    "rejects viewport changes $phase",
    async ({ stage, imageSize, captures }) => {
      let reads = 0;
      const { browser, result } = await captureWithFake({
        commandResult: ({ method }) =>
          method === "Page.getLayoutMetrics"
            ? withCssViewport({
                visualViewport: {
                  pageX: 0,
                  pageY: ++reads >= stage ? 50 : 0,
                  clientWidth: 4,
                  clientHeight: 4,
                  scale: 1,
                },
              })
            : method === "Page.captureScreenshot"
              ? screenshotData(imageSize, imageSize)
              : undefined,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { reason: "target_changed" },
      });
      expect(
        browser.commands.filter(
          ({ method }) => method === "Page.captureScreenshot",
        ),
      ).toHaveLength(captures);
    },
  );

  it.each([
    { label: "resize", css: { clientWidth: 8 }, pixel: { clientWidth: 8 } },
    { label: "zoom", css: { scale: 2 }, pixel: { scale: 2 } },
    {
      label: "device pixel density",
      css: {},
      pixel: { clientWidth: 8, clientHeight: 8 },
    },
  ])(
    "rejects $label during recovery even when the image is large enough",
    async ({ css, pixel }) => {
      let reads = 0;
      let captures = 0;
      const base = {
        pageX: 0,
        pageY: 0,
        clientWidth: 4,
        clientHeight: 4,
        scale: 1,
      };
      const { result } = await captureWithFake({
        commandResult: ({ method }) => {
          if (method === "Page.getLayoutMetrics") {
            const changed = ++reads === 3;
            return {
              cssVisualViewport: { ...base, ...(changed ? css : {}) },
              visualViewport: { ...base, ...(changed ? pixel : {}) },
            };
          }
          return method === "Page.captureScreenshot"
            ? ++captures === 1
              ? screenshotData(1, 1)
              : screenshotData(16, 16)
            : undefined;
        },
      });
      expect(result).toMatchObject({
        ok: false,
        error: { reason: "target_changed" },
      });
      expect(captures).toBe(2);
    },
  );

  it.each([2, 3])("validates refreshed metrics read %s", async (stage) => {
    let reads = 0;
    const { browser, result } = await captureWithFake({
      commandResult: ({ method }) =>
        method === "Page.getLayoutMetrics"
          ? ++reads === stage
            ? {}
            : withCssViewport({
                visualViewport: {
                  pageX: 0,
                  pageY: 0,
                  clientWidth: 2,
                  clientHeight: 2,
                  scale: 1,
                },
              })
          : undefined,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "protocol_error" },
    });
    expect(
      browser.commands.filter(
        ({ method }) => method === "Page.captureScreenshot",
      ),
    ).toHaveLength(stage - 1);
  });
});

describe("screenshot visual viewport capture", () => {
  it("recovers a cropped surface using the reported viewport clip and page scale", async () => {
    let captures = 0;
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }) =>
        method === "Page.getLayoutMetrics"
          ? withCssViewport({
              visualViewport: {
                pageX: 12,
                pageY: 34,
                clientWidth: 640,
                clientHeight: 360,
                scale: 2,
              },
            })
          : method === "Page.captureScreenshot"
            ? ++captures === 1
              ? screenshotData(320, 180)
              : screenshotData(1280, 720)
            : undefined,
    });
    onTestFinished(async () => {
      await browser.close();
    });
    const result = await new CdpBrowserProvider().captureScreenshot(
      captureWebScreenshotInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
      }),
    );
    expect(result.ok).toBe(true);
    const layoutMetrics = browser.commands.findIndex(
      ({ method }) => method === "Page.getLayoutMetrics",
    );
    const screenshotIndex = browser.commands.findIndex(
      ({ method }) => method === "Page.captureScreenshot",
    );
    expect(layoutMetrics).toBeGreaterThanOrEqual(0);
    expect(screenshotIndex).toBeGreaterThan(layoutMetrics);
    const screenshots = browser.commands.filter(
      ({ method }) => method === "Page.captureScreenshot",
    );
    expect(screenshots).toHaveLength(2);
    expect(screenshots[0]?.params).toMatchObject({
      captureBeyondViewport: false,
    });
    expect(screenshots[0]?.params).not.toHaveProperty("clip");
    expect(screenshots[1]?.params).toMatchObject({
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 12, y: 34, width: 640, height: 360, scale: 2 },
    });
    if (!result.ok) throw result.error;
    expect(result.value.viewport).toEqual({ width: 1280, height: 720 });
  });
});

describe("screenshot CSS and device-pixel coordinates", () => {
  it("uses CSS clip coordinates when the reported viewport has twice as many device pixels", async () => {
    let captures = 0;
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }) =>
        method === "Page.getLayoutMetrics"
          ? {
              cssVisualViewport: {
                pageX: 12,
                pageY: 34,
                clientWidth: 640,
                clientHeight: 360,
                scale: 1,
              },
              visualViewport: {
                pageX: 24,
                pageY: 68,
                clientWidth: 1280,
                clientHeight: 720,
                scale: 1,
              },
            }
          : method === "Page.captureScreenshot"
            ? ++captures === 1
              ? screenshotData(800, 400)
              : screenshotData(1280, 720)
            : undefined,
    });
    onTestFinished(() => browser.close());
    const result = await new CdpBrowserProvider().captureScreenshot(
      captureWebScreenshotInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
      }),
    );
    expect(result.ok).toBe(true);
    const screenshots = browser.commands.filter(
      ({ method }) => method === "Page.captureScreenshot",
    );
    expect(screenshots).toHaveLength(2);
    expect(screenshots[1]?.params.clip).toEqual({
      x: 12,
      y: 34,
      width: 640,
      height: 360,
      scale: 1,
    });
  });
});

describe("screenshot surface compatibility", () => {
  it.each([
    {
      label: "scrollbars",
      width: 2033,
      height: 1521,
      imageWidth: 2048,
      imageHeight: 1536,
    },
    {
      label: "higher pixel density",
      width: 640,
      height: 360,
      imageWidth: 1280,
      imageHeight: 720,
    },
  ])(
    "preserves the original surface with $label",
    async ({ width, height, imageWidth, imageHeight }) => {
      const image = screenshotData(imageWidth, imageHeight);
      const browser = await startFakeCdpBrowser({
        commandResult: ({ method }) =>
          method === "Page.getLayoutMetrics"
            ? withCssViewport({
                visualViewport: {
                  pageX: 0,
                  pageY: 0,
                  clientWidth: width,
                  clientHeight: height,
                  scale: 1,
                },
              })
            : method === "Page.captureScreenshot"
              ? image
              : undefined,
      });
      onTestFinished(() => browser.close());
      const result = await new CdpBrowserProvider().captureScreenshot(
        captureWebScreenshotInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          allowed_origins: [browser.allowedOrigin],
          target_id: "allowed-page",
        }),
      );
      if (!result.ok) throw result.error;
      expect(result.value.viewport).toEqual({
        width: imageWidth,
        height: imageHeight,
      });
      expect(result.value.artifact.data_base64).toBe(image.data);
      expect(
        browser.commands.filter(
          ({ method }) => method === "Page.captureScreenshot",
        ),
      ).toHaveLength(1);
    },
  );

  it("refuses a clipped recovery that still omits visible content", async () => {
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }) =>
        method === "Page.getLayoutMetrics"
          ? withCssViewport({
              visualViewport: {
                pageX: 0,
                pageY: 0,
                clientWidth: 2,
                clientHeight: 2,
                scale: 1,
              },
            })
          : undefined,
    });
    onTestFinished(() => browser.close());
    const result = await new CdpBrowserProvider().captureScreenshot(
      captureWebScreenshotInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "protocol_error" },
    });
    expect(
      browser.commands.filter(
        ({ method }) => method === "Page.captureScreenshot",
      ),
    ).toHaveLength(2);
  });

  it("does not retry a cropped surface after the target leaves scope", async () => {
    const browser = await startFakeCdpBrowser({
      navigateDuringScreenshotUrl: "https://outside.test/",
      commandResult: ({ method }) =>
        method === "Page.getLayoutMetrics"
          ? withCssViewport({
              visualViewport: {
                pageX: 0,
                pageY: 0,
                clientWidth: 2,
                clientHeight: 2,
                scale: 1,
              },
            })
          : undefined,
    });
    onTestFinished(() => browser.close());
    const result = await new CdpBrowserProvider().captureScreenshot(
      captureWebScreenshotInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "target_not_allowed" },
    });
    expect(
      browser.commands.filter(
        ({ method }) => method === "Page.captureScreenshot",
      ),
    ).toHaveLength(1);
  });
});

describe("screenshot viewport protocol validation", () => {
  it.each([
    ["missing metrics", {}],
    [
      "non-numeric coordinates",
      {
        visualViewport: {
          pageX: "unknown",
          pageY: 0,
          clientWidth: 10,
          clientHeight: 10,
          scale: 1,
        },
      },
    ],
    [
      "non-finite coordinates",
      {
        visualViewport: {
          pageX: Number.POSITIVE_INFINITY,
          pageY: 0,
          clientWidth: 10,
          clientHeight: 10,
          scale: 1,
        },
      },
    ],
    [
      "non-positive dimensions",
      {
        visualViewport: {
          pageX: 0,
          pageY: 0,
          clientWidth: 0,
          clientHeight: 10,
          scale: 1,
        },
      },
    ],
    [
      "non-positive scale",
      {
        visualViewport: {
          pageX: 0,
          pageY: 0,
          clientWidth: 10,
          clientHeight: 10,
          scale: 0,
        },
      },
    ],
  ])("rejects %s before screenshot capture", async (_label, metrics) => {
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }) =>
        method === "Page.getLayoutMetrics"
          ? withCssViewport(metrics)
          : undefined,
    });
    onTestFinished(async () => {
      await browser.close();
    });
    const result = await new CdpBrowserProvider().captureScreenshot(
      captureWebScreenshotInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "protocol_error" },
    });
    expect(
      browser.commands.some(
        ({ method }) => method === "Page.captureScreenshot",
      ),
    ).toBe(false);
  });
});

describe("screenshot committed document identity", () => {
  it.each(["requested-only", "same-url-history"])(
    "accepts unchanged identity after %s",
    async (kind) => {
      const browser = await startFakeCdpBrowser({
        commandEvents: ({ method, sessionId }, origin) =>
          method !== "Page.captureScreenshot"
            ? undefined
            : [
                {
                  method:
                    kind === "requested-only"
                      ? "Page.frameRequestedNavigation"
                      : "Page.navigatedWithinDocument",
                  ...(sessionId === undefined ? {} : { sessionId }),
                  params: {
                    frameId: "frame-main",
                    url: `${origin}${kind === "requested-only" ? "/pending" : "/app?token=frame-secret"}`,
                    reason: "scriptInitiated",
                    disposition: "currentTab",
                    navigationType: "historyApi",
                  },
                },
              ],
      });
      onTestFinished(async () => browser.close());
      const result = await new CdpBrowserProvider().captureScreenshot(
        captureWebScreenshotInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          allowed_origins: [browser.allowedOrigin],
          target_id: "allowed-page",
        }),
      );
      expect(result.ok).toBe(true);
    },
  );

  it.each([
    ["missing screenshot data", {}],
    ["invalid base64 screenshot data", { data: "not base64%%%" }],
  ])("reports %s as a protocol error", async (_label, result) => {
    const { result: observation } = await captureWithFake({
      commandResult: ({ method }) =>
        method === "Page.captureScreenshot" ? result : undefined,
    });
    expect(observation).toMatchObject({
      ok: false,
      error: { reason: "protocol_error" },
    });
  });

  it.each([
    { offset: 8, value: 14 },
    { offset: 16, value: 0x8000_0000 },
    { offset: 20, value: 0x8000_0000 },
  ])("rejects invalid screenshot IHDR metadata", async ({ offset, value }) => {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv4sAAAAASUVORK5CYII=",
      "base64",
    );
    bytes.writeUInt32BE(value, offset);
    bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
    const { result } = await captureWithFake({
      commandResult: ({ method }) =>
        method === "Page.captureScreenshot"
          ? { data: bytes.toString("base64") }
          : undefined,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "protocol_error" },
    });
  });
  it.each(["loader-main", "loader-reloaded"])(
    "distinguishes %s for the same URL",
    async (screenshotDocumentLoader) => {
      const { result } = await captureWithFake({ screenshotDocumentLoader });
      if (screenshotDocumentLoader === "loader-main")
        expect(result.ok).toBe(true);
      else
        expect(result).toMatchObject({
          ok: false,
          error: { reason: "target_changed" },
        });
    },
  );

  it("defers an unidentifiable navigation failure until screenshot cleanup completes", async () => {
    const { browser, result } = await captureWithFake({
      commandEvents: (command) =>
        command.method === "Page.captureScreenshot"
          ? [
              {
                method: "Page.frameNavigated",
                ...(command.sessionId === undefined
                  ? {}
                  : { sessionId: command.sessionId }),
                params: undefined,
              },
            ]
          : undefined,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "protocol_error" },
    });
    await expect.poll(() => browser.activeConnectionCount()).toBe(0);
  });
});

describe("screenshot frame identity transitions", () => {
  it("does not recover a cropped image after uncertain root identity", async () => {
    const { browser, result } = await captureWithFake({
      commandResult: ({ method }) =>
        method === "Page.getLayoutMetrics"
          ? withCssViewport({
              visualViewport: {
                pageX: 0,
                pageY: 0,
                clientWidth: 2,
                clientHeight: 2,
                scale: 1,
              },
            })
          : undefined,
      commandEvents: (command, origin) =>
        command.method === "Page.captureScreenshot"
          ? [
              frameNavigated(command, {
                id: "candidate-root",
                parentId: "candidate-root",
                url: `${origin}/app`,
              }),
            ]
          : undefined,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "protocol_error" },
    });
    expect(
      browser.commands.filter(
        ({ method }) => method === "Page.captureScreenshot",
      ),
    ).toHaveLength(1);
  });

  it("rejects a self-parented root candidate as malformed identity", async () => {
    const { browser, result } = await captureWithFake({
      commandEvents: (command, origin) =>
        command.method === "Page.captureScreenshot"
          ? [
              frameNavigated(command, {
                id: "candidate-root",
                parentId: "candidate-root",
                url: `${origin}/app?token=frame-secret`,
              }),
            ]
          : undefined,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "protocol_error" },
    });
    await expect.poll(() => browser.activeConnectionCount()).toBe(0);
  });

  it("keeps a malformed known child as screenshot coverage", async () => {
    const { result } = await captureWithFake({
      commandEvents: (command) =>
        command.method === "Page.captureScreenshot"
          ? [
              frameNavigated(command, {
                id: 7,
                parentId: "frame-main",
                url: "https://outside.invalid/child",
              }),
            ]
          : undefined,
    });
    if (!result.ok) throw result.error;
    expect(result.value.completeness.excluded).toContainEqual(
      expect.objectContaining({
        section: "screenshot",
        reason: "invalid_protocol_value",
      }),
    );
  });

  it("detects a same-URL root replacement and scopes later events to its new identity", async () => {
    const { result } = await captureWithFake({
      eventsBeforeReply: ["Page.captureScreenshot"],
      commandEvents: (command, origin) =>
        command.method === "Page.captureScreenshot"
          ? [
              frameNavigated(command, {
                id: "replacement-main",
                loaderId: "loader-main",
                url: `${origin}/app?token=frame-secret`,
              }),
              {
                method: "Page.navigatedWithinDocument",
                ...(command.sessionId === undefined
                  ? {}
                  : { sessionId: command.sessionId }),
                params: {
                  frameId: "replacement-main",
                  url: "https://outside.invalid/path",
                },
              },
            ]
          : undefined,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "target_not_allowed" },
    });
  });
});

describe("screenshot navigation event applicability", () => {
  it("ignores non-navigation events with selected-frame or malformed parameters", async () => {
    const { result } = await captureWithFake({
      commandEvents: (command) =>
        command.method === "Page.captureScreenshot"
          ? [
              {
                method: "Runtime.consoleAPICalled",
                sessionId: command.sessionId,
                params: {
                  type: "log",
                  args: [],
                  executionContextId: 1,
                  timestamp: 1,
                },
              },
              {
                method: "Page.lifecycleEvent",
                sessionId: command.sessionId,
                params: {
                  frameId: "frame-main",
                  loaderId: "loader-main",
                  name: "DOMContentLoaded",
                  timestamp: 1,
                },
              },
              {
                method: "Runtime.consoleAPICalled",
                sessionId: command.sessionId,
                params: { frameId: "frame-main", args: "not-an-array" },
              },
            ]
          : undefined,
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    "Page.frameRequestedNavigation",
    "Page.navigatedWithinDocument",
  ] as const)("ignores a known non-main frame's %s event", async (method) => {
    const { result } = await captureWithFake({
      commandEvents: (command) =>
        command.method === "Page.captureScreenshot"
          ? [
              {
                method,
                sessionId: command.sessionId,
                params: {
                  frameId: "frame-child",
                  url: "https://outside.invalid/child",
                },
              },
            ]
          : undefined,
    });
    expect(result.ok).toBe(true);
  });
});

it.each(
  [7, "missing-hash"].flatMap((fragment) =>
    ["initial", "event", "final"].flatMap((phase) =>
      ["allowed", "foreign", "missing"].map((scope) => ({
        fragment,
        phase,
        scope,
      })),
    ),
  ),
)(
  "keeps malformed screenshot fragments distinct from scope exits: $phase/$scope/$fragment",
  async ({ fragment, phase, scope }) => {
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }, origin, reads) =>
        method === "Page.getFrameTree" &&
        (phase === "initial" || (phase === "final" && reads > 1))
          ? {
              frameTree: {
                frame: {
                  id: "frame-main",
                  loaderId: "loader-main",
                  ...(scope === "missing"
                    ? {}
                    : {
                        url:
                          scope === "foreign"
                            ? "https://foreign.test/"
                            : `${origin}/app?token=frame-secret`,
                      }),
                  urlFragment: fragment,
                },
              },
            }
          : undefined,
      commandEvents: ({ method, sessionId }, origin) =>
        phase === "event" && method === "Page.captureScreenshot"
          ? [
              {
                method: "Page.frameNavigated",
                ...(sessionId === undefined ? {} : { sessionId }),
                params: {
                  frame: {
                    id: "frame-main",
                    loaderId: "loader-main",
                    ...(scope === "missing"
                      ? {}
                      : {
                          url:
                            scope === "foreign"
                              ? "https://foreign.test/"
                              : `${origin}/app?token=frame-secret`,
                        }),
                    urlFragment: fragment,
                  },
                },
              },
            ]
          : undefined,
    });
    onTestFinished(async () => browser.close());
    const result = await new CdpBrowserProvider().captureScreenshot(
      captureWebScreenshotInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        reason: scope === "foreign" ? "target_not_allowed" : "protocol_error",
      },
    });
  },
);

it("retains a foreign base scope even when its fragment is malformed", async () => {
  const browser = await startFakeCdpBrowser({
    commandEvents: ({ method, sessionId }) =>
      method === "Page.captureScreenshot"
        ? [
            {
              method: "Page.frameNavigated",
              ...(sessionId === undefined ? {} : { sessionId }),
              params: {
                frame: {
                  id: "frame-main",
                  loaderId: "foreign",
                  url: "https://foreign.test/",
                  urlFragment: 7,
                },
              },
            },
          ]
        : undefined,
  });
  onTestFinished(async () => browser.close());
  const result = await new CdpBrowserProvider().captureScreenshot(
    captureWebScreenshotInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
    }),
  );
  expect(result).toMatchObject({
    ok: false,
    error: { reason: "target_not_allowed" },
  });
});

it.each([24, 32, "crc"])(
  "rejects incomplete or corrupt PNG IHDR: %s",
  async (kind) => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv4sAAAAASUVORK5CYII=",
      "base64",
    );
    if (kind === "crc") png[29] = (png[29] ?? 0) ^ 1;
    const bytes = typeof kind === "number" ? png.subarray(0, kind) : png;
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }) =>
        method === "Page.captureScreenshot"
          ? { data: bytes.toString("base64") }
          : undefined,
    });
    onTestFinished(async () => browser.close());
    const result = await new CdpBrowserProvider().captureScreenshot(
      captureWebScreenshotInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "protocol_error" },
    });
  },
);
