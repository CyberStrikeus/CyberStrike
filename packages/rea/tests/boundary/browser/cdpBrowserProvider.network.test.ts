import { describe, expect, it } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

it.each([
  ["related", { openerId: "allowed-page" }, 1, null],
  ["foreign", { openerId: "other-page" }, 0, "out_of_target_scope"],
  ["unknown", {}, 0, "unattributed_target"],
] as const)(
  "keeps %s worker ownership separate from attachment state",
  async (_relation, ownership, count, exclusion) => {
    const browser = await startFakeCdpBrowser({
      commandResult: (command, origin) =>
        command.method === "Target.getTargets"
          ? {
              targetInfos: [
                {
                  targetId: "worker",
                  type: "worker",
                  url: `${origin}/worker.js`,
                  attached: true,
                  ...ownership,
                },
              ],
            }
          : undefined,
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        allowed_origins: [browser.allowedOrigin],
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.workers).toHaveLength(count);
    expect(result.value.completeness.attach_limited_sections).toContain(
      "workers",
    );
    expect(result.value.limitations.join(" ")).toContain(
      "not worker-session observation",
    );
    if (exclusion !== null)
      expect(result.value.completeness.excluded).toContainEqual({
        section: "workers",
        reason: exclusion,
        count: 1,
      });
    if (_relation === "unknown") {
      expect(result.value.completeness.unavailable_sections).toContain(
        "workers",
      );
      expect(result.value.completeness.policy_filtered_sections).not.toContain(
        "workers",
      );
    }
  },
);

it("preserves Document Link fields, structured policies and derived agent hints", async () => {
  const browser = await startFakeCdpBrowser({
    commandEvents(command, origin) {
      if (command.method !== "Network.enable") return undefined;
      const session =
        command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      return [
        {
          ...session,
          method: "Network.requestWillBeSent",
          params: {
            requestId: "repeated-document",
            type: "Document",
            request: { url: `${origin}/frame`, method: "GET" },
            initiator: { type: "parser" },
          },
        },
        {
          ...session,
          method: "Network.responseReceived",
          params: {
            requestId: "repeated-document",
            type: "Document",
            response: {
              url: `${origin}/frame`,
              status: 200,
              mimeType: "text/html",
              headers: {
                Link: "</next>; rel=next\n</agent>; rel=mcp",
                "Cross-Origin-Opener-Policy": 'same-origin; report-to="coop"',
                "Cross-Origin-Embedder-Policy":
                  'require-corp; report-to="coep"',
              },
            },
          },
        },
      ];
    },
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 1,
    }),
  );
  if (!result.ok) throw result.error;
  expect(result.value.metadata.responses).toContainEqual(
    expect.objectContaining({
      request_id: "repeated-document",
      policies: expect.objectContaining({
        coop: "same-origin",
        coep: "require-corp",
      }),
      links: [
        expect.objectContaining({
          href: `${browser.allowedOrigin}/next`,
          rel: ["next"],
        }),
        expect.objectContaining({
          href: `${browser.allowedOrigin}/agent`,
          rel: ["mcp"],
        }),
      ],
    }),
  );
  expect(result.value.metadata.agent_hints).toContainEqual({
    mechanism: "link_rel",
    declaration: "mcp",
    url: `${browser.allowedOrigin}/agent`,
    trust: "page-declared-untrusted",
  });
});

