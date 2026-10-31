import { afterEach, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import type {
  AnalysisExecution,
  AnalysisOperationPort,
} from "../../../src/application/AnalysisProvider.js";
import type { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../../../src/domain/analysisErrorCore.js";
import { inspectNativeDispatchMetadata } from "../../../src/domain/native/objcSwiftMetadata.js";
import { nativeInvestigationTraceSchema } from "../../../src/domain/native/nativeInvestigationGraph.js";
import { err, ok, type Result } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const identity = { id: "typed", name: "Typed provider", version: "1" };
const fallback = { id: "fallback", name: "Fallback provider", version: "1" };
const sha256 = "a".repeat(64);
const subject = {
  sha256,
  path: "/fixture",
  format: "mach-o",
  architecture: "arm64",
} as const;
const resources: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () =>
  Promise.all(resources.splice(0).map((resource) => resource.close())),
);

function typedKind(indirect = false) {
  return {
    available: true,
    provenance: "fixture reference classification",
    type: "call",
    flow: true,
    call: true,
    jump: false,
    data: false,
    read: false,
    write: false,
    indirect,
    computed: indirect,
    conditional: false,
    terminal: false,
    primary: true,
    operand_index: 0,
    external: false,
  };
}
type CallReference = {
  readonly classification: "none" | "unknown" | "direct" | "objective_c";
  readonly provider_type: number;
  readonly provenance: string;
};
function ref(
  site: string,
  target: string,
  indirect = false,
  callReference?: CallReference,
  targetProcedure = target,
) {
  return {
    source_address: site,
    target_address: target,
    target_procedure: { address: targetProcedure },
    kind:
      callReference === undefined
        ? typedKind(indirect)
        : {
            available: false as const,
            reason: "Detailed reference-kind flags unavailable",
          },
    ...(callReference === undefined ? {} : { call: callReference }),
  };
}
const partialCall = (
  classification: CallReference["classification"],
  provider_type: number,
): CallReference => ({
  classification,
  provider_type,
  provenance: "hopper-public-python-api:CallReference",
});
const mixedReferences = (refs = [ref("0x1004", "0x2000")]) => ({
  reference_kinds_available: false,
  references: [
    ...refs,
    {
      source_address: "0x1008",
      target_address: "0x9000",
      target_procedure: { address: "0x9000" },
      kind: { available: false, reason: "classification unavailable" },
    },
  ],
  unresolved_calls: [],
});
const completeReferences = (refs: ReturnType<typeof ref>[]) => ({
  reference_kinds_available: true,
  references: refs,
  unresolved_calls: [],
});
const noClassifiedReferences = {
  reference_kinds_available: false,
  references: [],
  unresolved_calls: [],
};

type Plan = {
  readonly references?: unknown;
  readonly referencesFailure?: AnalysisError;
  readonly uiFailure?: AnalysisError;
  readonly metadataFailure?: AnalysisError;
  readonly calls?: string[];
  readonly callees?: readonly string[];
  readonly fallbackProvider?: typeof identity;
  readonly fallbackFailure?: "unavailable" | "output" | "cancelled";
};
function publicTrace(plan: Plan, maxNodes = 12, maxEdges = 500) {
  const analysis: AnalysisOperationPort = {
    execute: async (
      operation,
      parameters,
    ): Promise<Result<AnalysisExecution, AnalysisError>> => {
      plan.calls?.push(operation);
      if (
        operation === "decode_interface_builder" &&
        plan.uiFailure !== undefined
      )
        return err(plan.uiFailure);
      if (
        operation === "inspect_native_dispatch_metadata" &&
        plan.metadataFailure !== undefined
      )
        return err(plan.metadataFailure);
      if (
        operation === "procedure_references" &&
        plan.referencesFailure !== undefined
      )
        return err(plan.referencesFailure);
      if (operation === "decode_interface_builder")
        return err(
          new AnalysisCapabilityUnavailableError(
            identity.id,
            operation,
            "No authored UI fixture",
          ),
        );
      if (operation === "inspect_native_dispatch_metadata")
        return ok(
          createAnalysisExecution(
            {
              target_sha256: sha256,
              provider: identity,
              analysis_profile_digest: null,
              result: inspectNativeDispatchMetadata([], 1),
            },
            identity,
            { subject },
          ),
        );
      if (operation === "procedure_address")
        return ok(createAnalysisExecution("0x1000", identity, { subject }));
      if (operation === "procedure_references")
        return ok(
          createAnalysisExecution(
            plan.references ?? mixedReferences(),
            identity,
            { subject },
          ),
        );
      if (operation === "procedure_callees") {
        if (plan.fallbackFailure === "unavailable")
          return err(
            new AnalysisCapabilityUnavailableError(
              identity.id,
              operation,
              "enumeration unavailable in fixture",
            ),
          );
        if (plan.fallbackFailure === "output")
          return err(
            new AnalysisOutputError(
              operation,
              "enumeration output failed in fixture",
            ),
          );
        if (plan.fallbackFailure === "cancelled")
          return err(new AnalysisCancelledError(operation));
        return ok(
          createAnalysisExecution(
            plan.callees ?? ["0x3000"],
            plan.fallbackProvider ?? fallback,
            { subject },
          ),
        );
      }
      throw new Error(
        `Unexpected operation ${operation} ${JSON.stringify(parameters)}`,
      );
    },
  };
  const server = createServer({ kind: "fixed", analysis });
  const client = new Client({ name: "native-ui-partial-routes", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return (async () => {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: "trace_native_ui_action",
      arguments: {
        action: "0x1000",
        max_nodes: maxNodes,
        max_edges: maxEdges,
        max_depth: 1,
      },
    });
    return result;
  })();
}

const traceFrom = (result: { structuredContent?: unknown }) =>
  z
    .object({
      normalized_result: nativeInvestigationTraceSchema,
    })
    .parse(result.structuredContent).normalized_result;

it("keeps typed callsite evidence and distinct fallback-provider routes for mixed reference kinds", async () => {
  const response = await publicTrace({});
  expect(response.isError).not.toBe(true);
  const trace = traceFrom(response);
  expect(trace.target_sha256).toBe(sha256);
  expect(trace.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        from: "native:function:0x1000",
        to: "native:function:0x2000",
        relation: "direct_call",
        resolution: "observed",
        evidence: expect.arrayContaining([
          expect.objectContaining({
            provider: identity,
            location: expect.objectContaining({ address: "0x1004" }),
          }),
        ]),
      }),
      expect.objectContaining({
        from: "native:function:0x1000",
        to: "native:function:0x3000",
        relation: "provider_call",
        resolution: "inferred",
        evidence: expect.arrayContaining([
          expect.objectContaining({
            provider: fallback,
            location: expect.objectContaining({ address: "0x1000" }),
          }),
        ]),
      }),
    ]),
  );
});

