import type { Client } from "@modelcontextprotocol/client";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import {
  TOOL_CONTRACTS,
  toolContract,
} from "../../../src/contracts/toolContracts.js";
import { TOOL_FAMILY_DEFINITIONS } from "../../../src/contracts/toolFamilies.js";
import { registerSessionStatusTool } from "../../../src/server/registerSessionStatusTool.js";
import type { BinarySessionPort } from "../../../src/application/binary/BinarySessionPort.js";
import { binaryTargetSummary } from "../../../src/application/binary/BinaryTargetSummary.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { jsonObjectSchema } from "../../../src/domain/jsonValue.js";
import { ToolResultDelivery } from "../../../src/server/ToolResultDelivery.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";
import { createTestMcp } from "../../support/mcp/mcpFixture.js";

const scopedServer = (
  advertisedToolFamilies: ReadonlySet<string> | undefined,
): EvidenceMcpServer =>
  new EvidenceMcpServer(
    { name: "tool-families", version: "0" },
    { capabilities: {} },
    undefined,
    new ToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
    undefined,
    "full",
    undefined,
    advertisedToolFamilies,
  );

const registerCatalog = (server: EvidenceMcpServer): void => {
  for (const contract of TOOL_CONTRACTS)
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async () => ({ content: [] }),
    );
};

const withClient = async (
  server: EvidenceMcpServer,
  use: (client: Client) => Promise<void>,
): Promise<void> => {
  const mcp = createTestMcp();
  try {
    const client = await mcp.connect(server, {
      name: "tool-families",
      version: "0",
    });
    await use(client);
  } finally {
    await mcp.close();
  }
};

const familyTools = (...ids: readonly string[]): readonly string[] =>
  TOOL_FAMILY_DEFINITIONS.filter(({ id }) => ids.includes(id)).flatMap(
    ({ contracts }) => contracts.map(({ name }) => name),
  );

/** Route facts with one direct operation the status report must hide. */
const sessionStatusWithDirectOperations = () => ({
  open: true,
  ...binaryTargetSummary({
    path: "/fixture/tool-family-target",
    kind: "executable",
    format: "mach-o",
    architecture: "x86_64",
    availableArchitectures: ["x86_64"],
    sha256: "a".repeat(64),
  }),
  cleanup_pending: false,
  analysis_run: null,
  analysis_activity: { status: "not_observed", providers: [] },
  provider_operation_health: null,
  analysis_provider_binding: null,
  capabilities: [
    {
      provider: { id: "probe", name: "Probe", version: "1" },
      shared_limitations: [],
      groups: [
        {
          operations: [
            "open_binary",
            "get_navigation_context",
            "current_document",
            "current_address",
            "resolve_containing_procedure",
            "inspect_macho",
          ],
          effects: ["mutates_artifact"],
          limitations: [],
          available: true,
          reason: null,
          availability_code: null,
        },
      ],
    },
  ],
  analysis_provider_candidates: [],
});

interface SessionReport {
  readonly capabilities?: readonly {
    readonly groups: readonly { readonly operations: readonly string[] }[];
  }[];
  readonly tool_availability?: {
    readonly groups: readonly {
      readonly names: readonly string[];
      readonly available: boolean;
      readonly reason: string | null;
      readonly default_mode_available?: boolean;
    }[];
  };
}

