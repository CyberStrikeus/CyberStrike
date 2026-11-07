import { describe, expect, it } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { discoverWebMcpToolsInputSchema } from "../../../src/domain/webMcpDiscovery.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import {
  startFakeCdpBrowser,
  type FakeOptions,
} from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

type CdpCommand = Parameters<NonNullable<FakeOptions["commandEvents"]>>[0];

const sessionEvent = (
  command: CdpCommand,
  method: string,
  params: Record<string, unknown>,
) => ({
  ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId }),
  method,
  params,
});

const inspect = async (
  commandEvents: NonNullable<FakeOptions["commandEvents"]>,
) => {
  const browser = await startFakeCdpBrowser({ commandEvents });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 1,
      include_console_text: true,
    }),
  );
  if (!result.ok) throw result.error;
  expect(() => webPageInspectionSchema.parse(result.value)).not.toThrow();
  return { browser, inspection: result.value };
};

const inspectConsole = async (
  fields: Record<string, unknown>,
  stackTrace?: (origin: string) => unknown,
) =>
  inspect((command, origin) =>
    command.method === "Runtime.enable"
      ? [
          sessionEvent(command, "Runtime.consoleAPICalled", {
            type: "log",
            timestamp: 1,
            ...fields,
            stackTrace: stackTrace?.(origin) ?? {
              callFrames: [
                { url: `${origin}/app.js`, lineNumber: 0, columnNumber: 0 },
              ],
            },
          }),
        ]
      : undefined,
  );

const invalidConsoleValue = {
  section: "console_events",
  reason: "invalid_protocol_value",
  count: 1,
};

describe("CdpBrowserProvider: console argument inventory", () => {
  it.each([
    ["omitted", {}],
    ["null", { args: null }],
    ["non-array", { args: "invalid" }],
  ])(
    "keeps an %s argument inventory unknown rather than empty",
    async (_label, fields) => {
      const { inspection } = await inspectConsole(fields);

      expect(inspection.console.events).toHaveLength(1);
      expect(inspection.console.events[0]?.argument_types).toBeNull();
      expect(inspection.console.events[0]?.text_capture).toEqual({
        status: "unavailable",
        values: [],
        retained_bytes: 0,
      });
      expect(inspection.completeness.excluded).toContainEqual(
        invalidConsoleValue,
      );
    },
  );

  it.each([
    ["a non-object element", null],
    ["an element without a type", { value: "first" }],
  ])(
    "retains original argument positions around %s",
    async (_label, malformed) => {
      const { inspection } = await inspectConsole({
        args: [malformed, { type: "string", value: "second" }],
      });

      expect(inspection.console.events[0]?.argument_types).toEqual([
        "unknown",
        "string",
      ]);
      expect(inspection.console.events[0]?.text_capture).toEqual({
        status: "included",
        values: [{ argument_index: 1, type: "string", text: "second" }],
        retained_bytes: Buffer.byteLength("second"),
      });
      expect(inspection.completeness.excluded).toContainEqual(
        invalidConsoleValue,
      );
    },
  );

  it.each([
    ["an empty", [], []],
    ["a non-primitive", [{ type: "object", subtype: "array" }], ["object"]],
  ])(
    "reports %s argument inventory as observed",
    async (_label, args, argumentTypes) => {
      const { inspection } = await inspectConsole({ args });

      expect(inspection.console.events[0]?.argument_types).toEqual(
        argumentTypes,
      );
      expect(inspection.console.events[0]?.text_capture).toEqual({
        status: "included",
        values: [],
        retained_bytes: 0,
      });
      expect(inspection.completeness.excluded).not.toContainEqual(
        expect.objectContaining({
          section: "console_events",
          reason: "invalid_protocol_value",
        }),
      );
    },
  );

  it.each([
    [
      "a malformed top frame",
      (origin: string) => ({
        callFrames: [
          null,
          { url: `${origin}/app.js`, lineNumber: 4, columnNumber: 2 },
        ],
      }),
    ],
    ["a non-array frame inventory", () => ({ callFrames: "invalid" })],
    ["a non-object stack", () => "invalid"],
  ])(
    "does not attribute a console call through %s",
    async (_label, stackTrace) => {
      const { inspection } = await inspectConsole({ args: [] }, stackTrace);

      expect(inspection.console.events).toEqual([]);
      expect(inspection.completeness.excluded).toContainEqual(
        invalidConsoleValue,
      );
    },
  );

  it("does not attribute a request initiator to a frame below a malformed top frame", async () => {
    const { browser, inspection } = await inspect((command, origin) =>
      command.method === "Network.enable"
        ? [
            sessionEvent(command, "Network.requestWillBeSent", {
              requestId: "initiated-request",
              type: "Fetch",
              request: { url: `${origin}/data.json`, method: "GET" },
              initiator: {
                type: "script",
                stack: {
                  callFrames: [
                    null,
                    { url: `${origin}/app.js`, lineNumber: 3, columnNumber: 5 },
                  ],
                },
              },
              timestamp: 1,
            }),
          ]
        : undefined,
    );

    const request = inspection.network.requests.find(
      (item) => item.request_id === "initiated-request",
    );
    expect(request?.url).toBe(`${browser.allowedOrigin}/data.json`);
    expect(request?.initiator).toEqual({
      type: "script",
      url: null,
      line: null,
      column: null,
    });
    expect(inspection.completeness.excluded).toContainEqual({
      section: "network_initiators",
      reason: "invalid_protocol_value",
      count: 1,
    });
  });
});

