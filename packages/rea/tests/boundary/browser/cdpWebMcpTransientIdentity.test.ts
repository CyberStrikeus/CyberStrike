import { expect, it } from "vitest";
import type { CdpEvent } from "../../../src/browser/CdpConnection.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { discoverWebMcpToolsInputSchema } from "../../../src/domain/webMcpDiscovery.js";
import { compareWebCaptures } from "../../../src/domain/webCaptureDiff.js";
import { compareWebCapturesInputSchema } from "../../../src/domain/webCaptureDiffSchemas.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

it.each(
  ["about:blank", "about:srcdoc"].flatMap((base) =>
    ["inline", "split"].flatMap((encoding) =>
      ["initial", "event"].flatMap((phase) =>
        [false, true].map((recover) => ({ base, encoding, phase, recover })),
      ),
    ),
  ),
)(
  "keeps temporary document policy separate from fragment identity: $base/$encoding/$phase/$recover",
  async ({ base, encoding, phase, recover }) => {
    let document = phase === "initial" ? "transient" : "old";
    const blank =
      encoding === "split"
        ? { url: base, urlFragment: "#details" }
        : { url: base + "#details" };
    const frame = (origin: string) => ({
      id: "child",
      parentId: "frame-main",
      loaderId: document,
      ...(document === "transient"
        ? blank
        : {
            url: origin + "/child",
            urlFragment: document === "fresh" ? "#current" : "#old",
          }),
    });
    const tool = (name: string) => ({
      name,
      frameId: "child",
      inputSchema: {},
      annotations: {
        readOnly: true,
        untrustedContent: true,
        consequential: false,
        autosubmit: false,
      },
    });
    const browser = await startFakeCdpBrowser({
      webMcpTools: true,
      eventsBeforeReply: ["WebMCP.enable"],
      commandResult: ({ method }, origin) =>
        method === "Page.getFrameTree"
          ? {
              frameTree: {
                frame: { id: "frame-main", url: origin + "/app" },
                childFrames: [{ frame: frame(origin) }],
              },
            }
          : undefined,
      commandEvents: ({ method, sessionId }, origin) => {
        if (method !== "WebMCP.enable") return undefined;
        const scope = sessionId === undefined ? {} : { sessionId };
        const events: CdpEvent[] = [
          {
            method: "WebMCP.toolsAdded",
            ...scope,
            params: { tools: [tool("stale")] },
          },
        ];
        document = "transient";
        if (phase === "event")
          events.push({
            method: "Page.frameNavigated",
            ...scope,
            params: { frame: frame(origin) },
          });
        if (recover) {
          document = "fresh";
          events.push({
            method: "Page.frameNavigated",
            ...scope,
            params: { frame: frame(origin) },
          });
          events.push({
            method: "WebMCP.toolsAdded",
            ...scope,
            params: { tools: [tool("current")] },
          });
        }
        return events;
      },
    });
    trackBrowser(browser);
    const provider = new CdpBrowserProvider();
    const input = {
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
    };
    const result = await provider.discoverWebMcpTools(
      discoverWebMcpToolsInputSchema.parse(input),
    );
    if (!result.ok) throw result.error;
    expect(result.value.tools.items.map(({ name }) => name)).toEqual(
      recover ? ["current"] : [],
    );
    expect(result.value.completeness.policy_filtered_sections).not.toContain(
      "webmcp_tools",
    );
    expect(
      result.value.completeness.attach_limited_sections.includes(
        "webmcp_tools",
      ),
    ).toBe(!recover || phase === "event");
    if (recover)
      expect(result.value.tools.items[0]?.frame_url).toBe(
        browser.allowedOrigin + "/child#current",
      );
    const inspection = await provider.inspectPage(
      inspectWebPageInputSchema.parse(input),
    );
    if (!inspection.ok) throw inspection.error;
    const snapshot = { inspection: inspection.value, webmcp: result.value };
    const compared = compareWebCaptures(
      compareWebCapturesInputSchema.parse({
        before: snapshot,
        after: snapshot,
      }),
    );
    expect(compared.dimensions.webmcp.status).toBe(
      recover && phase === "initial" ? "unchanged" : "unknown",
    );
  },
);

