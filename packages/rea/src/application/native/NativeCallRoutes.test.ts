import { AnalysisCleanupLease } from "../../artifacts/AnalysisCleanupLease.js";
import { describe, expect, it } from "vitest";
import { readNativeCallRoutes } from "./NativeCallRoutes.js";
import {
  createAnalysisExecution,
  type AnalysisOperation,
} from "../AnalysisProvider.js";
import { ghidraReferenceEdge } from "../../domain/ghidraValues.fixture.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { err, ok } from "../../domain/result.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
} from "../../domain/analysisErrorCore.js";

const provider = { id: "fixture", name: "Fixture", version: "1" };
const callReference = (source: string, target: string) => ({
  source_address: source,
  target_address: target,
  target_procedure: { address: target },
  kind: {
    available: true as const,
    provenance: "fixture-reference",
    type: "UNCONDITIONAL_CALL",
    flow: true,
    call: true,
    jump: false,
    data: false,
    read: false,
    write: false,
    indirect: false,
    computed: false,
    external: false,
    conditional: false,
    terminal: false,
    primary: true,
    operand_index: 0,
  },
});

const unavailableCallKind = {
  available: false as const,
  reason: "Reference kind is unavailable.",
};
describe("untyped native call route fallback", () => {
  it.each([{ callees: [] }, { callees: ["0x2000"] }])(
    "preserves targetless calls and their provider when fallback callees are $callees",
    async ({ callees }) => {
      const calls: string[] = [];
      const referenceProvider = { ...provider, id: "hopper", name: "Hopper" };
      const fallbackProvider = { ...provider, id: "fallback" };
      const signal = new AbortController().signal;
      const unknown = { address: "0x1008", reason: "No static target" };
      const result = await readNativeCallRoutes(
        {
          execute: async (operation, parameters, options) => {
            calls.push(operation);
            expect(parameters.procedure).toBe("0x1000");
            expect(options).toEqual({ signal, selectorOrigin: "provider" });
            return ok(
              createAnalysisExecution(
                operation === "procedure_references"
                  ? {
                      reference_kinds_available: false,
                      references: [],
                      unresolved_calls: [unknown],
                    }
                  : callees,
                operation === "procedure_references"
                  ? referenceProvider
                  : fallbackProvider,
                {
                  limitations:
                    operation === "procedure_references"
                      ? ["Reference-kind metadata is incomplete."]
                      : ["Callee enumeration is limited to named functions."],
                },
              ),
            );
          },
        },
        "0x1000",
        signal,
        "provider",
      );
      expect(calls).toEqual(["procedure_references", "procedure_callees"]);
      expect(result).toEqual({
        routes: callees.map((address) => ({
          provider: fallbackProvider,
          address,
          site: "0x1000",
          relation: "provider_call",
          resolution: "inferred",
        })),
        unknowns: [{ ...unknown, provider: referenceProvider }],
        limitations: [
          {
            provider: referenceProvider,
            operation: "procedure_references",
            limitation: "Reference-kind metadata is incomplete.",
          },
          {
            provider: fallbackProvider,
            operation: "procedure_callees",
            limitation: "Callee enumeration is limited to named functions.",
          },
        ],
        outcome: { ok: true, value: undefined },
      });
    },
  );
});

