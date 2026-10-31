import { describe, expect, it } from "vitest";
import {
  createAnalysisExecution,
  type AnalysisOperation,
  type AnalysisOperationPort,
} from "./AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisProtocolError,
} from "../domain/analysisErrorCore.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok } from "../domain/result.js";
import { EnhancedTools } from "./EnhancedTools.js";

const provider = { id: "fixture", name: "Fixture", version: "1" };

interface RecordedCall {
  readonly operation: AnalysisOperation;
  readonly procedure: unknown;
  readonly origin: unknown;
}

/** Port that knows `main` (0x1000, calling 0x2000) and rejects `nosuch`. */
const recordingPort = () => {
  const calls: RecordedCall[] = [];
  const sentParameters: Readonly<Record<string, JsonValue>>[] = [];
  const port: AnalysisOperationPort = {
    execute: async (operation, parameters, options) => {
      sentParameters.push(parameters);
      calls.push({
        operation,
        procedure: parameters.procedure,
        origin: options?.selectorOrigin,
      });
      const known = (value: JsonValue) =>
        ok(createAnalysisExecution(value, provider));
      if (parameters.procedure === "nosuch")
        return err(new AnalysisInputError(operation));
      switch (operation) {
        case "procedure_address":
          return known(parameters.procedure === "main" ? "0x1000" : "0x2000");
        case "procedure_callees":
          return known(parameters.procedure === "0x1000" ? ["0x2000"] : []);
        case "procedure_pseudo_code":
          return known("int main(void) { return 0; }");
        case "address_name":
          return known("main");
        default:
          throw new Error(`Unexpected operation: ${operation}`);
      }
    },
  };
  return { calls, sentParameters, tools: new EnhancedTools(port) };
};

const of = (
  calls: readonly RecordedCall[],
  operation: AnalysisOperation,
): RecordedCall[] => calls.filter((call) => call.operation === operation);

describe("selector origin of composed workflows", () => {
  it("marks every call-graph expansion as provider-derived and the root selector as caller-supplied", async () => {
    const { calls, tools } = recordingPort();

    const result = await tools.execute("get_call_graph", { address: "main" });

    expect(result.ok, "the graph is built").toBe(true);
    expect(
      of(calls, "procedure_address"),
      "the caller's selector carries no provider origin",
    ).toEqual([
      { operation: "procedure_address", procedure: "main", origin: undefined },
    ]);
    expect(
      of(calls, "procedure_callees"),
      "the canonical start and every discovered callee are provider-derived",
    ).toEqual([
      {
        operation: "procedure_callees",
        procedure: "0x1000",
        origin: "provider",
      },
      {
        operation: "procedure_callees",
        procedure: "0x2000",
        origin: "provider",
      },
    ]);
  });

  it("marks trace expansions as provider-derived and the start and goal as caller-supplied", async () => {
    const { calls, tools } = recordingPort();

    const result = await tools.execute("trace_call_path", {
      start: "main",
      goal: "0x2000",
    });

    expect(result.ok, "the trace completes").toBe(true);
    expect(
      of(calls, "procedure_address").map(({ origin }) => origin),
      "start and goal resolutions are caller-supplied",
    ).toEqual([undefined, undefined]);
    expect(
      of(calls, "procedure_callees").map(({ origin }) => origin),
      "expansion of the resolved start is provider-derived",
    ).toEqual(["provider"]);
  });

  it("marks the canonical retry of batch_decompile as derived and keeps the unresolved fallback caller-supplied", async () => {
    const { calls, tools } = recordingPort();

    const result = await tools.execute("batch_decompile", {
      addresses: ["main", "nosuch"],
    });

    expect(result.ok, "per-item failures do not fail the batch").toBe(true);
    expect(
      of(calls, "procedure_pseudo_code")
        .map(({ procedure, origin }) => [procedure, origin])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
      "the resolved canonical address is derived; the failed item keeps the caller's text",
    ).toEqual([
      ["0x1000", "provider"],
      ["nosuch", undefined],
    ]);
  });

  it("never copies the origin into the parameters sent to the provider", async () => {
    const { sentParameters, tools } = recordingPort();

    await tools.execute("get_call_graph", { address: "main" });
    await tools.execute("trace_call_path", { start: "main" });
    await tools.execute("batch_decompile", { addresses: ["main"] });

    expect(
      sentParameters.length,
      "workflows issued provider calls",
    ).toBeGreaterThan(0);
    expect(
      sentParameters.some((parameters) => "selectorOrigin" in parameters),
      "the origin travels in the options only, never in Evidence-bound parameters",
    ).toBe(false);
  });
});