it.each(["unavailable", "output"] as const)(
  "retains known observed routes when fallback enumeration has %s failure",
  async (failure) => {
    const response = await publicTrace({ fallbackFailure: failure });
    expect(response.isError).not.toBe(true);
    const trace = traceFrom(response);
    expect(trace.edges).toContainEqual(
      expect.objectContaining({
        from: "native:function:0x1000",
        to: "native:function:0x2000",
        relation: "direct_call",
        resolution: "observed",
        evidence: expect.arrayContaining([
          expect.objectContaining({
            provider: identity,
            location: expect.objectContaining({ address: "0x1004" }),
          }),
        ]),
      }),
    );
    expect(trace.unresolved).toContainEqual(
      expect.objectContaining({
        from: "native:function:0x1000",
        to: null,
        relation: "provider_call",
        resolution: "unresolved",
        reason:
          failure === "unavailable"
            ? "This analysis is unavailable for the current target. Choose another analysis or target."
            : expect.stringContaining("unreadable result"),
        limitations: expect.arrayContaining([
          "The provider could not complete callee enumeration.",
        ]),
      }),
    );
  },
);

it("deduplicates fallback overlap without erasing multiple typed callsites", async () => {
  const response = await publicTrace({
    references: mixedReferences([
      ref("0x1004", "0x2000"),
      ref("0x100c", "0x2000"),
    ]),
    callees: ["0x2000", "0x3000"],
  });
  expect(response.isError).not.toBe(true);
  const trace = traceFrom(response);
  const typedEdges = trace.edges.filter(
    (edge) => edge.to === "native:function:0x2000",
  );
  expect(typedEdges).toHaveLength(2);
  expect(
    typedEdges
      .map((edge) => edge.evidence.flatMap((item) => item.location?.address))
      .flat(),
  ).toEqual(expect.arrayContaining(["0x1004", "0x100c"]));
  expect(
    trace.edges.filter(
      (edge) =>
        edge.to === "native:function:0x2000" &&
        edge.relation === "provider_call",
    ),
  ).toHaveLength(0);
});

