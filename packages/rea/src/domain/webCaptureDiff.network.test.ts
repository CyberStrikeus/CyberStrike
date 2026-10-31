import { describe, expect, it } from "vitest";

import {
  passiveNetworkCapture,
  withPassiveDroppedEvents,
} from "../../tests/fixtures/passiveNetworkCapture.js";
import {
  browserCaptureComparisonInputSchema,
  compareBrowserCaptures,
} from "./browserCaptureComparison.js";
import type { WebPageInspection } from "./browserObservationSchemas.js";
import { webCaptureDiffSchema } from "./webCaptureDiffSchemas.js";

const compare = (before: WebPageInspection, after: WebPageInspection) =>
  webCaptureDiffSchema.parse(
    compareBrowserCaptures(
      browserCaptureComparisonInputSchema.parse({
        before: { inspection: before },
        after: { inspection: after },
      }),
    ),
  ).dimensions.network;

const unselectedShapes = (capture: WebPageInspection): WebPageInspection => {
  capture.completeness.excluded.push({
    section: "json_body_shapes",
    reason: "not_approved",
    count: null,
  });
  for (const request of capture.network.requests)
    request.body_shapes.status = "not_approved";
  return capture;
};

const redirectCapture = (resourceType: string | null): WebPageInspection => {
  const capture = unselectedShapes(passiveNetworkCapture());
  capture.network.requests[0]!.redirects = [
    {
      url: "https://app.example.test/start",
      response_url: "https://app.example.test/start",
      method: "GET",
      resource_type: resourceType,
      status: 302,
      mime_type: "text/html",
      encoded_data_length: 20,
      request_timestamp: 1,
      redirect_event_timestamp: 2,
    },
  ];
  return capture;
};

describe("nullable redirect resource types", () => {
  it.each([true, false])(
    "retains uncertainty when a redirect type is omitted (reversed=%s)",
    (reversed) => {
      const before = redirectCapture("Document");
      const after = structuredClone(before);
      after.network.requests[0]!.redirects![0]!.resource_type = null;
      const [left, right] = reversed
        ? ([after, before] as const)
        : ([before, after] as const);
      expect(compare(left, right)).toMatchObject({
        status: "unknown",
        total_changes: 0,
        changes: [],
      });
    },
  );

  it.each(["Document", "Fetch"])(
    "keeps a known redirect type %s comparable",
    (resourceType) => {
      const before = redirectCapture("Document");
      const after = structuredClone(before);
      after.network.requests[0]!.redirects![0]!.resource_type = resourceType;
      expect(compare(before, after)).toMatchObject({
        status: resourceType === "Document" ? "unchanged" : "changed",
        total_changes: resourceType === "Document" ? 0 : 1,
      });
    },
  );

  it("retains proven HTTP membership with incomplete redirect metadata", () => {
    const before = unselectedShapes(passiveNetworkCapture([]));
    const after = redirectCapture(null);
    expect(compare(before, after)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [{ change: "added" }],
    });
  });
});

