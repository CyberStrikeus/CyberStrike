import { createServer, type RequestListener, type Server } from "node:http";
import { once } from "node:events";

import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { WEB_RUNTIME_LIMITS } from "../domain/webRuntime.js";

import { afterEach, describe, expect, it } from "vitest";

import type { CdpConnection } from "./CdpConnection.js";
import {
  discoverCdpEndpoint,
  discoverCdpBrowserSocket,
  readCdpJson,
  withCdpDiscoveryDeadline,
} from "./CdpEndpoint.js";

const servers: Server[] = [];

const listen = async (
  handler: RequestListener,
): Promise<{ readonly server: Server; readonly endpoint: string }> => {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected a TCP listener address.");
  return {
    server,
    endpoint: `http://127.0.0.1:${String(address.port)}`,
  };
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      if (server.listening) {
        server.close();
        await once(server, "close");
      }
    }),
  );
});

it("retains usable CDP sibling identities and reports malformed optional discovery metadata", async () => {
  const { endpoint } = await listen((request, response) => {
    const port = new URL(endpoint).port;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url === "/json/version"
          ? {
              Browser: "Chrome/fixture",
              "Protocol-Version": "1.3",
              "User-Agent": "fixture",
              "V8-Version": "fixture",
              "WebKit-Version": "fixture",
              webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fixture`,
            }
          : [
              {
                id: "malformed-attachment",
                type: "page",
                url: "https://example.test/a",
                attached: "unknown",
              },
              {
                id: "selected",
                type: "page",
                url: "https://example.test/b",
                attached: false,
                webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/selected`,
              },
              { id: 1, type: "page", url: "https://example.test/invalid" },
              {
                id: "invalid-socket",
                type: "page",
                url: "https://example.test/c",
                attached: null,
                webSocketDebuggerUrl: 1,
              },
              {
                id: "worker",
                type: "worker",
                url: "https://example.test/worker",
                attached: true,
              },
            ],
      ),
    );
  });
  const discovery = await discoverCdpEndpoint(endpoint, "list_browser_targets");
  expect(discovery.targets.map(({ id }) => id)).toEqual([
    "malformed-attachment",
    "selected",
    "invalid-socket",
    "worker",
  ]);
  expect(discovery.targets[0]?.attached).toBeNull();
  expect(discovery.targets[1]?.webSocket).toMatchObject({
    scope: "page",
    targetId: "selected",
  });
  expect(discovery.targets[2]?.webSocket).toBeUndefined();
  expect(discovery.targets[3]?.attached).toBe(true);
  expect(discovery.limitations).toEqual(
    expect.arrayContaining([
      expect.stringContaining(
        'target malformed-attachment reported malformed attached metadata "unknown"',
      ),
      expect.stringContaining(
        "row 2 was excluded because its target identity is malformed",
      ),
    ]),
  );
});

