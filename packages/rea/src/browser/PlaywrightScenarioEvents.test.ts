import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page, Request, Response } from "playwright-core";

import { browserScenarioSchema } from "../domain/browserScenario.js";
import { resolveScenarioSecrets } from "../../tests/fixtures/browserScenarioSecrets.js";
import { PlaywrightScenarioEvents } from "./PlaywrightScenarioEvents.js";

describe("declared secrets in scenario events", () => {
  it("redacts encoded declared secrets from text evidence and fingerprints", () => {
    const listeners = new Map<string, (value: unknown) => void>();
    const socketListeners = new Map<string, (value: unknown) => void>();
    const page = {
      on: (name: string, listener: (value: unknown) => void) => {
        listeners.set(name, listener);
      },
    } as unknown as Page;
    const secret = "a/b&c\n d";
    const scenario = browserScenarioSchema.parse({
      browser: { mode: "launch", executable_path: "/opt/chromium" },
      start_url: { url: "https://app.example.test/" },
      actions: [
        { step_id: "wait", action: "wait_for_timeout", duration_ms: 1 },
      ],
      secrets: [
        { secret_id: "login_input", environment_variable: "REA_TEST_TOKEN" },
      ],
      capture: { events: ["console", "page-errors", "websockets"] },
    });
    const secrets = resolveScenarioSecrets(scenario, {
      REA_TEST_TOKEN: secret,
    });
    const events = new PlaywrightScenarioEvents({
      page,
      enabled: new Set(["console", "page-errors", "websockets"]),
      secrets,
    });

    listeners.get("console")?.({
      type: () => "log",
      text: () => encodeURIComponent(secret),
      location: () => ({ url: "https://app.example.test/app.js" }),
    });
    const escapedSecret = JSON.stringify(secret).slice(1, -1);
    const error = new Error(`failure ${escapedSecret}`);
    error.stack = `failure ${escapedSecret}`;
    listeners.get("pageerror")?.(error);
    listeners.get("websocket")?.({
      url: () => "wss://app.example.test/socket",
      on: (name: string, listener: (value: unknown) => void) => {
        socketListeners.set(name, listener);
      },
    });
    const formEncodedSecret = new URLSearchParams([["value", secret]])
      .toString()
      .slice("value=".length);
    socketListeners.get("framesent")?.({ payload: formEncodedSecret });

    const items = events.result().items;
    expect(items).toMatchObject([
      { kind: "console", text: "[REDACTED:login_input]" },
      {
        kind: "page-error",
        message: "failure [REDACTED:login_input]",
        stack: "failure [REDACTED:login_input]",
      },
      { kind: "websocket-opened" },
      {
        kind: "websocket-frame-sent",
        payload_text: "[REDACTED:login_input]",
      },
    ]);
    expect(secrets.fingerprint(`stored ${encodeURIComponent(secret)}`)).toEqual(
      { value_state: "redacted-secret", value_sha256: null },
    );
  });
});

