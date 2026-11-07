import { expect, it, onTestFinished } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { observeWebSessionInputSchema } from "../../../src/domain/browserSession.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

it.each(["Fetch", "Script"] as const)(
  "does not treat a %s redirect as leaving the observed page",
  async (type) => {
    const browser = await startFakeCdpBrowser({
      sessionTimeline: "outside_policy",
      sessionRedirectResourceType: type,
    });
    onTestFinished(async () => {
      await browser.close();
    });
    const result = await new CdpBrowserProvider().observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 1,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.window.end_reason).toBe("window_elapsed");
    expect(result.value.timeline.some(({ type }) => type === "redirect")).toBe(
      false,
    );
  },
);

it.each(["Document", undefined] as const)(
  "retains outside-origin scope rejection for %s redirect metadata",
  async (type) => {
    const browser = await startFakeCdpBrowser({
      sessionTimeline: "outside_policy",
      ...(type === undefined ? {} : { sessionRedirectResourceType: type }),
    });
    onTestFinished(async () => {
      await browser.close();
    });
    const result = await new CdpBrowserProvider().observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 1,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.window.end_reason).toBe("target_left_scope");
    expect(result.value.target.final_url).toBeNull();
    expect(result.value.timeline.some(({ type }) => type === "redirect")).toBe(
      true,
    );
  },
);

it("keeps final URL unknown when a redirect races the final frame-tree read", async () => {
  let frameTreeReads = 0;
  const browser = await startFakeCdpBrowser({
    eventsBeforeReply: ["Page.getFrameTree"],
    commandEvents: (command, origin) => {
      if (command.method !== "Page.getFrameTree") return undefined;
      frameTreeReads += 1;
      if (frameTreeReads !== 2 || command.sessionId === undefined)
        return undefined;
      return [
        {
          method: "Network.requestWillBeSent",
          sessionId: command.sessionId,
          params: {
            requestId: "late-main-document",
            type: "Document",
            frameId: "frame-main",
            request: {
              url: "https://private.example.test/redirected",
              method: "GET",
            },
            redirectResponse: { url: `${origin}/prior`, status: 302 },
          },
        },
      ];
    },
  });
  onTestFinished(async () => {
    await browser.close();
  });
  const result = await new CdpBrowserProvider().observeSession(
    observeWebSessionInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 1,
    }),
  );

  if (!result.ok) throw result.error;
  expect(result.value.window.end_reason).toBe("target_left_scope");
  expect(result.value.target.final_url).toBeNull();
  expect(result.value.timeline.at(-1)).toMatchObject({
    type: "redirect",
    url: null,
    destination_scope: "outside_policy",
  });
  expect(JSON.stringify(result.value)).not.toContain("private.example.test");
});

it("retains the approved URL returned by the final frame-tree read", async () => {
  const browser = await startFakeCdpBrowser();
  onTestFinished(async () => {
    await browser.close();
  });
  const result = await new CdpBrowserProvider().observeSession(
    observeWebSessionInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 1,
    }),
  );

  if (!result.ok) throw result.error;
  expect(result.value.window.end_reason).toBe("window_elapsed");
  expect(result.value.target.final_url).toBe(
    `${browser.allowedOrigin}/app?token=frame-secret`,
  );
});
