import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Client } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type {
  AnalysisExecution,
  AnalysisClient,
  AnalysisProvider,
  CapabilityDescriptor,
  AnalysisOperation,
} from "../../../src/application/AnalysisProvider.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import type { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../../src/domain/analysisErrorCore.js";
import {
  buildInterfaceBuilderAnalysis,
  interfaceBuilderLimitsSchema,
} from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { inspectNativeDispatchMetadata } from "../../../src/domain/native/objcSwiftMetadata.js";
import { nativeInvestigationTraceSchema } from "../../../src/domain/native/nativeInvestigationGraph.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { err, ok, type Result } from "../../../src/domain/result.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createSessionMcpHarness } from "./sessionMcpHarness.js";

const resources: Array<{ close(): Promise<unknown> }> = [];

const writeEligibleAppBundle = async (root: string): Promise<string> => {
  const app = join(root, "Eligible.app");
  const contents = join(app, "Contents");
  await mkdir(join(contents, "MacOS"), { recursive: true });
  await writeFile(
    join(contents, "MacOS", "Fixture"),
    thinMach(0xfeedfacf, 0x0100000c),
  );
  await writeFile(
    join(contents, "Info.plist"),
    "<plist><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>",
  );
  return app;
};

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

const identity = {
  id: "fixture",
  name: "Fixture analysis provider",
  version: "1",
};
const controllerName = "BuildViewController";
const selector = "buildTapped:";
const handlerAddress = "0x1000";
const calleeAddress = "0x2000";
const dispatchMetadata = inspectNativeDispatchMetadata(
  [{ address: handlerAddress, name: `-[${controllerName} ${selector}]` }],
  1,
);
const symbolInventory = [
  { address: handlerAddress, value: `-[${controllerName} ${selector}]` },
];
const interfaceBuilderFor = (targetSha256: string) =>
  buildInterfaceBuilderAnalysis({
    targetSha256,
    toolVersion: "fixture",
    documents: [
      {
        relativePath: "Main.storyboardc/scene.nib/objects.nib",
        archiveSha256: "b".repeat(64),
        documentKind: "storyboard_scene",
        raw: {
          "com.apple.ibtool.document.objects": {
            controller: { customClass: controllerName },
            button: { class: "UIButton", title: "Build" },
          },
          "com.apple.ibtool.document.connections": {
            button: [
              { type: "action", label: selector, destinationId: "controller" },
            ],
          },
        },
      },
    ],
    limits: interfaceBuilderLimitsSchema.parse({}),
  });

type ScenarioName =
  | "authored-ui-direct"
  | "authored-ui-symbols"
  | "native-seed-typed"
  | "native-seed-callees"
  | "metadata-only"
  | "missing-metadata"
  | "native-route-unavailable"
  | "metadata-runtime-failure"
  | "decode-cancelled";
type ProviderOperation = Extract<
  AnalysisOperation,
  | "decode_interface_builder"
  | "list_names"
  | "inspect_native_dispatch_metadata"
  | "procedure_address"
  | "procedure_references"
  | "procedure_callees"
>;
type Scenario = {
  readonly name: ScenarioName;
  readonly capabilities: readonly {
    readonly operation: ProviderOperation;
    readonly available: true;
  }[];
  readonly unavailable?: readonly {
    readonly operation: ProviderOperation;
    readonly reason: string;
  }[];
  readonly failure?: "metadata-runtime" | "decode-cancelled";
};
type RouteScenario = Scenario & {
  readonly route: "authored_ui_dispatch" | "native_seed_call_trace";
};

const authoredUiDirectScenario: RouteScenario = {
  name: "authored-ui-direct",
  route: "authored_ui_dispatch",
  capabilities: [
    { operation: "decode_interface_builder", available: true },
    { operation: "inspect_native_dispatch_metadata", available: true },
  ],
};
const authoredUiSymbolsScenario: RouteScenario = {
  name: "authored-ui-symbols",
  route: "authored_ui_dispatch",
  capabilities: [
    { operation: "decode_interface_builder", available: true },
    { operation: "list_names", available: true },
  ],
};
const nativeSeedTypedScenario: RouteScenario = {
  name: "native-seed-typed",
  route: "native_seed_call_trace",
  capabilities: [
    { operation: "inspect_native_dispatch_metadata", available: true },
    { operation: "procedure_address", available: true },
    { operation: "procedure_references", available: true },
  ],
};
const nativeSeedCalleesScenario: RouteScenario = {
  name: "native-seed-callees",
  route: "native_seed_call_trace",
  capabilities: [
    { operation: "inspect_native_dispatch_metadata", available: true },
    { operation: "procedure_address", available: true },
    { operation: "procedure_callees", available: true },
  ],
};