describe("partially typed native call routes", () => {
  it.each([false, true])(
    "keeps known typed calls when an individual kind is unavailable (aggregate=$0)",
    async (referenceKindsAvailable) => {
      const typedProvider = { ...provider, id: "typed" };
      const fallbackProvider = { ...provider, id: "fallback" };
      const result = await readNativeCallRoutes(
        {
          execute: async (operation) =>
            operation === "procedure_references"
              ? ok(
                  createAnalysisExecution(
                    {
                      reference_kinds_available: referenceKindsAvailable,
                      references: [
                        callReference("0x1004", "0x2000"),
                        {
                          ...callReference("0x1008", "0x3000"),
                          kind: unavailableCallKind,
                        },
                      ],
                      unresolved_calls: [],
                    },
                    typedProvider,
                    { limitations: ["Some reference kinds are unavailable."] },
                  ),
                )
              : ok(
                  createAnalysisExecution(
                    ["0x2000", "0x3000", "0x4000"],
                    fallbackProvider,
                    { limitations: ["Callee enumeration is incomplete."] },
                  ),
                ),
        },
        "0x1000",
      );

      expect(result).toEqual({
        routes: [
          {
            provider: typedProvider,
            address: "0x2000",
            site: "0x1004",
            relation: "direct_call",
            resolution: "observed",
          },
          {
            provider: fallbackProvider,
            address: "0x3000",
            site: "0x1000",
            relation: "provider_call",
            resolution: "inferred",
          },
          {
            provider: fallbackProvider,
            address: "0x4000",
            site: "0x1000",
            relation: "provider_call",
            resolution: "inferred",
          },
        ],
        unknowns: [],
        limitations: [
          {
            provider: typedProvider,
            operation: "procedure_references",
            limitation: "Some reference kinds are unavailable.",
          },
          {
            provider: fallbackProvider,
            operation: "procedure_callees",
            limitation: "Callee enumeration is incomplete.",
          },
        ],
        outcome: { ok: true, value: undefined },
      });
    },
  );

  it("preserves distinct typed sites when fallback overlaps their target", async () => {
    const typedProvider = { ...provider, id: "typed" };
    const fallbackProvider = { ...provider, id: "fallback" };
    const result = await readNativeCallRoutes(
      {
        execute: async (operation) =>
          operation === "procedure_references"
            ? ok(
                createAnalysisExecution(
                  {
                    reference_kinds_available: false,
                    references: [
                      callReference("0x1004", "0x2000"),
                      callReference("0x1008", "0x2000"),
                      {
                        ...callReference("0x100c", "0x4000"),
                        kind: unavailableCallKind,
                      },
                    ],
                    unresolved_calls: [],
                  },
                  typedProvider,
                ),
              )
            : ok(
                createAnalysisExecution(["0x2000", "0x3000"], fallbackProvider),
              ),
      },
      "0x1000",
    );

    expect(result).toEqual({
      routes: [
        {
          provider: typedProvider,
          address: "0x2000",
          site: "0x1004",
          relation: "direct_call",
          resolution: "observed",
        },
        {
          provider: typedProvider,
          address: "0x2000",
          site: "0x1008",
          relation: "direct_call",
          resolution: "observed",
        },
        {
          provider: fallbackProvider,
          address: "0x3000",
          site: "0x1000",
          relation: "provider_call",
          resolution: "inferred",
        },
      ],
      unknowns: [],
      limitations: [],
      outcome: { ok: true, value: undefined },
    });
  });
});

describe("native call fallback output failures", () => {
  it("retains source limitations when fallback output is invalid", async () => {
    const typedProvider = { ...provider, id: "typed" };
    const fallbackProvider = { ...provider, id: "fallback" };
    const result = await readNativeCallRoutes(
      {
        execute: async (operation) =>
          operation === "procedure_references"
            ? err(
                new AnalysisCapabilityUnavailableError(
                  typedProvider.id,
                  "procedure_references",
                  "Typed references are unavailable.",
                ),
              )
            : ok(
                createAnalysisExecution(
                  { callees: "not-an-address-list" },
                  fallbackProvider,
                  { limitations: ["Fallback output is truncated."] },
                ),
              ),
      },
      "0x1000",
    );

    expect(result).toMatchObject({
      routes: [],
      unknowns: [],
      limitations: [
        {
          provider: fallbackProvider,
          operation: "procedure_callees",
          limitation: "Fallback output is truncated.",
        },
      ],
      outcome: {
        ok: false,
        error: { _tag: "AnalysisOutputError" },
      },
    });
  });

  it("retains known typed routes when fallback output is invalid", async () => {
    const typedProvider = { ...provider, id: "typed" };
    const fallbackProvider = { ...provider, id: "fallback" };
    const result = await readNativeCallRoutes(
      {
        execute: async (operation) =>
          operation === "procedure_references"
            ? ok(
                createAnalysisExecution(
                  {
                    reference_kinds_available: false,
                    references: [
                      callReference("0x1004", "0x2000"),
                      {
                        ...callReference("0x1008", "0x3000"),
                        kind: unavailableCallKind,
                      },
                    ],
                    unresolved_calls: [],
                  },
                  typedProvider,
                  { limitations: ["One call kind remains unavailable."] },
                ),
              )
            : ok(
                createAnalysisExecution(
                  { callees: "not-an-address-list" },
                  fallbackProvider,
                  { limitations: ["Fallback output is truncated."] },
                ),
              ),
      },
      "0x1000",
    );

    expect(result).toMatchObject({
      routes: [
        {
          provider: typedProvider,
          address: "0x2000",
          site: "0x1004",
          relation: "direct_call",
          resolution: "observed",
        },
      ],
      unknowns: [],
      limitations: [
        {
          provider: typedProvider,
          operation: "procedure_references",
          limitation: "One call kind remains unavailable.",
        },
        {
          provider: fallbackProvider,
          operation: "procedure_callees",
          limitation: "Fallback output is truncated.",
        },
      ],
      outcome: {
        ok: false,
        error: { _tag: "AnalysisOutputError" },
      },
    });
  });
});