it("preserves unavailable response observations and captures completed peers", async () => {
  const browser = await startFakeCdpBrowser({
    commandEvents(command, origin) {
      if (command.method !== "Network.enable") return undefined;
      return ["unfinished", "missing-body", "available"].flatMap(
        (requestId) => {
          const session =
            command.sessionId === undefined
              ? {}
              : { sessionId: command.sessionId };
          const url = `${origin}/${requestId}`;
          return [
            {
              ...session,
              method: "Network.requestWillBeSent",
              params: {
                requestId,
                type: "Fetch",
                request: {
                  url,
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  postData: '{"selected":true}',
                },
                initiator: { type: "script" },
              },
            },
            {
              ...session,
              method: "Network.responseReceived",
              params: {
                requestId,
                response: {
                  url,
                  status: 200,
                  mimeType: "application/json",
                  headers: {},
                },
              },
            },
            ...(requestId === "unfinished"
              ? []
              : [
                  {
                    ...session,
                    method: "Network.loadingFinished",
                    params: { requestId, encodedDataLength: 0 },
                  },
                ]),
          ];
        },
      );
    },
    commandError(command) {
      if (
        command.method === "Network.getResponseBody" &&
        command.params.requestId === "missing-body"
      )
        return {
          code: -32_000,
          message: "No data found for resource with given identifier",
        };
      return undefined;
    },
    commandResult(command) {
      return command.method === "Network.getResponseBody"
        ? { body: '{"retained":true}', base64Encoded: false }
        : undefined;
    },
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 20,
      include_json_body_shapes: true,
    }),
  );
  if (!result.ok) throw result.error;
  expect(result.value.network.requests).toEqual([
    expect.objectContaining({
      request_id: "unfinished",
      status: 200,
      encoded_data_length: null,
      body_shapes: {
        status: "partial",
        request: expect.any(Object),
        response: null,
      },
    }),
    expect.objectContaining({
      request_id: "missing-body",
      status: 200,
      encoded_data_length: 0,
      body_shapes: {
        status: "partial",
        request: expect.any(Object),
        response: null,
      },
    }),
    expect.objectContaining({
      request_id: "available",
      body_shapes: {
        status: "included",
        request: expect.any(Object),
        response: expect.any(Object),
      },
    }),
  ]);
  expect(result.value.completeness.unavailable_sections).toContain(
    "json_body_shapes",
  );
  expect(result.value.limitations).toContainEqual(
    expect.stringContaining(
      "missing-body: CDP Network.getResponseBody failed (-32000): No data found",
    ),
  );
  expect(
    browser.commands
      .filter(({ method }) => method === "Network.getResponseBody")
      .map(({ params }) => params.requestId),
  ).toEqual(["missing-body", "available"]);
});

it("marks JSON response bodies unavailable when their events arrive during body capture", async () => {
  const browser = await startFakeCdpBrowser({
    commandEvents(command, origin) {
      const session =
        command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      if (command.method === "Network.enable") {
        const url = `${origin}/initial.json`;
        return [
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "initial",
              request: { url, method: "GET" },
              initiator: { type: "other" },
            },
          },
          {
            ...session,
            method: "Network.responseReceived",
            params: {
              requestId: "initial",
              response: { url, status: 200, mimeType: "application/json" },
            },
          },
          {
            ...session,
            method: "Network.loadingFinished",
            params: { requestId: "initial", encodedDataLength: 16 },
          },
        ];
      }
      if (command.method !== "Network.getResponseBody") return undefined;
      const url = `${origin}/late.json`;
      return [
        {
          ...session,
          method: "Network.requestWillBeSent",
          params: {
            requestId: "late",
            request: { url, method: "GET" },
            initiator: { type: "other" },
          },
        },
        {
          ...session,
          method: "Network.responseReceived",
          params: {
            requestId: "late",
            response: { url, status: 200, mimeType: "application/json" },
          },
        },
        {
          ...session,
          method: "Network.loadingFinished",
          params: { requestId: "late", encodedDataLength: 14 },
        },
      ];
    },
    commandResult(command) {
      return command.method === "Network.getResponseBody"
        ? { body: '{"initial":true}', base64Encoded: false }
        : undefined;
    },
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 20,
      include_json_body_shapes: true,
    }),
  );

  if (!result.ok) throw result.error;
  expect(result.value.network.requests).toEqual([
    expect.objectContaining({
      request_id: "initial",
      body_shapes: {
        status: "included",
        request: null,
        response: expect.any(Object),
      },
    }),
    expect.objectContaining({
      request_id: "late",
      body_shapes: { status: "unavailable", request: null, response: null },
    }),
  ]);
  expect(result.value.completeness.unavailable_sections).toContain(
    "json_body_shapes",
  );
});

