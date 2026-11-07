import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { crc32, deflateSync } from "node:zlib";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { err, ok as resultOk } from "../../../src/domain/result.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import type { Client } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { createWebScreenshotArtifact } from "../../../src/domain/webScreenshot.js";
import { JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE } from "../../../src/contracts/javascript/javascriptRuntimeReconciliationExample.js";
import {
  TOOL_CONTRACTS,
  toolContract,
} from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { createServer } from "../../../src/server/createServer.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestMcp } from "../../support/mcp/mcpFixture.js";
import {
  startFakeCdpBrowser,
  type FakeCdpBrowser,
} from "../../fixtures/fakeCdpBrowser.js";

const schemaValidation = createMcpSchemaValidation();
const resources = new ArtifactResourceScope();
const retainResource = (resource: string, close: () => Promise<void>): void => {
  resources.retain({ kind: "lease", resource, lease: { release: close } });
};
const retainBrowser = (browser: FakeCdpBrowser): void => {
  retainResource(browser.endpoint, () => browser.close());
};
afterAll(async () => {
  try {
    await resources.close();
  } finally {
    schemaValidation.clear();
  }
});
const INTEGRATION_TEST_TIMEOUT_MS = 20_000;

it("preserves Link parameter order and context through the advertised MCP contract", async () => {
  const links = [
    '</duplicate-first>; rel="mcp"; rel="preload"; type="application/mcp"; type="application/preload"',
    '</duplicate-last>; rel="preload"; rel="mcp"',
    String.raw`</escaped-rel>; rel="m\cp"`,
    '</other-context>; rel="mcp"; anchor="/other-document"; anchor="/page"',
    '</default-context>; rel="mcp"',
    '</same-context>; rel="mcp"; anchor="/page"',
  ];
  const browser = await startFakeCdpBrowser({
    eventsBeforeReply: ["Network.enable"],
    commandEvents(command, origin) {
      if (command.method !== "Network.enable") return undefined;
      const session =
        command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      return [
        {
          ...session,
          method: "Network.requestWillBeSent",
          params: {
            requestId: "link-metadata",
            type: "Document",
            request: { url: `${origin}/page`, method: "GET" },
            initiator: { type: "parser" },
          },
        },
        {
          ...session,
          method: "Network.responseReceived",
          params: {
            requestId: "link-metadata",
            type: "Document",
            response: {
              url: `${origin}/page`,
              status: 200,
              mimeType: "text/html",
              headers: {
                Link: [
                  ...links,
                  `</credential-context>; rel="mcp"; anchor="${new URL(origin).protocol}//other-user:other-pass@${new URL(origin).host}/page"`,
                ].join(", "),
              },
            },
          },
        },
      ];
    },
  });
  retainBrowser(browser);
  const connected = await connectBrowser();
  const advertised = (await connected.client.listTools()).tools.find(
    ({ name }) => name === "inspect_web_page",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("inspect_web_page must advertise its output schema");

  const inspected = await connected.client.callTool({
    name: "inspect_web_page",
    arguments: {
      cdp_endpoint: browser.endpoint,
      target_id: "allowed-page",
      observation_ms: 0,
    },
  });
  expect(inspected.isError).not.toBe(true);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  expect(
    ajv.validate(outputSchema, inspected.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);

  const normalized = webPageInspectionSchema.parse(
    normalizedResultOf(inspected.structuredContent),
  );
  expect(normalized.metadata.responses).toContainEqual(
    expect.objectContaining({
      request_id: "link-metadata",
      links: [
        expect.objectContaining({
          href: `${browser.allowedOrigin}/duplicate-first`,
          rel: ["mcp"],
          type: "application/mcp",
          context_url: `${browser.allowedOrigin}/page`,
          context_scope: "approved",
        }),
        expect.objectContaining({
          href: `${browser.allowedOrigin}/duplicate-last`,
          rel: ["preload"],
          context_url: `${browser.allowedOrigin}/page`,
        }),
        expect.objectContaining({
          href: `${browser.allowedOrigin}/escaped-rel`,
          rel: ["mcp"],
          context_url: `${browser.allowedOrigin}/page`,
        }),
        expect.objectContaining({
          href: `${browser.allowedOrigin}/other-context`,
          rel: ["mcp"],
          context_url: `${browser.allowedOrigin}/other-document`,
          context_scope: "approved",
        }),
        expect.objectContaining({
          href: `${browser.allowedOrigin}/default-context`,
          rel: ["mcp"],
          context_url: `${browser.allowedOrigin}/page`,
        }),
        expect.objectContaining({
          href: `${browser.allowedOrigin}/same-context`,
          rel: ["mcp"],
          context_url: `${browser.allowedOrigin}/page`,
        }),
        expect.objectContaining({
          href: `${browser.allowedOrigin}/credential-context`,
          rel: ["mcp"],
          context_url: `${browser.allowedOrigin}/page`,
        }),
      ],
    }),
  );
  const linkHints = normalized.metadata.agent_hints.filter(
    ({ mechanism }) => mechanism === "link_rel",
  );
  expect(linkHints.map(({ url }) => url)).toEqual([
    `${browser.allowedOrigin}/duplicate-first`,
    `${browser.allowedOrigin}/escaped-rel`,
    `${browser.allowedOrigin}/default-context`,
    `${browser.allowedOrigin}/same-context`,
  ]);

  const legacy = structuredClone(normalized);
  for (const response of legacy.metadata.responses)
    for (const projectedLink of response.links) {
      delete projectedLink.context_url;
      delete projectedLink.context_scope;
    }
  expect(webPageInspectionSchema.safeParse(legacy).success).toBe(true);
  const legacyStructuredContent = {
    ...(inspected.structuredContent as Record<string, unknown>),
    normalized_result: legacy,
  };
  expect(
    ajv.validate(outputSchema, legacyStructuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
});

cliTest(
  "preserves full document URL identity through CLI and MCP",
  async ({ cli }) => {
    const source =
      'document.modelContext.registerTool({name:"catalog",[``]:0,inputSchema:{properties:{"":{},ordinary:{}}}});';
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }, origin) =>
        method === "Debugger.getScriptSource"
          ? { scriptSource: source }
          : method === "Page.getFrameTree"
            ? {
                frameTree: {
                  frame: {
                    id: "frame-main",
                    loaderId: "loader-main",
                    url: `${origin}/app?token=frame-secret`,
                    urlFragment: "#details",
                  },
                },
              }
            : undefined,
      commandEvents: ({ method, sessionId }, origin) =>
        method === "Page.captureScreenshot"
          ? [
              {
                method: "Page.frameRequestedNavigation",
                ...(sessionId === undefined ? {} : { sessionId }),
                params: {
                  frameId: "frame-main",
                  url: `${origin}/not-committed`,
                  reason: "scriptInitiated",
                  disposition: "currentTab",
                },
              },
            ]
          : undefined,
    });
    retainBrowser(browser);
    const { client, session } = await connectBrowser();
    const args = {
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
    };
    const cliResult = await cli.run({
      arguments: [
        "analyze-web-bundle",
        browser.endpoint,
        "allowed-page",
        "--allowed-origins",
        browser.allowedOrigin,
        "--observation-ms",
        "0",
        "--json",
      ],
      environment: process.env,
    });
    expect(cliResult.exitCode).toBe(0);
    expect(cliResult.signal).toBeNull();
    const mcp = await client.callTool({
      name: "analyze_web_bundle",
      arguments: { ...args, observation_ms: 0 },
    });
    for (const result of [cliResult.json, mcp.structuredContent])
      expect(result).toMatchObject({
        normalized_result: {
          capture: {
            target_url: `${browser.allowedOrigin}/app?token=frame-secret#details`,
          },
        },
      });
    expect(
      session.evidenceById(parseEvidence(mcp.structuredContent).evidence_id),
    ).toEqual(parseEvidence(mcp.structuredContent));
    const screenshot = await client.callTool({
      name: "capture_web_screenshot",
      arguments: args,
    });
    expect(screenshot).toMatchObject({
      structuredContent: {
        normalized_result: {
          target: {
            url: `${browser.allowedOrigin}/app?token=frame-secret#details`,
          },
          artifact: { media_type: "image/png" },
        },
      },
    });
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

afterEach(() => resources.retryCleanup());

it("closes the browser and retains failed MCP and session cleanup for retry", async () => {
  const { client, session } = await connectBrowser();
  const browser = await startFakeCdpBrowser();
  retainBrowser(browser);
  const browserClose = vi.spyOn(browser, "close");
  const sdkFailure = new Error("controlled SDK close failure");
  const sessionFailure = new ProviderCleanupError(
    "fixture",
    ["session-owner"],
    {
      reason: "controlled session close failure",
    },
  );
  const clientClose = vi
    .spyOn(client, "close")
    .mockRejectedValueOnce(sdkFailure);
  const sessionClose = vi
    .spyOn(session, "close")
    .mockResolvedValueOnce(err(sessionFailure));
  try {
    const failure: unknown = await resources
      .retryCleanup()
      .catch((cause: unknown) => cause);
    expect(failure).toMatchObject({
      cause: expect.objectContaining({
        errors: expect.arrayContaining([sdkFailure, sessionFailure]),
      }),
    });
    await expect(fetch(`${browser.endpoint}/json/version`)).rejects.toThrow();
    expect(clientClose).toHaveBeenCalledTimes(1);
    expect(sessionClose).toHaveBeenCalledTimes(1);
    await resources.retryCleanup();
    expect(clientClose).toHaveBeenCalledTimes(2);
    expect(sessionClose).toHaveBeenCalledTimes(2);
    expect(browserClose).toHaveBeenCalledTimes(1);
  } finally {
    clientClose.mockRestore();
    sessionClose.mockRestore();
    await resources.retryCleanup();
    browserClose.mockRestore();
  }
});

it(
  "exposes CLI-equivalent Evidence results and session tools",
  async () => {
    const browser = await startFakeCdpBrowser({
      sessionTimeline: "same_origin",
      webMcpTools: true,
      sensitiveShapes: true,
      eventsBeforeReply: ["Network.enable"],
    });
    retainBrowser(browser);
    const connected = await connectBrowser();

    const tools = await connected.client.listTools();
    expect(tools.tools).toHaveLength(TOOL_CONTRACTS.length);
    expect(tools.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "list_browser_targets",
        "inspect_web_page",
        "analyze_web_bundle",
        "observe_web_session",
        "discover_webmcp_tools",
        "compare_web_captures",
        "capture_web_screenshot",
        "compare_web_screenshots",
      ]),
    );
    const status = await connected.client.callTool({
      name: "binary_session",
      arguments: {},
    });
    const sessionStatus = toolContract("binary_session").outputSchema.parse(
      status.structuredContent,
    );
    const availability = expandToolAvailability(
      sessionStatus.result.tool_availability,
    );
    expect(availability).toContainEqual(
      expect.objectContaining({
        name: "inspect_web_page",
        reason: expect.any(String),
      }),
    );
    const listed = await connected.client.callTool({
      name: "list_browser_targets",
      arguments: {
        cdp_endpoint: browser.endpoint,
      },
    });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({
      normalized_result: {
        targets: expect.arrayContaining([
          expect.objectContaining({ target_id: "allowed-page" }),
        ]),
      },
    });
    const inspected = await connected.client.callTool({
      name: "inspect_web_page",
      arguments: {
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 0,
        include_console_text: true,
        include_json_body_shapes: true,
        include_websocket_shapes: true,
        include_script_sources: true,
      },
    });
    expect(inspected.isError).not.toBe(true);
    expect(inspected.structuredContent).toMatchObject({
      normalized_result: {
        target: { target_id: "allowed-page" },
        console: { prior_activity_available: false },
        network: {
          prior_activity_available: false,
          requests: [
            expect.objectContaining({
              body_shapes: expect.objectContaining({ status: "included" }),
            }),
          ],
        },
      },
    });
    const reconciled = await connected.client.callTool({
      name: "reconcile_javascript_runtime",
      arguments: {
        static_layers: JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers,
        runtime_observations: [evidenceFor(inspected.structuredContent)],
      },
    });
    expect(reconciled.isError).not.toBe(true);
    expect(reconciled.structuredContent).toMatchObject({
      normalized_result: { summary: { runtime_scripts: 1 } },
    });
    expect(JSON.stringify(reconciled.structuredContent)).not.toContain(
      "source-secret",
    );
    const analyzed = await connected.client.callTool({
      name: "analyze_web_bundle",
      arguments: {
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 0,
      },
    });
    expect(analyzed.isError).not.toBe(true);
    expect(analyzed.structuredContent).toMatchObject({
      normalized_result: {
        capture: { scripts_analyzed: 1 },
        observations: { source_maps: { status: "not_requested" } },
      },
    });
    await verifySessionAndComparisonTools(connected, browser, inspected);
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

const verifySessionAndComparisonTools = async (
  connected: Awaited<ReturnType<typeof connectBrowser>>,
  browser: FakeCdpBrowser,
  inspected: Awaited<ReturnType<Client["callTool"]>>,
): Promise<void> => {
  const observedSession = await connected.client.callTool({
    name: "observe_web_session",
    arguments: {
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 5,
    },
  });
  expect(observedSession.isError).not.toBe(true);
  expect(observedSession.structuredContent).toMatchObject({
    normalized_result: {
      window: { end_reason: "window_elapsed" },
      timeline: expect.arrayContaining([
        expect.objectContaining({ type: "same_origin_reload" }),
      ]),
    },
  });
  const webMcp = await connected.client.callTool({
    name: "discover_webmcp_tools",
    arguments: {
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
    },
  });
  expect(webMcp.isError).not.toBe(true);
  expect(webMcp.structuredContent).toMatchObject({
    normalized_result: {
      tools: {
        items: [expect.objectContaining({ name: "search_orders" })],
      },
    },
  });
  const capture = normalizedResultOf(inspected.structuredContent);
  const compared = await connected.client.callTool({
    name: "compare_web_captures",
    arguments: {
      before: { inspection: capture },
      after: { inspection: capture },
    },
  });
  expect(compared.isError).not.toBe(true);
  expect(compared.structuredContent).toMatchObject({
    normalized_result: { overall_status: "unknown" },
  });
  const parsedCapture = webPageInspectionSchema.parse(capture);
  const socket = parsedCapture.network.websocket_connections
    .flatMap((connection) => connection.events)
    .find((event) => event.payload_shape?.json_shape != null);
  const payload = socket?.payload_shape;
  if (socket === undefined || payload == null || payload.json_shape === null)
    throw new Error("Missing deep WebSocket JSON shape fixture");
  const malformedCapture = {
    ...parsedCapture,
    network: {
      ...parsedCapture.network,
      websocket_connections: parsedCapture.network.websocket_connections.map(
        (connection) => ({
          ...connection,
          events: connection.events.map((event) =>
            event === socket
              ? {
                  ...event,
                  payload_shape: {
                    ...payload,
                    json_shape: {
                      ...payload.json_shape,
                      properties: [
                        { path: "/event", types: [42], observations: 1 },
                      ],
                    },
                  },
                }
              : event,
          ),
        }),
      ),
    },
  };
  const malformedComparison = await connected.client.callTool({
    name: "compare_web_captures",
    arguments: {
      before: { inspection: malformedCapture },
      after: { inspection: capture },
    },
  });
  expect(malformedComparison.isError).toBe(true);
  expect(parseMcpToolError(malformedComparison)).toMatchObject({
    error: {
      code: "invalid_request",
      recovery: {
        kind: "inspect_input_contract",
        operation: "compare_web_captures",
      },
      details: { operation: "compare_web_captures" },
    },
  });
  expect(JSON.stringify(malformedComparison.content)).toContain("types");
  const incompleteComparison = await connected.client.callTool({
    name: "compare_web_captures",
    arguments: { before: { inspection: capture } },
  });
  expect(incompleteComparison.isError).toBe(true);
  await verifyScreenshotTools(connected.client, browser);
  expect(inspected.structuredContent).toMatchObject({
    normalized_result: expect.any(Object),
    operation: "inspect_web_page",
    predicate_type: expect.any(String),
    parameters: expect.any(Object),
  });
};

const verifyScreenshotTools = async (
  client: Client,
  browser: FakeCdpBrowser,
): Promise<void> => {
  const screenshot = await client.callTool({
    name: "capture_web_screenshot",
    arguments: {
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
    },
  });
  expect(screenshot.isError).not.toBe(true);
  const screenshotArtifact = artifactOf(screenshot.structuredContent);
  const visual = await client.callTool({
    name: "compare_web_screenshots",
    arguments: {
      before: screenshotArtifact,
      after: screenshotArtifact,
    },
  });
  expect(visual.isError).not.toBe(true);
  expect(visual.structuredContent).toMatchObject({
    normalized_result: { status: "identical", changed_pixels: 0 },
  });

  const before = singlePixelScreenshot([0, 0, 0]);
  const after = singlePixelScreenshot([10, 0, 0]);
  const changed = await client.callTool({
    name: "compare_web_screenshots",
    arguments: { before, after, channel_threshold: 2 },
  });
  expect(changed.isError).not.toBe(true);
  expect(changed.structuredContent).toMatchObject({
    parameters: {
      before_artifact_sha256: before.sha256,
      after_artifact_sha256: after.sha256,
      channel_threshold: 2,
    },
    normalized_result: {
      status: "different",
      channel_threshold: 2,
      compared_pixels: 1,
      changed_pixels: 1,
      changed_ratio: 1,
      maximum_channel_delta: 10,
      mean_absolute_channel_delta: 2.5,
    },
  });

  await assertScreenshotPngFailures(client);
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, 8 + data.length)),
    8 + data.length,
  );
  return chunk;
};

