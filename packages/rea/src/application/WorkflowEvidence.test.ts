import { describe, expect, it } from "vitest";

import {
  recordWorkflowUnknowns,
  createWorkflowEvidence,
  executeComposedWorkflow,
  workflowSnapshotRecord,
} from "./WorkflowEvidence.js";
import { InvestigationRecords } from "./investigation/InvestigationRecords.js";
import { UnknownRegistryError } from "../domain/unknownRegistryError.js";
import { err, ok } from "../domain/result.js";
import {
  createAnalysisExecution,
  type AnalysisOperationPort,
} from "./AnalysisProvider.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { nativeApiBoundarySchema } from "../domain/native/nativeApiBoundary.js";
import { projectNativeApiInspection } from "./native/NativeApiInspection.js";
import { functionDossierSchema } from "../domain/native/functionDossier.js";
import { ghidraFunctionDossier } from "../domain/ghidraValues.fixture.js";
import { ANALYSIS_SNAPSHOT_PROFILE } from "../domain/analysisSnapshot.fixture.js";
import { createEvidence } from "../domain/evidence.js";

it("links shared provider source Evidence once without copying its payload into the workflow", async () => {
  const source = createEvidence(
    undefined,
    { id: "fixture", name: "Fixture", version: "1" },
    {
      operation: "health",
      parameters: { facet: "saved-analysis-report" },
      result: { report: "historical content ".repeat(1_000) },
    },
    { immutable: true },
  );
  const result = await executeComposedWorkflow(
    {
      execute: async () =>
        ok(
          createAnalysisExecution(
            "observed",
            { id: "fixture", name: "Fixture", version: "1" },
            { sourceEvidence: [source] },
          ),
        ),
    },
    async (observed) => {
      await observed.execute("list_procedures", {});
      await observed.execute("procedure_pseudo_code", { procedure: "0x1000" });
      return ok({ count: 1 });
    },
  );
  expect(result).toEqual({
    ...ok({
      result: { count: 1 },
      limitations: [],
      evidenceLinks: [source.evidence_id],
    }),
    sourceEvidence: [source],
  });
  expect(result.ok && JSON.stringify(result.value)).not.toContain(
    "historical content",
  );
});

it.each([false, true])(
  "propagates transient=%s through composed snapshot decisions while retaining Evidence",
  async (transient) => {
    let calls = 0;
    const composed = await executeComposedWorkflow(
      {
        execute: async () =>
          ok(
            createAnalysisExecution(
              "observed",
              provider,
              transient && calls++ === 0
                ? { cachePolicy: "live" as const }
                : {},
            ),
          ),
      },
      async (observed) => {
        await observed.execute("analyze_function", { procedure: "0x1000" });
        const last = await observed.execute("procedure_info", {
          procedure: "0x1000",
        });
        return last.ok ? ok(last.value.result) : last;
      },
    );
    if (!composed.ok) throw composed.error;
    const evidence = createWorkflowEvidence({
      target: undefined,
      operation: "inspect_native_api",
      parameters: {},
      result: composed.value.result,
      upstreamProfile: ANALYSIS_SNAPSHOT_PROFILE,
      upstreamLimitations: composed.value.limitations,
    });
    expect(new InvestigationRecords().recordEvidence(evidence).ok).toBe(true);
    expect(
      workflowSnapshotRecord(
        evidence,
        "inspect_native_api",
        ANALYSIS_SNAPSHOT_PROFILE,
        composed.value.cachePolicy,
      ) === undefined,
    ).toBe(transient);
    expect(evidence.normalized_result).toBe("observed");
  },
);

const provider = { id: "fixture", name: "Fixture", version: "1" };