it("does not attach a redirect response body to the reused request ID", async () => {
  const browser = await startFakeCdpBrowser({
    commandEvents(command, origin) {
      const session =
        command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      if (command.method === "Network.enable") {
        const url = `${origin}/before-redirect.json`;
        return [
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "reused",
              request: { url, method: "GET" },
              initiator: { type: "other" },
            },
          },
          {
            ...session,
            method: "Network.responseReceived",
            params: {
              requestId: "reused",
              response: { url, status: 302, mimeType: "application/json" },
            },
          },
          {
            ...session,
            method: "Network.loadingFinished",
            params: { requestId: "reused", encodedDataLength: 12 },
          },
        ];
      }
      if (command.method !== "Network.getResponseBody") return undefined;
      const previousUrl = `${origin}/before-redirect.json`;
      const nextUrl = `${origin}/after-redirect.json`;
      return [
        {
          ...session,
          method: "Network.requestWillBeSent",
          params: {
            requestId: "reused",
            request: { url: nextUrl, method: "GET" },
            initiator: { type: "other" },
            redirectResponse: {
              url: previousUrl,
              status: 302,
              mimeType: "application/json",
              encodedDataLength: 12,
            },
          },
        },
        {
          ...session,
          method: "Network.responseReceived",
          params: {
            requestId: "reused",
            response: {
              url: nextUrl,
              status: 200,
              mimeType: "application/json",
            },
          },
        },
        {
          ...session,
          method: "Network.loadingFinished",
          params: { requestId: "reused", encodedDataLength: 14 },
        },
      ];
    },
    commandResult(command) {
      return command.method === "Network.getResponseBody"
        ? { body: '{"belongs":"redirect"}', base64Encoded: false }
        : undefined;
    },
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 20,
      include_json_body_shapes: true,
    }),
  );

  if (!result.ok) throw result.error;
  expect(result.value.network.requests).toEqual([
    expect.objectContaining({
      request_id: "reused",
      url: `${browser.allowedOrigin}/after-redirect.json`,
      redirects: [expect.objectContaining({ status: 302 })],
      body_shapes: { status: "unavailable", request: null, response: null },
    }),
  ]);
  expect(result.value.completeness.unavailable_sections).toContain(
    "json_body_shapes",
  );
});

it("marks malformed JSON body shapes unavailable while preserving partial request shapes", async () => {
  const browser = await startFakeCdpBrowser({
    commandEvents(command, origin) {
      if (command.method !== "Network.enable") return undefined;
      const session =
        command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      return ["unavailable", "partial"].flatMap((requestId) => {
        const url = `${origin}/${requestId}`;
        return [
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId,
              request: {
                url,
                method: requestId === "partial" ? "POST" : "GET",
                ...(requestId === "partial"
                  ? {
                      headers: { "Content-Type": "application/json" },
                      postData: '{"request":true}',
                    }
                  : {}),
              },
              initiator: { type: "other" },
            },
          },
          {
            ...session,
            method: "Network.responseReceived",
            params: {
              requestId,
              response: { url, status: 200, mimeType: "application/json" },
            },
          },
          {
            ...session,
            method: "Network.loadingFinished",
            params: { requestId, encodedDataLength: 0 },
          },
        ];
      });
    },
    commandResult(command) {
      return command.method === "Network.getResponseBody"
        ? { body: "{", base64Encoded: false }
        : undefined;
    },
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 20,
      include_json_body_shapes: true,
    }),
  );

  if (!result.ok) throw result.error;
  expect(result.value.network.requests).toEqual([
    expect.objectContaining({
      request_id: "unavailable",
      body_shapes: { status: "unavailable", request: null, response: null },
    }),
    expect.objectContaining({
      request_id: "partial",
      body_shapes: {
        status: "partial",
        request: expect.any(Object),
        response: null,
      },
    }),
  ]);
  expect(result.value.completeness.unavailable_sections).toContain(
    "json_body_shapes",
  );
  expect(result.value.completeness.excluded).not.toContainEqual(
    expect.objectContaining({
      section: "json_body_shapes",
      reason: "invalid_protocol_value",
    }),
  );
});