describe("passive network inventory changes", () => {
  it.each(["websocket_connections", "websocket_frames"] as const)(
    "does not infer duplicate WebSocket inventory changes from dropped %s",
    (kind) => {
      const before = unselectedShapes(passiveNetworkCapture());
      before.network.websocket_connections = [
        {
          request_id: "ws-one",
          url: "wss://app.example.test/live",
          events: [],
        },
      ];
      const after = structuredClone(before);
      after.network.websocket_connections.push({
        request_id: "ws-two",
        url: "wss://app.example.test/live",
        events: [],
      });
      const limited = withPassiveDroppedEvents(before, { [kind]: 1 });
      for (const [left, right] of [
        [limited, after],
        [after, limited],
      ] as const)
        expect(compare(left, right)).toMatchObject({
          status: "unknown",
          total_changes: 0,
          changes: [],
        });
      expect(compare(before, after)).toMatchObject({
        status: "changed",
        total_changes: 1,
        changes: [{ change: "modified" }],
      });
    },
  );

  it.each(["dropped", "truncated", "unavailable"] as const)(
    "does not infer repeated-request count changes from %s HTTP inventory",
    (limitation) => {
      const after = unselectedShapes(passiveNetworkCapture(["/a", "/a"]));
      let before = unselectedShapes(passiveNetworkCapture());
      if (limitation === "dropped")
        before = withPassiveDroppedEvents(before, { network_requests: 1 });
      else if (limitation === "truncated")
        before.completeness.truncated_sections.push("network_requests");
      else before.completeness.unavailable_sections.push("network_requests");
      for (const [left, right] of [
        [before, after],
        [after, before],
      ] as const)
        expect(compare(left, right)).toMatchObject({
          status: "unknown",
          total_changes: 0,
          changes: [],
        });
    },
  );

  it.each(["unavailable", "partial", "truncated"] as const)(
    "retains complete request additions/removals with %s selected shapes",
    (coverage) => {
      const before = passiveNetworkCapture(["/a"]);
      const after = passiveNetworkCapture(["/a", "/b"]);
      for (const capture of [before, after]) {
        if (coverage === "truncated")
          capture.completeness.truncated_sections.push("json_body_shapes");
        else capture.completeness.unavailable_sections.push("json_body_shapes");
        for (const request of capture.network.requests) {
          const shape = {
            root_type: "object" as const,
            node_count: 1,
            max_depth_observed: 0,
            properties: [],
          };
          if (coverage !== "unavailable") request.body_shapes.request = shape;
          if (coverage === "truncated") request.body_shapes.response = shape;
          request.body_shapes.status =
            coverage === "truncated" ? "included" : coverage;
        }
      }
      for (const [left, right, change] of [
        [before, after, "added"],
        [after, before, "removed"],
      ] as const)
        expect(compare(left, right)).toEqual({
          status: "changed",
          total_changes: 1,
          changes: [{ identity: expect.stringMatching(/^net_/u), change }],
          reason: null,
        });
      expect(compare(after, after)).toMatchObject({
        status: "unknown",
        total_changes: 0,
      });
    },
  );

  it("keeps request absence proof independent of WebSocket inventory and response metadata", () => {
    const before = passiveNetworkCapture([]);
    const after = passiveNetworkCapture(["/added"]);
    for (const capture of [before, after]) {
      capture.completeness.attach_limited_sections.push(
        "websocket_connections",
        "websocket_frames",
      );
      for (const request of capture.network.requests) {
        request.status = null;
        request.mime_type = null;
        request.encoded_data_length = null;
      }
    }
    for (const [left, right, change] of [
      [before, after, "added"],
      [after, before, "removed"],
    ] as const)
      expect(compare(left, right)).toMatchObject({
        status: "changed",
        total_changes: 1,
        changes: [{ change }],
      });
    expect(compare(after, after)).toMatchObject({
      status: "unknown",
      total_changes: 0,
    });
  });
});

describe("unknown WebSocket opcode evidence", () => {
  const captureWithWebSocketFrames = (
    events: WebPageInspection["network"]["websocket_connections"][number]["events"],
  ): WebPageInspection => {
    const capture = unselectedShapes(passiveNetworkCapture([]));
    capture.network.websocket_connections.push({
      request_id: "capture-local-socket-id",
      url: "wss://app.example.test/live",
      events: structuredClone(events),
    });
    return capture;
  };

  it("does not compare an unknown opcode as a real continuation frame", () => {
    const malformed = captureWithWebSocketFrames([
      {
        direction: "received",
        opcode: null,
        payload_bytes: null,
        payload_shape: null,
      },
    ]);
    const observedZero = captureWithWebSocketFrames([
      {
        direction: "received",
        opcode: 0,
        payload_bytes: 0,
        payload_shape: { format: "binary", json_shape: null },
      },
    ]);

    for (const [before, after] of [
      [malformed, observedZero],
      [observedZero, malformed],
    ] as const)
      expect(compare(before, after)).toMatchObject({
        status: "unknown",
        total_changes: 0,
        changes: [],
      });
  });

  it("still compares known payload facts in a stream with another unknown frame", () => {
    const before = captureWithWebSocketFrames([
      {
        direction: "received",
        opcode: null,
        payload_bytes: null,
        payload_shape: null,
      },
      {
        direction: "sent",
        opcode: 1,
        payload_bytes: 3,
        payload_shape: { format: "text", json_shape: null },
      },
    ]);
    const after = structuredClone(before);
    after.network.websocket_connections[0]!.events[1]!.payload_bytes = 4;

    expect(compare(before, after)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [{ change: "modified" }],
    });
  });
});