describe("trace path completion and cancellation", () => {
  it("keeps an unreachable goal unknown when provider coverage is unresolved", async () => {
    const tools = new EnhancedTools({
      execute: async (operation, parameters) => {
        if (operation === "procedure_address")
          return ok(createAnalysisExecution(parameters.procedure, provider));
        if (operation === "procedure_callees")
          return ok(
            createAnalysisExecution([], provider, {
              relationshipCoverage: {
                status: "unknown",
                reason: "the provider cannot confirm graph coverage",
              },
            }),
          );
        throw new Error(`Unexpected operation: ${operation}`);
      },
    });

    const result = await tools.execute("trace_call_path", {
      start: "0x1000",
      goal: "0x2000",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { goal_status: "unknown", truncated: true },
    });
  });

  it.each([
    { abortSignal: false, errorKind: "cancelled" },
    { abortSignal: true, errorKind: "cancelled" },
    { abortSignal: true, errorKind: "protocol" },
  ])(
    "preserves provider $errorKind failure and cleanup with request abort: $abortSignal",
    async ({ abortSignal, errorKind }) => {
      const cleanup = {
        reason: "provider cleanup is still pending",
        resources: ["provider session"],
      };
      const providerFailure =
        errorKind === "cancelled"
          ? new AnalysisCancelledError("procedure_callees", { cleanup })
          : new AnalysisProtocolError("provider relationship read failed", {
              cleanup,
            });
      const controller = new AbortController();
      const tools = new EnhancedTools({
        execute: async (operation, parameters) => {
          if (operation === "procedure_address")
            return ok(createAnalysisExecution(parameters.procedure, provider));
          if (operation === "procedure_callees") {
            if (abortSignal) controller.abort();
            return err(providerFailure);
          }
          throw new Error(`Unexpected operation: ${operation}`);
        },
      });

      const result = await tools.execute(
        "trace_call_path",
        { start: "0x1000", goal: "0x2000" },
        abortSignal ? controller.signal : undefined,
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag:
            errorKind === "cancelled"
              ? "AnalysisCancelledError"
              : "AnalysisProtocolError",
          cleanup,
        },
      });
      if (result.ok) throw new Error("expected provider failure");
      expect(result.error).toBe(providerFailure);
    },
  );

  it("stops after cancellation races with a successful relationship response", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const tools = new EnhancedTools({
      execute: async (operation, parameters) => {
        calls.push(operation);
        if (operation === "procedure_address")
          return ok(createAnalysisExecution(parameters.procedure, provider));
        if (operation === "procedure_callees") {
          controller.abort();
          return ok(createAnalysisExecution(["0x2000"], provider));
        }
        throw new Error(`Unexpected operation: ${operation}`);
      },
    });

    const result = await tools.execute(
      "trace_call_path",
      { start: "0x1000", goal: "0x3000" },
      controller.signal,
    );

    expect(calls).toEqual([
      "procedure_address",
      "procedure_address",
      "procedure_callees",
    ]);
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
  });
});

it.each([null, "", "0x1000"] as const)(
  "validates the observed call-graph root and retains its limitations (%s)",
  async (address) => {
    const calls: string[] = [];
    const tools = new EnhancedTools({
      execute: async (operation) => {
        calls.push(operation);
        return ok(
          createAnalysisExecution(
            operation === "procedure_address" ? address : [],
            provider,
            {
              limitations:
                operation === "procedure_address"
                  ? ["Root identity caveat"]
                  : [],
            },
          ),
        );
      },
    });
    const result = await tools.execute("get_call_graph", { address: "main" });
    if (address === "0x1000") {
      expect(result).toMatchObject({
        ok: true,
        value: {
          limitations: expect.arrayContaining(["Root identity caveat"]),
        },
      });
      expect(calls).toEqual(["procedure_address", "procedure_callees"]);
    } else {
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisOutputError", operation: "procedure_address" },
      });
      expect(calls).toEqual(["procedure_address"]);
    }
  },
);