it("keeps Evidence identity stable when dependent branches finish in opposite orders", async () => {
  const run = async (order: readonly number[]) => {
    const gate = () => {
      let resolve: () => void = () => {
        throw new Error("gate not initialized");
      };
      const promise = new Promise<void>((release) => {
        resolve = release;
      });
      return { promise, resolve };
    };
    const parents = [gate(), gate()];
    const children = [gate(), gate()];
    const analysis: AnalysisOperationPort = {
      execute: async (operation, parameters) => {
        const index = Number(parameters.index);
        if (operation === "procedure_address") {
          await parents[index]!.promise;
          return ok(createAnalysisExecution(String(index), provider));
        }
        children[index]!.resolve();
        return ok(
          createAnalysisExecution(String(index), provider, {
            limitations: [
              index === 0 ? "first child caveat" : "second child caveat",
            ],
          }),
        );
      },
    };
    const composed = await executeComposedWorkflow(
      analysis,
      async (observed) => {
        const branches = Promise.all(
          [0, 1].map(async (index) => {
            await observed.execute("procedure_address", { index });
            const child = await observed.execute("address_name", { index });
            if (!child.ok) throw child.error;
            return child.value.result;
          }),
        );
        for (const index of order) {
          parents[index]!.resolve();
          await children[index]!.promise;
        }
        return ok(await branches);
      },
    );
    if (!composed.ok) throw composed.error;
    return createWorkflowEvidence({
      target: undefined,
      operation: "batch_decompile",
      parameters: {},
      result: composed.value.result,
      upstreamProfile: undefined,
      upstreamLimitations: composed.value.limitations,
    });
  };
  const left = await run([0, 1]);
  const right = await run([1, 0]);
  expect(left.normalized_result).toEqual(right.normalized_result);
  expect(left.limitations).toEqual(right.limitations);
  expect(left.evidence_id).toBe(right.evidence_id);
});

it("retains unique upstream limits in canonical order across concurrent observations", async () => {
  let release: () => void = () => {
    throw new Error("gate not initialized");
  };
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const options = { signal: new AbortController().signal };
  const analysis: AnalysisOperationPort = {
    execute: async (operation, parameters, forwarded) => {
      expect(parameters).toEqual({ marker: true });
      expect(forwarded).toMatchObject(options);
      expect(forwarded?.workScope).toBeDefined();
      const call = calls++;
      if (call === 0) await gate;
      else release();
      const limitation =
        operation === "list_strings"
          ? ["first", "shared"]
          : ["second", "shared"];
      return ok(
        createAnalysisExecution([], provider, { limitations: limitation }),
      );
    },
  };
  const result = await executeComposedWorkflow(analysis, async (observed) => {
    await Promise.all([
      observed.execute("list_strings", { marker: true }, options),
      observed.execute("list_procedures", { marker: true }, options),
    ]);
    return ok({ count: 0 });
  });
  expect(calls).toBe(2);
  expect(result).toEqual(
    ok({
      result: { count: 0 },
      limitations: [
        "Fixture (fixture 1) list_procedures, list_strings: shared",
        "Fixture (fixture 1) list_procedures: second",
        "Fixture (fixture 1) list_strings: first",
      ],
    }),
  );
});

it("deduplicates exact source caveats without merging providers or operations", async () => {
  const firstProvider = { id: "first", name: "First", version: "1" };
  const secondProvider = { id: "second", name: "Second", version: "1" };
  const result = await executeComposedWorkflow(
    {
      execute: async (operation, parameters) =>
        ok(
          createAnalysisExecution(
            null,
            parameters.provider === "second" ? secondProvider : firstProvider,
            { limitations: ["same source caveat"] },
          ),
        ),
    },
    async (observed) => {
      await observed.execute("list_strings", { provider: "first" });
      await observed.execute("list_strings", { provider: "first" });
      await observed.execute("list_strings", { provider: "second" });
      await observed.execute("list_procedures", { provider: "first" });
      return ok({ count: 0 });
    },
  );

  expect(result).toEqual(
    ok({
      result: { count: 0 },
      limitations: [
        "First (first 1) list_procedures, list_strings: same source caveat",
        "Second (second 1) list_strings: same source caveat",
      ],
    }),
  );
});