describe("MCP tool family advertising", () => {
  it("advertises every catalog tool when no scope is set", async () => {
    const server = scopedServer(undefined);
    registerCatalog(server);
    await withClient(server, async (client) => {
      expect(
        (await client.listTools()).tools.map(({ name }) => name).sort(),
      ).toEqual(TOOL_CONTRACTS.map(({ name }) => name).sort());
    });
  });

  it("advertises only the scoped families", async () => {
    const server = scopedServer(new Set(["session", "javascript-runtime"]));
    registerCatalog(server);
    await withClient(server, async (client) => {
      const advertised = (await client.listTools()).tools
        .map(({ name }) => name)
        .sort();
      expect(advertised).toEqual(
        [...familyTools("session", "javascript-runtime")].sort(),
      );
      expect(advertised).not.toContain("inspect_macho");
    });
  });

  it("fails calls to out-of-scope tools with the disabled-tool error", async () => {
    const server = scopedServer(new Set(["session"]));
    registerCatalog(server);
    await withClient(server, async (client) => {
      await expect(
        client.callTool({ name: "list_frida_devices" }),
      ).rejects.toThrow(/disabled/u);
    });
  });

  it("reflects the scope in availability reports", () => {
    const server = scopedServer(new Set(["session"]));
    registerCatalog(server);
    // Status reporting must not advertise a tool the registration disables.
    expect(server.advertisesTool("open_binary")).toBe(true);
    expect(server.advertisesTool("analyze_javascript_application")).toBe(false);
    expect(server.advertisesTool("inspect_macho")).toBe(false);
  });

  it("advertises every tool in availability reports when no scope is set", () => {
    const server = scopedServer(undefined);
    registerCatalog(server);
    for (const { name } of TOOL_CONTRACTS)
      expect(server.advertisesTool(name)).toBe(true);
  });

  it.each([
    { scope: ["session"], probed: [] },
    { scope: ["session", "android", "adb"], probed: ["android", "adb"] },
    { scope: ["session", "artifact"], probed: ["evm"] },
  ])(
    "probes only advertised families for binary_session status ($scope)",
    async ({ scope, probed }) => {
      const server = scopedServer(new Set(scope));
      const calls: string[] = [];
      const probe = (name: string) => async () => {
        calls.push(name);
        return {
          status: "unavailable",
          code: "runtime_missing",
          reason: `${name} runtime is unavailable`,
          diagnostics: {},
        } as const;
      };
      registerSessionStatusTool({
        server,
        session: {
          status: sessionStatusWithDirectOperations,
        } as unknown as BinarySessionPort,
        contract: toolContract("binary_session"),
        startedAt: new Date().toISOString(),
        availabilityPolicy: () => ({ processCaptureEnabled: false }),
        androidAnalysisAvailability: probe("android"),
        adbAnalysisAvailability: probe("adb"),
        apktoolAnalysisAvailability: probe("apktool"),
        jebAnalysisAvailability: probe("jeb"),
        evmLimiterAvailability: probe("evm"),
      });
      await withClient(server, async (client) => {
        const result = await client.callTool({
          name: "binary_session",
          arguments: {},
        });
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
      });
      expect(calls.sort()).toEqual([...probed].sort());
    },
  );

  it("reports only advertised operations without erasing composed availability", async () => {
    // `session` advertises `get_navigation_context`, while `direct` owns the
    // operations its default mode composes.
    const server = scopedServer(new Set(["session"]));
    registerSessionStatusTool({
      server,
      session: {
        status: sessionStatusWithDirectOperations,
      } as unknown as BinarySessionPort,
      contract: toolContract("binary_session"),
      startedAt: new Date().toISOString(),
      availabilityPolicy: () => ({ processCaptureEnabled: false }),
      androidAnalysisAvailability: async () => ({
        status: "unavailable",
        code: "runtime_missing",
        reason: "android runtime is unavailable",
        diagnostics: {},
      }),
    });
    let content: Record<string, unknown> | undefined;
    await withClient(server, async (client) => {
      const result = await client.callTool({
        name: "binary_session",
        arguments: {},
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      content = jsonObjectSchema.parse(
        jsonObjectSchema.parse(result.structuredContent).result,
      );
    });

    const report = content as SessionReport | undefined;
    // The public report must follow the scope of `tools/list`.
    const reported = report?.capabilities
      ?.flatMap((set) => set.groups.flatMap(({ operations }) => operations))
      .sort();
    expect(reported).toEqual(["get_navigation_context", "open_binary"]);
    // Availability was built from the complete provider facts: the composed
    // tool needs operations the public report hides.
    const available = report?.tool_availability?.groups.find(({ names }) =>
      names.includes("get_navigation_context"),
    );
    expect(available).toMatchObject({
      available: true,
      reason: "available",
      default_mode_available: true,
    });
  });
});