describe("passive network coverage uncertainty", () => {
  it.each([
    "attach_limited_sections",
    "unavailable_sections",
    "truncated_sections",
    "policy_filtered_sections",
  ] as const)(
    "does not infer request absence when its inventory is %s",
    (section) => {
      const before = passiveNetworkCapture();
      const after = passiveNetworkCapture(["/a", "/b"]);
      before.completeness[section].push("network_requests");
      for (const [left, right] of [
        [before, after],
        [after, before],
      ])
        expect(compare(left!, right!)).toMatchObject({
          status: "unknown",
          total_changes: 0,
        });
      after.network.requests[0]!.status = 503;
      expect(compare(before, after)).toMatchObject({
        status: "changed",
        total_changes: 1,
        changes: [{ change: "modified" }],
      });
    },
  );

  it("does not promote unavailable shapes to a modification and preserves unselected-shape behavior", () => {
    const before = passiveNetworkCapture();
    const after = structuredClone(before);
    after.network.requests[0]!.body_shapes = {
      status: "included",
      request: {
        root_type: "object",
        node_count: 1,
        max_depth_observed: 0,
        properties: [],
      },
      response: {
        root_type: "string",
        node_count: 1,
        max_depth_observed: 0,
        properties: [],
      },
    };
    expect(compare(before, after)).toMatchObject({
      status: "unknown",
      total_changes: 0,
    });
    before.completeness.excluded.push({
      section: "json_body_shapes",
      reason: "not_approved",
      count: null,
    });
    expect(compare(before, after)).toMatchObject({
      status: "unchanged",
      total_changes: 0,
    });
  });
});

describe("independent WebSocket inventory evidence", () => {
  it("does not use complete HTTP inventory to infer an unobserved WebSocket connection", () => {
    const before = passiveNetworkCapture();
    const after = structuredClone(before);
    after.network.websocket_connections.push({
      request_id: "ws",
      url: "wss://app.example.test/live",
      events: [],
    });
    before.completeness.attach_limited_sections.push("websocket_connections");
    expect(compare(before, after)).toMatchObject({
      status: "unknown",
      total_changes: 0,
    });
    expect(compare(after, before)).toMatchObject({
      status: "unknown",
      total_changes: 0,
    });
    after.network.requests.push({
      ...passiveNetworkCapture(["/b"]).network.requests[0]!,
      request_id: "request-b",
    });
    expect(compare(before, after)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [{ identity: expect.stringMatching(/^net_/u), change: "added" }],
    });
  });

  it("retains complete WebSocket membership changes when HTTP inventory is limited", () => {
    const before = passiveNetworkCapture();
    before.completeness.attach_limited_sections.push("network_requests");
    const after = structuredClone(before);
    after.network.websocket_connections.push({
      request_id: "ws",
      url: "wss://app.example.test/live",
      events: [],
    });
    for (const [left, right, change] of [
      [before, after, "added"],
      [after, before, "removed"],
    ] as const)
      expect(compare(left, right)).toMatchObject({
        status: "changed",
        total_changes: 1,
        changes: [{ identity: expect.stringMatching(/^ws_/u), change }],
      });
  });

  it("does not turn missing WebSocket payload facts into membership changes", () => {
    const before = passiveNetworkCapture();
    before.network.websocket_connections.push({
      request_id: "ws",
      url: "wss://app.example.test/live",
      events: [
        {
          direction: "sent",
          opcode: 1,
          payload_bytes: 4,
          payload_shape: { format: "text", json_shape: null },
        },
      ],
    });
    const after = structuredClone(before);
    const event = after.network.websocket_connections[0]!.events[0]!;
    event.payload_bytes = null;
    event.payload_shape = null;
    expect(compare(before, after)).toMatchObject({
      status: "unknown",
      total_changes: 0,
    });
    after.network.requests.push({
      ...passiveNetworkCapture(["/b"]).network.requests[0]!,
      request_id: "request-b",
    });
    expect(compare(before, after)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [{ identity: expect.stringMatching(/^net_/u), change: "added" }],
    });
  });
});