const captureNetworkBudgetFixture = async (
  maxTotalEventAllocationBytes?: number,
) => {
  const pageListeners = new Map<string, (value: unknown) => void>();
  const contextListeners = new Map<string, (value: unknown) => void>();
  const context = {
    on: (name: string, listener: (value: unknown) => void) =>
      contextListeners.set(name, listener),
    off: vi.fn(),
  } as unknown as BrowserContext;
  const page = {
    url: () => "http://127.0.0.1/fixture",
    context: () => context,
    on: (name: string, listener: (value: unknown) => void) =>
      pageListeners.set(name, listener),
    off: vi.fn(),
  } as unknown as Page;
  const scenario = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/fixture/chrome" },
    start_url: { url: "http://127.0.0.1/fixture" },
    actions: [{ step_id: "ready", action: "wait_for_timeout", duration_ms: 1 }],
    capture: {
      events: ["network"],
      network: { response_body: true },
      ...(maxTotalEventAllocationBytes === undefined
        ? {}
        : {
            limits: {
              max_total_event_allocation_bytes: maxTotalEventAllocationBytes,
            },
          }),
    },
  });
  const secrets = resolveScenarioSecrets(scenario, {});
  const redactBytes = vi.spyOn(secrets, "redactBytes");
  const redactJson = vi.spyOn(secrets, "redactJsonBody");
  const capture = new PlaywrightScenarioEvents({
    page,
    context,
    ownsContext: true,
    enabled: new Set(["network"]),
    network: scenario.capture.network,
    limits: scenario.capture.limits,
    secrets,
  });
  for (let index = 0; index < 43; index += 1) {
    const post = index >= 40;
    const body = post
      ? Buffer.from('{"ok":true}')
      : Buffer.from("x".repeat(60_000));
    const request = {
      method: () => (post ? "POST" : "GET"),
      url: () => `http://127.0.0.1/${post ? "final" : "data"}/${String(index)}`,
      resourceType: () => "fetch",
      postDataBuffer: () => (post ? Buffer.from("{}") : null),
      redirectedFrom: () => null,
      failure: () => null,
      headers: () => ({ "content-type": "application/json" }),
      headersArray: async () => [
        { name: "content-type", value: "application/json" },
      ],
    } as unknown as Request;
    const response = {
      request: () => request,
      url: () => request.url(),
      status: () => 200,
      headers: () => ({ "content-type": "application/json" }),
      headersArray: async () => [
        { name: "content-type", value: "application/json" },
      ],
      body: async () => body,
    } as unknown as Response;
    contextListeners.get("request")?.(request);
    contextListeners.get("response")?.(response);
    contextListeners.get("requestfinished")?.(request);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  await capture.finish();
  return {
    result: capture.result(),
    redactedByteValues: redactBytes.mock.calls.length,
    processedJsonBodies: redactJson.mock.calls.length,
  };
};

describe("PlaywrightScenarioEvents", () => {
  it("identifies omitted network transaction content and honors a raised budget", async () => {
    const baseline = await captureNetworkBudgetFixture();
    const raised = await captureNetworkBudgetFixture(32 * 1024 * 1024);
    expect(baseline.result.dropped).toBeGreaterThan(0);
    expect(
      baseline.result.omissions.by_kind.find(
        ({ kind }) => kind === "network-content",
      ),
    ).toMatchObject({
      count: expect.any(Number),
      reasons: expect.arrayContaining(["max-total-event-allocation-bytes"]),
    });
    expect(
      baseline.result.omissions.network_transactions.length,
    ).toBeGreaterThan(0);
    const retainedBodies = baseline.result.items.filter(
      (event) =>
        event.kind === "network-content" && event.body.state === "captured",
    ).length;
    expect(baseline.processedJsonBodies).toBe(retainedBodies);
    expect(baseline.redactedByteValues).toBe(2 * retainedBodies);
    expect(raised.result).toMatchObject({
      dropped: 0,
      omissions: { network_transactions: [] },
    });
    expect(
      raised.result.items.filter(
        (event) =>
          event.kind === "network-content" && event.phase === "response",
      ),
    ).toHaveLength(43);
  });

  it("observes requested popup page errors independently of popup lifecycle events", () => {
    const listeners = new Map<string, (value: unknown) => void>();
    const popupListeners = new Map<string, (value: unknown) => void>();
    const page = {
      on: (name: string, listener: (value: unknown) => void) => {
        listeners.set(name, listener);
      },
    } as unknown as Page;
    const popup = {
      url: () => "https://app.example.test/popup",
      on: (name: string, listener: (value: unknown) => void) => {
        popupListeners.set(name, listener);
      },
    } as unknown as Page;
    const scenario = browserScenarioSchema.parse({
      browser: { mode: "launch", executable_path: "/opt/chromium" },
      start_url: { url: "https://app.example.test/" },
      actions: [
        { step_id: "wait", action: "wait_for_timeout", duration_ms: 1 },
      ],
      capture: { events: ["page-errors"] },
    });
    const secrets = resolveScenarioSecrets(scenario, {});
    const events = new PlaywrightScenarioEvents({
      page,
      enabled: new Set(["page-errors"]),
      secrets,
    });
    listeners.get("popup")?.(popup);
    popupListeners.get("pageerror")?.(new Error("popup application failure"));
    expect(events.result().items).toMatchObject([
      { kind: "page-error", message: "popup application failure" },
    ]);
  });

  it("retains oversized page errors without truncating their text", () => {
    const listeners = new Map<string, (value: Error) => void>();
    const page = {
      url: () => "https://app.example.test/",
      on: (name: string, listener: (value: Error) => void) => {
        listeners.set(name, listener);
      },
    } as unknown as Page;
    const scenario = browserScenarioSchema.parse({
      browser: {
        mode: "launch",
        executable_path: "/opt/chromium",
      },
      start_url: { url: "https://app.example.test/" },
      environment: {
        viewport: { width: 1_280, height: 720 },
        locale: "en-US",
        timezone: "UTC",
        color_scheme: "light",
        reduced_motion: "reduce",
      },
      actions: [
        {
          step_id: "wait",
          action: "wait_for_timeout",
          duration_ms: 1,
        },
      ],
      storage: {},
      secrets: [],
      capture: {
        after_each_step: [],
        at_end: [],
        events: ["page-errors"],
      },
    });
    const secrets = resolveScenarioSecrets(scenario, {});
    const events = new PlaywrightScenarioEvents({
      page,
      enabled: new Set(["page-errors"]),
      secrets,
    });
    const error = new Error("m".repeat(70_000));
    error.stack = "s".repeat(300_000);

    listeners.get("pageerror")?.(error);
    expect(events.result().items[0]).toMatchObject({
      kind: "page-error",
      message: "m".repeat(70_000),
      stack: "s".repeat(300_000),
    });
  });
});