const singlePixelScreenshot = (rgb: readonly [number, number, number]) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return createWebScreenshotArtifact(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(Buffer.from([0, ...rgb]))),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
};

const assertScreenshotPngFailures = async (client: Client): Promise<void> => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const malformedPng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", Buffer.from("bad")),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const malformedArtifact = createWebScreenshotArtifact(malformedPng);
  const malformed = await client.callTool({
    name: "compare_web_screenshots",
    arguments: {
      before: malformedArtifact,
      after: malformedArtifact,
    },
  });
  expect(parseMcpToolError(malformed)).toMatchObject({
    error: {
      code: "invalid_request",
      category: "invalid_input",
      details: {
        operation: "compare_web_screenshots",
        issues: [{ path: [], reason: "invalid_format" }],
      },
    },
  });

  const grayscaleHeader = Buffer.alloc(13);
  grayscaleHeader.writeUInt32BE(1, 0);
  grayscaleHeader.writeUInt32BE(1, 4);
  grayscaleHeader.set([8, 0, 0, 0, 0], 8);
  const unsupportedPng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", grayscaleHeader),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 30]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const unsupported = createWebScreenshotArtifact(unsupportedPng);
  const rejectedFormat = await client.callTool({
    name: "compare_web_screenshots",
    arguments: { before: unsupported, after: unsupported },
  });
  expect(parseMcpToolError(rejectedFormat)).toMatchObject({
    error: { code: "unsupported_target", category: "unsupported_target" },
  });
};