it("bounds per-item caveat retention while preserving inventory caveats", async () => {
  const result = await executeComposedWorkflow(
    {
      execute: async (operation, parameters) =>
        ok(
          createAnalysisExecution(null, provider, {
            limitations:
              operation === "list_procedures"
                ? ["inventory caveat"]
                : [
                    "shared caveat",
                    `caveat at ${String(parameters.procedure)}`,
                  ],
          }),
        ),
    },
    async (observed) => {
      await observed.execute("list_procedures", {});
      for (const procedure of ["0x1", "0x2", "0x3"])
        await observed.execute("procedure_pseudo_code", { procedure });
      return ok({ count: 3 });
    },
    {
      perItemOperations: new Set(["procedure_pseudo_code"]),
      maxDistinct: 2,
      retainedIn: "the files keep them",
    },
  );
  expect(result).toEqual(
    ok({
      result: { count: 3 },
      limitations: [
        "Fixture (fixture 1) list_procedures: inventory caveat",
        "Fixture (fixture 1) procedure_pseudo_code: caveat at 0x1",
        "Fixture (fixture 1) procedure_pseudo_code: shared caveat",
        "2 per-item provider limitation observations were omitted from this answer; the files keep them.",
      ],
    }),
  );
});

it("spends one budget slot on a caveat that two per-item operations share", async () => {
  const result = await executeComposedWorkflow(
    {
      execute: async (operation, parameters) =>
        ok(
          createAnalysisExecution(null, provider, {
            limitations: [
              "shared caveat",
              `${operation} at ${String(parameters.procedure)}`,
            ],
          }),
        ),
    },
    async (observed) => {
      await observed.execute("procedure_info", { procedure: "0x1" });
      await observed.execute("procedure_pseudo_code", { procedure: "0x1" });
      return ok(null);
    },
    {
      perItemOperations: new Set(["procedure_info", "procedure_pseudo_code"]),
      maxDistinct: 2,
      retainedIn: "the files keep them",
    },
  );
  expect(result).toEqual(
    ok({
      result: null,
      limitations: [
        "Fixture (fixture 1) procedure_info, procedure_pseudo_code: shared caveat",
        "Fixture (fixture 1) procedure_info: procedure_info at 0x1",
        "1 per-item provider limitation observation was omitted from this answer; the files keep them.",
      ],
    }),
  );
});

it("counts repeated omitted observations without retaining their text for ranking", async () => {
  const result = await executeComposedWorkflow(
    {
      execute: async (_operation, parameters) =>
        ok(
          createAnalysisExecution(null, provider, {
            limitations: [
              parameters.procedure === "first"
                ? "first caveat"
                : "later caveat",
            ],
          }),
        ),
    },
    async (observed) => {
      await observed.execute("procedure_pseudo_code", { procedure: "first" });
      for (let index = 0; index < 30; index += 1)
        await observed.execute("procedure_pseudo_code", { procedure: "later" });
      return ok(null);
    },
    {
      perItemOperations: new Set(["procedure_pseudo_code"]),
      maxDistinct: 1,
      retainedIn: "the index keeps them",
    },
  );
  expect(result).toEqual(
    ok({
      result: null,
      limitations: [
        "Fixture (fixture 1) procedure_pseudo_code: first caveat",
        "30 per-item provider limitation observations were omitted from this answer; the index keeps them.",
      ],
    }),
  );
});

it("bounds retained caveat text while preserving smaller later observations", async () => {
  const result = await executeComposedWorkflow(
    {
      execute: async () =>
        ok(
          createAnalysisExecution(null, provider, {
            limitations: [
              "x".repeat(9_000),
              "first",
              "second",
              "x".repeat(9_000),
              "ok",
            ],
          }),
        ),
    },
    async (observed) => {
      await observed.execute("procedure_pseudo_code", {});
      return ok(null);
    },
    {
      perItemOperations: new Set(["procedure_pseudo_code"]),
      maxDistinct: 8,
      maxBytes: 12,
      retainedIn: "the index keeps them",
    },
  );
  expect(result).toEqual(
    ok({
      result: null,
      limitations: [
        "Fixture (fixture 1) procedure_pseudo_code: first",
        "Fixture (fixture 1) procedure_pseudo_code: ok",
        "3 per-item provider limitation observations were omitted from this answer; the index keeps them.",
      ],
    }),
  );
});

it("preserves a failed composed operation without an extra provider read", async () => {
  const failure = err(new AnalysisCancelledError("list_strings"));
  let calls = 0;
  const result = await executeComposedWorkflow(
    {
      execute: async () => {
        calls++;
        return failure;
      },
    },
    async (observed) => {
      const observedResult = await observed.execute("list_strings", {});
      return observedResult.ok
        ? ok(observedResult.value.result)
        : observedResult;
    },
  );
  expect(result).toBe(failure);
  expect(calls).toBe(1);
});