const routeScenarios = [
  authoredUiDirectScenario,
  authoredUiSymbolsScenario,
  nativeSeedTypedScenario,
  nativeSeedCalleesScenario,
] as const;

const metadataOnlyScenario: Scenario = {
  name: "metadata-only",
  capabilities: [
    { operation: "inspect_native_dispatch_metadata", available: true },
  ],
};
const missingMetadataScenario: Scenario = {
  name: "missing-metadata",
  capabilities: [{ operation: "decode_interface_builder", available: true }],
};
const unavailableNativeRouteScenario: Scenario = {
  name: "native-route-unavailable",
  capabilities: [
    { operation: "inspect_native_dispatch_metadata", available: true },
    { operation: "procedure_address", available: true },
  ],
  unavailable: [
    {
      operation: "procedure_references",
      reason: "Typed references are unavailable in this fixture.",
    },
  ],
};
const metadataRuntimeFailureScenario: Scenario = {
  name: "metadata-runtime-failure",
  capabilities: [
    { operation: "decode_interface_builder", available: true },
    { operation: "inspect_native_dispatch_metadata", available: true },
    { operation: "list_names", available: true },
  ],
  failure: "metadata-runtime",
};
const decodeCancelledScenario: Scenario = {
  name: "decode-cancelled",
  capabilities: [
    { operation: "decode_interface_builder", available: true },
    { operation: "inspect_native_dispatch_metadata", available: true },
    { operation: "list_names", available: true },
  ],
  failure: "decode-cancelled",
};

describe("native UI action availability through available routes", () => {
  it.each(routeScenarios)(
    "reports the $name route available when its observed path succeeds",
    async (scenario) => {
      const directory = await createTestTempDirectory(
        "rea-native-ui-availability-",
      );
      const calls: ProviderOperation[] = [];
      const { mcp } = await createSessionMcpHarness(
        directory,
        () => provider(scenario, calls),
        resources,
      );
      const app = await writeEligibleAppBundle(directory);
      const opened = await mcp.callTool({
        name: "open_binary",
        arguments: { path: app },
      });
      expect(opened.isError).not.toBe(true);

      try {
        const inventory = await readInventory(mcp);
        const result = await mcp.callTool({
          name: "trace_native_ui_action",
          arguments: {
            action:
              scenario.route === "authored_ui_dispatch"
                ? selector
                : `-[${controllerName} ${selector}]`,
          },
        });
        assertSuccessfulRoute(scenario, result, calls);

        expect(dispatchAvailability(inventory)).toMatchObject({
          available: true,
          reason: "available",
        });
        const entry = dispatchAvailability(inventory);
        expect(entry?.modes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: scenario.route,
              available: true,
            }),
          ]),
        );
        expect(entry).not.toHaveProperty("default_mode_available");
      } finally {
        const closed = await mcp.callTool({
          name: "close_binary",
          arguments: {},
        });
        expect(closed.isError).not.toBe(true);
      }
    },
  );
});

