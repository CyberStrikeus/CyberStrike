import { describe, expect, it } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import {
  startFakeCdpBrowser,
  type FakeCdpBrowser,
} from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

describe("CdpBrowserProvider: passive evidence redaction", () => {
  it("captures bounded passive evidence without retaining sensitive values", async () => {
    const browser = await startFakeCdpBrowser({
      binaryWebSocketEvent: true,
      foreignSessionEvents: true,
      unrelatedWorker: true,
    });
    trackBrowser(browser);
    const provider = new CdpBrowserProvider();
    const result = await provider.inspectPage(
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
    expect(() => webPageInspectionSchema.parse(result.value)).not.toThrow();
    expect(result.value.frames).toHaveLength(1);
    expect(result.value.dom.nodes).toHaveLength(2);
    expect(result.value.dom.nodes[1]?.attribute_names).toEqual([
      "token",
      "href",
      "rel",
    ]);
    expect(result.value.accessibility).toMatchObject({
      text_capture: {
        status: "not_approved",
        retained_bytes: 0,
      },
      nodes: [expect.objectContaining({ name: null, description: null })],
    });
    expect(result.value.scripts.items).toHaveLength(1);
    expect(result.value.scripts.items[0]?.script_key).toMatch(
      /^scr_[a-f0-9]{64}$/u,
    );
    expect(result.value.scripts.items[0]?.frame_id).toBe("frame-main");
    expect(result.value.scripts.items[0]?.source_map_url).toBe(
      `${browser.allowedOrigin}/app.js.map?token=map-secret`,
    );
    expect(result.value.scripts.items[0]?.resource_reconciliation).toEqual({
      status: "exact",
      resource_key: result.value.resources[0]?.resource_key,
    });
    expect(result.value.scripts.items[0]?.source).toEqual({
      included: false,
      reason: "source capture was not selected",
    });
    expect(result.value.resources).toHaveLength(1);
    expect(result.value.network.requests).toHaveLength(1);
    expect(result.value.network.requests[0]?.initiator).toEqual({
      type: "script",
      url: `${browser.allowedOrigin}/app.js?caller=caller-secret`,
      line: 3,
      column: 5,
    });
    expect(result.value.network.websocket_connections).toEqual([
      {
        request_id: "websocket-1",
        url: `ws://${new URL(browser.allowedOrigin).host}/live?token=websocket-url-secret`,
        events: [
          {
            direction: "sent",
            opcode: 1,
            payload_bytes: Buffer.byteLength("websocket-secret"),
            payload_shape: null,
          },
          {
            direction: "received",
            opcode: 2,
            payload_bytes: 3,
            payload_shape: null,
          },
        ],
      },
    ]);
    expect(result.value.console.events[0]?.argument_types).toEqual(["string"]);
    expect(result.value.workers).toHaveLength(1);
    expect(result.value.workers[0]).toMatchObject({
      opener_target_id: "allowed-page",
      parent_frame_id: null,
    });
    expect(result.value.metadata).toMatchObject({
      headers_allowlisted: true,
      responses: [
        {
          content_length: 321,
          content_encoding: "br",
          csp: { nonce_count: 1, hash_count: 1 },
          policies: {
            coop: "same-origin",
            coep: "require-corp",
            permissions_policy_features: ["camera", "geolocation"],
          },
        },
      ],
      dom_urls: [
        {
          attribute: "href",
          url: `${browser.allowedOrigin}/agent?token=dom-url-secret`,
          destination_scope: "approved",
        },
      ],
      agent_hints: expect.arrayContaining([
        expect.objectContaining({
          mechanism: "link_rel",
          declaration: "mcp service-desc",
        }),
        expect.objectContaining({
          mechanism: "dom_link_rel",
          declaration: "mcp",
        }),
        expect.objectContaining({
          mechanism: "response_header",
          declaration: "x-model-context",
        }),
      ]),
    });
    expect(result.value.storage).toEqual(
      expect.objectContaining({
        local_storage_keys: ["public-key"],
        session_storage_keys: ["public-key"],
        indexed_db_names: ["app-db"],
        cache_names: ["assets-v1"],
        content_fingerprints: expect.arrayContaining([
          expect.objectContaining({ scope: "cookie", complete: true }),
          expect.objectContaining({ scope: "local_storage", complete: true }),
          expect.objectContaining({ scope: "session_storage", complete: true }),
          expect.objectContaining({
            scope: "indexed_db_schema",
            complete: true,
          }),
          expect.objectContaining({
            scope: "indexed_db_record",
            complete: true,
          }),
          expect.objectContaining({ scope: "cache_entry", complete: true }),
        ]),
        fingerprint_algorithm: "sha256",
        fingerprints_complete: true,
        values_redacted: true,
      }),
    );
    expectSensitiveValuesAbsent(result.value, browser);
  });
});

describe("CdpBrowserProvider: page cookie scope", () => {
  it("uses the attached page URL for cookies and its origin for DOM storage", async () => {
    const browser = await startFakeCdpBrowser();
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
    expect(
      browser.commands.find(({ method }) => method === "Network.getCookies")
        ?.params,
    ).toEqual({ urls: [`${browser.allowedOrigin}/app?token=frame-secret`] });
    expect(
      browser.commands.find(
        ({ method }) => method === "DOMStorage.getDOMStorageItems",
      )?.params,
    ).toEqual({
      storageId: {
        securityOrigin: browser.allowedOrigin,
        isLocalStorage: true,
      },
    });
  });
});

describe("CdpBrowserProvider: complete storage fingerprints", () => {
  it("fingerprints cache bodies above the former byte ceiling", async () => {
    const body = "x".repeat(64 * 1_024 + 1);
    const browser = await startFakeCdpBrowser({ cachedResponseBody: body });
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
    expect(result.value.storage.fingerprints_complete).toBe(true);
    expect(
      result.value.storage.content_fingerprints.find(
        ({ scope }) => scope === "cache_entry",
      ),
    ).toMatchObject({ complete: true, value_sha256: expect.any(String) });
    expect(JSON.stringify(result.value)).not.toContain(body);
  });
});

describe("CdpBrowserProvider: explicitly requested text and payload shapes", () => {
  it("captures requested console text verbatim and value-free payload shapes", async () => {
    const browser = await startFakeCdpBrowser({
      sensitiveShapes: true,
      binaryWebSocketEvent: true,
      nullConsoleArgument: true,
      eventsBeforeReply: ["Network.enable"],
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
        include_console_text: true,
        include_json_body_shapes: true,
        include_websocket_shapes: true,
      }),
    );

    if (!result.ok) throw result.error;
    expect(result.value.console.events[0]?.argument_types).toEqual([
      "string",
      "number",
      "object",
      "object",
    ]);
    expect(result.value.console.events[0]?.text_capture).toEqual({
      status: "included",
      values: [
        {
          argument_index: 0,
          type: "string",
          text: "authorization=Bearer console-secret",
        },
        { argument_index: 1, type: "number", text: "42" },
        { argument_index: 3, type: "object", text: "null" },
      ],
      retained_bytes:
        Buffer.byteLength("authorization=Bearer console-secret") +
        Buffer.byteLength("42") +
        Buffer.byteLength("null"),
    });
    expect(result.value.network.requests[0]?.body_shapes).toMatchObject({
      status: "included",
      request: {
        root_type: "object",
        properties: expect.arrayContaining([
          expect.objectContaining({
            path: [{ kind: "property", name: "token" }],
            types: ["string"],
          }),
          expect.objectContaining({
            path: [
              { kind: "property", name: "filters" },
              { kind: "property", name: "active" },
            ],
            types: ["boolean"],
          }),
        ]),
      },
      response: {
        root_type: "object",
        properties: expect.arrayContaining([
          expect.objectContaining({
            path: [
              { kind: "property", name: "result" },
              { kind: "property", name: "token" },
            ],
            types: ["string"],
          }),
          expect.objectContaining({
            path: [
              { kind: "property", name: "items" },
              { kind: "array-element" },
              { kind: "property", name: "id" },
            ],
            types: ["number"],
          }),
        ]),
      },
    });
    expect(result.value.network.websocket_connections).toEqual([
      expect.objectContaining({
        events: [
          expect.objectContaining({
            opcode: 1,
            payload_shape: expect.objectContaining({
              format: "json",
              json_shape: expect.objectContaining({
                properties: expect.arrayContaining([
                  expect.objectContaining({
                    path: [{ kind: "property", name: "token" }],
                    types: ["string"],
                  }),
                ]),
              }),
            }),
          }),
          expect.objectContaining({
            opcode: 2,
            payload_shape: {
              format: "binary",
              json_shape: null,
            },
          }),
        ],
      }),
    ]);
    const serialized = JSON.stringify(result.value);
    for (const secret of [
      "request-body-secret",
      "response-body-secret",
      "websocket-secret",
      "object-secret",
    ])
      expect(serialized).not.toContain(secret);
    const methods = browser.commands.map(({ method }) => method);
    expect(methods).toContain("Network.getResponseBody");
    expect(methods).not.toContain("Runtime.getProperties");
    expect(methods).not.toContain("Runtime.callFunctionOn");
  });
});