describe("native call fallback cancellation", () => {
  it("keeps known typed routes when fallback is cancelled", async () => {
    let calls = 0;
    const referenceProvider = { ...provider, id: "references" };
    const result = await readNativeCallRoutes(
      {
        execute: async (operation) => {
          calls += 1;
          return operation === "procedure_references"
            ? ok(
                createAnalysisExecution(
                  {
                    reference_kinds_available: false,
                    references: [
                      callReference("0x1004", "0x2000"),
                      {
                        ...callReference("0x1008", "0x3000"),
                        kind: unavailableCallKind,
                      },
                    ],
                    unresolved_calls: [],
                  },
                  referenceProvider,
                  { limitations: ["One call kind remains unavailable."] },
                ),
              )
            : err(new AnalysisCancelledError("procedure_callees"));
        },
      },
      "0x1000",
    );

    expect(result).toMatchObject({
      routes: [
        {
          provider: referenceProvider,
          address: "0x2000",
          site: "0x1004",
          relation: "direct_call",
          resolution: "observed",
        },
      ],
      unknowns: [],
      limitations: [
        {
          provider: referenceProvider,
          operation: "procedure_references",
          limitation: "One call kind remains unavailable.",
        },
      ],
      outcome: {
        ok: false,
        error: { _tag: "AnalysisCancelledError" },
      },
    });
    expect(calls).toBe(2);
  });
});

describe("complete typed native call routes", () => {
  it("preserves computed targets, ambiguity and targetless call sites", async () => {
    const reference = jsonValueSchema.parse(ghidraReferenceEdge());
    if (
      reference === null ||
      typeof reference !== "object" ||
      Array.isArray(reference)
    )
      throw new TypeError("Invalid reference fixture");
    const calls: string[] = [];
    const result = await readNativeCallRoutes(
      {
        execute: async (operation) => {
          calls.push(operation);
          return ok(
            createAnalysisExecution(
              {
                reference_kinds_available: false,
                references: ["0x2000", "0x3000"].map((address) => ({
                  ...reference,
                  source_address: "0x1004",
                  target_address: address,
                  target_procedure: { address },
                  kind: {
                    available: true,
                    provenance: "fixture-reference",
                    type: "COMPUTED_CALL",
                    flow: true,
                    call: true,
                    jump: false,
                    data: false,
                    read: false,
                    write: false,
                    indirect: true,
                    computed: true,
                    external: false,
                    conditional: false,
                    terminal: false,
                    primary: true,
                    operand_index: 0,
                  },
                })),
                unresolved_calls: [
                  { address: "0x1008", reason: "No static target" },
                ],
              },
              provider,
              { limitations: ["SEH handler targets may be outside the body."] },
            ),
          );
        },
      },
      "0x1000",
    );
    expect(result).toMatchObject({
      routes: [
        {
          provider,
          address: "0x2000",
          relation: "indirect_call",
          resolution: "ambiguous",
        },
        {
          provider,
          address: "0x3000",
          relation: "indirect_call",
          resolution: "ambiguous",
        },
      ],
      unknowns: [{ address: "0x1008", provider }],
      limitations: [
        {
          provider,
          operation: "procedure_references",
          limitation: "SEH handler targets may be outside the body.",
        },
      ],
      outcome: { ok: true, value: undefined },
    });
    expect(calls).toEqual(["procedure_references"]);
  });
});