describe("native UI action availability for unmet routes", () => {
  it.each([
    metadataOnlyScenario,
    missingMetadataScenario,
    unavailableNativeRouteScenario,
  ])(
    "reports unmet route sources for $name without hiding partial results",
    async (scenario) => {
      const directory = await createTestTempDirectory(
        "rea-native-ui-no-metadata-",
      );
      const calls: ProviderOperation[] = [];
      const { mcp } = await createSessionMcpHarness(
        directory,
        () => provider(scenario, calls),
        resources,
      );
      const app = await writeEligibleAppBundle(directory);
      const opened = await mcp.callTool({
        name: "open_binary",
        arguments: { path: app },
      });
      expect(opened.isError).not.toBe(true);

      try {
        const inventory = await readInventory(mcp);
        const result = await mcp.callTool({
          name: "trace_native_ui_action",
          arguments: {
            action:
              scenario.name === "metadata-only"
                ? "missingAction:"
                : scenario.name === "native-route-unavailable"
                  ? `-[${controllerName} ${selector}]`
                  : selector,
          },
        });
        if (scenario.name === "metadata-only") {
          expect(result.isError).not.toBe(true);
          const trace = z
            .object({ normalized_result: nativeInvestigationTraceSchema })
            .parse(result.structuredContent).normalized_result;
          expect(trace.edges).toEqual([]);
          expect(trace.nodes).toEqual([]);
          expect(trace.reason).toBe("ui_action_or_object_not_found");
          expect(trace.coverage).toContainEqual(
            expect.objectContaining({
              facet: "interface_builder_archives",
              status: "unsupported",
            }),
          );
          expect(calls).toEqual(["inspect_native_dispatch_metadata"]);
        } else if (scenario.name === "missing-metadata") {
          expect(result.isError).toBe(true);
          expect(parseMcpToolError(result)).toMatchObject({
            error: { code: "capability_unavailable" },
          });
          expect(calls).toContain("decode_interface_builder");
          expect(calls).not.toContain("inspect_native_dispatch_metadata");
        } else {
          expect(result.isError).not.toBe(true);
          expect(calls).toContain("procedure_address");
          expect(calls).not.toContain("procedure_references");
        }
        const entry = dispatchAvailability(inventory);
        expect(entry).toMatchObject({
          available: false,
          reason:
            scenario.name === "native-route-unavailable"
              ? "unsupported_host"
              : "provider_missing",
        });
        expect(entry?.modes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "authored_ui_dispatch",
              available: false,
            }),
            expect.objectContaining({
              name: "native_seed_call_trace",
              available: false,
            }),
          ]),
        );
        if (scenario.name === "metadata-only") {
          const authored = entry?.modes?.find(
            (mode) => mode.name === "authored_ui_dispatch",
          );
          expect(authored?.missing_operations).toEqual([
            "decode_interface_builder",
          ]);
        }
        if (scenario.name === "missing-metadata") {
          const authored = entry?.modes?.find(
            (mode) => mode.name === "authored_ui_dispatch",
          );
          expect(authored?.missing_operations).toEqual([
            "inspect_native_dispatch_metadata",
            "list_names",
          ]);
        }
        if (scenario.name === "native-route-unavailable") {
          const native = entry?.modes?.find(
            (mode) => mode.name === "native_seed_call_trace",
          );
          expect(native?.missing_operations).toEqual([
            "procedure_references",
            "procedure_callees",
          ]);
        }
      } finally {
        const closed = await mcp.callTool({
          name: "close_binary",
          arguments: {},
        });
        expect(closed.isError).not.toBe(true);
      }
    },
  );
});