it("retains console and initiator events with invalid coordinates unknown", async () => {
  const { inspection } = await inspect((command, origin) => {
    const frame = {
      url: `${origin}/app.js`,
      lineNumber: -3,
      columnNumber: 7.5,
    };
    if (command.method === "Runtime.enable")
      return [
        sessionEvent(command, "Runtime.consoleAPICalled", {
          type: "log",
          timestamp: 1,
          args: [],
          stackTrace: { callFrames: [frame] },
        }),
      ];
    if (command.method === "Network.enable")
      return [
        sessionEvent(command, "Network.requestWillBeSent", {
          requestId: "bad-location",
          type: "Fetch",
          request: { url: `${origin}/data.json`, method: "GET" },
          initiator: { type: "script", stack: { callFrames: [frame] } },
          timestamp: 1,
        }),
      ];
    return undefined;
  });
  expect(inspection.console.events[0]).toMatchObject({
    line: null,
    column: null,
  });
  expect(
    inspection.network.requests.find(
      (item) => item.request_id === "bad-location",
    )?.initiator,
  ).toMatchObject({ line: null, column: null });
  expect(inspection.completeness.excluded).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        section: "console_events",
        reason: "invalid_protocol_value",
      }),
      expect.objectContaining({
        section: "network_initiators",
        reason: "invalid_protocol_value",
      }),
    ]),
  );
});

describe("CdpBrowserProvider: WebMCP registration stacks", () => {
  const discover = async (
    stackTrace: (origin: string) => JsonValue | undefined,
  ) => {
    const browser = await startFakeCdpBrowser({
      webMcpTools: true,
      webMcpStackTrace: stackTrace,
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().discoverWebMcpTools(
      discoverWebMcpToolsInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    return { discovery: result.value };
  };
  const invalidToolValue = expect.objectContaining({
    section: "webmcp_tools",
    reason: "invalid_protocol_value",
  });

  it.each<[string, (origin: string) => JsonValue]>([
    [
      "invalid coordinates",
      (origin) => ({
        callFrames: [
          { url: `${origin}/app.js`, lineNumber: -3, columnNumber: 7.5 },
        ],
      }),
    ],
    [
      "a malformed top frame",
      (origin) => ({
        callFrames: [
          null,
          { url: `${origin}/app.js`, lineNumber: 12, columnNumber: 4 },
        ],
      }),
    ],
    ["a non-array frame inventory", () => ({ callFrames: "invalid" })],
    ["a non-object stack", () => "invalid"],
  ])(
    "keeps the tool but reports %s as incomplete",
    async (_label, stackTrace) => {
      const { discovery } = await discover(stackTrace);

      expect(discovery.tools.items).toEqual([
        expect.objectContaining({
          name: "search_orders",
          registration_source: null,
        }),
      ]);
      expect(discovery.completeness.excluded).toContainEqual(invalidToolValue);
    },
  );

  it("preserves valid registration coordinates", async () => {
    const { discovery } = await discover((origin) => ({
      callFrames: [{ url: `${origin}/app.js`, lineNumber: 0, columnNumber: 4 }],
    }));
    expect(discovery.tools.items[0]?.registration_source).toMatchObject({
      line: 0,
      column: 4,
    });
    expect(discovery.completeness.excluded).not.toContainEqual(
      invalidToolValue,
    );
  });

  it.each<[string, JsonValue | undefined]>([
    ["an omitted", undefined],
    ["an empty", { callFrames: [] }],
  ])("reports %s registration stack as having no source", async (_l, stack) => {
    const { discovery } = await discover(() => stack);

    expect(discovery.tools.items).toEqual([
      expect.objectContaining({
        name: "search_orders",
        registration_source: null,
      }),
    ]);
    expect(discovery.completeness.excluded).not.toContainEqual(
      invalidToolValue,
    );
  });
});