it("retains ordinary event volumes and reports event-count exhaustion", () => {
  const listeners = new Map<string, ((value: Error) => void)[]>();
  const page = {
    url: () => "https://app.example.test/",
    on: (name: string, listener: (value: Error) => void) => {
      const registered = listeners.get(name) ?? [];
      registered.push(listener);
      listeners.set(name, registered);
    },
  } as unknown as Page;
  const scenario = browserScenarioSchema.parse({
    browser: {
      mode: "launch",
      executable_path: "/opt/chromium",
    },
    start_url: { url: "https://app.example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
    capture: { events: ["page-errors"] },
  });
  const secrets = resolveScenarioSecrets(scenario, {});
  const events = new PlaywrightScenarioEvents({
    page,
    enabled: new Set(["page-errors"]),
    secrets,
  });
  for (let index = 0; index < 2_001; index += 1)
    listeners.get("pageerror")?.forEach((listener) => {
      const error = new Error(`failure-${index}`);
      error.stack = "";
      listener(error);
    });
  expect(events.result()).toMatchObject({ retained: 2_001, dropped: 0 });
  expect(events.result().items.at(-1)).toMatchObject({
    kind: "page-error",
    message: "failure-2000",
  });
  // Omit whole oversized events, preserving ordinary messages rather than
  // inventing truncated observations. This also tests admission before redact.
  const redact = vi.spyOn(secrets, "redact");
  listeners.get("pageerror")?.forEach((listener) => {
    const error = new Error("x".repeat(1_000_000));
    error.stack = "";
    listener(error);
  });
  expect(redact).not.toHaveBeenCalled();
  for (let index = 0; index < 10_000; index += 1)
    listeners.get("pageerror")?.forEach((listener) => {
      const error = new Error(`short-${index}`);
      error.stack = "";
      listener(error);
    });
  expect(events.result()).toMatchObject({ retained: 10_000, dropped: 2_002 });
  expect(events.limitations().join(" ")).toContain("resource budget");
  const aggregate = new PlaywrightScenarioEvents({
    page,
    enabled: new Set(["page-errors"]),
    secrets,
  });
  const aggregateListener = listeners.get("pageerror")?.at(-1);
  const aggregateRedact = vi.spyOn(secrets, "redact");
  let refused = false;
  for (let index = 0; index < 64 && !refused; index += 1) {
    aggregateRedact.mockClear();
    const droppedBefore = aggregate.result().dropped;
    const error = new Error("x".repeat(400_000));
    error.stack = "";
    aggregateListener?.(error);
    refused = aggregate.result().dropped > droppedBefore;
    if (refused) expect(aggregateRedact.mock.calls.length).toBe(0);
  }
  expect(refused).toBe(true);

  const small = new Error("small event remains eligible");
  small.stack = "";
  aggregateRedact.mockClear();
  aggregateListener?.(small);
  expect(aggregateRedact.mock.calls.length).toBeGreaterThan(0);
  expect(aggregate.result().retained).toBeGreaterThan(0);
  expect(aggregate.result().items.at(-1)).toMatchObject({
    kind: "page-error",
    message: "small event remains eligible",
  });
});

it("caps live descendant listeners and reuses capacity after closure", () => {
  const listeners = new Map<string, (value: unknown) => void>();
  const page = {
    on: (name: string, listener: (value: unknown) => void) =>
      listeners.set(name, listener),
    off: vi.fn(),
  } as unknown as Page;
  const scenario = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/fixture/chrome" },
    start_url: { url: "https://example.test" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
  });
  const secrets = resolveScenarioSecrets(scenario, {});
  const events = new PlaywrightScenarioEvents({
    page,
    enabled: new Set(["websockets"]),
    secrets,
  });
  const sockets = Array.from({ length: 2049 }, () => ({
    url: () => "wss://example.test/",
    on: vi.fn<(name: string, listener: () => void) => void>(),
    off: vi.fn(),
  }));
  for (const socket of sockets.slice(0, 2048))
    listeners.get("websocket")?.(socket);
  expect(sockets[2046]?.on).toHaveBeenCalledTimes(3);
  expect(sockets[2047]?.on).not.toHaveBeenCalled();
  expect(events.result().dropped).toBe(1);
  const close = sockets[0]?.on.mock.calls.find(
    ([name]) => name === "close",
  )?.[1];
  close?.();
  expect(sockets[0]?.off).toHaveBeenCalledTimes(3);
  listeners.get("websocket")?.(sockets[2048]);
  expect(sockets[2048]?.on).toHaveBeenCalledTimes(3);
});