describe("native UI action availability for failures and target gates", () => {
  it.each([metadataRuntimeFailureScenario, decodeCancelledScenario])(
    "preserves runtime failures for $name without trying another declared source",
    async (scenario) => {
      const directory = await createTestTempDirectory(
        "rea-native-ui-source-failure-",
      );
      const calls: ProviderOperation[] = [];
      const { mcp } = await createSessionMcpHarness(
        directory,
        () => provider(scenario, calls),
        resources,
      );
      const app = await writeEligibleAppBundle(directory);
      expect(
        (
          await mcp.callTool({
            name: "open_binary",
            arguments: { path: app },
          })
        ).isError,
      ).not.toBe(true);
      try {
        const inventory = await readInventory(mcp);
        const result = await mcp.callTool({
          name: "trace_native_ui_action",
          arguments: { action: selector },
        });
        expect(result.isError).toBe(true);
        expect(parseMcpToolError(result).error.code).toBe(
          scenario.name === "decode-cancelled"
            ? "cancelled"
            : "unreadable_output",
        );
        if (scenario.name === "metadata-runtime-failure") {
          expect(calls).toContain("inspect_native_dispatch_metadata");
          expect(calls).not.toContain("list_names");
        } else {
          expect(calls).toContain("decode_interface_builder");
          expect(calls).not.toContain("list_names");
        }
        expect(dispatchAvailability(inventory)).toMatchObject({
          available: true,
        });
      } finally {
        expect(
          (await mcp.callTool({ name: "close_binary", arguments: {} })).isError,
        ).not.toBe(true);
      }
    },
  );

  it("reports target_required before querying provider operations", async () => {
    const directory = await createTestTempDirectory("rea-native-ui-no-target-");
    const calls: ProviderOperation[] = [];
    const { mcp } = await createSessionMcpHarness(
      directory,
      () => provider(authoredUiDirectScenario, calls),
      resources,
    );
    const inventory = await readInventory(mcp);
    expect(inventory.result.open).toBe(false);
    expect(dispatchAvailability(inventory)).toMatchObject({
      available: false,
      reason: "target_required",
    });
    expect(calls).toEqual([]);
  });

  it("keeps authored UI dispatch unavailable for a non-bundle target", async () => {
    const directory = await createTestTempDirectory(
      "rea-native-ui-non-bundle-",
    );
    const calls: ProviderOperation[] = [];
    const { mcp } = await createSessionMcpHarness(
      directory,
      () => provider(authoredUiDirectScenario, calls),
      resources,
    );
    const executable = join(directory, "Standalone");
    await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
    expect(
      (
        await mcp.callTool({
          name: "open_binary",
          arguments: { path: executable },
        })
      ).isError,
    ).not.toBe(true);

    try {
      const entry = dispatchAvailability(await readInventory(mcp));
      const authored = entry?.modes?.find(
        (mode) => mode.name === "authored_ui_dispatch",
      );
      expect(authored).toMatchObject({
        available: false,
        missing_operations: ["decode_interface_builder"],
      });
      expect(calls).toEqual([]);
    } finally {
      expect(
        (await mcp.callTool({ name: "close_binary", arguments: {} })).isError,
      ).not.toBe(true);
    }
  });
});

const readInventory = async (mcp: Client) => {
  const result = await mcp.callTool({ name: "binary_session", arguments: {} });
  return toolContract("binary_session").outputSchema.parse(
    result.structuredContent,
  );
};

const dispatchAvailability = (
  inventory: Awaited<ReturnType<typeof readInventory>>,
) =>
  expandToolAvailability(inventory.result.tool_availability).find(
    (entry) => entry.name === "trace_native_ui_action",
  );

const assertSuccessfulRoute = (
  scenario: RouteScenario,
  result: CallToolResult,
  calls: readonly ProviderOperation[],
): void => {
  expect(result.isError).not.toBe(true);
  const trace = z
    .object({ normalized_result: nativeInvestigationTraceSchema })
    .parse(result.structuredContent).normalized_result;
  expect(trace.target_sha256).toMatch(/^[a-f0-9]{64}$/u);
  if (scenario.route === "authored_ui_dispatch") {
    expect(trace.edges).toContainEqual(
      expect.objectContaining({
        relation: "objc_dispatch",
        to: `native:function:${handlerAddress}`,
      }),
    );
    expect(calls).toContain("decode_interface_builder");
    expect(calls).toContain(
      scenario.name === "authored-ui-direct"
        ? "inspect_native_dispatch_metadata"
        : "list_names",
    );
    expect(calls).not.toContain(
      scenario.name === "authored-ui-direct"
        ? "list_names"
        : "inspect_native_dispatch_metadata",
    );
    expect(calls).not.toContain("procedure_address");
    return;
  }
  expect(trace.start).toBe(`native:function:${handlerAddress}`);
  expect(trace.edges).toContainEqual(
    expect.objectContaining({
      relation:
        scenario.name === "native-seed-typed" ? "direct_call" : "provider_call",
      from: `native:function:${handlerAddress}`,
      to: `native:function:${calleeAddress}`,
    }),
  );
  expect(calls).not.toContain("decode_interface_builder");
  expect(calls).toContain("inspect_native_dispatch_metadata");
  expect(calls).toContain("procedure_address");
  expect(calls).toContain(
    scenario.name === "native-seed-typed"
      ? "procedure_references"
      : "procedure_callees",
  );
};

const capabilityEffects = {
  mutatesArtifact: false,
  launchesProcess: false,
  mayShowUi: false,
  mayAccessNetwork: false,
  mayWriteFilesystem: false,
  changesPermissions: false,
  requiresRoot: false,
};

const providerOperations = new Set<AnalysisOperation>([
  "decode_interface_builder",
  "list_names",
  "inspect_native_dispatch_metadata",
  "procedure_address",
  "procedure_references",
  "procedure_callees",
]);