it.each([
  {
    relation: "direct_call",
    references: completeReferences([
      ref("0x1004", "0x2000"),
      ref("0x1008", "0x3000"),
    ]),
    callees: [],
    firstRelation: "direct_call",
    firstTarget: "native:function:0x2000",
    firstResolution: "observed",
    firstProvider: identity,
    firstSite: "0x1004",
  },
  {
    relation: "indirect_call",
    references: completeReferences([
      ref("0x1004", "0x2000"),
      ref("0x1008", "0x3000", true),
    ]),
    callees: [],
    firstRelation: "direct_call",
    firstTarget: "native:function:0x2000",
    firstResolution: "observed",
    firstProvider: identity,
    firstSite: "0x1004",
  },
  {
    relation: "provider_call",
    references: noClassifiedReferences,
    callees: ["0x2000", "0x3000"],
    firstRelation: "provider_call",
    firstTarget: "native:function:0x2000",
    firstResolution: "inferred",
    firstProvider: fallback,
    firstSite: "0x1000",
  },
] as const)(
  "preserves $relation when node bounds omit a route",
  async ({
    relation,
    callees,
    references,
    firstRelation,
    firstTarget,
    firstResolution,
    firstProvider,
    firstSite,
  }) => {
    const response = await publicTrace({ references, callees }, 2);
    expect(response.isError).not.toBe(true);
    const trace = traceFrom(response);
    expect(trace.unresolved).toContainEqual(
      expect.objectContaining({
        from: "native:function:0x1000",
        to: null,
        relation,
        resolution: "unresolved",
        reason: "native_trace_node_bound_reached",
      }),
    );
    expect(trace.edges).toContainEqual(
      expect.objectContaining({
        from: "native:function:0x1000",
        to: firstTarget,
        relation: firstRelation,
        resolution: firstResolution,
        evidence: expect.arrayContaining([
          expect.objectContaining({
            provider: firstProvider,
            location: expect.objectContaining({ address: firstSite }),
          }),
        ]),
      }),
    );
    expect(trace.truncated).toBe(true);
    expect(trace.coverage).toContainEqual(
      expect.objectContaining({
        facet: "static_native_calls",
        status: "partial",
      }),
    );
    expect(trace.limitations).toContain(
      "Static analysis does not prove that an authored UI action is reachable or executed at runtime.",
    );
  },
);

it("retains separate omitted callsites when routes share a target", async () => {
  const response = await publicTrace(
    {
      references: completeReferences([
        ref("0x1004", "0x2000"),
        ref("0x1008", "0x3000", true),
        ref("0x100c", "0x3000"),
      ]),
      callees: [],
    },
    2,
  );
  expect(response.isError).not.toBe(true);
  const trace = traceFrom(response);
  expect(trace.unresolved).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        from: "native:function:0x1000",
        to: null,
        relation: "indirect_call",
        resolution: "unresolved",
        evidence: expect.arrayContaining([
          expect.objectContaining({
            provider: identity,
            location: expect.objectContaining({ address: "0x1008" }),
          }),
        ]),
      }),
      expect.objectContaining({
        from: "native:function:0x1000",
        to: null,
        relation: "direct_call",
        resolution: "unresolved",
        evidence: expect.arrayContaining([
          expect.objectContaining({
            provider: identity,
            location: expect.objectContaining({ address: "0x100c" }),
          }),
        ]),
      }),
    ]),
  );
  expect(trace.truncated).toBe(true);
});

it("keeps cancellation terminal when fallback enumeration is cancelled", async () => {
  const response = await publicTrace({
    references: completeReferences([
      ref("0x1004", "0x2000", false, partialCall("direct", 2)),
    ]),
    fallbackFailure: "cancelled",
  });
  expect(response.isError).toBe(true);
  expect(parseMcpToolError(response).error.code).toBe("cancelled");
});

