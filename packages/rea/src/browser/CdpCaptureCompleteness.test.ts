import { describe, expect, it } from "vitest";

import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";

describe("CdpCaptureCompleteness", () => {
  it("reports attach-window limitations without claiming a complete history", () => {
    const capture = new CdpCaptureCompleteness([
      "network_requests",
      "console_events",
    ]);

    expect(capture.snapshot()).toMatchObject({
      status: "attach_limited",
      conditions: ["attach_limited"],
      attach_limited_sections: ["console_events", "network_requests"],
      excluded: [],
      dropped_events: { total: 0 },
    });
  });

  it("aggregates sparse exclusions and applies explicit status precedence", () => {
    const capture = new CdpCaptureCompleteness(["network_requests"]);
    capture.exclude("scripts", "disallowed_origin");
    capture.exclude("scripts", "disallowed_origin", 2);
    capture.exclude("storage_keys", "not_approved", null);
    capture.drop("console_events", 4);

    expect(capture.snapshot()).toMatchObject({
      status: "truncated",
      conditions: ["attach_limited", "policy_filtered", "truncated"],
      policy_filtered_sections: ["scripts", "storage_keys"],
      truncated_sections: ["console_events"],
      excluded: [
        { section: "scripts", reason: "disallowed_origin", count: 3 },
        { section: "storage_keys", reason: "not_approved", count: null },
      ],
      dropped_events: { console_events: 4, total: 4 },
    });
  });

  it("restores initial attach limitations when reused for a new capture", () => {
    const capture = new CdpCaptureCompleteness(["websocket_frames"]);
    capture.drop("scripts");
    capture.exclude("resources", "provider_unavailable", null);

    capture.reset();

    expect(capture.snapshot()).toMatchObject({
      status: "attach_limited",
      attach_limited_sections: ["websocket_frames"],
      unavailable_sections: [],
      excluded: [],
      dropped_events: { total: 0 },
    });
  });
});