cliTest(
  "delivers the source-map response URL through authenticated MCP Evidence",
  async ({ cli }) => {
    const terminalPath = "/maps/v1/app.js.map?revision=2&token=source-value";
    const sources = [
      ["../src/original.js", "text/javascript"],
      ["../src/plain.ts", "text/typescript"],
      ["../src/main.ts?revision=2", "text/typescript"],
      ["../src/main.tsx?revision=2", "text/typescript"],
      ["../src/main.mts?revision=2", "text/typescript"],
      ["../src/main.cts?revision=2", "text/typescript"],
      ["../src/fragment.ts#original", "text/typescript"],
      ["../src/control.js?filename=main.ts", "text/javascript"],
      ["../src/extensionless?revision=2", "text/javascript"],
    ] as const;
    const sourceText = "export const value = 1;";
    const browser = await startFakeCdpBrowser({
      sourceMapRedirect: terminalPath,
      sourceMapBody: JSON.stringify({
        version: 3,
        names: [],
        sources: sources.map(([source]) => source),
        sourcesContent: sources.map(() => sourceText),
        mappings: "AAAA",
      }),
    });
    retainBrowser(browser);
    const connected = await connectBrowser();
    const result = await connected.client.callTool({
      name: "analyze_web_bundle",
      arguments: {
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        allowed_origins: [browser.allowedOrigin],
        observation_ms: 0,
        fetch_source_maps: true,
      },
    });
    expect(result.isError).not.toBe(true);
    const evidence = parseEvidence(result.structuredContent);
    const expectedResult = {
      observations: {
        source_maps: {
          status: "included",
          items: [
            {
              declared_url: `${browser.allowedOrigin}/app.js.map?token=map-secret`,
              effective_url: `${browser.allowedOrigin}${terminalPath}`,
              original_sources: sources.map(([source, mediaType]) => ({
                source: new URL(
                  source,
                  `${browser.allowedOrigin}${terminalPath}`,
                ).href,
                artifact: { media_type: mediaType, text: sourceText },
              })),
            },
          ],
        },
      },
    };
    expect(evidence.normalized_result).toMatchObject(expectedResult);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: JSON.stringify(evidence),
    });
    const cliResult = await cli.run({
      arguments: [
        "analyze-web-bundle",
        browser.endpoint,
        "allowed-page",
        "--allowed-origins",
        browser.allowedOrigin,
        "--observation-ms",
        "0",
        "--fetch-source-maps",
        "--json",
      ],
      environment: process.env,
    });
    expect(cliResult.exitCode).toBe(0);
    expect(cliResult.signal).toBeNull();
    const cliEvidence = parseEvidence(cliResult.json);
    expect(cliEvidence.normalized_result).toMatchObject(expectedResult);
    const mapRequests = browser.httpRequests.filter(({ url }) =>
      url.includes(".map"),
    );
    expect(mapRequests.map(({ url }) => url)).toEqual([
      "/app.js.map?token=map-secret",
      terminalPath,
      "/app.js.map?token=map-secret",
      terminalPath,
    ]);
    expect(
      mapRequests.every(
        ({ authorization, cookie, referer }) =>
          authorization === undefined &&
          cookie === undefined &&
          referer === undefined,
      ),
    ).toBe(true);
  },
);

