import { describe, expect, it } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import type { WebPageInspection } from "../../../src/domain/browserObservationSchemas.js";
import { compareWebCaptures } from "../../../src/domain/webCaptureDiff.js";
import { compareWebCapturesInputSchema } from "../../../src/domain/webCaptureDiffSchemas.js";
import type { FakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import {
  startHttpComparisonBrowser,
  type HttpRequestObservation,
} from "../../fixtures/httpComparisonBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

const inspect = async (browser: FakeCdpBrowser): Promise<WebPageInspection> => {
  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
    }),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

const capturePair = async (
  before: readonly HttpRequestObservation[],
  after: readonly HttpRequestObservation[],
): Promise<readonly [WebPageInspection, WebPageInspection]> => {
  const fixture = await startHttpComparisonBrowser(before);
  trackBrowser(fixture.browser);
  const left = await inspect(fixture.browser);
  fixture.setRequests(after);
  return [left, await inspect(fixture.browser)];
};

const compareNetwork = (before: WebPageInspection, after: WebPageInspection) =>
  compareWebCaptures(
    compareWebCapturesInputSchema.parse({
      before: { inspection: before },
      after: { inspection: after },
    }),
  ).dimensions.network;

const response = {
  requestId: "request-before",
  status: 200,
  mimeType: "application/json",
} as const;

describe("HTTP comparison response coverage", () => {
  it("does not compare an unavailable byte count with a completed response", async () => {
    const [before, after] = await capturePair(
      [response],
      [{ ...response, requestId: "request-after", encodedDataLength: 100 }],
    );
    expect(before.network.requests[0]?.encoded_data_length).toBeNull();
    expect(after.network.requests[0]?.encoded_data_length).toBe(100);
    for (const [left, right] of [
      [before, after],
      [after, before],
    ] as const)
      expect(compareNetwork(left, right)).toMatchObject({
        status: "unknown",
        total_changes: 0,
        changes: [],
      });
  });

  it("does not treat an unobserved response as a changed response", async () => {
    const [before, after] = await capturePair(
      [{ requestId: "request-before" }],
      [{ ...response, encodedDataLength: 100 }],
    );
    expect(before.network.requests).toEqual([
      expect.objectContaining({
        status: null,
        mime_type: null,
        encoded_data_length: null,
      }),
    ]);
    for (const [left, right] of [
      [before, after],
      [after, before],
    ] as const)
      expect(compareNetwork(left, right)).toMatchObject({
        status: "unknown",
        total_changes: 0,
      });
  });

  it("retains observed status changes when response bytes are unavailable", async () => {
    const [before, after] = await capturePair(
      [response],
      [{ ...response, status: 500 }],
    );
    expect(compareNetwork(before, after)).toMatchObject({
      status: "unknown",
      total_changes: 0,
      changes: [],
    });
    // A finite imported inventory supplies correspondence; passive samples
    // alone cannot pair repeated same-URL transactions by transient CDP ID.
    markNetworkInventoriesComplete(before, after);
    expect(compareNetwork(before, after)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [expect.objectContaining({ change: "modified" })],
    });
  });

  it.each([
    { mimeType: "text/plain", encodedDataLength: 100 },
    { mimeType: "application/json", encodedDataLength: 200 },
  ])("retains observed response changes: %j", async (change) => {
    const [before, after] = await capturePair(
      [{ ...response, encodedDataLength: 100 }],
      [{ ...response, ...change }],
    );
    expect(compareNetwork(before, after)).toMatchObject({
      status: "unknown",
      total_changes: 0,
      changes: [],
    });
    markNetworkInventoriesComplete(before, after);
    expect(compareNetwork(before, after)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [expect.objectContaining({ change: "modified" })],
    });
  });
});