/** Emit the request before attaching the source policy, matching Playwright listener order. */
const sourceTransactionCapture = async (
  options: {
    fail?: boolean;
    followup?: boolean;
    metadataOnly?: boolean;
    learnDirect?: boolean;
    latePageValue?: string;
    value?: string;
    padding?: number;
    metadataLimit?: number;
  } = {},
) => {
  const listeners = new Map<string, (value: unknown) => void>();
  const context = {
    on: (name: string, listener: (value: unknown) => void) =>
      listeners.set(name, listener),
    off: vi.fn(),
  } as unknown as BrowserContext;
  const page = {
    context: () => context,
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Page;
  const value = options.value ?? "credential-82ea";
  const url = `https://example.test/exchange?token=${value.repeat(options.padding ?? 1)}&safe=visible`;
  const body = JSON.stringify({
    token: value,
    ...(options.latePageValue === undefined
      ? {}
      : { page: options.latePageValue }),
    public: "kept",
  });
  const parsed = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/fixture/browser" },
    start_url: { url: "https://example.test/" },
    actions: [{ step_id: "click", action: "wait_for_timeout", duration_ms: 1 }],
    capture: {
      events: ["network"],
      network: {
        request_body: !options.metadataOnly,
        response_body: !options.metadataOnly,
        header_values: !options.metadataOnly,
      },
      ...(options.metadataLimit === undefined
        ? {}
        : {
            limits: {
              max_network_metadata_allocation_bytes: options.metadataLimit,
            },
          }),
    },
  });
  const secrets = resolveScenarioSecrets(parsed, {});
  const capture = new PlaywrightScenarioEvents({
    page,
    context,
    ownsContext: true,
    enabled: new Set(["network"]),
    network: parsed.capture.network,
    limits: parsed.capture.limits,
    secrets,
  });
  const request = {
    method: () => "POST",
    url: () => url,
    resourceType: () => "fetch",
    redirectedFrom: () => null,
    postDataBuffer: () => Buffer.from(body),
    failure: () => null,
    sizes: async () => ({ responseBodySize: Buffer.byteLength(body) }),
    headers: () => ({
      "content-type": "application/json",
      "x-source-token": value,
    }),
    headersArray: async () => [
      { name: "Content-Type", value: "application/json" },
      { name: "X-Source-Token", value },
    ],
  };
  listeners.get("request")!(request);
  if (!options.metadataOnly)
    await vi.waitFor(() =>
      expect(capture.result().items).toContainEqual(
        expect.objectContaining({ kind: "network-content", phase: "request" }),
      ),
    );
  if (options.latePageValue !== undefined)
    secrets.admitPageValue("later.cookie", options.latePageValue);
  const sourceId = capture
    .result()
    .items.find((event) => event.kind === "request")!.transaction_id;
  // This same-URL transaction has no source policy; unknown source values must not withhold it.
  const unrelated = { ...request };
  listeners.get("request")!(unrelated);
  listeners.get("requestfinished")!(unrelated);
  secrets.responseProtector("click", [
    { name: "token", json_pointer: "/token", secret: true },
  ])?.(request);
  if (options.learnDirect)
    secrets.responseProtector("click", [
      { name: "token", json_pointer: "/token", secret: true },
    ])?.(unrelated);
  listeners.get("response")!({
    request: () => request,
    url: () => url,
    status: () => 200,
    headers: () => ({ "content-type": "application/json" }),
    headersArray: async () => [],
    body: async () => {
      if (options.fail) throw new Error(`Read failed for ${url}`);
      return Buffer.from(body);
    },
  });
  if (options.followup) {
    const followup = {
      ...request,
      url: () => `https://example.test/followup?token=${value}`,
    };
    listeners.get("request")!(followup);
    listeners.get("response")!({
      request: () => followup,
      url: () => followup.url(),
      status: () => 200,
      headers: () => ({ "content-type": "application/json" }),
      headersArray: async () => [{ name: "X-Followup", value }],
      body: async () => Buffer.from(body),
    });
    listeners.get("requestfinished")!(followup);
    if (!options.metadataOnly)
      await vi.waitFor(() =>
        expect(
          capture
            .result()
            .items.filter(
              (event) =>
                event.kind === "network-content" && event.phase === "response",
            ),
        ).toHaveLength(1),
      );
  }
  if (options.learnDirect) secrets.save("click.token", "token", value, true);
  listeners.get("requestfinished")!(request);
  await capture.finish();
  return { capture, sourceId, value, url };
};