it.each([
  { classification: "direct", provider_type: 2 },
  { classification: "objective_c", provider_type: 3 },
  { classification: "none", provider_type: 0 },
  { classification: "unknown", provider_type: 1 },
  { classification: "unknown", provider_type: 99 },
] as const)(
  "retains raw $classification CallReference facts without inventing generic flags",
  async ({ classification, provider_type }) => {
    const call = partialCall(classification, provider_type);
    const response = await publicTrace({
      references: completeReferences([
        ref("0x1004", "0x2000", false, call, "0x2fff"),
      ]),
      callees: [],
    });
    expect(response.isError).not.toBe(true);
    const trace = traceFrom(response);
    expect(trace.edges).toContainEqual(
      expect.objectContaining({
        from: "native:function:0x1000",
        to: "native:function:0x2fff",
        relation: "provider_call",
        resolution: "observed",
        evidence: expect.arrayContaining([
          expect.objectContaining({
            provider: identity,
            location: expect.objectContaining({ address: "0x1004" }),
            call_reference: {
              ...call,
              source_address: "0x1004",
              target_address: "0x2000",
            },
          }),
        ]),
      }),
    );
    expect(trace.edges.some((edge) => edge.relation === "objc_dispatch")).toBe(
      false,
    );
  },
);

it("deduplicates fallback overlap while preserving CallReference site and provider", async () => {
  const call = partialCall("direct", 2);
  const response = await publicTrace({
    references: completeReferences([ref("0x1004", "0x2000", false, call)]),
    callees: ["0x2000", "0x3000"],
  });
  expect(response.isError).not.toBe(true);
  const trace = traceFrom(response);
  const targetEdges = trace.edges.filter(
    (edge) => edge.to === "native:function:0x2000",
  );
  expect(targetEdges).toHaveLength(1);
  expect(targetEdges[0]).toMatchObject({
    relation: "provider_call",
    resolution: "observed",
    evidence: [
      expect.objectContaining({
        provider: identity,
        location: expect.objectContaining({ address: "0x1004" }),
        call_reference: expect.objectContaining({
          classification: "direct",
          provider_type: 2,
          provenance: "hopper-public-python-api:CallReference",
          source_address: "0x1004",
          target_address: "0x2000",
        }),
      }),
    ],
  });
});

it.each(["unavailable", "output"] as const)(
  "preserves partial CallReference evidence when fallback has %s failure",
  async (fallbackFailure) => {
    const call = partialCall("direct", 2);
    const response = await publicTrace({
      references: completeReferences([
        ref("0x1004", "0x2000", false, call, "0x2fff"),
      ]),
      fallbackFailure,
    });
    expect(response.isError).not.toBe(true);
    const trace = traceFrom(response);
    expect(trace.edges).toContainEqual(
      expect.objectContaining({
        to: "native:function:0x2fff",
        relation: "provider_call",
        resolution: "observed",
        evidence: expect.arrayContaining([
          expect.objectContaining({
            provider: identity,
            location: expect.objectContaining({ address: "0x1004" }),
            call_reference: expect.objectContaining({
              ...call,
              source_address: "0x1004",
              target_address: "0x2000",
            }),
          }),
        ]),
      }),
    );
    expect(trace.unresolved).toContainEqual(
      expect.objectContaining({
        to: null,
        relation: "provider_call",
        resolution: "unresolved",
        limitations: expect.arrayContaining([
          "The provider could not complete callee enumeration.",
        ]),
      }),
    );
  },
);

it("keeps partial CallReference evidence on a node-bound unresolved edge", async () => {
  const response = await publicTrace(
    {
      references: completeReferences([
        ref("0x1004", "0x2000", false, partialCall("direct", 2)),
        ref("0x1008", "0x3000", false, partialCall("unknown", 99)),
      ]),
      callees: [],
    },
    2,
  );
  expect(response.isError).not.toBe(true);
  const trace = traceFrom(response);
  expect(trace.unresolved).toContainEqual(
    expect.objectContaining({
      relation: "provider_call",
      resolution: "unresolved",
      evidence: expect.arrayContaining([
        expect.objectContaining({
          provider: identity,
          location: expect.objectContaining({ address: "0x1008" }),
          call_reference: expect.objectContaining({
            classification: "unknown",
            provider_type: 99,
            source_address: "0x1008",
            target_address: "0x3000",
          }),
        }),
      ]),
    }),
  );
});

it("reports malformed partial CallReference as unreadable route evidence", async () => {
  const response = await publicTrace({
    references: {
      reference_kinds_available: false,
      references: [
        {
          ...ref("0x1004", "0x2000"),
          kind: { available: false, reason: "Detailed flags unavailable" },
          call: {
            classification: "objectivec",
            provider_type: 3,
            provenance: "hopper-public-python-api:CallReference",
          },
        },
      ],
      unresolved_calls: [],
    },
    fallbackFailure: "unavailable",
  });
  expect(response.isError).not.toBe(true);
  const trace = traceFrom(response);
  expect(trace.edges).toEqual([]);
  expect(trace.unresolved).toContainEqual(
    expect.objectContaining({
      relation: "provider_call",
      resolution: "unresolved",
      reason: expect.stringContaining("unreadable result"),
    }),
  );
});