describe("workflow residual question retention", () => {
  it("keeps questions linked to workflow Evidence and records repeats idempotently", () => {
    const records = new InvestigationRecords();
    const result = {
      residual_unknowns: ["Which provider resolves this boundary?"],
    };
    const evidence = createWorkflowEvidence({
      target: undefined,
      operation: "inspect_native_api",
      parameters: { procedure: "0x1000" },
      result,
      upstreamProfile: undefined,
      upstreamLimitations: [],
    });
    expect(records.recordEvidence(evidence).ok).toBe(true);
    const input = {
      name: "inspect_native_api",
      result,
      evidenceId: evidence.evidence_id,
      recordUnknown: (
        unknown: Parameters<InvestigationRecords["recordUnknown"]>[0],
      ) => records.recordUnknown(unknown),
    };
    expect(recordWorkflowUnknowns(input).ok).toBe(true);
    expect(recordWorkflowUnknowns(input).ok).toBe(true);
    expect(records.listUnknowns()).toMatchObject([
      {
        question: `${result.residual_unknowns[0]} (Evidence ${evidence.evidence_id})`,
        domain: "native-api",
        supporting_evidence_ids: [evidence.evidence_id],
        required_authority: "shipped-artifact",
      },
    ]);
  });

  it("retains one identical residual question per distinct workflow Evidence", () => {
    const records = new InvestigationRecords();
    const result = {
      residual_unknowns: ["Which provider resolves this boundary?"],
    };
    const evidence = ["0x1000", "0x2000"].map((procedure) =>
      createWorkflowEvidence({
        target: undefined,
        operation: "inspect_native_api",
        parameters: { procedure },
        result,
        upstreamProfile: undefined,
        upstreamLimitations: [],
      }),
    );
    expect(evidence[0]?.evidence_id).not.toBe(evidence[1]?.evidence_id);

    for (const item of evidence) {
      expect(records.recordEvidence(item).ok).toBe(true);
      const input = {
        name: "inspect_native_api",
        result,
        evidenceId: item.evidence_id,
        recordUnknown: (
          unknown: Parameters<InvestigationRecords["recordUnknown"]>[0],
        ) => records.recordUnknown(unknown),
      };
      expect(recordWorkflowUnknowns(input).ok).toBe(true);
      expect(recordWorkflowUnknowns(input).ok).toBe(true);
    }

    expect(records.listUnknowns()).toHaveLength(2);
    expect(
      records
        .listUnknowns()
        .map(({ supporting_evidence_ids }) => supporting_evidence_ids),
    ).toEqual(
      expect.arrayContaining(evidence.map(({ evidence_id }) => [evidence_id])),
    );
  });

  it.each([
    ["spaces", "  Which boundary?  "],
    ["line feed and tab", "\nWhich boundary?\t"],
    ["byte order mark", "\uFEFFWhich boundary?\uFEFF"],
  ])(
    "normalizes edge whitespace from %s without changing workflow Evidence",
    (_, question) => {
      const records = new InvestigationRecords();
      const result = { residual_unknowns: [question] };
      const evidence = createWorkflowEvidence({
        target: undefined,
        operation: "inspect_native_api",
        parameters: {},
        result,
        upstreamProfile: undefined,
        upstreamLimitations: [],
      });

      expect(records.recordEvidence(evidence).ok).toBe(true);
      expect(
        recordWorkflowUnknowns({
          name: "inspect_native_api",
          result,
          evidenceId: evidence.evidence_id,
          recordUnknown: (unknown) => records.recordUnknown(unknown),
        }).ok,
      ).toBe(true);
      expect(records.listUnknowns()).toMatchObject([
        { question: `Which boundary? (Evidence ${evidence.evidence_id})` },
      ]);
      expect(evidence.normalized_result).toEqual(result);
    },
  );

  it("rejects questions that are empty after whitespace normalization", () => {
    const records = new InvestigationRecords();
    const result = { residual_unknowns: [" \n\t "] };
    const evidence = createWorkflowEvidence({
      target: undefined,
      operation: "inspect_native_api",
      parameters: {},
      result,
      upstreamProfile: undefined,
      upstreamLimitations: [],
    });

    expect(records.recordEvidence(evidence).ok).toBe(true);
    expect(
      recordWorkflowUnknowns({
        name: "inspect_native_api",
        result,
        evidenceId: evidence.evidence_id,
        recordUnknown: (unknown) => records.recordUnknown(unknown),
      }).ok,
    ).toBe(false);
    expect(records.listUnknowns()).toEqual([]);
    expect(evidence.normalized_result).toEqual(result);
  });

  it("preserves registry failures rather than presenting a completed workflow", () => {
    const error = new UnknownRegistryError("limit");
    expect(
      recordWorkflowUnknowns({
        name: "trace_feature",
        result: { residual_unknowns: ["Which branch handles the request?"] },
        evidenceId: "unretained",
        recordUnknown: () => err(error),
      }),
    ).toEqual(err(error));
  });
});