describe("malformed typed native call output", () => {
  it("does not fall back on cancellation or invalid typed output", async () => {
    let calls = 0;
    const cancelled = await readNativeCallRoutes(
      {
        execute: async () => {
          calls++;
          return err(new AnalysisCancelledError("procedure_references"));
        },
      },
      "0x1000",
    );
    expect(cancelled).toMatchObject({
      routes: [],
      unknowns: [],
      limitations: [],
      outcome: { ok: false, error: { _tag: "AnalysisCancelledError" } },
    });
    expect(calls).toBe(1);
    const malformed = await readNativeCallRoutes(
      {
        execute: async () =>
          ok(
            createAnalysisExecution({}, provider, {
              limitations: ["Malformed output still has source caveats."],
            }),
          ),
      },
      "0x1000",
    );
    expect(malformed).toMatchObject({
      routes: [],
      unknowns: [],
      limitations: [
        {
          provider,
          operation: "procedure_references",
          limitation: "Malformed output still has source caveats.",
        },
      ],
      outcome: { ok: false, error: { _tag: "AnalysisOutputError" } },
    });
  });
});

describe("missing unresolved-call observations", () => {
  it("rejects omitted unresolved-call observations instead of claiming none", async () => {
    let calls = 0;
    const result = await readNativeCallRoutes(
      {
        execute: async () => {
          calls++;
          return ok(
            createAnalysisExecution(
              {
                reference_kinds_available: false,
                references: [],
              },
              provider,
            ),
          );
        },
      },
      "0x1000",
    );

    expect(result).toMatchObject({
      routes: [],
      unknowns: [],
      limitations: [],
      outcome: { ok: false, error: { _tag: "AnalysisOutputError" } },
    });
    expect(calls).toBe(1);
  });
});

it.each([false, true])(
  "preserves capability cleanup ownership (incomplete=%s)",
  async (incomplete) => {
    const failure = new AnalysisCapabilityUnavailableError(
      provider.id,
      "procedure_references",
      "Typed references unavailable",
      incomplete
        ? { cleanup: { reason: "release failed", resources: ["route-owner"] } }
        : undefined,
    );
    const owner = {
      cleanupResources: incomplete ? ["route-owner"] : ([] as string[]),
    };
    failure.bindCleanupResourceOwner(owner);
    const lease = new AnalysisCleanupLease(async () => {
      owner.cleanupResources = [];
    }, owner);
    lease.bindCleanupError(failure);
    const calls: string[] = [];
    const analysis = {
      execute: async (operation: AnalysisOperation) => {
        calls.push(operation);
        return operation === "procedure_references"
          ? err(failure)
          : ok(createAnalysisExecution(["0x2000"], provider));
      },
    };
    const result = await readNativeCallRoutes(analysis, "0x1000");
    expect(calls).toEqual(
      incomplete
        ? ["procedure_references"]
        : ["procedure_references", "procedure_callees"],
    );
    if (incomplete) {
      expect(result.outcome).toEqual(err(failure));
      if (result.outcome.ok) throw new Error("Expected retained cleanup error");
      expect(result.outcome.error).toBe(failure);
      expect(result.outcome.error.cleanupResources).toEqual(["route-owner"]);
      await lease.release();
      expect(result.outcome.error.cleanupResources).toEqual([]);
      const recovered = await readNativeCallRoutes(analysis, "0x1000");
      expect(recovered.outcome.ok).toBe(true);
      expect(calls).toEqual([
        "procedure_references",
        "procedure_references",
        "procedure_callees",
      ]);
    } else {
      expect(result.outcome.ok).toBe(true);
      expect(result.routes).toContainEqual(
        expect.objectContaining({
          address: "0x2000",
          relation: "provider_call",
        }),
      );
    }
  },
);
