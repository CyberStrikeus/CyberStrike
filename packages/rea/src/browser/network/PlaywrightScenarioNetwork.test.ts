import { afterEach, expect, it, vi } from "vitest";

import { browserScenarioSchema } from "../../domain/browserScenario.js";
import {
  type BrowserScenarioEventAdmission,
  browserScenarioEventSchema,
  type BrowserScenarioEvent,
} from "../../domain/browserScenarioCaptureValues.js";
import type { BrowserNetworkContentSelection } from "../../domain/browserNetworkEvidence.js";
import { resolveScenarioSecrets } from "../../../tests/fixtures/browserScenarioSecrets.js";
import {
  PlaywrightScenarioNetwork,
  type ScenarioNetworkRequest,
  type ScenarioNetworkResponse,
} from "./PlaywrightScenarioNetwork.js";

class RequestFixture implements ScenarioNetworkRequest {
  headerReads = 0;
  bodyReads = 0;
  predecessor: ScenarioNetworkRequest | null = null;
  responseSize = 64;
  constructor(readonly marker: string) {}
  method() {
    return "POST";
  }
  url() {
    return "https://example.test/same-url";
  }
  resourceType() {
    return "fetch";
  }
  async sizes() {
    return { responseBodySize: this.responseSize };
  }
  headers(): Record<string, string> {
    return {
      "content-type": "text/plain",
      authorization: "Bearer private-transport",
    };
  }
  async headersArray() {
    this.headerReads += 1;
    return Object.entries(this.headers()).map(([name, value]) => ({
      name,
      value,
    }));
  }
  postDataBuffer(): Buffer | null {
    this.bodyReads += 1;
    return Buffer.from(this.marker);
  }
  redirectedFrom() {
    return this.predecessor;
  }
  failure() {
    return { errorText: "connection reset" };
  }
}

class ResponseFixture implements ScenarioNetworkResponse {
  bodyReads = 0;
  headerReads = 0;
  read: () => Promise<Buffer>;
  constructor(
    private readonly source: ScenarioNetworkRequest,
    marker: string,
  ) {
    this.read = async () => Buffer.from(marker);
  }
  request() {
    return this.source;
  }
  url() {
    return this.source.url();
  }
  status() {
    return 200;
  }
  headers(): Record<string, string> {
    return {
      "content-type": "application/octet-stream",
      "set-cookie": "session=transport-secret",
    };
  }
  async headersArray() {
    this.headerReads += 1;
    return [
      { name: "X-Repeat", value: "first" },
      { name: "X-Repeat", value: "second" },
      { name: "Set-Cookie", value: "session=transport-secret" },
    ];
  }
  body() {
    this.bodyReads += 1;
    return this.read();
  }
}

const selection = {
  request_body: true,
  response_body: true,
  header_values: true,
};
const harness = (
  selected: BrowserNetworkContentSelection = selection,
  signal?: AbortSignal,
  secretValue = "私密",
  limitsInput: unknown = {},
) => {
  const scenario = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/fixture/chrome" },
    start_url: { url: "https://example.test" },
    actions: [{ step_id: "done", action: "wait_for_timeout", duration_ms: 1 }],
    secrets: [
      { secret_id: "declared", environment_variable: "FIXTURE_SECRET" },
    ],
    capture: { limits: limitsInput },
  });
  const secrets = resolveScenarioSecrets(scenario, {
    FIXTURE_SECRET: secretValue,
  });
  const events: BrowserScenarioEvent[] = [];
  const omittedEventCounts = new Map<string, number>();
  const collector = new PlaywrightScenarioNetwork({
    selection: selected,
    limits: scenario.capture.limits,
    secrets,
    readTimeoutMs: 50,
    ...(signal === undefined ? {} : { signal }),
    emit: (event) => {
      const sequence = events.length + 1;
      events.push(
        browserScenarioEventSchema.parse({ ...event, sequence, step_index: 0 }),
      );
      return { status: "retained", sequence };
    },
    admitText: () => ({ status: "retained", sequence: events.length + 1 }),
    admitContentBody: () => ({
      status: "retained",
      sequence: events.length + 1,
    }),
    omitNetwork: (transactionId, kind, reason) => {
      let omission = networkOmissions.get(transactionId);
      if (omission === undefined) {
        omission = { kinds: new Set(), reasons: new Set() };
        networkOmissions.set(transactionId, omission);
      }
      omission.kinds.add(kind);
      omission.reasons.add(reason);
    },
    omitEvent: (kind) => {
      omittedEventCounts.set(kind, (omittedEventCounts.get(kind) ?? 0) + 1);
    },
  });
  const networkOmissions = new Map<
    string,
    { kinds: Set<string>; reasons: Set<string> }
  >();
  return {
    collector,
    events,
    limits: scenario.capture.limits,
    secrets,
    networkOmissions,
    omittedEventCounts,
  };
};