it.each([
  "  Which boundary?  ",
  "\nWhich boundary?\t",
  "\uFEFFWhich boundary?\uFEFF",
])(
  "retains contract-accepted question %j without rewriting workflow Evidence",
  (question) => {
    const boundary = nativeApiBoundarySchema.parse({
      available: false,
      reason: "Synthetic provider unavailable boundary",
      residual_unknowns: [question],
    });
    const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
    const result = projectNativeApiInspection({
      ...dossier,
      native_api: boundary,
    });
    const evidence = createWorkflowEvidence({
      target: undefined,
      operation: "inspect_native_api",
      parameters: { procedure: "0x1000" },
      result,
      upstreamProfile: undefined,
      upstreamLimitations: [],
    });
    const records = new InvestigationRecords();
    expect(records.recordEvidence(evidence).ok).toBe(true);
    expect(
      recordWorkflowUnknowns({
        name: "inspect_native_api",
        result,
        evidenceId: evidence.evidence_id,
        recordUnknown: (input) => records.recordUnknown(input),
      }).ok,
    ).toBe(true);
    expect(records.listUnknowns()).toMatchObject([
      { question: `Which boundary? (Evidence ${evidence.evidence_id})` },
    ]);
    expect(records.evidenceById(evidence.evidence_id)).toEqual(evidence);
    expect(evidence.normalized_result).toMatchObject({
      residual_unknowns: [question],
    });
  },
);

it("shares temporary provider state only within a single completed workflow", async () => {
  const owner = {};
  const scopes: Array<
    NonNullable<import("./AnalysisProvider.js").ExecutionOptions["workScope"]>
  > = [];
  const provider = { id: "fixture", name: "Fixture", version: "1" };
  const analysis: AnalysisOperationPort = {
    execute: async (_operation, _parameters, options) => {
      const scope = options?.workScope;
      if (scope === undefined) throw new Error("workflow scope missing");
      scopes.push(scope);
      scope.set(owner, (scope.get<number>(owner) ?? 0) + 1);
      return ok(createAnalysisExecution(null, provider));
    },
  };
  const run = () =>
    executeComposedWorkflow(analysis, async (observed) => {
      await observed.execute("health", {});
      await observed.execute("health", {});
      expect(scopes.at(-1)?.get(owner)).toBe(2);
      return ok(null);
    });
  await run();
  expect(scopes[0]?.get(owner)).toBeUndefined();
  scopes[0]?.set(owner, "late completion");
  expect(scopes[0]?.get(owner)).toBeUndefined();
  await run();
  expect(scopes[0]).toBe(scopes[1]);
  expect(scopes[0]).not.toBe(scopes[2]);
  expect(scopes[2]).toBe(scopes[3]);
});

it("clears workflow state when its callback throws", async () => {
  const owner = {};
  let captured: import("./AnalysisProvider.js").ExecutionOptions["workScope"];
  const analysis: AnalysisOperationPort = {
    execute: async (_operation, _parameters, options) => {
      captured = options?.workScope;
      captured?.set(owner, "in flight");
      return ok(
        createAnalysisExecution(null, {
          id: "fixture",
          name: "Fixture",
          version: "1",
        }),
      );
    },
  };
  await expect(
    executeComposedWorkflow(analysis, async (observed) => {
      await observed.execute("health", {});
      throw new Error("failed workflow");
    }),
  ).rejects.toThrow("failed workflow");
  expect(captured?.get(owner)).toBeUndefined();
});