it("redacts earlier source transaction metadata and request content before publishing", async () => {
  const { capture, sourceId, value } = await sourceTransactionCapture();
  const source = capture
    .result()
    .items.filter(
      (event) => "transaction_id" in event && event.transaction_id === sourceId,
    );
  expect(source.filter((event) => event.kind === "request")).toHaveLength(1);
  expect(source).toContainEqual(
    expect.objectContaining({
      kind: "request",
      url: expect.objectContaining({
        origin: "https://example.test",
        query_parameter_names: ["token", "safe"],
        redacted: true,
        url: expect.stringContaining("safe=visible"),
      }),
    }),
  );
  expect(JSON.stringify(source)).not.toContain(value);
  for (const event of source)
    if (event.kind === "network-content" && event.body.state === "captured") {
      const text = Buffer.from(event.body.content, "base64").toString();
      expect(text).not.toContain(value);
      expect(JSON.parse(text).token).toBe("[REDACTED:page:click.token]");
    }
  expect(capture.result().items).toContainEqual(
    expect.objectContaining({
      kind: "request",
      transaction_id: expect.not.stringMatching(new RegExp(`^${sourceId}$`)),
      url: expect.objectContaining({
        origin: "https://example.test",
        redacted: true,
        url: expect.stringContaining("safe=visible"),
      }),
    }),
  );
  const finished = JSON.stringify(capture.result());
  await capture.finish();
  expect(JSON.stringify(capture.result())).toBe(finished);
});

it("withholds source URLs and earlier content if source values cannot be read", async () => {
  const { capture, sourceId, value } = await sourceTransactionCapture({
    fail: true,
  });
  const source = capture
    .result()
    .items.filter(
      (event) => "transaction_id" in event && event.transaction_id === sourceId,
    );
  expect(JSON.stringify(source)).not.toContain(value);
  expect(source).toContainEqual(
    expect.objectContaining({
      kind: "request",
      url: { url: "", origin: null, query_parameter_names: [], redacted: true },
    }),
  );
  expect(source).toContainEqual(
    expect.objectContaining({
      kind: "network-content",
      phase: "request",
      body: expect.objectContaining({ state: "unavailable" }),
    }),
  );
  expect(capture.limitations().join(" ")).toContain(
    "marked response values were unavailable",
  );
});

it("accounts for source metadata redaction expansion before publishing replacements", async () => {
  const { capture, sourceId } = await sourceTransactionCapture({
    value: "a",
    padding: 1000,
    metadataLimit: 50_000,
  });
  expect(capture.result().omissions.network_transactions).toContainEqual(
    expect.objectContaining({
      transaction_id: sourceId,
      reasons: expect.arrayContaining([
        "max-network-metadata-allocation-bytes",
      ]),
    }),
  );
});