describe("CDP discovery cancellation ownership", () => {
  it("preserves the exact reason for a pre-aborted discovery request", async () => {
    let requests = 0;
    const { endpoint } = await listen((_request, response) => {
      requests += 1;
      response.end("{}");
    });
    const reason = { _tag: "caller-stop" };
    const controller = new AbortController();
    controller.abort(reason);

    const failure = await readCdpJson(
      new URL("/json/version", endpoint),
      "inspect_web_page",
      controller.signal,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AnalysisCancelledError);
    expect(failure).toMatchObject({ cause: reason });
    expect(requests).toBe(0);
  });

  it("cancels an in-flight discovery at the HTTP producer with the original reason", async () => {
    let requestedPath: string | undefined;
    let requestSeen!: () => void;
    const seen = new Promise<void>((resolve) => {
      requestSeen = resolve;
    });
    const { endpoint } = await listen((request) => {
      requestedPath = request.url;
      requestSeen();
    });
    const reason = new Error("operator stopped discovery");
    const controller = new AbortController();
    const discovery = discoverCdpEndpoint(
      endpoint,
      "inspect_web_page",
      controller.signal,
    ).catch((error: unknown) => error);

    await seen;
    controller.abort(reason);
    const failure = await discovery;

    expect(requestedPath).toBe("/json/version");
    expect(failure).toBeInstanceOf(AnalysisCancelledError);
    expect(failure).toMatchObject({ cause: reason });
  });

  it("does not replace a primary discovery failure when cancellation arrives later", async () => {
    const primary = new BrowserObservationError(
      "inspect_web_page",
      "protocol_error",
    );
    const controller = new AbortController();
    const failure = await withCdpDiscoveryDeadline(
      "inspect_web_page",
      controller.signal,
      async () => {
        throw primary;
      },
      100,
    ).catch((error: unknown) => error);
    controller.abort(new Error("late caller cancellation"));

    expect(failure).toBe(primary);
  });

  it("does not replace a plain physical failure rejected before a late abort", async () => {
    const primary = new Error("socket failed before cancellation");
    const controller = new AbortController();
    const pending = withCdpDiscoveryDeadline(
      "inspect_web_page",
      controller.signal,
      () => Promise.reject(primary),
      100,
    ).catch((error: unknown) => error);
    controller.abort(new Error("later caller cancellation"));
    const failure = await pending;

    expect(failure).toBe(primary);
  });

  it("classifies its own discovery deadline as timeout", async () => {
    const failure = await withCdpDiscoveryDeadline(
      "inspect_web_page",
      undefined,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
      1,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BrowserObservationError);
    expect(failure).toMatchObject({ reason: "timeout" });
  });

  it("normalizes a typed cancellation caused by its own deadline to timeout", async () => {
    const failure = await withCdpDiscoveryDeadline(
      "inspect_web_page",
      undefined,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(
                new AnalysisCancelledError("inspect_web_page", {
                  cause: signal.reason,
                }),
              ),
            { once: true },
          );
        }),
      1,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BrowserObservationError);
    expect(failure).toMatchObject({ reason: "timeout" });
  });

  it("treats the caller's AnalysisError abort reason as cancellation when caller wins first", async () => {
    const reason = new BrowserObservationError(
      "inspect_web_page",
      "protocol_error",
    );
    const controller = new AbortController();
    const failure = await withCdpDiscoveryDeadline(
      "inspect_web_page",
      controller.signal,
      async () => {
        controller.abort(reason);
        throw reason;
      },
      0,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AnalysisCancelledError);
    expect(failure).toMatchObject({ cause: reason });
  });

  it("keeps a deadline rejection when the caller aborts only after timeout", async () => {
    const controller = new AbortController();
    const failure = await withCdpDiscoveryDeadline(
      "inspect_web_page",
      controller.signal,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
      0,
    ).catch((error: unknown) => error);
    controller.abort(new Error("caller stopped after timeout"));

    expect(failure).toBeInstanceOf(BrowserObservationError);
    expect(failure).toMatchObject({ reason: "timeout" });
  });
});

it("names the browser-socket message budget when that discovery deadline expires", async () => {
  const failure = await withCdpDiscoveryDeadline(
    "list_browser_targets",
    undefined,
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
    1,
  ).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(BrowserObservationError);
  if (!(failure instanceof BrowserObservationError)) return;
  expect(failure.userMessage).toContain(
    `${String(WEB_RUNTIME_LIMITS.protocolBytes)}-byte browser-socket message budget`,
  );
  expect(failure.userMessage).not.toContain(
    "8388608-byte discovery document budget",
  );
});