describe("HTTP comparison repeated request coverage", () => {
  it("does not assign missing evidence by request order or transient ID", async () => {
    const [before, after] = await capturePair(
      [
        { ...response, encodedDataLength: 100 },
        { ...response, requestId: "second-before" },
      ],
      [
        { ...response, requestId: "second-after", encodedDataLength: 200 },
        { ...response, requestId: "first-after", encodedDataLength: 100 },
      ],
    );
    expect(before.network.requests).toHaveLength(2);
    expect(after.network.requests).toHaveLength(2);
    expect(compareNetwork(before, after)).toMatchObject({
      status: "unknown",
      total_changes: 0,
    });
  });

  it("compares complete byte counts even when another field is incomplete", async () => {
    const [before, after] = await capturePair(
      [
        { ...response, encodedDataLength: 100 },
        { requestId: "second-before", encodedDataLength: 200 },
      ],
      [
        { requestId: "second-after", encodedDataLength: 300 },
        { ...response, requestId: "first-after", encodedDataLength: 100 },
      ],
    );
    expect(compareNetwork(before, after)).toMatchObject({
      status: "unknown",
      total_changes: 0,
      changes: [],
    });
    markNetworkInventoriesComplete(before, after);
    expect(compareNetwork(before, after)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [expect.objectContaining({ change: "modified" })],
    });
  });

  it("preserves the association between complete response fields", async () => {
    const [before, after] = await capturePair(
      [
        { ...response, encodedDataLength: 100 },
        {
          ...response,
          requestId: "second-before",
          status: 201,
          encodedDataLength: 200,
        },
      ],
      [
        { ...response, requestId: "first-after", encodedDataLength: 200 },
        {
          ...response,
          requestId: "second-after",
          status: 201,
          encodedDataLength: 100,
        },
      ],
    );
    expect(compareNetwork(before, after)).toMatchObject({
      status: "unknown",
      total_changes: 0,
      changes: [],
    });
    markNetworkInventoriesComplete(before, after);
    expect(compareNetwork(before, after)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [expect.objectContaining({ change: "modified" })],
    });
  });
});

it.each([
  {
    name: "a pending request in an empty inventory",
    before: [],
    after: [{ requestId: "pending" }],
  },
  {
    name: "a known request beside an existing pending request",
    before: [{ requestId: "pending" }],
    after: [
      { requestId: "pending" },
      {
        ...response,
        requestId: "new",
        path: "/api/new",
        encodedDataLength: 100,
      },
    ],
  },
])("preserves additions and removals of $name", async (observations) => {
  const [before, after] = await capturePair(
    observations.before,
    observations.after,
  );
  // Live CDP observations have attach-limited inventories. Their absence
  // remains unknown even when a request is seen in the other capture.
  for (const [left, right] of [
    [before, after],
    [after, before],
  ] as const)
    expect(compareNetwork(left, right)).toMatchObject({
      status: "unknown",
      total_changes: 0,
      changes: [],
    });

  // Project explicitly complete inventory coverage without changing the
  // producer's request facts; response fields remain independently unknown.
  markNetworkInventoriesComplete(before, after);
  for (const [left, right, change] of [
    [before, after, "added"],
    [after, before, "removed"],
  ] as const)
    expect(compareNetwork(left, right)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [expect.objectContaining({ change })],
    });
});

it("requires response field coverage even when capture sections are complete", async () => {
  const [before, after] = await capturePair(
    [response],
    [{ ...response, encodedDataLength: 100 }],
  );
  markNetworkInventoriesComplete(before, after);
  expect(compareNetwork(before, before).status).toBe("unknown");
  expect(compareNetwork(before, after).status).toBe("unknown");
  expect(compareNetwork(after, after).status).toBe("unchanged");
});

const markNetworkInventoriesComplete = (
  ...inspections: WebPageInspection[]
): void => {
  const sections = new Set([
    "network_requests",
    "websocket_connections",
    "websocket_frames",
  ]);
  for (const inspection of inspections)
    for (const key of [
      "policy_filtered_sections",
      "attach_limited_sections",
      "truncated_sections",
      "unavailable_sections",
    ] as const)
      inspection.completeness[key] = inspection.completeness[key].filter(
        (section) => !sections.has(section),
      );
};