it("rejects malformed response-body envelopes and preserves request shapes", async () => {
  const browser = await startFakeCdpBrowser({
    commandEvents(command, origin) {
      if (command.method !== "Network.enable") return undefined;
      const session =
        command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      return ["missing-encoding-flag", "invalid-encoding-flag"].flatMap(
        (requestId) => {
          const url = `${origin}/${requestId}`;
          return [
            {
              ...session,
              method: "Network.requestWillBeSent",
              params: {
                requestId,
                request: {
                  url,
                  method:
                    requestId === "invalid-encoding-flag" ? "POST" : "GET",
                  ...(requestId === "invalid-encoding-flag"
                    ? {
                        headers: { "Content-Type": "application/json" },
                        postData: '{"request":true}',
                      }
                    : {}),
                },
                initiator: { type: "other" },
              },
            },
            {
              ...session,
              method: "Network.responseReceived",
              params: {
                requestId,
                response: { url, status: 200, mimeType: "application/json" },
              },
            },
            {
              ...session,
              method: "Network.loadingFinished",
              params: { requestId, encodedDataLength: 0 },
            },
          ];
        },
      );
    },
    commandResult(command) {
      if (command.method !== "Network.getResponseBody") return undefined;
      return command.params.requestId === "missing-encoding-flag"
        ? { body: '{"response":true}' }
        : { body: '{"response":true}', base64Encoded: "false" };
    },
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 20,
      include_json_body_shapes: true,
    }),
  );

  if (!result.ok) throw result.error;
  expect(result.value.network.requests).toEqual([
    expect.objectContaining({
      request_id: "missing-encoding-flag",
      body_shapes: { status: "unavailable", request: null, response: null },
    }),
    expect.objectContaining({
      request_id: "invalid-encoding-flag",
      body_shapes: {
        status: "partial",
        request: expect.any(Object),
        response: null,
      },
    }),
  ]);
  expect(result.value.completeness.excluded).toContainEqual({
    section: "json_body_shapes",
    reason: "invalid_protocol_value",
    count: 2,
  });
  expect(result.value.completeness.excluded).not.toContainEqual(
    expect.objectContaining({
      section: "json_body_shapes",
      reason: "provider_unavailable",
    }),
  );
});

it.each([
  {
    options: {
      commandError: (command: { method: string }) =>
        command.method === "Network.getResponseBody"
          ? { code: -32_602, message: "Invalid parameters" }
          : undefined,
    },
    reason: "protocol_error",
  },
  {
    options: { malformedMessageOnMethod: "Network.getResponseBody" },
    reason: "protocol_error",
  },
  {
    options: { closeOnMethod: "Network.getResponseBody" },
    reason: "disconnected",
  },
])(
  "preserves fatal response capture errors ($reason)",
  async ({ options, reason }) => {
    const browser = await startFakeCdpBrowser(options);
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 20,
        include_json_body_shapes: true,
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "BrowserObservationError", reason },
    });
  },
);