it.each(["full", "compact"] as const)(
  "records a browser-socket endpoint redacted and reconciles its Evidence (%s)",
  async (profile) => {
    const browser = await startFakeCdpBrowser();
    retainBrowser(browser);
    const connected = await connectBrowser(profile);
    const tool = (await connected.client.listTools()).tools.find(
      ({ name }) => name === "inspect_web_page",
    );
    if (profile === "full")
      expect(tool?.inputSchema.properties?.cdp_endpoint).toMatchObject({
        description: expect.stringContaining("/devtools/browser/ID"),
      });
    const inspected = await connected.client.callTool({
      name: "inspect_web_page",
      arguments: {
        cdp_endpoint: browser.browserWebSocketUrl,
        target_id: "allowed-page",
        observation_ms: 0,
        include_script_sources: true,
      },
    });
    expect(inspected.isError).not.toBe(true);
    expect(inspected.structuredContent).toMatchObject({
      parameters: {
        cdp_endpoint: browser.browserWebSocketUrl.replace(
          /fake$/u,
          "[REDACTED]",
        ),
      },
    });
    expect(JSON.stringify(inspected.structuredContent)).not.toContain(
      "/devtools/browser/fake",
    );
    const reconciled = await connected.client.callTool({
      name: "reconcile_javascript_runtime",
      arguments: {
        static_layers: JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers,
        runtime_observations: [evidenceFor(inspected.structuredContent)],
      },
    });
    expect(reconciled.isError).not.toBe(true);
    expect(reconciled.structuredContent).toMatchObject({
      normalized_result: { summary: { runtime_scripts: 1 } },
    });
  },
);