it("re-protects follow-up URLs, headers and both body phases recorded before source secrets were learned", async () => {
  const { capture, value } = await sourceTransactionCapture({ followup: true });
  const request = capture
    .result()
    .items.find(
      (event) =>
        event.kind === "request" && event.url.url.includes("/followup?"),
    );
  expect(request).toBeDefined();
  if (request?.kind !== "request")
    throw new Error("Expected actual follow-up request");
  const events = capture
    .result()
    .items.filter(
      (event) =>
        "transaction_id" in event &&
        event.transaction_id === request.transaction_id,
    );
  expect(JSON.stringify(events)).not.toContain(value);
  const bodies = events.flatMap((event) =>
    event.kind === "network-content" && event.body.state === "captured"
      ? [Buffer.from(event.body.content, "base64").toString()]
      : [],
  );
  expect(bodies).toHaveLength(2);
  for (const body of bodies) {
    expect(body).not.toContain(value);
    expect(JSON.parse(body)).toEqual({
      token: "[REDACTED:page:click.token]",
      public: "kept",
    });
  }
});

it("protects metadata-only follow-ups when direct saves learn a secret without unambiguous source identity", async () => {
  const { capture, value } = await sourceTransactionCapture({
    followup: true,
    metadataOnly: true,
    learnDirect: true,
  });
  const request = capture
    .result()
    .items.find(
      (event) =>
        event.kind === "request" && event.url.url.includes("/followup?"),
    );
  expect(request).toMatchObject({
    url: { redacted: true, origin: "https://example.test" },
  });
  expect(JSON.stringify(capture.result().items)).not.toContain(value);
  expect(
    capture.result().items.some((event) => event.kind === "network-content"),
  ).toBe(false);
});

it("protects earlier non-network event text after a response secret is learned, without network selection", async () => {
  const listeners = new Map<string, (value: unknown) => void>();
  const socketListeners = new Map<string, (value: unknown) => void>();
  const page = {
    on: (name: string, listener: (value: unknown) => void) =>
      listeners.set(name, listener),
    off: vi.fn(),
  } as unknown as Page;
  const parsed = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/fixture/browser" },
    start_url: { url: "https://example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
  });
  const secrets = resolveScenarioSecrets(parsed, {});
  const capture = new PlaywrightScenarioEvents({
    page,
    enabled: new Set([
      "console",
      "page-errors",
      "websockets",
      "frames",
      "workers",
      "popups",
      "downloads",
    ]),
    secrets,
  });
  const value = "late-secret-829a";
  const url = `https://example.test/?token=${value}`;
  listeners.get("console")!({
    type: () => "log",
    text: () => value,
    location: () => ({ url }),
  });
  const error = new Error(value);
  error.stack = value;
  listeners.get("pageerror")!(error);
  listeners.get("websocket")!({
    url: () => url,
    on: (name: string, listener: (value: unknown) => void) =>
      socketListeners.set(name, listener),
    off: vi.fn(),
  });
  socketListeners.get("framesent")!({ payload: value });
  listeners.get("framenavigated")!({ url: () => url, name: () => value });
  listeners.get("worker")!({ url: () => url, on: vi.fn(), off: vi.fn() });
  listeners.get("popup")!({ url: () => url, on: vi.fn(), off: vi.fn() });
  listeners.get("download")!({
    url: () => url,
    suggestedFilename: () => value,
    cancel: async () => undefined,
  });
  expect(capture.result().items.length).toBeGreaterThanOrEqual(8);
  expect(JSON.stringify(capture.result().items)).toContain(value);
  secrets.save("late.token", "token", value, true);
  await capture.finish();
  expect(JSON.stringify(capture.result().items)).not.toContain(value);
  expect(JSON.stringify(capture.result().items)).toContain("REDACTED");
  const finished = JSON.stringify(capture.result());
  await capture.finish();
  expect(JSON.stringify(capture.result())).toBe(finished);
});

it("accounts for late non-network redaction expansion and reports omissions once", async () => {
  const listeners = new Map<string, (value: unknown) => void>();
  const page = {
    on: (name: string, listener: (value: unknown) => void) =>
      listeners.set(name, listener),
    off: vi.fn(),
  } as unknown as Page;
  const parsed = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/fixture/browser" },
    start_url: { url: "https://example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
    capture: { limits: { max_event_allocation_bytes: 20_000 } },
  });
  const secrets = resolveScenarioSecrets(parsed, {});
  const capture = new PlaywrightScenarioEvents({
    page,
    enabled: new Set(["console"]),
    limits: parsed.capture.limits,
    secrets,
  });
  listeners.get("console")!({
    type: () => "log",
    text: () => "x".repeat(1000),
    location: () => ({ url: "" }),
  });
  expect(capture.result().retained).toBe(1);
  secrets.save("late.token", "token", "x", true);
  await capture.finish();
  expect(capture.result()).toMatchObject({
    retained: 0,
    dropped: 1,
    omissions: {
      by_kind: [
        { kind: "console", count: 1, reasons: ["max-event-allocation-bytes"] },
      ],
      network_transactions: [],
    },
  });
  await capture.finish();
  expect(capture.result().dropped).toBe(1);
});

