import { expect, it } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

it("reports malformed child frame entries through the CDP boundary", async () => {
  const browser = await startFakeCdpBrowser({
    commandResult: (command, origin) =>
      command.method === "Page.getFrameTree"
        ? {
            frameTree: {
              frame: { id: "main", url: `${origin}/` },
              childFrames: [
                null,
                { frame: { id: "child", url: `${origin}/child` } },
              ],
            },
          }
        : undefined,
  });
  trackBrowser(browser);

  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
    }),
  );

  if (!result.ok) throw result.error;
  expect(result.value.frames.map(({ frame_id }) => frame_id)).toEqual([
    "main",
    "child",
  ]);
  expect(result.value.completeness.unavailable_sections).toContain("frames");
});

it("marks a missing resource frame tree incomplete through CDP", async () => {
  const browser = await startFakeCdpBrowser({
    commandResult: (command) =>
      command.method === "Page.getResourceTree" ? {} : undefined,
  });
  trackBrowser(browser);

  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
    }),
  );

  if (!result.ok) throw result.error;
  expect(result.value.resources).toEqual([]);
  expect(result.value.completeness.unavailable_sections).toContain("resources");
});