const bodyText = (event: BrowserScenarioEvent) => {
  if (event.kind !== "network-content" || event.body.state !== "captured")
    throw new Error("Expected retained network bytes");
  return Buffer.from(event.body.content, "base64").toString();
};

afterEach(() => vi.useRealTimers());

it.each([true, false])(
  "protects source body and headers before the binding is saved (body selected: %s)",
  async (responseBody) => {
    const { collector, events, secrets } = harness({
      request_body: false,
      response_body: responseBody,
      header_values: true,
    });
    const request = new RequestFixture("marked");
    const secret = "source-token-729d";
    const response = new ResponseFixture(
      request,
      JSON.stringify({ token: secret, public: "kept" }),
    );
    vi.spyOn(response, "headers").mockReturnValue({
      "content-type": "application/json",
      "x-derived-token": secret,
    });
    vi.spyOn(response, "headersArray").mockResolvedValue([
      { name: "X-Derived-Token", value: secret },
    ]);
    secrets.responseProtector("login", [
      { name: "token", json_pointer: "/token", secret: true },
    ])?.(request);
    collector.request(request);
    collector.response(response);
    collector.finished(request);
    await collector.finish();
    const content = events.find(
      (event) => event.kind === "network-content" && event.phase === "response",
    );
    if (content?.kind !== "network-content")
      throw new Error("Missing response content");
    expect(JSON.stringify(content.headers)).not.toContain(secret);
    expect(content.headers.state).toBe("captured");
    if (responseBody)
      expect(JSON.parse(bodyText(content))).toEqual({
        token: "[REDACTED:page:login.token]",
        public: "kept",
      });
    else expect(content.body.state).toBe("not_requested");
    expect(() => secrets.savedValue("token")).toThrow("No earlier step saved");
    secrets.save("login.token", "token", secret, true);
    expect(secrets.redact(secret)).toBe("[REDACTED:page:login.token]");
    expect(response.bodyReads).toBe(1);
  },
);

it.each([
  ['{"token":"\\u0073ecret-token"}', "/token"],
  ['{"token":"secret\\/token"}', "/token"],
  ['{"token":1e3}', "/token"],
  ['{"token":1000.0}', "/token"],
  ['{"items":[{"a/b":"\\u0073ecret-token"}]}', "/items/0/a~1b"],
  ['{"token":"shadowed","token":"\\u0073ecret-token"}', "/token"],
])(
  "redacts the selected source JSON token structurally: %s",
  async (body, pointer) => {
    const { collector, events, secrets } = harness({
      request_body: false,
      response_body: true,
      header_values: false,
    });
    const request = new RequestFixture("marked");
    request.responseSize = Buffer.byteLength(body);
    secrets.responseProtector("login", [
      { name: "token", json_pointer: pointer, secret: true },
    ])?.(request);
    collector.request(request);
    collector.response(new ResponseFixture(request, body));
    collector.finished(request);
    await collector.finish();
    const content = events.find(
      (event) => event.kind === "network-content" && event.phase === "response",
    );
    expect(content).toBeDefined();
    const text = bodyText(content!);
    expect(text).not.toMatch(/secret|0073|shadowed|1e3|1000/u);
    expect(JSON.parse(text)).toBeDefined();
    expect(text).toContain("[REDACTED:page:login.token]");
  },
);

it("reads and redacts marked gzip content its received size bounds", async () => {
  const { collector, events, secrets } = harness({
    request_body: false,
    response_body: true,
    header_values: false,
  });
  const request = new RequestFixture("marked");
  const body = '{"token":"secret-token"}';
  request.responseSize = 20;
  const response = new ResponseFixture(request, body);
  vi.spyOn(response, "headers").mockReturnValue({
    "content-type": "application/json",
    "content-encoding": "gzip",
  });
  secrets.responseProtector("login", [
    { name: "token", json_pointer: "/token", secret: true },
  ])?.(request);
  collector.request(request);
  collector.response(response);
  collector.finished(request);
  await collector.finish();
  const content = events.find(
    (event) => event.kind === "network-content" && event.phase === "response",
  );
  expect(content).toBeDefined();
  const text = bodyText(content!);
  expect(text).not.toContain("secret-token");
  expect(text).toContain("[REDACTED:page:login.token]");
});

