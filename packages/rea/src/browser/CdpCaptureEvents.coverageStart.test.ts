import { afterEach, expect, it, vi } from "vitest";
import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { CdpCaptureEvents } from "./CdpCaptureEvents.js";

afterEach(() => vi.useRealTimers());

it("starts each domain at its first event or enable acknowledgment, preserving events before the reply", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T00:00:00.000Z"));
  const events = new CdpCaptureEvents(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "page",
      allowed_origins: ["https://example.test"],
    }),
    new Set(["https://example.test"]),
  );
  events.beginAuthorizedFrame("main");
  vi.setSystemTime(new Date("2026-10-24T00:00:01.000Z"));
  events.ingest({
    method: "Network.loadingFinished",
    params: { requestId: "unobserved", encodedDataLength: 0 },
  });
  vi.setSystemTime(new Date("2026-10-24T00:00:02.000Z"));
  events.markDomainEnabled("Network");
  events.markDomainEnabled("Runtime");
  expect(events.coverageStartedAt("Network")).toBe("2026-10-24T00:00:01.000Z");
  expect(events.coverageStartedAt("Runtime")).toBe("2026-10-24T00:00:02.000Z");
});
