import { expect, it, onTestFinished } from "vitest";

import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { BrowserObservationError } from "../../../src/domain/browserObservationError.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

it("captures a page without aborting on a duplicate frame event", async () => {
  const browser = await startFakeCdpBrowser({ sessionTimeline: "same_origin" });
  onTestFinished(async () => {
    await browser.close();
  });
  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
    }),
  );
  expect(result.ok).toBe(true);
});

it("accepts child navigation when the frame-tree root has an identity", async () => {
  const browser = await startFakeCdpBrowser({
    eventsBeforeReply: ["Network.enable"],
    commandResult: (command, origin) =>
      command.method === "Page.getFrameTree"
        ? {
            frameTree: {
              frame: { id: "main", url: `${origin}/app` },
              childFrames: [
                {
                  frame: {
                    id: "child",
                    parentId: "main",
                    url: `${origin}/child`,
                  },
                },
              ],
            },
          }
        : undefined,
    commandEvents: (command, origin) =>
      command.method === "Network.enable"
        ? [
            {
              method: "Page.frameNavigated",
              sessionId: command.sessionId,
              params: {
                frame: {
                  id: "child",
                  parentId: "main",
                  url: `${origin}/child`,
                },
              },
            },
          ]
        : undefined,
  });
  const provider = new CdpBrowserProvider();
  try {
    const result = await provider.inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    expect(result.ok).toBe(true);
  } finally {
    await provider.close();
    await browser.close();
  }
});

it.each([false, true])(
  "requires the actual frame-tree root identity before observing (child event: %s)",
  async (navigateChild) => {
    const commands: string[] = [];
    const browser = await startFakeCdpBrowser({
      eventsBeforeReply: ["Network.enable"],
      commandResult: (command, origin) => {
        commands.push(command.method);
        if (command.method !== "Page.getFrameTree") return undefined;
        return {
          frameTree: {
            frame: { url: `${origin}/app` },
            childFrames: [
              {
                frame: {
                  id: "child",
                  parentId: "main",
                  url: `${origin}/child`,
                },
              },
            ],
          },
        };
      },
      commandEvents: (command, origin) =>
        navigateChild && command.method === "Network.enable"
          ? [
              {
                method: "Page.frameNavigated",
                sessionId: command.sessionId,
                params: {
                  frame: {
                    id: "child",
                    parentId: "main",
                    url: `${origin}/child`,
                  },
                },
              },
            ]
          : undefined,
    });
    const provider = new CdpBrowserProvider();
    try {
      const result = await provider.inspectPage(
        inspectWebPageInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          allowed_origins: [browser.allowedOrigin],
          target_id: "allowed-page",
          observation_ms: 0,
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(BrowserObservationError);
        expect(result.error).toMatchObject({ reason: "protocol_error" });
      }
      expect(commands).not.toContain("Network.enable");
      expect(commands).not.toContain("Runtime.enable");
      expect(commands).not.toContain("Debugger.enable");
    } finally {
      await provider.close();
      await browser.close();
    }
  },
);

it("does not promote a child when the final frame-tree root loses its identity", async () => {
  let reads = 0;
  const browser = await startFakeCdpBrowser({
    commandResult: (command, origin) => {
      if (command.method !== "Page.getFrameTree") return undefined;
      reads += 1;
      return {
        frameTree: {
          frame: {
            ...(reads === 1 ? { id: "main" } : {}),
            url: `${origin}/app`,
          },
          childFrames: [
            {
              frame: { id: "child", parentId: "main", url: `${origin}/child` },
            },
          ],
        },
      };
    },
  });
  const provider = new CdpBrowserProvider();
  try {
    const result = await provider.inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({ reason: "protocol_error" });
  } finally {
    await provider.close();
    await browser.close();
  }
});
