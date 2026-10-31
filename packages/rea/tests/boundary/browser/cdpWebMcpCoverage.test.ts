import { expect, it } from "vitest";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { discoverWebMcpToolsInputSchema } from "../../../src/domain/webMcpDiscovery.js";
import { digestCanonicalValue } from "../../../src/domain/canonicalDigest.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

it.each(["initial", "final"])(
  "explains WebMCP %s current-document origin refusal",
  async (stage) => {
    const browser = await startFakeCdpBrowser({
      webMcpTools: true,
      commandResult: ({ method }, origin, frameReads) =>
        method === "Page.getFrameTree"
          ? {
              frameTree: {
                frame: {
                  id: "frame-main",
                  url:
                    stage === "initial" || frameReads > 1
                      ? "https://outside.example/page"
                      : origin + "/app",
                },
              },
            }
          : undefined,
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().discoverWebMcpTools(
      discoverWebMcpToolsInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    if (result.ok) throw new Error("Expected WebMCP origin refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "target_unavailable",
      message: expect.stringContaining("permitted HTTP(S) origin scope"),
      remediation: { action: expect.stringContaining("allowed_origins") },
      details: {
        operation: "discover_webmcp_tools",
        reason: "target_not_allowed",
      },
    });
    expect(
      browser.commands.some(({ method }) => method === "WebMCP.enable"),
    ).toBe(stage === "final");
  },
);

it.each([false, true])(
  "accepts optional WebMCP input schema (declared=%s)",
  async (declared) => {
    const browser = await startFakeCdpBrowser({
      commandEvents: ({ method, sessionId }) =>
        method === "WebMCP.enable"
          ? [
              {
                method: "WebMCP.toolsAdded",
                sessionId,
                params: {
                  tools: [
                    {
                      name: "parameterless",
                      frameId: "frame-main",
                      ...(declared ? { inputSchema: {} } : {}),
                    },
                  ],
                },
              },
            ]
          : undefined,
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().discoverWebMcpTools(
      discoverWebMcpToolsInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.tools.items[0]).toMatchObject({
      name: "parameterless",
      input_schema: declared ? {} : null,
      input_schema_sha256: declared ? digestCanonicalValue({}) : null,
    });
    expect(result.value.completeness.unavailable_sections).not.toContain(
      "webmcp_tools",
    );
    expect(result.value.completeness.excluded).not.toContainEqual(
      expect.objectContaining({
        section: "webmcp_tools",
        reason: "invalid_protocol_value",
      }),
    );
  },
);

it("retains a valid parameterless registration while rejecting malformed annotations", async () => {
  const browser = await startFakeCdpBrowser({
    commandEvents: ({ method, sessionId }) =>
      method === "WebMCP.enable"
        ? [
            {
              method: "WebMCP.toolsAdded",
              sessionId,
              params: {
                tools: [
                  {
                    name: "parameterless",
                    frameId: "frame-main",
                    annotations: { readOnly: "yes" },
                  },
                ],
              },
            },
          ]
        : undefined,
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().discoverWebMcpTools(
    discoverWebMcpToolsInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      target_id: "allowed-page",
      observation_ms: 0,
    }),
  );
  if (!result.ok) throw result.error;
  expect(result.value.tools.items).toHaveLength(1);
  expect(result.value.completeness.unavailable_sections).toContain(
    "webmcp_tools",
  );
});

it("retains replay and live subframe tools without claiming replay covered older subframe registrations", async () => {
  const browser = await startFakeCdpBrowser({
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
    commandEvents: ({ method, sessionId }) =>
      method === "WebMCP.enable"
        ? [
            {
              method: "WebMCP.toolsAdded",
              sessionId,
              params: { tools: [{ name: "replayed", frameId: "frame-main" }] },
            },
            {
              method: "WebMCP.toolsAdded",
              sessionId,
              params: { tools: [{ name: "live-child", frameId: "child" }] },
            },
          ]
        : undefined,
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().discoverWebMcpTools(
    discoverWebMcpToolsInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      target_id: "allowed-page",
      observation_ms: 0,
    }),
  );
  if (!result.ok) throw result.error;
  expect(result.value.tools.items.map(({ name }) => name).sort()).toEqual([
    "live-child",
    "replayed",
  ]);
  expect(result.value.completeness.attach_limited_sections).toContain(
    "webmcp_tools",
  );
  expect(result.value.limitations).toContainEqual(
    expect.stringContaining("pre-existing subframe registrations"),
  );
});
