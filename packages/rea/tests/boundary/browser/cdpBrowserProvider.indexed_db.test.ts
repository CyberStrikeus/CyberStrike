import { expect, it } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

it.each([false, true])(
  "captures object-store records with Date keys: %s",
  async (dateKeys) => {
    const browser = await startFakeCdpBrowser({ indexedDbDateKeys: dateKeys });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
        include_storage_keys: true,
        include_storage_fingerprints: true,
      }),
    );
    if (!result.ok) throw result.error;

    const requests = browser.commands.filter(
      ({ method }) => method === "IndexedDB.requestData",
    );
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests)
      expect(request.params).not.toHaveProperty("indexName");
    const records = result.value.storage.content_fingerprints.filter(
      ({ scope }) => scope === "indexed_db_record",
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.complete).toBe(!dateKeys);
    expect(result.value.storage.fingerprints_complete).toBe(!dateKeys);
    expect(JSON.stringify(result.value.storage)).not.toContain(
      "indexed-db-secret",
    );
  },
);
