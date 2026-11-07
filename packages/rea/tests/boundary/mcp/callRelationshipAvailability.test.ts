import { rm } from "node:fs/promises";

import type { Client } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AnalysisClient,
  AnalysisProvider,
  CapabilityDescriptor,
} from "../../../src/application/AnalysisProvider.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { ok } from "../../../src/domain/result.js";
import type { ProviderRejectionCode } from "../../../src/domain/providerSelection.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createSessionMcpHarness } from "./sessionMcpHarness.js";

const resources: Array<{ close(): Promise<unknown> }> = [];
let directory: string | undefined;

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

const providerIdentity = {
  id: "fixture",
  name: "Fixture analysis provider",
  version: "1",
};
const effects = {
  mutatesArtifact: false,
  launchesProcess: false,
  mayShowUi: false,
  mayAccessNetwork: false,
  mayWriteFilesystem: false,
  changesPermissions: false,
  requiresRoot: false,
};
const addressBySymbol = new Map([
  ["start", "0x1000"],
  ["goal", "0x2000"],
]);
type RelationshipOperation =
  | "procedure_address"
  | "procedure_callees"
  | "procedure_callers";
type Scenario = {
  readonly name: string;
  readonly operations: readonly RelationshipOperation[];
  readonly unavailable?: RelationshipOperation;
  readonly availabilityCode?: ProviderRejectionCode;
  readonly unavailableReason?: string;
};

const FULL_SCENARIO: Scenario = {
  name: "both directions",
  operations: ["procedure_address", "procedure_callees", "procedure_callers"],
};
const scenarios: readonly Scenario[] = [
  FULL_SCENARIO,
  {
    name: "forward only",
    operations: ["procedure_address", "procedure_callees"],
  },
  {
    name: "backward only",
    operations: ["procedure_address", "procedure_callers"],
  },
  {
    name: "address missing",
    operations: ["procedure_callees", "procedure_callers"],
  },
  {
    name: "address unavailable",
    operations: ["procedure_address", "procedure_callees", "procedure_callers"],
    unavailable: "procedure_address",
  },
  {
    name: "forward relationship unavailable",
    operations: ["procedure_address", "procedure_callees", "procedure_callers"],
    unavailable: "procedure_callees",
  },
  {
    name: "address unsupported on host",
    operations: ["procedure_address", "procedure_callees", "procedure_callers"],
    unavailable: "procedure_address",
    availabilityCode: "unsupported_host",
    unavailableReason: "Procedure address lookup is unsupported on this host.",
  },
  { name: "no relationships", operations: ["procedure_address"] },
];

describe("call relationship capability inventory at the public MCP boundary", () => {
  it.each(scenarios)(
    "keeps $name inventory aligned with callable modes",
    async (scenario) => {
      directory = await createTestTempDirectory("rea-call-availability-");
      const calls: string[] = [];
      const { mcp, first } = await createSessionMcpHarness(
        directory,
        () => relationshipProvider(scenario, calls),
        resources,
        undefined,
        // The full scenario retains default advertisement coverage; the
        // remaining cases exercise availability and canonical call results.
        scenario === FULL_SCENARIO ? undefined : "off",
      );
      const toolsBefore = await mcp.listTools();
      const before = await sessionInventory(mcp);
      const opened = await mcp.callTool({
        name: "open_binary",
        arguments: { path: first },
      });
      expect(opened.isError).not.toBe(true);

      try {
        const inventory = await sessionInventory(mcp);
        await assertDirectExecution(mcp, scenario, calls);
        assertInventory(inventory, scenario);
        const after = await sessionInventory(mcp);
        expect((await mcp.listTools()).tools.map(({ name }) => name)).toEqual(
          toolsBefore.tools.map(({ name }) => name),
        );
        expect(after.result.server_identity.catalog).toEqual(
          before.result.server_identity.catalog,
        );
      } finally {
        const closed = await mcp.callTool({
          name: "close_binary",
          arguments: {},
        });
        expect(closed.isError).not.toBe(true);
      }
    },
  );

  it("keeps call relationship tools unavailable before a target is open", async () => {
    directory = await createTestTempDirectory(
      "rea-call-availability-no-target-",
    );
    const { mcp } = await createSessionMcpHarness(
      directory,
      () => relationshipProvider(FULL_SCENARIO, []),
      resources,
    );
    const inventory = await sessionInventory(mcp);
    expect(inventory.result.open).toBe(false);
    expect(
      Object.fromEntries(
        callToolAvailability(inventory).map((entry) => [
          entry.name,
          entry.reason,
        ]),
      ),
    ).toEqual({
      trace_call_path: "target_required",
      get_call_graph: "target_required",
    });
  });
});

