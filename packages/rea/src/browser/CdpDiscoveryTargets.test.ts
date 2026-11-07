import { once } from "node:events";
import { createServer } from "node:http";

import { expect, it } from "vitest";
import { BrowserObservationError } from "../domain/browserObservationError.js";

import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { inspectElectronPageInputSchema } from "../domain/javascript/electronObservation.js";
import { V8InspectorProvider } from "../inspector/V8InspectorProvider.js";
import { CdpBrowserProvider } from "./CdpBrowserProvider.js";
import { CdpElectronProvider } from "./CdpElectronProvider.js";
import { parseCdpDiscoveryTargets } from "./CdpDiscoveryTargets.js";
import { discoverCdpBrowserSocket } from "./CdpEndpoint.js";
import { authorizeCdpTarget } from "./CdpAuthorizedTarget.js";

it.each(["http", "browser-socket"] as const)(
  "%s retains sibling identities and marks duplicates before malformed rows are excluded",
  (source) => {
    const idField = source === "http" ? "id" : "targetId";
    const result = parseCdpDiscoveryTargets(
      [
        { [idField]: "duplicate", type: "page", url: "https://allowed.test/" },
        { [idField]: "duplicate", type: "page" },
        {
          [idField]: "sibling",
          type: "page",
          url: "https://allowed.test/other",
        },
      ],
      "list_browser_targets",
      source,
    );
    expect(result.targets).toMatchObject([
      { id: "duplicate" },
      { id: "sibling" },
    ]);
    expect(result.ambiguousTargetIds).toEqual(["duplicate"]);
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("identity is ambiguous"),
        expect.stringContaining("identity is malformed"),
      ]),
    );
  },
);

it.each([0, 1, 2])(
  "browser-socket selection rejects duplicate IDs before origin policy (malformed duplicate rows: %s)",
  async (malformedRows) => {
    const discovery = await discoverCdpBrowserSocket(
      {
        send: async (method) =>
          method === "Browser.getVersion"
            ? {
                protocolVersion: "1.3",
                product: "Chrome",
                revision: "r",
                userAgent: "ua",
                jsVersion: "v8",
              }
            : {
                targetInfos: [
                  {
                    targetId: "duplicate",
                    type: "page",
                    ...(malformedRows === 2
                      ? {}
                      : { url: "https://allowed.test/" }),
                  },
                  {
                    targetId: "duplicate",
                    type: "page",
                    ...(malformedRows > 0
                      ? {}
                      : { url: "https://foreign.test/" }),
                  },
                  {
                    targetId: "sibling",
                    type: "page",
                    url: "https://allowed.test/other",
                  },
                ],
              },
      },
      "ws://127.0.0.1:9222/devtools/browser/fixture",
      "inspect_web_page",
    );
    expect(() =>
      authorizeCdpTarget(
        discovery,
        {
          target_id: "duplicate",
          allowed_origins: ["https://allowed.test"],
        },
        "inspect_web_page",
      ),
    ).toThrow(
      expect.objectContaining({
        reason: "invalid_endpoint_response",
        detail: expect.stringContaining("ambiguous"),
      }),
    );
    expect(
      authorizeCdpTarget(
        discovery,
        {
          target_id: "sibling",
          allowed_origins: ["https://allowed.test"],
        },
        "inspect_web_page",
      ).target.id,
    ).toBe("sibling");
  },
);

it.each(
  (["browser", "electron", "inspector"] as const).flatMap((providerKind) => [
    { providerKind, malformedRows: 0 },
    { providerKind, malformedRows: 1 },
    { providerKind, malformedRows: 2 },
  ]),
)(
  "$providerKind rejects ambiguous HTTP target identity before authorizing its location or opening a socket (malformed duplicate rows: $malformedRows)",
  async ({ providerKind, malformedRows }) => {
    let upgrades = 0;
    const server = createServer((request, response) => {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing TCP address");
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify(
          request.url === "/json/version"
            ? {
                Browser: "Node.js/v24",
                "Protocol-Version": "1.3",
                "User-Agent": "fixture",
                "V8-Version": "v8",
                "WebKit-Version": "r",
                webSocketDebuggerUrl: `ws://127.0.0.1:${String(address.port)}/devtools/browser/fixture`,
              }
            : [
                {
                  id: "duplicate",
                  type: "page",
                  ...(malformedRows === 2
                    ? {}
                    : { url: "https://allowed.test/" }),
                },
                {
                  id: "duplicate",
                  type: "node",
                  ...(malformedRows > 0
                    ? {}
                    : { url: "file:///missing/foreign.js" }),
                },
                {
                  id: "sibling",
                  type: "page",
                  url: "https://allowed.test/other",
                },
              ],
        ),
      );
    });
    server.on("upgrade", (_request, socket) => {
      upgrades += 1;
      socket.destroy();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing TCP address");
    const endpoint = `http://127.0.0.1:${String(address.port)}`;
    const provider =
      providerKind === "browser"
        ? new CdpBrowserProvider()
        : providerKind === "electron"
          ? new CdpElectronProvider()
          : new V8InspectorProvider();
    try {
      const result =
        provider instanceof CdpBrowserProvider
          ? await provider.inspectPage(
              inspectWebPageInputSchema.parse({
                cdp_endpoint: endpoint,
                target_id: "duplicate",
                allowed_origins: ["https://allowed.test"],
                observation_ms: 0,
              }),
            )
          : provider instanceof CdpElectronProvider
            ? await provider.inspectPage(
                inspectElectronPageInputSchema.parse({
                  cdp_endpoint: endpoint,
                  target_id: "duplicate",
                  observation_ms: 0,
                }),
              )
            : await provider.observe({
                inspector_endpoint: endpoint,
                target_id: "duplicate",
                observation_ms: 0,
              });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected ambiguous target rejection");
      expect(result.error).toBeInstanceOf(BrowserObservationError);
      expect(result.error.userMessage).toContain("ambiguous");
      expect(upgrades).toBe(0);
    } finally {
      await provider.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    }
  },
);