describe("repeated HTTP request identity uncertainty", () => {
  it.each([true, false])(
    "keeps repeated-request regrouping unknown when one type is missing (shapes selected=%s)",
    (selected) => {
      const before = passiveNetworkCapture(["/a", "/a"]);
      const after = structuredClone(before);
      after.network.requests[1]!.resource_type = null;
      if (!selected)
        for (const capture of [before, after]) unselectedShapes(capture);
      for (const [left, right] of [
        [before, after],
        [after, before],
      ] as const)
        expect(compare(left, right)).toMatchObject({
          status: "unknown",
          total_changes: 0,
          changes: [],
        });
    },
  );

  it("retains a known repeated-request count change", () => {
    const before = unselectedShapes(passiveNetworkCapture(["/a", "/a"]));
    const after = unselectedShapes(passiveNetworkCapture());
    for (const [left, right] of [
      [before, after],
      [after, before],
    ] as const)
      expect(compare(left, right)).toMatchObject({
        status: "changed",
        total_changes: 1,
        changes: [{ change: "modified" }],
      });
  });

  it("does not assign observed content to an ambiguous type bucket", () => {
    const before = unselectedShapes(passiveNetworkCapture(["/a", "/a"]));
    before.network.requests[1]!.resource_type = null;
    before.network.requests[1]!.status = 503;
    const after = structuredClone(before);
    after.network.requests[0]!.status = 503;
    after.network.requests[1]!.status = 200;
    for (const [left, right] of [
      [before, after],
      [after, before],
    ] as const)
      expect(compare(left, right)).toMatchObject({
        status: "unknown",
        total_changes: 0,
        changes: [],
      });
  });
});

describe("nullable HTTP request identities", () => {
  it.each([true, false])(
    "keeps known/unknown resource-type matches uncertain (shapes selected=%s)",
    (selected) => {
      const before = passiveNetworkCapture();
      const after = structuredClone(before);
      after.network.requests[0]!.resource_type = null;
      if (!selected)
        for (const capture of [before, after]) unselectedShapes(capture);
      for (const [left, right] of [
        [before, after],
        [after, before],
      ] as const)
        expect(compare(left, right)).toMatchObject({
          status: "unknown",
          total_changes: 0,
          changes: [],
          reason: expect.stringContaining("request identity"),
        });
    },
  );

  it("does not prove equality from two unknown request types", () => {
    const capture = unselectedShapes(passiveNetworkCapture());
    capture.network.requests[0]!.resource_type = null;
    expect(compare(capture, structuredClone(capture))).toMatchObject({
      status: "unknown",
      total_changes: 0,
      reason: expect.stringContaining("request identity"),
    });
  });

  it("does not assign an unknown type to one of multiple same-method/URL candidates", () => {
    const before = unselectedShapes(passiveNetworkCapture(["/a", "/a"]));
    before.network.requests[1]!.resource_type = "Fetch";
    const after = structuredClone(before);
    after.network.requests[1]!.resource_type = null;
    for (const [left, right] of [
      [before, after],
      [after, before],
    ] as const)
      expect(compare(left, right)).toMatchObject({
        status: "unknown",
        total_changes: 0,
      });
  });

  it.each([
    ["/b", "GET"],
    ["/a", "POST"],
  ])(
    "retains a distinct %s %s request beside ambiguous identities",
    (path, method) => {
      const before = unselectedShapes(passiveNetworkCapture());
      const after = unselectedShapes(passiveNetworkCapture(["/a", path]));
      after.network.requests[0]!.resource_type = null;
      after.network.requests[1]!.method = method;
      for (const [left, right, change] of [
        [before, after, "added"],
        [after, before, "removed"],
      ] as const)
        expect(compare(left, right)).toMatchObject({
          status: "changed",
          total_changes: 1,
          changes: [{ identity: expect.stringMatching(/^net_/u), change }],
        });
    },
  );

  it("uses a complete empty peer inventory to prove absence despite an unknown type", () => {
    const empty = unselectedShapes(passiveNetworkCapture([]));
    const observed = unselectedShapes(passiveNetworkCapture());
    observed.network.requests[0]!.resource_type = null;
    for (const [left, right, change] of [
      [empty, observed, "added"],
      [observed, empty, "removed"],
    ] as const)
      expect(compare(left, right)).toMatchObject({
        status: "changed",
        total_changes: 1,
        changes: [{ change }],
      });
    expect(compare(empty, empty)).toMatchObject({
      status: "unchanged",
      total_changes: 0,
    });
  });

  it("retains definite type changes and independently observed metadata changes", () => {
    const before = unselectedShapes(passiveNetworkCapture());
    const changedType = structuredClone(before);
    changedType.network.requests[0]!.resource_type = "Fetch";
    expect(compare(before, changedType)).toMatchObject({
      status: "changed",
      total_changes: 2,
      changes: expect.arrayContaining([
        expect.objectContaining({ change: "added" }),
        expect.objectContaining({ change: "removed" }),
      ]),
    });
    before.network.requests.push({
      ...passiveNetworkCapture(["/b"]).network.requests[0]!,
      resource_type: null,
    });
    const changedStatus = structuredClone(before);
    changedStatus.network.requests[0]!.status = 503;
    expect(compare(before, changedStatus)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [{ change: "modified" }],
    });
  });
});