it.each([2, 12])(
  "retains original endpoints on a shared edge at the edge bound (maxNodes=%s)",
  async (maxNodes) => {
    const response = await publicTrace(
      {
        references: completeReferences(
          [
            ref("0x1004", "0x2004", false, partialCall("direct", 2), "0x2000"),
            ref(
              "0x1004",
              "0x2008",
              false,
              partialCall("unknown", 99),
              "0x2000",
            ),
            ref("0x1008", "0x3000", false, partialCall("direct", 2)),
          ].reverse(),
        ),
        callees: [],
      },
      maxNodes,
      2,
    );
    expect(response.isError).not.toBe(true);
    const trace = traceFrom(response);
    const evidence = [...trace.edges, ...trace.unresolved].flatMap(
      (edge) => edge.evidence,
    );
    expect(evidence.map((item) => item.call_reference)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target_address: "0x2004", provider_type: 2 }),
        expect.objectContaining({
          target_address: "0x2008",
          provider_type: 99,
        }),
      ]),
    );
  },
);

it.each([
  { maxNodes: 2, reverse: false },
  { maxNodes: 2, reverse: true },
  { maxNodes: 12, reverse: false },
  { maxNodes: 12, reverse: true },
])(
  "preserves typed and partial relations sharing a site and target ($maxNodes/$reverse)",
  async ({ maxNodes, reverse }) => {
    const references = [
      ref("0x1004", "0x2000"),
      ref("0x1004", "0x2008", false, partialCall("unknown", 99), "0x2000"),
    ];
    const response = await publicTrace(
      {
        references: completeReferences([
          ref("0x1008", "0x3000"),
          ...(reverse ? references.reverse() : references),
        ]),
        callees: [],
      },
      maxNodes,
    );
    expect(response.isError).not.toBe(true);
    const trace = traceFrom(response);
    const routes = [...trace.edges, ...trace.unresolved].filter((edge) =>
      edge.evidence.some((item) => item.location.address === "0x1004"),
    );
    expect(routes.map((edge) => edge.relation).sort()).toEqual([
      "direct_call",
      "provider_call",
    ]);
  },
);

it.each([false, true])(
  "keeps unsupported reference fallback conditional on completed cleanup through MCP (incomplete=%s)",
  async (incomplete) => {
    const calls: string[] = [];
    const failure = new AnalysisCapabilityUnavailableError(
      identity.id,
      "procedure_references",
      "Typed references unavailable",
      incomplete
        ? { cleanup: { reason: "release failed", resources: ["route-owner"] } }
        : undefined,
    );
    const response = await publicTrace({ referencesFailure: failure, calls });
    if (incomplete) {
      expect(calls).not.toContain("procedure_callees");
      expect(parseMcpToolError(response).error).toMatchObject({
        code: "cleanup_incomplete",
        details: { resources: ["route-owner"] },
      });
      expect(failure.cleanupResources).toEqual(["route-owner"]);
    } else {
      expect(response.isError).not.toBe(true);
      expect(calls).toContain("procedure_callees");
      expect(traceFrom(response).edges).toContainEqual(
        expect.objectContaining({
          to: "native:function:0x3000",
          relation: "provider_call",
        }),
      );
    }
  },
);

it.each([false, true])(
  "retains initial UI cleanup failure with failed metadata peer=%s",
  async (failedPeer) => {
    const cleanupFailure = (operation: string, resource: string) =>
      new AnalysisCapabilityUnavailableError(
        identity.id,
        operation,
        "unavailable after cleanup failed",
        { cleanup: { reason: "release failed", resources: [resource] } },
      );
    const calls: string[] = [];
    const response = await publicTrace({
      calls,
      uiFailure: cleanupFailure("decode_interface_builder", "ui-owner"),
      ...(failedPeer
        ? {
            metadataFailure: cleanupFailure(
              "inspect_native_dispatch_metadata",
              "metadata-owner",
            ),
          }
        : {}),
    });
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: expect.arrayContaining(
          failedPeer ? ["ui-owner", "metadata-owner"] : ["ui-owner"],
        ),
      },
    });
    expect(calls).not.toContain("procedure_address");
    expect(calls).not.toContain("list_names");
  },
);