describe("CdpBrowserProvider: WebSocket connection projection", () => {
  it("retains allowed connections created without observed frames", async () => {
    const browser = await startFakeCdpBrowser({ webSocketWithoutFrames: true });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.network.websocket_connections).toEqual([
      {
        request_id: "websocket-1",
        url: `ws://${new URL(browser.allowedOrigin).host}/live?token=websocket-url-secret`,
        events: [],
      },
    ]);
  });
});

describe("CdpBrowserProvider: malformed approved payloads", () => {
  it("fails closed on malformed approved response and binary payload encodings", async () => {
    const browser = await startFakeCdpBrowser({
      invalidResponseBodyBase64: true,
      binaryWebSocketEvent: true,
      invalidBinaryWebSocketEvent: true,
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        // Unlike the sibling cases, this scenario asserts outcomes produced
        // *after* the observation window closes: the response-body fetch has to
        // run and has to reject the malformed base64. A zero-length window
        // races that phase, so the expected `partial` status and the
        // `json_body_shapes` exclusion below depend on host speed. This window
        // is long enough for the fetch to complete, which makes the assertions
        // measure the malformed-body rejection instead of the machine's load.
        observation_ms: 200,
        include_json_body_shapes: true,
        include_websocket_shapes: true,
      }),
    );

    if (!result.ok) throw result.error;
    expect(result.value.network.requests[0]?.body_shapes).toMatchObject({
      status: "partial",
      request: expect.any(Object),
      // The security-relevant claim: malformed base64 never yields a shape.
      response: null,
    });
    expect(
      result.value.network.websocket_connections[0]?.events[1],
    ).toMatchObject({
      opcode: 2,
      payload_bytes: null,
      payload_shape: { format: "binary", json_shape: null },
    });
    expect(result.value.completeness.unavailable_sections).toEqual(
      expect.arrayContaining(["json_body_shapes", "websocket_frames"]),
    );
  });
});

const expectSensitiveValuesAbsent = (
  inspection: ReturnType<typeof webPageInspectionSchema.parse>,
  browser: FakeCdpBrowser,
): void => {
  const serialized = JSON.stringify(inspection);
  for (const secret of [
    "forbidden",
    "request-body-secret",
    "response-body-secret",
    "websocket-secret",
    "unknown-origin-console-secret",
    "unknown-console-value-secret",
    "storage-secret",
    "cookie-secret",
    "indexed-db-secret",
    "cache-body-secret",
  ])
    expect(serialized).not.toContain(secret);
  const methods = browser.commands.map((command) => command.method);
  expect(methods).toContain("Target.detachFromTarget");
  expect(methods).not.toContain("Browser.close");
  expect(methods).not.toContain("Target.closeTarget");
  expect(methods).not.toContain("Runtime.evaluate");
  expect(methods).not.toContain("Network.getResponseBody");
};