const sessionInventory = async (mcp: Client) => {
  const result = await mcp.callTool({ name: "binary_session", arguments: {} });
  return toolContract("binary_session").outputSchema.parse(
    result.structuredContent,
  );
};

const callToolAvailability = (
  inventory: Awaited<ReturnType<typeof sessionInventory>>,
) =>
  expandToolAvailability(inventory.result.tool_availability).filter((entry) =>
    ["trace_call_path", "get_call_graph"].includes(entry.name),
  );

const assertDirectExecution = async (
  mcp: Client,
  scenario: Scenario,
  calls: string[],
): Promise<void> => {
  for (const direction of ["forward", "backward"] as const) {
    const relation =
      direction === "forward" ? "procedure_callees" : "procedure_callers";
    const start = direction === "forward" ? "start" : "goal";
    const goal = direction === "forward" ? "goal" : "start";
    const startAddress = direction === "forward" ? "0x1000" : "0x2000";
    const nextAddress = direction === "forward" ? "0x2000" : "0x1000";
    const graph = await mcp.callTool({
      name: "get_call_graph",
      arguments: { address: start, direction },
    });
    const trace = await mcp.callTool({
      name: "trace_call_path",
      arguments: { start, goal, direction },
    });

    if (!scenario.operations.includes("procedure_address")) {
      expect(errorCode(graph)).toBe("capability_unavailable");
      expect(errorCode(trace)).toBe("capability_unavailable");
    } else if (scenario.unavailable === "procedure_address") {
      expect(errorCode(graph)).toBe("capability_unavailable");
      expect(errorCode(trace)).toBe("capability_unavailable");
      expect(calls).toEqual([]);
    } else if (
      !scenario.operations.includes(relation) ||
      scenario.unavailable === relation
    ) {
      expect(calls).not.toContain(relation);
      expect(graph.structuredContent).toMatchObject({
        normalized_result: {
          graph: {
            "0": [
              {
                address: startAddress,
                status: "error",
                error: { code: "capability_unavailable" },
              },
            ],
          },
        },
      });
      expect(trace.structuredContent).toMatchObject({
        normalized_result: {
          goal_status: "unknown",
          truncated: true,
          failures: expect.arrayContaining([
            expect.objectContaining({
              address: startAddress,
              error: expect.objectContaining({
                code: "capability_unavailable",
              }),
            }),
          ]),
        },
      });
    } else {
      expect(graph.structuredContent).toMatchObject({
        normalized_result: {
          graph: {
            "0": [
              {
                address: startAddress,
                status: "ok",
                calls: [nextAddress],
                relationship_coverage: { status: "complete" },
              },
            ],
          },
        },
      });
      expect(trace.structuredContent).toMatchObject({
        normalized_result: {
          goal_status: "reached",
          traversal_path: [startAddress, nextAddress],
          relationship_coverage: { [startAddress]: { status: "complete" } },
        },
      });
    }
  }

  if (
    scenario.operations.includes("procedure_address") &&
    !scenario.operations.includes("procedure_callees") &&
    !scenario.operations.includes("procedure_callers")
  ) {
    const callsBefore = calls.length;
    const sameEndpoint = await mcp.callTool({
      name: "trace_call_path",
      arguments: { start: "start", goal: "start" },
    });
    expect(sameEndpoint.structuredContent).toMatchObject({
      normalized_result: {
        goal_status: "reached",
        traversal_path: ["0x1000"],
      },
    });
    expect(
      calls
        .slice(callsBefore)
        .every((operation) => operation === "procedure_address"),
    ).toBe(true);
  }
};