it("preserves unselected source spellings while redacting escaped aliases", async () => {
  const { collector, events, secrets } = harness({
    request_body: false,
    response_body: true,
    header_values: false,
  });
  const request = new RequestFixture("marked");
  const body =
    '{ "token":"secret-token", "mirror":"\\u0073ecret-token", "unknown":1e-400 }';
  request.responseSize = Buffer.byteLength(body);
  secrets.responseProtector("login", [
    { name: "token", json_pointer: "/token", secret: true },
  ])?.(request);
  collector.request(request);
  collector.response(new ResponseFixture(request, body));
  collector.finished(request);
  await collector.finish();
  const content = events.find(
    (event) => event.kind === "network-content" && event.phase === "response",
  );
  const text = bodyText(content!);
  expect(text).toContain('"unknown":1e-400');
  expect(text).toContain('{ "token":');
  expect(text).not.toMatch(/secret|0073/u);
  expect(JSON.parse(text).mirror).toBe("[REDACTED:page:login.token]");
});

it("associates sensitive fields by request identity while keeping same-URL unmarked values", async () => {
  const { collector, events, secrets } = harness({
    request_body: false,
    response_body: true,
    header_values: false,
  });
  const marked = new RequestFixture("marked");
  const unmarked = new RequestFixture("unmarked");
  secrets.responseProtector("login", [
    { name: "token", json_pointer: "/token", secret: true },
  ])?.(marked);
  for (const [request, token] of [
    [marked, "private-token-729d"],
    [unmarked, "public-unmarked-token"],
  ] as const) {
    collector.request(request);
    collector.response(new ResponseFixture(request, JSON.stringify({ token })));
    collector.finished(request);
  }
  await collector.finish();
  const bodies = events
    .filter(
      (event) => event.kind === "network-content" && event.phase === "response",
    )
    .map((event) => JSON.parse(bodyText(event)));
  expect(bodies).toEqual(
    expect.arrayContaining([
      { token: "[REDACTED:page:login.token]" },
      { token: "public-unmarked-token" },
    ]),
  );
});

it.each(["br", "cache"])(
  "withholds marked response content when decoded bounds are unknown: %s",
  async (kind) => {
    const { collector, events, secrets } = harness();
    const request = new RequestFixture("marked");
    if (kind === "cache") request.responseSize = 0;
    const secret = "private-source-token";
    const response = new ResponseFixture(
      request,
      JSON.stringify({ token: secret }),
    );
    if (kind === "br")
      vi.spyOn(response, "headers").mockReturnValue({
        "content-type": "application/json",
        "content-encoding": "br",
      });
    secrets.responseProtector("login", [
      { name: "token", json_pointer: "/token", secret: true },
    ])?.(request);
    collector.request(request);
    collector.response(response);
    collector.finished(request);
    await collector.finish();
    const content = events.find(
      (event) => event.kind === "network-content" && event.phase === "response",
    );
    if (content?.kind !== "network-content")
      throw new Error("Missing response content");
    expect(content.body.state).toBe("unavailable");
    expect(content.headers.state).toBe("unavailable");
    expect(response.bodyReads).toBe(0);
    expect(response.headerReads).toBe(0);
    expect(JSON.stringify(events)).not.toContain(secret);
  },
);

it("keeps observed completion independent of rejected completion metadata", async () => {
  const { secrets, limits } = harness();
  let omit = false;
  const omitted: string[] = [];
  const collector = new PlaywrightScenarioNetwork({
    selection: {
      request_body: false,
      response_body: false,
      header_values: false,
    },
    limits,
    secrets,
    admitText: () =>
      omit
        ? {
            status: "omitted",
            sequence: 1,
            reason: "max-total-event-allocation-bytes",
          }
        : { status: "retained", sequence: 1 },
    emit: () => ({ status: "retained", sequence: 1 }),
    admitContentBody: () => ({ status: "retained", sequence: 1 }),
    omitNetwork: (_id, kind) => {
      omitted.push(kind);
    },
    omitEvent: (kind) => {
      omitted.push(kind);
    },
  });
  const request = new RequestFixture("ordinary");
  collector.request(request);
  omit = true;
  collector.finished(request);
  await collector.finish();
  expect(omitted).toContain("request-finished");
  expect(omitted).not.toContain("request-unfinished");
});

it.each(["finished", "failed", "unfinished"])(
  "counts selected omitted response content when %s",
  async (terminal) => {
    const { collector, omittedEventCounts } = harness(
      { request_body: false, response_body: true, header_values: false },
      undefined,
      "fixture",
      { max_network_transactions: 1 },
    );
    collector.request(new RequestFixture("admitted"));
    const request = new RequestFixture("omitted");
    const response = new ResponseFixture(request, "response");
    collector.request(request);
    collector.response(response);
    expect(omittedEventCounts.get("network-content")).toBe(1);
    collector.response(response);
    expect(omittedEventCounts.get("network-content")).toBe(1);
    if (terminal === "finished") collector.finished(request);
    if (terminal === "failed") collector.failed(request);
    expect(omittedEventCounts.get("network-content")).toBe(1);
    await collector.finish();
    expect(omittedEventCounts.get("network-content")).toBe(1);
    expect(response.bodyReads).toBe(0);
    expect(request.bodyReads).toBe(0);
  },
);