it.each([
  ["inspect_web_page", 0],
  ["analyze_web_bundle", 0],
  ["observe_web_session", 1],
  ["discover_webmcp_tools", 0],
  ["capture_web_screenshot", undefined],
] as const)(
  "selects the exact opaque target ID through %s",
  async (name, observationMs) => {
    const browser = await startFakeCdpBrowser();
    retainBrowser(browser);
    const { client } = await connectBrowser();
    const args = {
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      ...(observationMs === undefined ? {} : { observation_ms: observationMs }),
    };
    const rejected = await client.callTool({
      name,
      arguments: { ...args, target_id: " allowed-page " },
    });
    expect(parseMcpToolError(rejected)).toMatchObject({
      error: { details: { reason: "target_not_found" } },
    });
    expect(browser.commands).toHaveLength(0);
    const accepted = await client.callTool({
      name,
      arguments: { ...args, target_id: "allowed-page" },
    });
    expect(accepted.isError).not.toBe(true);
    expect(browser.commands.length).toBeGreaterThan(0);
  },
);

it("does not attach to a target outside the request's allowed origin scope", async () => {
  const browser = await startFakeCdpBrowser();
  retainBrowser(browser);
  const connected = await connectBrowser();
  const result = await connected.client.callTool({
    name: "inspect_web_page",
    arguments: {
      cdp_endpoint: browser.endpoint,
      allowed_origins: ["https://unapproved.example.test"],
      target_id: "allowed-page",
      observation_ms: 0,
    },
  });
  expect(result.isError).toBe(true);
  expect(parseMcpToolError(result)).toMatchObject({
    error: {
      details: {
        operation: "inspect_web_page",
        reason: "target_not_allowed",
      },
    },
  });
  expect(browser.commands).toHaveLength(0);
});

