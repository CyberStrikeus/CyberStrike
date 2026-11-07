import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { createEvidence, type Evidence } from "../domain/evidence.js";
import {
  borrowEvidenceArray,
  borrowEvidenceInput,
  evidenceInputSchema,
} from "../domain/evidenceReference.js";
import { getEvidenceInputContract } from "../domain/evidenceInputContract.js";
import { readImmutableEvidence } from "../domain/evidenceValidation.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import {
  EvidenceIntegrityError,
  EvidenceReferenceError,
} from "../domain/evidenceErrors.js";
import { err } from "../domain/result.js";
import {
  resolveEvidenceRequest,
  type EvidenceRequestResolutionOptions,
} from "./EvidenceInputResolver.js";

const evidence = createEvidence(
  undefined,
  {
    id: "test-evidence-input",
    name: "Evidence input regression",
    version: "1",
  },
  {
    operation: "test_observation",
    parameters: {},
    result: { value: 42 },
  },
);
const reference = {
  kind: "retained-evidence" as const,
  evidence_id: evidence.evidence_id,
};

describe("schema-owned Evidence request resolution", () => {
  it("resolves declared single, nested and array sources once per exact ID", () => {
    const schema = z.strictObject({
      source: evidenceInputSchema.describe("Owner-described source"),
      layers: z.array(z.strictObject({ analysis: evidenceInputSchema })),
      optional: evidenceInputSchema.optional(),
      ordinary: z.unknown(),
    });
    let lookups = 0;
    const ordinary = { kind: "retained-evidence", evidence_id: "display-data" };
    const result = resolveEvidenceRequest(
      "test",
      {
        source: reference,
        layers: [{ analysis: reference }, { analysis: evidence }],
        ordinary,
      },
      schema,
      () => {
        lookups += 1;
        return evidence;
      },
    );
    if (!result.ok) throw result.error;
    expectTypeOf(result.value.input.source).toBeUnknown();
    expectTypeOf(result.value.input.layers).toEqualTypeOf<
      { analysis: unknown }[]
    >();
    expect(lookups).toBe(1);
    expect(result.value.input.source).toBe(evidence);
    expect(result.value.input.layers.map(({ analysis }) => analysis)).toEqual([
      evidence,
      evidence,
    ]);
    expect(result.value.input).not.toHaveProperty("optional");
    expect(result.value.input.ordinary).toBe(ordinary);
    expect(result.value.sources).toEqual([evidence]);
  });

  it("borrows inline values until the format owner authenticates them", () => {
    const schema = z.strictObject({ source: evidenceInputSchema });
    const opaque = Object.defineProperty({}, "normalized_result", {
      get: () => {
        throw new Error("premature payload access");
      },
    });
    const result = resolveEvidenceRequest("test", { source: opaque }, schema);
    if (!result.ok) throw result.error;
    expectTypeOf(result.value.input.source).toBeUnknown();
    expect(result.value.input.source).toBe(opaque);
    expect(result.value.sources).toEqual([opaque]);
    const admitted = resolveEvidenceRequest(
      "test",
      { source: evidence },
      schema,
      undefined,
      { readEvidence: readImmutableEvidence },
    );
    if (!admitted.ok) throw admitted.error;
    expectTypeOf(admitted.value.input.source).toEqualTypeOf<Evidence>();
    expect(admitted.value.input.source).toEqual(evidence);
    expect(admitted.value.sources).toEqual([admitted.value.input.source]);
    const optionalAdmission: EvidenceRequestResolutionOptions = {};
    const borrowed = resolveEvidenceRequest(
      "test",
      { source: null },
      schema,
      undefined,
      optionalAdmission,
    );
    if (!borrowed.ok) throw borrowed.error;
    expectTypeOf(borrowed.value.input.source).toBeUnknown();
    expect(borrowed.value.input.source).toBeNull();
    const rejected = resolveEvidenceRequest(
      "test",
      { source: null },
      schema,
      undefined,
      { readEvidence: readImmutableEvidence },
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok)
      expect(rejected.error.diagnostics).toEqual({ input_path: ["source"] });
  });

  it.each([{ ownerPath: undefined }, { ownerPath: ["payload", 2] }])(
    "preserves source-owner failures and existing paths: %j",
    ({ ownerPath }) => {
      const failure = new EvidenceIntegrityError("Invalid source", {
        diagnostics: {
          owner: "fixture",
          ...(ownerPath === undefined ? {} : { input_path: ownerPath }),
        },
      });
      let reads = 0;
      const result = resolveEvidenceRequest(
        "test",
        { layers: [{ source: {} }] },
        z.strictObject({
          layers: z.array(z.strictObject({ source: evidenceInputSchema })),
        }),
        undefined,
        {
          readEvidence: () => {
            reads += 1;
            return err(failure);
          },
        },
      );
      if (result.ok) throw new Error("Invalid source was accepted");
      expect(result.error).toBe(failure);
      expect(reads).toBe(1);
      expect(failure.diagnostics).toEqual({
        owner: "fixture",
        input_path: ownerPath ?? ["layers", 0, "source"],
      });
    },
  );

  it("preserves optional/default/nullable source selection and envelope constraints", () => {
    const schema = z.strictObject({
      sources: z.array(evidenceInputSchema).min(1).default([reference]),
      absent: evidenceInputSchema.exactOptional(),
      nullable: evidenceInputSchema.nullable(),
      limit: z.int().positive(),
    });
    const result = resolveEvidenceRequest(
      "test",
      {
        nullable: null,
        limit: 1,
      },
      schema,
      () => evidence,
    );
    if (!result.ok) throw result.error;
    expectTypeOf(result.value.input.limit).toEqualTypeOf<number>();
    expect(result.value.input.sources).toEqual([evidence]);
    expect(result.value.input.nullable).toBeNull();
    expect(result.value.input).not.toHaveProperty("absent");
    const rejected = resolveEvidenceRequest(
      "test",
      {
        sources: [],
        nullable: null,
        limit: 0,
      },
      schema,
    );
    if (rejected.ok) throw new Error("invalid envelope was admitted");
    expect(rejected.error).toBeInstanceOf(AnalysisInputError);
  });
});