it("redacts declared secrets in browser-produced form and JSON encodings", async () => {
  for (const secret of ["私密", 'space " and \n']) {
    const { collector, events } = harness(selection, undefined, secret);
    const encoded = new RequestFixture(
      `value=${new URLSearchParams([["value", secret]]).toString().slice(6)}`,
    );
    const json = new RequestFixture(JSON.stringify({ value: secret }));
    collector.request(encoded);
    collector.request(json);
    await collector.finish();
    const content = events.filter(
      (event) => event.kind === "network-content" && event.phase === "request",
    );
    expect(content.map(bodyText)).toEqual([
      "value=[REDACTED:declared]",
      '{"value":"[REDACTED:declared]"}',
    ]);
  }
});

it("associates out-of-order same-URL responses by request identity", async () => {
  const { collector, events } = harness();
  const slow = new RequestFixture("slow");
  const fast = new RequestFixture("fast");
  collector.request(slow);
  collector.request(fast);
  collector.response(new ResponseFixture(fast, "reply:fast"));
  collector.response(new ResponseFixture(slow, "reply:slow"));
  collector.finished(fast);
  collector.finished(slow);
  await collector.finish();
  const content = events.filter((event) => event.kind === "network-content");
  for (const marker of ["slow", "fast"]) {
    const request = content.find(
      (event) => event.phase === "request" && bodyText(event) === marker,
    );
    const response = content.find(
      (event) =>
        event.phase === "response" && bodyText(event) === `reply:${marker}`,
    );
    expect(response).toMatchObject({
      body: { representation: "playwright-response-body-bytes" },
    });
    expect(request?.transaction_id).toBe(response?.transaction_id);
    expect(request?.source_event_sequence).not.toBe(
      response?.source_event_sequence,
    );
  }
  expect(new Set(content.map((event) => event.transaction_id)).size).toBe(2);
});

it("keeps metadata-only capture free of body and header-value reads", async () => {
  const { collector, events } = harness({
    request_body: false,
    response_body: false,
    header_values: false,
  });
  const request = new RequestFixture("body");
  const response = new ResponseFixture(request, "reply");
  collector.request(request);
  collector.response(response);
  collector.finished(request);
  await collector.finish();
  expect(
    request.bodyReads +
      request.headerReads +
      response.bodyReads +
      response.headerReads,
  ).toBe(0);
  expect(events.map(({ kind }) => kind)).toEqual([
    "request",
    "response",
    "request-finished",
  ]);
  expect(JSON.stringify(events)).not.toContain("private-transport");
});

it("reports unfinished metadata even when content was not selected", async () => {
  const { collector, events } = harness({
    request_body: false,
    response_body: false,
    header_values: false,
  });
  const request = new RequestFixture("body");
  collector.request(request);
  await collector.finish();
  expect(events.map(({ kind }) => kind)).toEqual([
    "request",
    "request-unfinished",
  ]);
  expect(collector.limitations()).toHaveLength(1);
  expect(request.bodyReads + request.headerReads).toBe(0);
});

it.each([
  {
    selection: {
      request_body: true,
      response_body: false,
      header_values: false,
    },
    reads: [1, 0, 0, 0],
    phases: ["request"],
  },
  {
    selection: {
      request_body: false,
      response_body: true,
      header_values: false,
    },
    reads: [0, 0, 1, 0],
    phases: ["response"],
  },
  {
    selection: {
      request_body: false,
      response_body: false,
      header_values: true,
    },
    reads: [0, 1, 0, 1],
    phases: ["request", "response"],
  },
])(
  "reads only the selected content $selection",
  async ({ selection: selected, reads, phases }) => {
    const { collector, events } = harness(selected);
    const request = new RequestFixture("input");
    const response = new ResponseFixture(request, "output");
    collector.request(request);
    collector.response(response);
    collector.finished(request);
    await collector.finish();
    expect([
      request.bodyReads,
      request.headerReads,
      response.bodyReads,
      response.headerReads,
    ]).toEqual(reads);
    expect(
      events
        .filter((event) => event.kind === "network-content")
        .map((event) => event.phase),
    ).toEqual(phases);
  },
);