it("names the HTTP discovery document budget when that response deadline expires", async () => {
  const { endpoint } = await listen(() => undefined);
  const failure = await readCdpJson(
    new URL(endpoint),
    "list_browser_targets",
    undefined,
    { bytes: 8 * 1024 * 1024, timeoutMs: 20 },
  ).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(BrowserObservationError);
  if (!(failure instanceof BrowserObservationError)) return;
  expect(failure.userMessage).toContain(
    "8388608-byte discovery document budget",
  );
  expect(failure.userMessage).toContain("20 ms");
  expect(failure.userMessage).not.toContain(
    `${String(WEB_RUNTIME_LIMITS.protocolBytes)}-byte browser-socket message budget`,
  );
});

const socketDiscoveryConnection = (
  targetReply: unknown,
): Pick<CdpConnection, "send"> => ({
  async send(method: string): Promise<unknown> {
    if (method === "Browser.getVersion")
      return {
        protocolVersion: "1.3",
        product: "fixture",
        revision: "fixture",
        userAgent: "fixture",
        jsVersion: "fixture",
      };
    if (method === "Target.getTargets") return targetReply;
    throw new Error(method);
  },
});

it.each([
  { label: "absent document", reply: undefined },
  { label: "null document", reply: null },
  { label: "array document", reply: [] },
  { label: "missing target list", reply: {} },
  { label: "null target list", reply: { targetInfos: null } },
  { label: "string target list", reply: { targetInfos: "invalid" } },
  { label: "object target list", reply: { targetInfos: {} } },
])("rejects an $label during browser-socket discovery", async ({ reply }) => {
  await expect(
    discoverCdpBrowserSocket(
      socketDiscoveryConnection(reply),
      "ws://127.0.0.1:9222/devtools/browser/fixture",
      "list_browser_targets",
    ),
  ).rejects.toMatchObject({
    reason: "invalid_endpoint_response",
    detail: expect.stringContaining("CDP Target.getTargets"),
  });
});

it("retains an explicitly empty browser-socket target inventory", async () => {
  await expect(
    discoverCdpBrowserSocket(
      socketDiscoveryConnection({ targetInfos: [] }),
      "ws://127.0.0.1:9222/devtools/browser/fixture",
      "list_browser_targets",
    ),
  ).resolves.toMatchObject({ targets: [], limitations: [] });
});

it("preserves an independent typed cancellation when the discovery deadline also expires", async () => {
  const primary = new AnalysisCancelledError("inspect_web_page", {
    cause: "independent cancellation",
  });
  const failure = await withCdpDiscoveryDeadline(
    "inspect_web_page",
    undefined,
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(primary), { once: true });
      }),
    1,
  ).catch((cause: unknown) => cause);
  expect(failure).toBe(primary);
});

it("preserves browser-socket sibling identities and reports malformed optional metadata", async () => {
  const discovery = await discoverCdpBrowserSocket(
    {
      send: async (method) =>
        method === "Browser.getVersion"
          ? {
              protocolVersion: "1.3",
              product: "Chrome/fixture",
              revision: "r",
              userAgent: "fixture",
              jsVersion: "v8",
            }
          : {
              targetInfos: [
                {
                  targetId: "valid",
                  type: "page",
                  url: "https://example.test/",
                  title: "Example",
                  attached: false,
                },
                {
                  targetId: "partial",
                  type: "page",
                  url: "https://example.test/other",
                  title: 42,
                  attached: "yes",
                },
                { targetId: "broken", type: "page" },
                {
                  id: "wrong-identity-field",
                  type: "page",
                  url: "https://example.test/",
                },
              ],
            },
    },
    "ws://127.0.0.1:9222/devtools/browser/fixture",
    "list_browser_targets",
  );
  expect(discovery.targets).toEqual([
    {
      id: "valid",
      type: "page",
      url: "https://example.test/",
      title: "Example",
      attached: false,
    },
    {
      id: "partial",
      type: "page",
      url: "https://example.test/other",
      title: "",
      attached: null,
    },
  ]);
  expect(discovery.limitations).toHaveLength(4);
  expect(
    discovery.limitations?.every((limitation) =>
      limitation.startsWith("CDP Target.getTargets row"),
    ),
  ).toBe(true);
});