it.each(["page", "basic"])(
  "preserves pre-read %s facts while backfilling only response-marked values",
  async (kind) => {
    for (const responseSave of [false, true]) {
      const listeners = new Map<string, (value: unknown) => void>();
      const page = {
        on: (name: string, listener: (value: unknown) => void) =>
          listeners.set(name, listener),
        off: vi.fn(),
      } as unknown as Page;
      const parsed = browserScenarioSchema.parse({
        browser: { mode: "launch", executable_path: "/fixture/browser" },
        start_url: { url: "https://example.test/" },
        actions: [
          { step_id: "wait", action: "wait_for_timeout", duration_ms: 1 },
        ],
      });
      const secrets = resolveScenarioSecrets(parsed, {});
      const capture = new PlaywrightScenarioEvents({
        page,
        enabled: new Set(["console"]),
        secrets,
      });
      const value =
        kind === "page"
          ? "csrf-page-value-729d"
          : Buffer.from("user:password").toString("base64");
      const message = `${value} response-value-82ea`;
      const emit = () =>
        listeners.get("console")!({
          type: () => "log",
          text: () => message,
          location: () => ({ url: "" }),
        });
      emit();
      if (kind === "page") secrets.admitPageValue("request.cookie", value);
      else secrets.basicCredential("request.auth", "user", "password");
      emit();
      if (responseSave)
        secrets.save("response.token", "token", "response-value-82ea", true);
      await capture.finish();
      const events = capture.result().items;
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        kind: "console",
        text: expect.stringContaining(value),
      });
      expect(events[1]).toMatchObject({
        kind: "console",
        text: expect.not.stringContaining(value),
      });
      expect(JSON.stringify(events).includes("response-value-82ea")).toBe(
        !responseSave,
      );
    }
  },
);

it("preserves a response field recorded before a later page-value read while backfilling response secrets", async () => {
  const pageValue = "csrf-page-value-729d";
  const { capture, sourceId, value } = await sourceTransactionCapture({
    latePageValue: pageValue,
  });
  const first = capture
    .result()
    .items.find(
      (event) =>
        event.kind === "network-content" &&
        event.transaction_id === sourceId &&
        event.phase === "request",
    );
  expect(first).toBeDefined();
  if (first?.kind !== "network-content" || first.body.state !== "captured")
    throw new Error("Expected retained earlier request bytes");
  const body = JSON.parse(Buffer.from(first.body.content, "base64").toString());
  expect(body.page).toBe(pageValue);
  expect(body.token).toBe("[REDACTED:page:click.token]");
  expect(body.token).not.toContain(value);
});

it("promotes an already held page value to response scope without changing its first marker", () => {
  const parsed = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/fixture/browser" },
    start_url: { url: "https://example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
  });
  const secrets = resolveScenarioSecrets(parsed, {});
  const value = "existing-page-value-82ea";
  secrets.admitPageValue("cookie.token", value);
  expect(secrets.redact(value, "response")).toBe(value);
  expect(secrets.hasLearnedResponseSecrets()).toBe(false);
  secrets.save("response.token", "token", value, true);
  expect(secrets.hasLearnedResponseSecrets()).toBe(true);
  expect(secrets.redact(value, "response")).toBe(
    "[REDACTED:page:cookie.token]",
  );
  expect(secrets.redactBytes(Buffer.from(value), "response").toString()).toBe(
    "[REDACTED:page:cookie.token]",
  );
  secrets.admitPageValue("later.unrelated", "unrelated-page-value-729d");
  expect(secrets.redact("unrelated-page-value-729d", "response")).toBe(
    "unrelated-page-value-729d",
  );
  expect(secrets.redact(value, "response")).toBe(
    "[REDACTED:page:cookie.token]",
  );
});
