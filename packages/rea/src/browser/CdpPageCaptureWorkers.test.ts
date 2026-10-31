import { describe, expect, it } from "vitest";

import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { CdpCaptureEvents } from "./CdpCaptureEvents.js";
import type { CdpConnection } from "./CdpConnection.js";
import type { CdpEndpointTarget } from "./CdpEndpoint.js";
import { captureWorkers } from "./CdpPageCaptureWorkers.js";
import type { CaptureContext } from "./CdpPageCapture.js";

const origin = "http://127.0.0.1:43127";

const capture = async (inventory: unknown, frameIds = new Set<string>()) => {
  const input = inspectWebPageInputSchema.parse({
    cdp_endpoint: origin,
    allowed_origins: [origin],
    target_id: "page",
  });
  const events = new CdpCaptureEvents(input, new Set([origin]));
  const context = {
    connection: {
      async send() {
        return inventory;
      },
    } as unknown as CdpConnection,
    sessionId: undefined,
    target: {
      id: "page",
      type: "page",
      title: "Fixture",
      url: `${origin}/index.html`,
      attached: false,
    } satisfies CdpEndpointTarget,
  } as unknown as CaptureContext;
  const workers = await captureWorkers(
    {
      context,
      allowedOrigins: new Set([origin]),
      limitations: [],
      events,
    },
    frameIds,
  );
  return { workers, completeness: events.completeness.snapshot() };
};

describe("web worker target inventory", () => {
  it.each([
    ["", "unattributed_origin"],
    ["https://outside.example/worker.js", "disallowed_origin"],
    ["file:///fixture/worker.js", "unsupported_url"],
  ])(
    "retains selected-worker URL exclusion evidence for %s",
    async (url, reason) => {
      const result = await capture({
        targetInfos: [
          {
            targetId: "worker",
            type: "worker",
            url,
            attached: false,
            openerId: "page",
          },
        ],
      });

      expect(result.workers).toEqual([]);
      expect(result.completeness.excluded).toContainEqual({
        section: "workers",
        reason,
        count: 1,
      });
    },
  );

  it("preserves an explicit empty inventory", async () => {
    const result = await capture({ targetInfos: [] });

    expect(result.workers).toEqual([]);
    expect(result.completeness.unavailable_sections).not.toContain("workers");
  });

  it.each([undefined, { length: 1 }])(
    "reports a missing or non-array target inventory as unknown: %s",
    async (targetInfos) => {
      const result = await capture({ targetInfos });

      expect(result.workers).toEqual([]);
      expect(result.completeness).toMatchObject({
        unavailable_sections: ["workers"],
        excluded: [
          {
            section: "workers",
            reason: "invalid_protocol_value",
            count: null,
          },
        ],
      });
    },
  );

  it("retains valid worker records beside malformed entries", async () => {
    const result = await capture({
      targetInfos: [
        null,
        {
          targetId: "worker-1",
          type: "service_worker",
          url: `${origin}/worker.js`,
          attached: true,
          openerId: "page",
        },
        {
          targetId: "worker-missing-url",
          type: "worker",
          attached: true,
          openerId: "another-page",
        },
        {
          type: "worker",
          url: `${origin}/missing-id.js`,
          attached: true,
          openerId: "page",
        },
        {
          targetId: "worker-invalid-attached",
          type: "worker",
          url: `${origin}/invalid-attached.js`,
          attached: "true",
          openerId: "page",
        },
        "malformed",
      ],
    });

    expect(result.workers.map((worker) => worker.target_id)).toEqual([
      "worker-1",
    ]);
    expect(result.completeness).toMatchObject({
      unavailable_sections: ["workers"],
      excluded: [
        {
          section: "workers",
          reason: "invalid_protocol_value",
          count: 5,
        },
      ],
    });
    expect(result.completeness.excluded).not.toContainEqual(
      expect.objectContaining({
        section: "workers",
        reason: "out_of_target_scope",
      }),
    );
  });
});

it.each([`${origin}/worker.js`, ""])(
  "keeps an unattributed worker unavailable rather than policy filtered: %s",
  async (url) => {
    const result = await capture({
      targetInfos: [
        { targetId: "worker", type: "worker", url, attached: false },
      ],
    });
    expect(result.workers).toEqual([]);
    expect(result.completeness).toMatchObject({
      status: "attach_limited",
      conditions: ["attach_limited"],
      unavailable_sections: ["workers"],
      policy_filtered_sections: [],
      excluded: [
        { section: "workers", reason: "unattributed_target", count: 1 },
      ],
    });
  },
);

it.each([{ openerId: "" }, { parentFrameId: null }])(
  "retains invalid supplied relationship coverage: %j",
  async (relationship) => {
    const result = await capture({
      targetInfos: [
        {
          targetId: "worker",
          type: "worker",
          url: `${origin}/worker.js`,
          attached: false,
          ...relationship,
        },
      ],
    });
    expect(result.workers).toEqual([]);
    expect(result.completeness).toMatchObject({
      unavailable_sections: ["workers"],
      policy_filtered_sections: [],
      excluded: [
        { section: "workers", reason: "invalid_protocol_value", count: 1 },
      ],
    });
  },
);

it.each([
  { type: undefined },
  { type: 7 },
  { type: "" },
  { targetId: "" },
  { url: undefined },
  { attached: null },
  { openerId: null },
  { parentFrameId: "" },
])(
  "reports malformed worker facts before ownership and URL policy: %j",
  async (override) => {
    const result = await capture({
      targetInfos: [
        {
          targetId: "worker",
          type: "worker",
          url: "https://outside.example/worker.js",
          attached: false,
          openerId: "foreign-page",
          ...override,
        },
      ],
    });
    expect(result.workers).toEqual([]);
    expect(result.completeness.excluded).toEqual([
      { section: "workers", reason: "invalid_protocol_value", count: 1 },
    ]);
  },
);

it("uses parsed frame relationships without treating valid non-workers as malformed", async () => {
  const result = await capture(
    {
      targetInfos: [
        { type: "page" },
        {
          targetId: "worker",
          type: "shared_worker",
          url: `${origin}/worker.js`,
          attached: false,
          openerId: "foreign-page",
          parentFrameId: "selected-frame",
        },
        {
          targetId: "foreign",
          type: "worker",
          url: `${origin}/foreign.js`,
          attached: true,
          parentFrameId: "foreign-frame",
        },
      ],
    },
    new Set(["selected-frame"]),
  );
  expect(result.workers).toEqual([
    {
      target_id: "worker",
      type: "shared_worker",
      url: `${origin}/worker.js`,
      origin,
      attached: false,
      opener_target_id: "foreign-page",
      parent_frame_id: "selected-frame",
    },
  ]);
  expect(result.completeness.excluded).toEqual([
    { section: "workers", reason: "out_of_target_scope", count: 1 },
  ]);
});