it("preserves duplicate headers and binary bytes, redacting credentials and declared UTF-8 secrets", async () => {
  const { collector, events } = harness();
  const request = new RequestFixture("input");
  const response = new ResponseFixture(request, "unused");
  response.read = async () =>
    Buffer.concat([
      Buffer.from([0xff, 0x00]),
      Buffer.from("私密"),
      Buffer.from([0xfe]),
    ]);
  collector.request(request);
  collector.response(response);
  expect(response.bodyReads).toBe(0);
  collector.finished(request);
  await collector.finish();
  const content = events.find(
    (event) => event.kind === "network-content" && event.phase === "response",
  );
  if (content?.kind !== "network-content" || content.body.state !== "captured")
    throw new Error("Missing response");
  expect(
    Buffer.compare(
      Buffer.from(content.body.content, "base64"),
      Buffer.concat([
        Buffer.from([0xff, 0x00]),
        Buffer.from("[REDACTED:declared]"),
        Buffer.from([0xfe]),
      ]),
    ),
  ).toBe(0);
  expect(content.body.redacted).toBe(true);
  expect(content.headers).toEqual({
    state: "captured",
    items: [
      { name: "X-Repeat", value: "first", redacted: false },
      { name: "X-Repeat", value: "second", redacted: false },
      { name: "Set-Cookie", value: null, redacted: true },
    ],
  });
  expect(JSON.stringify(events)).not.toContain("transport-secret");
});

it("does not read unfinished streaming responses and reports the cutoff", async () => {
  const { collector, events } = harness();
  const request = new RequestFixture("stream");
  const response = new ResponseFixture(request, "never-complete");
  collector.request(request);
  collector.response(response);
  await collector.finish();
  expect(response.bodyReads).toBe(0);
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "request-unfinished",
      reason: "capture-ended",
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "network-content",
      phase: "response",
      body: expect.objectContaining({
        state: "unavailable",
        reason: "response-unfinished",
      }),
    }),
  );
  expect(collector.limitations().length).toBeGreaterThan(0);
});

it("queues completed body reads behind the active-read limit", async () => {
  const { collector, events } = harness({
    request_body: false,
    response_body: true,
    header_values: false,
  });
  const requests = Array.from(
    { length: 20 },
    (_, index) => new RequestFixture(`request-${String(index)}`),
  );
  const releases: Array<(bytes: Buffer) => void> = [];
  let activeReads = 0;
  let maximumActiveReads = 0;
  for (const request of requests) {
    const response = new ResponseFixture(request, "unused");
    response.read = () =>
      new Promise((resolve) => {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        releases.push((bytes) => {
          activeReads -= 1;
          resolve(bytes);
        });
      });
    collector.request(request);
    collector.response(response);
    collector.finished(request);
  }

  let releasedReads = 0;
  while (releasedReads < requests.length) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const batch = releases.splice(0);
    expect(batch.length).toBeGreaterThan(0);
    batch.forEach((release) => release(Buffer.from("captured")));
    releasedReads += batch.length;
  }
  await collector.finish();

  const content = events.filter(
    (event) => event.kind === "network-content" && event.phase === "response",
  );
  expect(maximumActiveReads).toBe(16);
  expect(content).toHaveLength(20);
  expect(
    content.every(
      (event) =>
        event.kind === "network-content" && event.body.state === "captured",
    ),
  ).toBe(true);
  expect(events.filter(({ kind }) => kind === "network-content")).toHaveLength(
    20,
  );
});

it("starts each queued body's timeout when its read begins", async () => {
  vi.useFakeTimers();
  const { collector, events } = harness({
    request_body: false,
    response_body: true,
    header_values: false,
  });
  const requests = Array.from(
    { length: 20 },
    (_, index) => new RequestFixture(`request-${String(index)}`),
  );
  for (const request of requests) {
    const response = new ResponseFixture(request, "unused");
    response.read = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(Buffer.from("captured")), 40);
      });
    collector.request(request);
    collector.response(response);
    collector.finished(request);
  }

  const finishing = collector.finish();
  await vi.advanceTimersByTimeAsync(40);
  await vi.advanceTimersByTimeAsync(40);
  await finishing;

  const content = events.filter(
    (event) => event.kind === "network-content" && event.phase === "response",
  );
  expect(content).toHaveLength(20);
  expect(
    content.every(
      (event) =>
        event.kind === "network-content" && event.body.state === "captured",
    ),
  ).toBe(true);
});