it("projects legal oversized PNG dimensions as a memory constraint", async () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(0x7fffffff, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const artifact = createWebScreenshotArtifact(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(Buffer.from([0]))),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
  const connected = await connectBrowser();
  const result = await connected.client.callTool({
    name: "compare_web_screenshots",
    arguments: { before: artifact, after: artifact },
  });

  expect(parseMcpToolError(result)).toMatchObject({
    error: {
      code: "resource_constraint",
      category: "resource_constraint",
      details: {
        operation: "compare_web_screenshots",
        resource: "memory",
        reported_limits: {
          maximum_working_memory_bytes: 256 * 1024 * 1024,
          estimated_working_memory_bytes: "34359738499",
          before_dimensions: { width: 0x7fffffff, height: 1 },
          after_dimensions: { width: 0x7fffffff, height: 1 },
        },
      },
    },
  });
});

const connectBrowser = async (profile?: "full" | "compact") => {
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  retainResource("binary session", async () => {
    const result = await session.close();
    if (!result.ok) throw result.error;
  });
  const mcp = createTestMcp();
  retainResource("MCP connection", () => mcp.close());
  const server = createServer(
    { kind: "session", session },
    {
      environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: profile },
      browserObservation: new CdpBrowserProvider(),
      availabilityPolicy: () => ({
        processCaptureEnabled: false,
        investigationInputRoots: 0,
      }),
    },
  );
  const client = await mcp.connect(
    server,
    { name: "browser-mcp-test", version: "1" },
    schemaValidation,
  );
  return { client, session };
};