describe("passive dropped-event inventory coverage", () => {
  it("does not infer request absence from a capture with independently counted drops", () => {
    const before = withPassiveDroppedEvents(passiveNetworkCapture(), {
      network_requests: 1,
    });
    const after = passiveNetworkCapture(["/a", "/b"]);
    expect(before.completeness).toMatchObject({
      status: "truncated",
      truncated_sections: [],
      unavailable_sections: [],
      attach_limited_sections: [],
      policy_filtered_sections: [],
      dropped_events: { network_requests: 1, total: 1 },
    });
    for (const [left, right] of [
      [before, after],
      [after, before],
    ] as const)
      expect(compare(left, right)).toMatchObject({
        status: "unknown",
        total_changes: 0,
      });
    const changed = structuredClone(before);
    changed.network.requests[0]!.status = 503;
    expect(compare(before, changed)).toMatchObject({
      status: "unknown",
      total_changes: 0,
      changes: [],
    });
    // Once one complete inventory excludes the peer's observed response,
    // omissions cannot explain that response difference.
    changed.completeness.dropped_events.network_requests = 0;
    changed.completeness.dropped_events.total = 0;
    expect(compare(before, changed)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [{ change: "modified" }],
    });
  });

  it.each([
    "network_requests",
    "websocket_connections",
    "websocket_frames",
  ] as const)(
    "cannot prove network equality after dropped %s even when shapes are unselected",
    (kind) => {
      const before = withPassiveDroppedEvents(
        unselectedShapes(passiveNetworkCapture()),
        { [kind]: 1 },
      );
      expect(before.completeness.truncated_sections).toEqual([]);
      expect(compare(before, structuredClone(before))).toMatchObject({
        status: "unknown",
        total_changes: 0,
      });
    },
  );

  it.each(["websocket_connections", "websocket_frames"] as const)(
    "keeps %s drops separate from HTTP inventory",
    (kind) => {
      const before = withPassiveDroppedEvents(passiveNetworkCapture(), {
        [kind]: 1,
      });
      const after = structuredClone(before);
      after.network.websocket_connections.push({
        request_id: "ws",
        url: "wss://app.example.test/live",
        events: [],
      });
      for (const [left, right] of [
        [before, after],
        [after, before],
      ] as const)
        expect(compare(left, right)).toMatchObject({
          status: "unknown",
          total_changes: 0,
        });
      after.network.requests.push({
        ...passiveNetworkCapture(["/b"]).network.requests[0]!,
        request_id: "request-b",
      });
      for (const [left, right, change] of [
        [before, after, "added"],
        [after, before, "removed"],
      ] as const)
        expect(compare(left, right)).toMatchObject({
          status: "changed",
          total_changes: 1,
          changes: [{ identity: expect.stringMatching(/^net_/u), change }],
        });
    },
  );

  it("retains complete WebSocket membership despite HTTP drops", () => {
    const before = withPassiveDroppedEvents(passiveNetworkCapture(), {
      network_requests: 1,
    });
    const after = structuredClone(before);
    after.network.websocket_connections.push({
      request_id: "ws",
      url: "wss://app.example.test/live",
      events: [],
    });
    expect(compare(before, after)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [{ identity: expect.stringMatching(/^ws_/u), change: "added" }],
    });
    expect(compare(after, before)).toMatchObject({
      status: "changed",
      total_changes: 1,
      changes: [
        { identity: expect.stringMatching(/^ws_/u), change: "removed" },
      ],
    });
  });

  it.each([
    "console_events",
    "scripts",
    "timeline_events",
    "webmcp_tools",
  ] as const)(
    "does not use the total or unrelated %s drops as HTTP absence limits",
    (kind) => {
      const before = withPassiveDroppedEvents(
        unselectedShapes(passiveNetworkCapture()),
        { [kind]: 2 },
      );
      expect(before.completeness).toMatchObject({
        status: "truncated",
        dropped_events: { total: 2 },
      });
      expect(compare(before, structuredClone(before))).toMatchObject({
        status: "unchanged",
        total_changes: 0,
      });
      const after = unselectedShapes(passiveNetworkCapture(["/a", "/b"]));
      expect(compare(before, after)).toMatchObject({
        status: "changed",
        total_changes: 1,
        changes: [{ change: "added" }],
      });
      expect(compare(after, before)).toMatchObject({
        status: "changed",
        total_changes: 1,
        changes: [{ change: "removed" }],
      });
    },
  );
});