it.each([
  "about:blanker#details",
  "about:srcdoc-other#details",
  "about:blank?policy=1#details",
  "https://foreign.invalid/child#about:blank",
  "allowed",
])("does not broaden temporary document policy: %s", async (rawUrl) => {
  const browser = await startFakeCdpBrowser({
    webMcpTools: true,
    eventsBeforeReply: ["WebMCP.enable"],
    commandResult: ({ method }, origin) =>
      method === "Page.getFrameTree"
        ? {
            frameTree: {
              frame: { id: "frame-main", url: origin + "/app" },
              childFrames: [
                {
                  frame: {
                    id: "child",
                    parentId: "frame-main",
                    url:
                      rawUrl === "allowed"
                        ? origin + "/child#about:blank"
                        : rawUrl,
                  },
                },
              ],
            },
          }
        : undefined,
    commandEvents: ({ method, sessionId }) =>
      method === "WebMCP.enable"
        ? [
            {
              method: "WebMCP.toolsAdded",
              ...(sessionId === undefined ? {} : { sessionId }),
              params: {
                tools: [{ name: "current", frameId: "child", inputSchema: {} }],
              },
            },
          ]
        : undefined,
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
  expect(result.value.tools.items.map(({ name }) => name)).toEqual(
    rawUrl === "allowed" ? ["current"] : [],
  );
  expect(
    result.value.completeness.policy_filtered_sections.includes("webmcp_tools"),
  ).toBe(rawUrl !== "allowed");
  // The initial allowed child may have unreported pre-attach registrations.
  // A literal #about:blank fragment does not make that coverage complete.
  expect(
    result.value.completeness.attach_limited_sections.includes("webmcp_tools"),
  ).toBe(rawUrl === "allowed");
  if (rawUrl === "allowed")
    expect(result.value.tools.items[0]?.frame_url).toBe(
      browser.allowedOrigin + "/child#about:blank",
    );
});

it.each([
  {
    kind: "missing id with alias",
    event: "Page.frameNavigated",
    fields: { frameId: "child" },
    tools: ["current"],
    invalid: true,
  },
  {
    kind: "non-string id with alias",
    event: "Page.frameNavigated",
    fields: { id: 7, frameId: "child" },
    tools: ["current"],
    invalid: true,
  },
  {
    kind: "empty id",
    event: "Page.frameNavigated",
    fields: { id: "" },
    tools: ["current"],
    invalid: true,
  },
  {
    kind: "non-string parent",
    event: "Page.frameNavigated",
    fields: { id: "child", parentId: 7 },
    tools: [],
    invalid: true,
  },
  {
    kind: "empty parent",
    event: "Page.frameNavigated",
    fields: { id: "child", parentId: "" },
    tools: [],
    invalid: true,
  },
  {
    kind: "null parent",
    event: "Page.frameNavigated",
    fields: { id: "child", parentId: null },
    tools: [],
    invalid: true,
  },
  {
    kind: "non-string committed loader",
    event: "Page.frameNavigated",
    fields: { id: "child", parentId: "frame-main", loaderId: 7 },
    tools: [],
    invalid: true,
  },
  {
    kind: "full navigation becomes root",
    event: "Page.frameNavigated",
    fields: { id: "child" },
    tools: ["current"],
    invalid: false,
  },
  {
    kind: "within-document navigation keeps parent",
    event: "Page.navigatedWithinDocument",
    fields: { frameId: "child" },
    tools: [],
    invalid: false,
  },
] as const)(
  "uses method-specific frame identity and ancestry: $kind",
  async ({ event, fields, tools, invalid }) => {
    const browser = await startFakeCdpBrowser({
      webMcpTools: true,
      eventsBeforeReply: ["WebMCP.enable"],
      commandResult: ({ method }, origin) =>
        method === "Page.getFrameTree"
          ? {
              frameTree: {
                frame: { id: "frame-main", url: origin + "/app" },
                childFrames: [
                  {
                    frame: {
                      id: "child",
                      parentId: "frame-main",
                      url: origin + "/child",
                    },
                  },
                ],
              },
            }
          : undefined,
      commandEvents: ({ method, sessionId }, origin) => {
        if (method !== "WebMCP.enable") return undefined;
        const scope = sessionId === undefined ? {} : { sessionId };
        const frame = { ...fields, url: origin + "/child" };
        return [
          {
            method: "WebMCP.toolsAdded",
            ...scope,
            params: {
              tools: [{ name: "current", frameId: "child", inputSchema: {} }],
            },
          },
          {
            method: event,
            ...scope,
            params: event === "Page.frameNavigated" ? { frame } : frame,
          },
          ...(!invalid
            ? [
                {
                  method: "Page.frameDetached",
                  ...scope,
                  params: { frameId: "frame-main" },
                },
              ]
            : []),
        ];
      },
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
    expect(result.value.tools.items.map(({ name }) => name)).toEqual(tools);
    expect(
      result.value.completeness.excluded.some(
        ({ section, reason }) =>
          section === "webmcp_tools" && reason === "invalid_protocol_value",
      ),
    ).toBe(invalid);
  },
);

it("retains the committed loader through same-document updates before a replacement", async () => {
  const browser = await startFakeCdpBrowser({
    webMcpTools: true,
    eventsBeforeReply: ["WebMCP.enable"],
    commandResult: ({ method }, origin) =>
      method === "Page.getFrameTree"
        ? {
            frameTree: {
              frame: { id: "frame-main", url: origin + "/app" },
              childFrames: [
                {
                  frame: {
                    id: "child",
                    parentId: "frame-main",
                    loaderId: "loader-A",
                    url: origin + "/child",
                  },
                },
              ],
            },
          }
        : undefined,
    commandEvents: ({ method, sessionId }, origin) => {
      if (method !== "WebMCP.enable") return undefined;
      const scope = sessionId === undefined ? {} : { sessionId };
      return [
        {
          method: "WebMCP.toolsAdded",
          ...scope,
          params: {
            tools: [{ name: "old", frameId: "child", inputSchema: {} }],
          },
        },
        {
          method: "Page.navigatedWithinDocument",
          ...scope,
          params: { frameId: "child", url: origin + "/child#updated" },
        },
        {
          method: "Page.frameNavigated",
          ...scope,
          params: {
            frame: {
              id: "child",
              parentId: "frame-main",
              loaderId: "loader-B",
              url: origin + "/child#updated",
            },
          },
        },
      ];
    },
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
  expect(result.value.tools.items).toEqual([]);
  expect(result.value.completeness.excluded).not.toContainEqual(
    expect.objectContaining({
      section: "webmcp_tools",
      reason: "invalid_protocol_value",
    }),
  );
});
