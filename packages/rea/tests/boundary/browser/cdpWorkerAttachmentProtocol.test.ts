import { expect, it } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

it.each(["omitted", "null"] as const)(
  "excludes TargetInfo workers with %s required attached state",
  async (attachmentState) => {
    const browser = await startFakeCdpBrowser({
      commandResult: (command, origin) => {
        if (command.method !== "Target.getTargets") return undefined;
        return {
          targetInfos: [
            {
              targetId: "worker-1",
              type: "service_worker",
              url: `${origin}/worker.js`,
              openerId: "allowed-page",
              ...(attachmentState === "null" ? { attached: null } : {}),
            },
          ],
        };
      },
    });
    try {
      const result = await new CdpBrowserProvider().inspectPage(
        inspectWebPageInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          allowed_origins: [browser.allowedOrigin],
          target_id: "allowed-page",
          observation_ms: 0,
        }),
      );
      if (!result.ok) throw result.error;
      expect(result.value.workers).toEqual([]);
      expect(result.value.completeness.excluded).toContainEqual({
        section: "workers",
        reason: "invalid_protocol_value",
        count: 1,
      });
    } finally {
      await browser.close();
    }
  },
);