const normalizedResultOf = (value: unknown): unknown => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("normalized_result" in value)
  )
    throw new TypeError("Missing normalized browser result");
  return value.normalized_result;
};

const evidenceFor = (value: unknown) => {
  return parseEvidence(value);
};

const artifactOf = (value: unknown): unknown => {
  const normalized = normalizedResultOf(value);
  if (
    typeof normalized !== "object" ||
    normalized === null ||
    !("artifact" in normalized)
  )
    throw new TypeError("Missing screenshot artifact");
  return normalized.artifact;
};

it.each([24, 32, "crc"])(
  "rejects corrupt captured PNG through MCP: %s",
  async (kind) => {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv4sAAAAASUVORK5CYII=",
      "base64",
    );
    if (kind === "crc") bytes[29] = (bytes[29] ?? 0) ^ 1;
    const data = (
      typeof kind === "number" ? bytes.subarray(0, kind) : bytes
    ).toString("base64");
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }) =>
        method === "Page.captureScreenshot" ? { data } : undefined,
    });
    retainBrowser(browser);
    const { client } = await connectBrowser();
    const result = await client.callTool({
      name: "capture_web_screenshot",
      arguments: {
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
      },
    });
    expect(parseMcpToolError(result)).toMatchObject({
      error: {
        code: "unreadable_output",
        details: { reason: "protocol_error" },
      },
    });
  },
);