describe("malformed CDP network request metadata", () => {
  it("omits requests with missing required metadata and reports the malformed events", async () => {
    const browser = await startFakeCdpBrowser({
      commandEvents(command, origin) {
        if (command.method !== "Network.enable") return undefined;
        const session =
          command.sessionId === undefined
            ? {}
            : { sessionId: command.sessionId };
        return [
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "valid",
              request: { url: `${origin}/valid`, method: "GET" },
              initiator: { type: "future-protocol-type" },
            },
          },
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "missing-method",
              request: { url: `${origin}/missing-method` },
              initiator: { type: "script" },
            },
          },
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "empty-method",
              request: { url: `${origin}/empty-method`, method: "" },
              initiator: { type: "script" },
            },
          },
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "missing-initiator-type",
              request: {
                url: `${origin}/missing-initiator-type`,
                method: "POST",
              },
              initiator: {},
            },
          },
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "missing-request",
              request: null,
              initiator: { type: "script" },
            },
          },
        ];
      },
    });
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
    expect(result.value.network.requests).toEqual([
      expect.objectContaining({
        request_id: "valid",
        method: "GET",
        initiator: expect.objectContaining({ type: "future-protocol-type" }),
      }),
    ]);
    expect(result.value.completeness.excluded).toContainEqual({
      section: "network_requests",
      reason: "invalid_protocol_value",
      count: 4,
    });
  });
});

describe("malformed reused CDP request IDs", () => {
  it("keeps the last valid request and redirects after a malformed replacement", async () => {
    const browser = await startFakeCdpBrowser({
      commandEvents(command, origin) {
        if (command.method !== "Network.enable") return undefined;
        const session =
          command.sessionId === undefined
            ? {}
            : { sessionId: command.sessionId };
        return [
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "redirecting",
              request: { url: `${origin}/first`, method: "POST" },
              initiator: { type: "parser" },
            },
          },
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "redirecting",
              request: { url: `${origin}/second`, method: "GET" },
              initiator: { type: "other" },
              redirectResponse: {
                url: `${origin}/first`,
                status: 301,
                mimeType: "text/plain",
                encodedDataLength: 12,
              },
            },
          },
          {
            ...session,
            method: "Network.responseReceived",
            params: {
              requestId: "redirecting",
              response: {
                url: `${origin}/second`,
                status: 202,
                mimeType: "application/json",
              },
            },
          },
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "redirecting",
              request: { url: `${origin}/third` },
              initiator: { type: "other" },
              redirectResponse: {
                url: `${origin}/second`,
                status: 302,
                mimeType: "text/plain",
                encodedDataLength: 18,
              },
            },
          },
          {
            ...session,
            method: "Network.responseReceived",
            params: {
              requestId: "redirecting",
              response: {
                url: `${origin}/third`,
                status: 418,
                mimeType: "application/json",
              },
            },
          },
          {
            ...session,
            method: "Network.loadingFinished",
            params: { requestId: "redirecting", encodedDataLength: 777 },
          },
        ];
      },
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
        include_json_body_shapes: true,
      }),
    );

    if (!result.ok) throw result.error;
    expect(result.value.network.requests).toEqual([
      expect.objectContaining({
        request_id: "redirecting",
        url: `${browser.allowedOrigin}/second`,
        method: "GET",
        status: 202,
        mime_type: "application/json",
        encoded_data_length: null,
        redirects: [
          expect.objectContaining({
            url: `${browser.allowedOrigin}/first`,
            response_url: `${browser.allowedOrigin}/first`,
            method: "POST",
            status: 301,
          }),
        ],
      }),
    ]);
    expect(result.value.completeness.excluded).toContainEqual({
      section: "network_requests",
      reason: "invalid_protocol_value",
      count: 1,
    });
    expect(result.value.completeness.excluded).toContainEqual({
      section: "json_body_shapes",
      reason: "invalid_protocol_value",
      count: 1,
    });
    expect(
      browser.commands.filter(
        ({ method }) => method === "Network.getResponseBody",
      ),
    ).toEqual([]);
  });
});