describe("Evidence request branches and source diagnostics", () => {
  it("preserves selected union defaults and overwrites without running them twice", () => {
    let refinements = 0;
    const schema = z
      .union([
        z.strictObject({
          kind: z.literal("selected"),
          source: evidenceInputSchema,
          label: z.string().overwrite((value) => value + "!"),
        }),
        z.strictObject({ kind: z.literal("plain"), value: z.string() }),
      ])
      .superRefine(() => {
        refinements += 1;
      });
    const result = resolveEvidenceRequest(
      "test",
      {
        kind: "selected",
        source: reference,
        label: "once",
      },
      schema,
      () => evidence,
    );
    if (!result.ok) throw result.error;
    expect(result.value.input).toEqual({
      kind: "selected",
      source: evidence,
      label: "once!",
    });
    expect(refinements).toBe(1);
    const plain = resolveEvidenceRequest(
      "test",
      {
        kind: "plain",
        value: "literal",
      },
      schema,
    );
    if (!plain.ok) throw plain.error;
    expect(plain.value.sources).toEqual([]);
  });

  it("preserves nested optional malformed carriers for typed owner rejection", () => {
    const schema = z.strictObject({
      sources: z.array(
        z.strictObject({ source: evidenceInputSchema.optional() }),
      ),
    });
    const result = resolveEvidenceRequest(
      "test",
      {
        sources: [{ source: null }],
      },
      schema,
      undefined,
      { readEvidence: readImmutableEvidence },
    );
    expect(result.ok).toBe(false);
  });

  it("reports malformed reference paths without treating arbitrary objects as refs", () => {
    const schema = z.strictObject({
      layers: z.array(
        z.strictObject({
          source: evidenceInputSchema,
        }),
      ),
    });
    const result = resolveEvidenceRequest(
      "test",
      {
        layers: [{ source: { kind: "retained-evidence" } }],
      },
      schema,
    );
    if (result.ok) throw new Error("missing ID was accepted");
    expect(result.error).toBeInstanceOf(AnalysisInputError);
    expect(result.error).toMatchObject({
      issues: [
        expect.objectContaining({
          path: ["layers", 0, "source", "evidence_id"],
        }),
      ],
    });
  });

  it("retains the exact missing/incorrect identity and its source path", () => {
    const schema = z.strictObject({ source: evidenceInputSchema });
    const missing = resolveEvidenceRequest(
      "test",
      { source: reference },
      schema,
      undefined,
      { referenceScope: "retained-closure" },
    );
    if (missing.ok) throw new Error("missing reference was accepted");
    expect(missing.error).toBeInstanceOf(EvidenceReferenceError);
    expect(missing.error).toMatchObject({
      reason: "missing",
      referenceScope: "retained-closure",
      diagnostics: { input_path: ["source"] },
    });
    const different = { ...reference, evidence_id: `ev_${"f".repeat(64)}` };
    const mismatched = resolveEvidenceRequest(
      "test",
      { source: different },
      schema,
      () => evidence,
    );
    if (mismatched.ok) throw new Error("mismatched record was accepted");
    expect(mismatched.error).toMatchObject({ reason: "identity_mismatch" });
  });
});

describe("Evidence request borrowing and cancellation", () => {
  it("keeps borrowed SDK selections untouched before service capacity admission", () => {
    const schema = z.strictObject({
      source: borrowEvidenceInput(),
      observations: borrowEvidenceArray().default([]),
    });
    const observations = [reference, evidence];
    const parsed = getEvidenceInputContract(schema).frameSchema.parse({
      source: evidence,
      observations,
    });
    expect(parsed.source).toBe(evidence);
    expect(parsed.observations).toBe(observations);
    const result = resolveEvidenceRequest(
      "test",
      parsed,
      schema,
      () => evidence,
    );
    if (!result.ok) throw result.error;
    expect(result.value.input.observations).toEqual([evidence, evidence]);
    expect(observations[0]).toBe(reference);
  });

  it("honors cancellation before parsing or resolving selected sources", () => {
    const controller = new AbortController();
    const reason = new Error("cancelled by caller");
    controller.abort(reason);
    let lookups = 0;
    const result = resolveEvidenceRequest(
      "test",
      { source: reference },
      z.strictObject({ source: evidenceInputSchema }),
      () => {
        lookups += 1;
        return evidence;
      },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("cancelled request was admitted");
    expect(result.error.cause).toBe(reason);
    expect(lookups).toBe(0);
  });

  it("observes cancellation raised by the final source owner", () => {
    const controller = new AbortController();
    const reason = new Error("cancelled during source admission");
    const result = resolveEvidenceRequest(
      "test",
      { source: reference },
      z.strictObject({ source: evidenceInputSchema }),
      () => evidence,
      {
        signal: controller.signal,
        readEvidence: (input) => {
          const read = readImmutableEvidence(input);
          controller.abort(reason);
          return read;
        },
      },
    );
    if (result.ok) throw new Error("late source cancellation was lost");
    expect(result.error.cause).toBe(reason);
  });
});