it("settles queued reads as cancelled without starting their body APIs", async () => {
  const controller = new AbortController();
  const { collector, events } = harness(
    {
      request_body: false,
      response_body: true,
      header_values: false,
    },
    controller.signal,
  );
  const requests = Array.from(
    { length: 20 },
    (_, index) => new RequestFixture(`request-${String(index)}`),
  );
  const responses = requests.map((request) => {
    const response = new ResponseFixture(request, "unused");
    response.read = () => new Promise(() => undefined);
    return response;
  });
  requests.forEach((request, index) => {
    collector.request(request);
    collector.response(responses[index]!);
    collector.finished(request);
  });

  expect(responses.filter(({ bodyReads }) => bodyReads > 0)).toHaveLength(16);
  controller.abort();
  await collector.finish();

  expect(responses.filter(({ bodyReads }) => bodyReads > 0)).toHaveLength(16);
  const content = events.filter(
    (event) => event.kind === "network-content" && event.phase === "response",
  );
  expect(content).toHaveLength(20);
  expect(
    content.every(
      (event) =>
        event.kind === "network-content" &&
        event.body.state === "unavailable" &&
        event.body.reason === "cancelled",
    ),
  ).toBe(true);
});

it("bounds hung completed-body reads and rejects late mutation after finalization", async () => {
  vi.useFakeTimers();
  const { collector, events } = harness();
  const request = new RequestFixture("hung");
  const response = new ResponseFixture(request, "unused");
  let release: (bytes: Buffer) => void = () => {
    throw new Error("Read was not started");
  };
  response.read = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  collector.request(request);
  collector.response(response);
  collector.finished(request);
  const finishing = collector.finish();
  await vi.advanceTimersByTimeAsync(51);
  await finishing;
  const frozen = JSON.stringify(events);
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "network-content",
      phase: "response",
      body: expect.objectContaining({
        state: "unavailable",
        reason: "body-read-timeout",
      }),
    }),
  );
  release(Buffer.from("late"));
  collector.request(new RequestFixture("after-cutoff"));
  await Promise.resolve();
  expect(JSON.stringify(events)).toBe(frozen);
});

it("cancellation settles pending reads and preserves the cancelled reason", async () => {
  const controller = new AbortController();
  const { collector, events } = harness(selection, controller.signal);
  const request = new RequestFixture("cancel");
  const response = new ResponseFixture(request, "unused");
  response.read = () => new Promise(() => undefined);
  collector.request(request);
  collector.response(response);
  collector.finished(request);
  controller.abort();
  await collector.finish();
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "network-content",
      phase: "response",
      body: expect.objectContaining({
        state: "unavailable",
        reason: "cancelled",
      }),
    }),
  );
});

it.each([false, true])(
  "records failed requests without hiding header read gaps (headers fail: %s)",
  async (headersFail) => {
    const { collector, events } = harness();
    const request = new RequestFixture("failed");
    const response = new ResponseFixture(request, "partial");
    if (headersFail)
      vi.spyOn(response, "headersArray").mockRejectedValue(
        new Error("Headers unavailable"),
      );
    collector.request(request);
    collector.response(response);
    collector.failed(request);
    await collector.finish();
    expect(response.bodyReads).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "request-failed",
        failure: "connection reset",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "network-content",
        phase: "response",
        body: expect.objectContaining({ reason: "request-failed" }),
      }),
    );
    expect(collector.limitations()).toHaveLength(headersFail ? 1 : 0);
  },
);

it("links observed redirect hops and leaves unseen predecessors unknown", async () => {
  const { collector, events } = harness();
  const first = new RequestFixture("first");
  const next = new RequestFixture("next");
  next.predecessor = first;
  const unseen = new RequestFixture("unseen");
  unseen.predecessor = new RequestFixture("outside-capture");
  collector.request(first);
  collector.request(next);
  collector.request(unseen);
  await collector.finish();
  const requests = events.filter((event) => event.kind === "request");
  expect(requests[0]?.redirected_from_transaction_state).toBe("root");
  expect(requests[1]?.redirected_from_transaction_id).toBe(
    requests[0]?.transaction_id,
  );
  expect(requests[1]?.redirected_from_transaction_state).toBeUndefined();
  expect(requests[2]?.redirected_from_transaction_id).toBeNull();
  expect(requests[2]?.redirected_from_transaction_state).toBe("unknown");
});

it("preserves read errors and does not turn unexposed or empty bytes into the same state", async () => {
  const { collector, events } = harness();
  const missing = new RequestFixture("missing");
  missing.postDataBuffer = () => null;
  const response = new ResponseFixture(missing, "unused");
  response.read = async () => {
    throw new Error("Cannot read 私密 response");
  };
  response.headersArray = async () => {
    throw new Error("Headers unavailable 私密");
  };
  const empty = new RequestFixture("");
  collector.request(missing);
  collector.response(response);
  collector.finished(missing);
  collector.request(empty);
  collector.response(new ResponseFixture(empty, ""));
  collector.finished(empty);
  await collector.finish();
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "network-content",
      phase: "request",
      body: { state: "not_exposed" },
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "network-content",
      phase: "response",
      headers: {
        state: "unavailable",
        message: "Headers unavailable [REDACTED:declared]",
      },
      body: {
        state: "unavailable",
        reason: "body-read-failed",
        message: "Cannot read [REDACTED:declared] response",
      },
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "network-content",
      phase: "response",
      body: expect.objectContaining({
        state: "captured",
        content: "",
        bytes: 0,
      }),
    }),
  );
  expect(collector.limitations().length).toBeGreaterThan(0);
});