describe("CDP network length metadata", () => {
  it("retains valid zero lengths and excludes malformed loading lengths", async () => {
    const browser = await startFakeCdpBrowser({
      commandEvents(command, origin) {
        if (command.method !== "Network.enable") return undefined;
        const session =
          command.sessionId === undefined
            ? {}
            : { sessionId: command.sessionId };
        const request = (requestId: string, path: string) => ({
          ...session,
          method: "Network.requestWillBeSent",
          params: {
            requestId,
            request: { url: `${origin}${path}`, method: "GET" },
            initiator: { type: "parser" },
          },
        });
        return [
          request("zero", "/zero"),
          request("missing", "/missing"),
          request("negative", "/negative"),
          request("prior", "/prior"),
          request("redirect-zero", "/redirect-zero-first"),
          request("redirect-invalid", "/redirect-invalid-first"),
          {
            ...session,
            method: "Network.loadingFinished",
            params: { requestId: "zero", encodedDataLength: 0 },
          },
          {
            ...session,
            method: "Network.loadingFinished",
            params: { requestId: "missing" },
          },
          {
            ...session,
            method: "Network.loadingFinished",
            params: { requestId: "negative", encodedDataLength: -1 },
          },
          {
            ...session,
            method: "Network.loadingFinished",
            params: { requestId: "prior", encodedDataLength: 27 },
          },
          {
            ...session,
            method: "Network.loadingFinished",
            params: { requestId: "prior", encodedDataLength: -1 },
          },
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "redirect-zero",
              request: { url: `${origin}/redirect-zero-final`, method: "GET" },
              initiator: { type: "parser" },
              redirectResponse: {
                url: `${origin}/redirect-zero-first`,
                status: 301,
                encodedDataLength: 0,
              },
            },
          },
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "redirect-invalid",
              request: {
                url: `${origin}/redirect-invalid-final`,
                method: "GET",
              },
              initiator: { type: "parser" },
              redirectResponse: {
                url: `${origin}/redirect-invalid-first`,
                status: 301,
                encodedDataLength: -1,
              },
            },
          },
        ];
      },
    });
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
    const requests = new Map(
      result.value.network.requests.map((item) => [item.request_id, item]),
    );
    expect(requests.get("zero")?.encoded_data_length).toBe(0);
    expect(requests.get("missing")?.encoded_data_length).toBeNull();
    expect(requests.get("negative")?.encoded_data_length).toBeNull();
    expect(requests.get("prior")?.encoded_data_length).toBe(27);
    expect(
      requests.get("redirect-zero")?.redirects?.[0]?.encoded_data_length,
    ).toBe(0);
    expect(
      requests.get("redirect-invalid")?.redirects?.[0]?.encoded_data_length,
    ).toBeNull();
    expect(result.value.completeness.excluded).toContainEqual({
      section: "network_requests",
      reason: "invalid_protocol_value",
      count: 4,
    });
  });
});

describe("same-origin redirect chains", () => {
  it("retains same-origin redirect hops on the one final request", async () => {
    const browser = await startFakeCdpBrowser({ redirectWithinOrigin: true });
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
    expect(result.value.network.requests).toHaveLength(1);
    expect(result.value.network.requests[0]).toMatchObject({
      request_id: "request-1",
      url: `${browser.allowedOrigin}/redirected?token=final-secret`,
      status: 200,
      redirects: [
        {
          url: `${browser.allowedOrigin}/api?token=network-secret`,
          response_url: `${browser.allowedOrigin}/api?token=network-secret`,
          method: "POST",
          resource_type: "Fetch",
          status: 301,
          mime_type: "text/plain",
          encoded_data_length: 23,
          request_timestamp: 7,
          redirect_event_timestamp: 8,
        },
        {
          url: `${browser.allowedOrigin}/intermediate`,
          response_url: `${browser.allowedOrigin}/intermediate`,
          method: "GET",
          resource_type: "Fetch",
          status: 302,
          mime_type: "text/plain",
          encoded_data_length: 27,
          request_timestamp: 8,
          redirect_event_timestamp: 9,
        },
      ],
    });
    expect(JSON.stringify(result.value.network.requests)).not.toContain(
      "redirect-header-secret",
    );
    expect(result.value.completeness.excluded).not.toContainEqual({
      section: "network_requests",
      reason: "invalid_protocol_value",
      count: expect.any(Number),
    });
  });
});