const assertInventory = (
  inventory: Awaited<ReturnType<typeof sessionInventory>>,
  scenario: Scenario,
): void => {
  const available = callToolAvailability(inventory);
  const trace = available.find((entry) => entry.name === "trace_call_path");
  const graph = available.find((entry) => entry.name === "get_call_graph");
  expect(trace).toBeDefined();
  expect(graph).toBeDefined();
  if (trace === undefined || graph === undefined)
    throw new Error("call relationship tools missing from inventory");

  const forwardAvailable = modeAvailable(scenario, "procedure_callees");
  const backwardAvailable = modeAvailable(scenario, "procedure_callers");
  const expected = {
    available: forwardAvailable || backwardAvailable,
    reason: availabilityReason(scenario),
    default_mode_available: forwardAvailable,
    modes: [
      mode("forward", scenario, "procedure_callees"),
      mode("backward", scenario, "procedure_callers"),
    ],
  };
  expect(trace).toMatchObject(expected);
  expect(graph).toMatchObject(expected);
  if (scenario.unavailableReason !== undefined) {
    expect(trace.remediation).toContain(scenario.unavailableReason);
    expect(graph.remediation).toContain(scenario.unavailableReason);
  }
};

const modeAvailable = (
  scenario: Scenario,
  relation: "procedure_callees" | "procedure_callers",
): boolean =>
  scenario.operations.includes("procedure_address") &&
  scenario.unavailable !== "procedure_address" &&
  scenario.unavailable !== relation &&
  scenario.operations.includes(relation);

const mode = (
  name: "forward" | "backward",
  scenario: Scenario,
  relation: "procedure_callees" | "procedure_callers",
) => {
  const available = modeAvailable(scenario, relation);
  const required: readonly RelationshipOperation[] = [
    "procedure_address",
    relation,
  ];
  const missing = required.filter(
    (operation) =>
      !scenario.operations.includes(operation) ||
      scenario.unavailable === operation,
  );
  return {
    name,
    available,
    missing_operations: available ? [] : missing,
    remediation: available ? null : expect.any(String),
  };
};

const availabilityReason = (scenario: Scenario) => {
  if (scenario.unavailable === "procedure_address")
    return scenario.availabilityCode === "unsupported_host"
      ? "unsupported_host"
      : "provider_unavailable";
  if (!scenario.operations.includes("procedure_address"))
    return "provider_missing";
  return scenario.operations.some((operation) =>
    ["procedure_callees", "procedure_callers"].includes(operation),
  )
    ? "available"
    : "provider_missing";
};

const errorCode = (result: CallToolResult): unknown =>
  result.isError === true ? parseMcpToolError(result).error.code : undefined;

const relationshipProvider = (
  scenario: Scenario,
  calls: string[],
): AnalysisProvider => {
  const capabilities: CapabilityDescriptor[] = scenario.operations.map(
    (operation) => {
      const shared = {
        provider: providerIdentity,
        operation,
        effects,
        limitations: [],
      };
      return scenario.unavailable === operation
        ? {
            ...shared,
            available: false as const,
            reason:
              scenario.unavailableReason ?? "fixture operation unavailable",
            ...(scenario.availabilityCode === undefined
              ? {}
              : { availabilityCode: scenario.availabilityCode }),
          }
        : { ...shared, available: true as const, reason: null };
    },
  );
  return {
    identity: () => providerIdentity,
    capabilities: () => capabilities,
    createClient: (): AnalysisClient => ({
      execute: async (operation, arguments_) => {
        if (operation === "health")
          return ok(createAnalysisExecution(null, providerIdentity));
        calls.push(operation);
        if (operation === "procedure_address") {
          const address = addressBySymbol.get(String(arguments_.procedure));
          return ok(createAnalysisExecution(address ?? null, providerIdentity));
        }
        if (
          operation === "procedure_callees" ||
          operation === "procedure_callers"
        ) {
          const forward = operation === "procedure_callees";
          const edge = forward ? "0x2000" : "0x1000";
          const from = forward ? "0x1000" : "0x2000";
          const related = String(arguments_.procedure) === from ? [edge] : [];
          return ok(
            createAnalysisExecution(related, providerIdentity, {
              relationshipCoverage: { status: "complete" },
            }),
          );
        }
        throw new Error(`Unexpected operation ${operation}`);
      },
      close: async () => ok(null),
    }),
  };
};