const isProviderOperation = (
  operation: AnalysisOperation,
): operation is ProviderOperation => providerOperations.has(operation);

type ProviderFixtureContext = {
  readonly scenario: Scenario;
  readonly calls: ProviderOperation[];
  readonly target: Parameters<AnalysisProvider["createClient"]>[0];
  readonly profile: Parameters<AnalysisProvider["createClient"]>[1];
};

const provider = (
  scenario: Scenario,
  calls: ProviderOperation[],
): AnalysisProvider => {
  const capabilities: CapabilityDescriptor[] = [
    ...scenario.capabilities.map((capability) => {
      return {
        provider: identity,
        operation: capability.operation,
        effects: capabilityEffects,
        limitations: [],
        available: true as const,
        reason: null,
      };
    }),
    ...(scenario.unavailable ?? []).map((capability) => {
      return {
        provider: identity,
        operation: capability.operation,
        effects: capabilityEffects,
        limitations: [],
        available: false as const,
        availabilityCode: "unsupported_host" as const,
        reason: capability.reason,
      };
    }),
  ];
  return {
    identity: () => identity,
    capabilities: () => capabilities,
    createClient: (target, profile): AnalysisClient => ({
      execute: (operation, parameters) =>
        executeProviderFixture(
          { scenario, calls, target, profile },
          operation,
          parameters,
        ),
      close: async () => ok(null),
    }),
  };
};

const executeProviderFixture = async (
  context: ProviderFixtureContext,
  operation: AnalysisOperation,
  parameters: Readonly<Record<string, JsonValue>>,
): Promise<Result<AnalysisExecution, AnalysisError>> => {
  if (operation === "health")
    return ok(createAnalysisExecution(null, identity));
  if (!isProviderOperation(operation))
    throw new Error(`Unexpected provider operation: ${operation}`);
  context.calls.push(operation);
  const failure = failureFor(context.scenario, operation);
  if (failure !== undefined) return err(failure);
  return ok(
    createAnalysisExecution(
      resultFor(operation, parameters, context.target.sha256, context.profile),
      identity,
      {
        subject: context.target,
        ...(context.profile === undefined
          ? {}
          : { analysisProfile: context.profile }),
      },
    ),
  );
};

const failureFor = (
  scenario: Scenario,
  operation: ProviderOperation,
): AnalysisError | undefined => {
  if (
    operation === "inspect_native_dispatch_metadata" &&
    scenario.failure === "metadata-runtime"
  )
    return new AnalysisOutputError(
      "inspect_native_dispatch_metadata",
      "fixture failure",
    );
  if (
    operation === "decode_interface_builder" &&
    scenario.failure === "decode-cancelled"
  )
    return new AnalysisCancelledError("decode_interface_builder");
  return undefined;
};

const resultFor = (
  operation: ProviderOperation,
  parameters: Readonly<Record<string, JsonValue>>,
  targetSha256: string,
  profile: Parameters<AnalysisProvider["createClient"]>[1],
): unknown => {
  switch (operation) {
    case "decode_interface_builder":
      return interfaceBuilderFor(targetSha256);
    case "inspect_native_dispatch_metadata":
      return {
        target_sha256: targetSha256,
        provider: identity,
        analysis_profile_digest: profile?.digest ?? null,
        result: dispatchMetadata,
      };
    case "procedure_address":
      return handlerAddress;
    case "list_names":
      return symbolInventory;
    case "procedure_callees":
      return parameters.procedure === handlerAddress ? [calleeAddress] : [];
    case "procedure_references":
      return typedCallReferences(
        typeof parameters.procedure === "string" ? parameters.procedure : "",
      );
  }
};

const typedCallReferences = (procedure: string) => ({
  reference_kinds_available: true,
  references:
    procedure === handlerAddress
      ? [
          {
            source_address: "0x1008",
            target_address: calleeAddress,
            target_procedure: { address: calleeAddress },
            kind: {
              available: true,
              provenance: "fixture typed reference",
              type: "call",
              flow: true,
              call: true,
              jump: false,
              data: false,
              read: false,
              write: false,
              indirect: false,
              computed: false,
              conditional: false,
              terminal: false,
              primary: true,
              operand_index: 0,
              external: false,
            },
          },
        ]
      : [],
  unresolved_calls: [],
});