describe("redirect origin policy", () => {
  it("drops network evidence when a request redirects outside the approved origin", async () => {
    const browser = await startFakeCdpBrowser({
      redirectToDisallowedOrigin: true,
    });
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
    expect(result.value.network.requests).toEqual([]);
  });

  it("does not retain excluded prior-hop data when a redirect returns in scope", async () => {
    const browser = await startFakeCdpBrowser({
      redirectFromDisallowedOrigin: true,
    });
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
    expect(result.value.network.requests).toHaveLength(1);
    expect(result.value.network.requests[0]).toMatchObject({
      url: `${browser.allowedOrigin}/returned`,
      redirects: [],
    });
    const output = JSON.stringify(result.value.network.requests);
    expect(output).not.toContain("private.example.test");
    expect(output).not.toContain("redirect-header-secret");
    expect(output).not.toContain("redirect-body-secret");
    expect(result.value.completeness.policy_filtered_sections).toContain(
      "network_requests",
    );
    expect(result.value.completeness.status).toBe("policy_filtered");
    expect(result.value.completeness.unavailable_sections).not.toContain(
      "network_requests",
    );
    expect(result.value.completeness.excluded).not.toContainEqual({
      section: "network_requests",
      reason: "invalid_protocol_value",
      count: expect.any(Number),
    });
  });
});

it("keeps response facts with an unknown optional status without changing request identity", async () => {
  const browser = await startFakeCdpBrowser({
    commandEvents(command, origin) {
      if (command.method !== "Network.enable") return undefined;
      return [
        {
          sessionId: command.sessionId,
          method: "Network.requestWillBeSent",
          params: {
            requestId: "partial-response",
            request: { url: `${origin}/requested`, method: "GET" },
            initiator: { type: "parser" },
          },
        },
        {
          sessionId: command.sessionId,
          method: "Network.responseReceived",
          params: {
            requestId: "partial-response",
            response: {
              url: `${origin}/reported-response`,
              status: "malformed",
              mimeType: "application/json",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": "123",
                "Content-Encoding": "gzip",
              },
            },
          },
        },
      ];
    },
  });
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
  expect(result.value.network.requests).toContainEqual(
    expect.objectContaining({
      request_id: "partial-response",
      url: `${browser.allowedOrigin}/requested`,
      status: null,
      mime_type: "application/json",
    }),
  );
  expect(result.value.metadata.responses).toContainEqual(
    expect.objectContaining({
      request_id: "partial-response",
      url: `${browser.allowedOrigin}/reported-response`,
      mime_type: "application/json",
      content_length: 123,
      content_encoding: "gzip",
    }),
  );
});

it("does not persist or join an empty passive request identity", async () => {
  const browser = await startFakeCdpBrowser({
    commandEvents(command, origin) {
      if (command.method !== "Network.enable") return undefined;
      return [
        {
          sessionId: command.sessionId,
          method: "Network.requestWillBeSent",
          params: {
            requestId: "",
            frameId: "frame-main",
            type: "Document",
            request: { url: `${origin}/empty-id`, method: "GET" },
            initiator: { type: "parser" },
          },
        },
        {
          sessionId: command.sessionId,
          method: "Network.responseReceived",
          params: {
            requestId: "",
            response: {
              url: `${origin}/empty-id`,
              status: 200,
              mimeType: "text/html",
              headers: {},
            },
          },
        },
        {
          sessionId: command.sessionId,
          method: "Network.loadingFinished",
          params: { requestId: "", encodedDataLength: 42 },
        },
      ];
    },
  });
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
  expect(result.value.network.requests).not.toContainEqual(
    expect.objectContaining({ request_id: "" }),
  );
  expect(result.value.metadata.responses).not.toContainEqual(
    expect.objectContaining({ request_id: "" }),
  );
  expect(result.value.completeness.excluded).toContainEqual(
    expect.objectContaining({
      section: "network_requests",
      reason: "invalid_protocol_value",
    }),
  );
});