it("redacts declared encodings in body media metadata", async () => {
  const { collector, events } = harness({
    request_body: false,
    response_body: true,
    header_values: false,
  });
  const request = new RequestFixture("input");
  const response = new ResponseFixture(request, "ordinary-bytes");
  const headers = response.headers();
  response.headers = () => ({
    ...headers,
    "content-type": `text/plain; fixture=${encodeURIComponent("私密")}`,
  });
  collector.request(request);
  collector.response(response);
  collector.finished(request);
  await collector.finish();
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "network-content",
      phase: "response",
      body: expect.objectContaining({
        state: "captured",
        media_type: "text/plain; fixture=[REDACTED:declared]",
      }),
    }),
  );
});

it("bounds admitted transactions before invoking content producers", async () => {
  const { collector, events } = harness();
  const admitted: RequestFixture[] = [];
  for (let index = 0; index < 1024; index += 1) {
    const request = new RequestFixture(`body-${index}`);
    admitted.push(request);
    collector.request(request);
    collector.request(request); // repeated producer delivery cannot add jobs
  }
  const rejected = new RequestFixture("rejected");
  const response = new ResponseFixture(rejected, "rejected");
  collector.request(rejected);
  collector.response(response);
  collector.finished(rejected);
  await collector.finish();
  expect(admitted[0]?.bodyReads).toBe(1);
  expect(
    admitted.every(
      (request) => request.bodyReads === 1 && request.headerReads === 1,
    ),
  ).toBe(true);
  expect(rejected.bodyReads).toBe(0);
  expect(rejected.headerReads).toBe(0);
  expect(response.bodyReads).toBe(0);
  expect(response.headerReads).toBe(0);
  expect(
    events.filter((event) => event.kind === "network-content"),
  ).toHaveLength(1024);
  expect(collector.limitations().join(" ")).toContain("resource budget");
});

it("uses the caller's transaction limit and reports the exact omitted ID range", async () => {
  const { collector, events, omittedEventCounts } = harness(
    selection,
    undefined,
    "fixture",
    { max_network_transactions: 2 },
  );
  const requests = Array.from(
    { length: 4 },
    (_, index) => new RequestFixture(`body-${String(index)}`),
  );
  for (const request of requests) collector.request(request);
  collector.response(new ResponseFixture(requests[2]!, "body-2"));
  collector.finished(requests[2]!);
  await collector.finish();
  expect(collector.omittedTransactionRange()).toEqual({
    first_transaction_id: "request-3",
    last_transaction_id: "request-4",
    count: 2,
    reason: "max-network-transactions",
  });
  expect(events.filter(({ kind }) => kind === "request")).toHaveLength(2);
  expect(Object.fromEntries(omittedEventCounts)).toEqual({
    request: 2,
    "network-content": 3,
    response: 1,
    "request-finished": 1,
  });
  expect(requests[2]?.bodyReads).toBe(0);
});

it("uses the caller's body-byte limit and returns typed size evidence", async () => {
  const { collector, events } = harness(selection, undefined, "fixture", {
    max_network_body_bytes: 4,
  });
  const request = new RequestFixture("12345");
  collector.request(request);
  await collector.finish();
  expect(events.find(({ kind }) => kind === "network-content")).toMatchObject({
    transaction_id: "request-1",
    body: {
      state: "unavailable",
      reason: "body-size-limit",
      limit_bytes: 4,
      observed_bytes: 5,
    },
  });
});

it("keeps header names and selected body when unselected values are oversized", async () => {
  const { collector, events } = harness({
    request_body: true,
    response_body: false,
    header_values: false,
  });
  const request = new RequestFixture("retained body");
  request.headers = () => ({
    "x-large-unselected": "x".repeat(1024 * 1024 + 1),
  });
  collector.request(request);
  await collector.finish();

  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "request",
      header_names: ["x-large-unselected"],
    }),
  );
  expect(
    events.find((event) => event.kind === "network-content"),
  ).toMatchObject({
    phase: "request",
    headers: { state: "not_requested" },
    body: { state: "captured" },
  });
  expect(request.bodyReads).toBe(1);
});

it("omits oversized body copies and retains ordinary content", async () => {
  const { collector, events } = harness();
  collector.request(new RequestFixture("x".repeat(64 * 1024 + 1)));
  collector.request(new RequestFixture("ordinary"));
  await collector.finish();
  const content = events.filter((event) => event.kind === "network-content");
  expect(content[0]?.body).toMatchObject({
    state: "unavailable",
    reason: "body-size-limit",
    limit_bytes: 64 * 1024,
    observed_bytes: 64 * 1024 + 1,
    message: expect.stringContaining("budget"),
  });
  expect(bodyText(content[1]!)).toBe("ordinary");
});

it("reserves redaction expansion before creating replacement copies", async () => {
  const { collector, events, secrets } = harness(selection, undefined, "a");
  const redact = vi.spyOn(secrets, "redactBytes");
  collector.request(new RequestFixture("a".repeat(64 * 1024)));
  await collector.finish();
  expect(
    events.find((event) => event.kind === "network-content")?.body,
  ).toMatchObject({
    state: "unavailable",
    message: expect.stringContaining("redaction"),
  });
  // Ordinary header values can still pass through the byte redactor.
  expect(redact.mock.calls.every(([value]) => value.length < 64 * 1024)).toBe(
    true,
  );
});

it("does not read content when phase metadata was omitted", async () => {
  const { secrets, limits } = harness();
  const redact = vi.spyOn(secrets, "redact");
  const collector = new PlaywrightScenarioNetwork({
    selection,
    limits,
    secrets,
    admitText: () => ({
      status: "omitted",
      sequence: 1,
      reason: "max-total-event-allocation-bytes",
    }),
    emit: (): BrowserScenarioEventAdmission => ({
      status: "retained",
      sequence: 1,
    }),
    admitContentBody: () => ({ status: "retained", sequence: 1 }),
    omitNetwork: () => undefined,
    omitEvent: () => undefined,
  });
  const request = new RequestFixture("ordinary");
  collector.request(request);
  await collector.finish();
  expect(redact).not.toHaveBeenCalled();
  expect(request.bodyReads + request.headerReads).toBe(0);
  expect(collector.limitations().join(" ")).toContain(
    "max-total-event-allocation-bytes",
  );
  expect(collector.limitations().join(" ")).toContain("incomplete");
});

it("stamps when each request was observed, and the browser's own start and duration once it ends", async () => {
  vi.useFakeTimers({ now: Date.parse("2026-10-24T05:00:00.250Z") });
  const { collector, events } = harness({
    request_body: false,
    response_body: false,
    header_values: false,
  });
  class TimedRequest extends RequestFixture {
    constructor(
      marker: string,
      readonly startTime: number,
      readonly responseEnd: number,
    ) {
      super(marker);
    }
    timing() {
      return { startTime: this.startTime, responseEnd: this.responseEnd };
    }
  }
  const finished = new TimedRequest(
    "timed",
    Date.parse("2026-10-24T05:00:00.200Z"),
    12.5,
  );
  const failed = new TimedRequest("untimed", 0, -1);
  collector.request(finished);
  collector.request(failed);
  collector.finished(finished);
  collector.failed(failed);
  await collector.finish();
  expect(events.filter(({ kind }) => kind === "request")).toEqual([
    expect.objectContaining({ observed_at: "2026-10-24T05:00:00.250Z" }),
    expect.objectContaining({ observed_at: "2026-10-24T05:00:00.250Z" }),
  ]);
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "request-finished",
      started_at: "2026-10-24T05:00:00.200Z",
      elapsed_ms: 12.5,
    }),
  );
  const failure = events.find(({ kind }) => kind === "request-failed");
  expect(failure).toBeDefined();
  expect(failure).not.toHaveProperty("started_at");
  expect(failure).not.toHaveProperty("elapsed_ms");
});

it.each([
  { name: "structural expansion", body: '{"token":1}', limit: 16 },
  {
    name: "shadowed container",
    body: '{"token":{},"token":"source-private"}',
    limit: 2048,
  },
])("withholds marked content for $name", async ({ body, limit }) => {
  const { collector, events, secrets } = harness(
    selection,
    undefined,
    "declared-private",
    { max_network_body_bytes: limit },
  );
  const request = new RequestFixture("marked");
  request.responseSize = Buffer.byteLength(body);
  secrets.responseProtector("login", [
    { name: "token", json_pointer: "/token", secret: true },
  ])?.(request);
  const response = new ResponseFixture(request, body);
  collector.request(request);
  collector.response(response);
  collector.finished(request);
  await collector.finish();
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: "network-content",
      phase: "response",
      body: expect.objectContaining({ state: "unavailable" }),
      headers: expect.objectContaining({ state: "unavailable" }),
    }),
  );
  expect(response.bodyReads).toBe(1);
});
