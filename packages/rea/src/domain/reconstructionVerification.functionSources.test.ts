import { describe, expect, it } from "vitest";

import { AnalysisInputError } from "./analysisErrorCore.js";
import { EvidenceIntegrityError } from "./evidenceErrors.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
  type EvidenceObservation,
  type EvidenceProvider,
  type EvidenceSubjectTarget,
} from "./evidence.js";
import { createEvidenceBundle, parseEvidenceBundle } from "./evidenceBundle.js";
import { functionDossierSchema } from "./native/functionDossier.js";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonValue,
} from "./jsonValue.js";
import { createResidualUnknown } from "./residualUnknown.js";

import { compareFunctions } from "./functionComparison.js";
import { functionSnapshotFixture } from "./functionDossierEvidence.fixture.js";
import { verifyReconstruction } from "./reconstructionVerification.js";
const dossier = jsonValueSchema.parse(
  functionDossierSchema.parse({
    procedure: {
      address: "0x1000",
      name: "main",
      symbol: {
        primary: true,
        dynamic: false,
        external: false,
        type: "function",
        source: "imported",
      },
      classification: null,
      body: {
        available: false,
        reason:
          "Hopper's public Python API does not expose complete function body ranges",
      },
      signature: "int main(void)",
      locals: [],
    },
    pseudocode: "return 0;",
    assembly: [],
    comments: [],
    callers: [],
    callees: [],
    incoming_references: [],
    outgoing_references: [],
    referenced_strings: [],
    referenced_names: [],
    native_api: null,
    native_value_flow: null,
    facet_availability: {
      pseudocode: { available: true },
      assembly: { available: true },
      comments: { available: true },
      callers: { available: true },
      callees: { available: true },
      references: { available: true },
      strings_names: { available: true },
      cfg: { available: true },
    },
    basic_blocks: [{ start: "0x1000", end: "0x1001", successors: [] }],
    limitations: [],
  }),
);

const source = (
  digit: string,
  observation: Partial<EvidenceObservation> = {},
  hasSubject = true,
  hasCoverage = true,
): Evidence =>
  createEvidence(
    hasSubject
      ? {
          path: `/fixture/function-${digit}`,
          sha256: digit.repeat(64),
          format: "file",
        }
      : undefined,
    { id: "fixture", name: "Fixture function analysis", version: "1" },
    {
      operation: "analyze_function",
      parameters: { procedure: "main" },
      result: dossier,
      confidence: "derived",
      authority: "shipped-artifact",
      ...(hasCoverage
        ? { relationshipCoverage: { status: "complete" as const } }
        : {}),
      ...observation,
    },
  );

const left = source("1");
const right = source("2");
const extra = source("3");
const singular = {
  left_evidence_id: left.evidence_id,
  right_evidence_id: right.evidence_id,
};
const plural = {
  left_evidence_ids: [left.evidence_id],
  right_evidence_ids: [right.evidence_id],
};
const provider = {
  id: "rea-function-comparison",
  name: "REA function comparison",
  version: "1",
};
const baselineResult = compareFunctions(
  functionSnapshotFixture(left),
  functionSnapshotFixture(right),
);

const comparison = (
  parameters: Record<string, JsonValue>,
  observation: Partial<EvidenceObservation> = {},
  sources: readonly Evidence[] = [left, right],
  identity: {
    provider?: EvidenceProvider;
    target?: EvidenceSubjectTarget;
  } = {},
  resultInput = baselineResult,
): Evidence => {
  const links = sources.map(({ evidence_id: id }) => id);
  const dimensions = resultInput.dimensions.map((dimension) => ({
    ...dimension,
    evidence_links: links,
  }));
  return createEvidence(identity.target, identity.provider ?? provider, {
    predicateType: "rea.function-comparison",
    operation: "compare_functions",
    parameters,
    result: jsonValueSchema.parse({
      ...resultInput,
      dimensions,
      changes: dimensions.filter(({ status }) => status !== "unchanged"),
    }),
    confidence: "derived",
    authority: "analyst-inference",
    evidenceLinks: links,
    ...observation,
  });
};

const specification = (evidence: Evidence, dimension = "pseudocode") => ({
  name: "Function reconstruction",
  claims: [
    {
      kind: "structural-function",
      claim_id: "function",
      title: "Function agrees",
      comparison_evidence_id: evidence.evidence_id,
      dimension,
    },
  ],
});

const admittedVerification = (
  evidence: Evidence,
  sources: readonly Evidence[] = [left, right],
  dimension = "pseudocode",
) => {
  // Admission controls use newly hashed Evidence and a valid bundle, not a stale digest.
  expect(parseEvidence(evidence)).toEqual(evidence);
  const bundle = createEvidenceBundle([...sources, evidence]);
  expect(parseEvidenceBundle(bundle)).toEqual(bundle);
  return () => verifyReconstruction(specification(evidence, dimension), bundle);
};

const verify = (
  evidence: Evidence,
  sources: readonly Evidence[] = [left, right],
) => admittedVerification(evidence, sources)();

describe("function reconstruction source parameters", () => {
  it.each([
    ["singular", singular],
    ["plural", plural],
    ["coherent aliases", { ...singular, ...plural }],
  ])(
    "accepts %s and preserves exact sides and unrelated metadata",
    (_name, parameters) => {
      const evidence = comparison({
        ...parameters,
        context: { label: "retained", revision: 7 },
      });
      const before = JSON.stringify(evidence);
      const result = verify(evidence);
      expect(result.status).toBe("pass");
      expect(result.claims.items).toMatchObject([
        {
          observed_status: "unchanged",
          left_evidence_ids: [left.evidence_id],
          right_evidence_ids: [right.evidence_id],
        },
      ]);
      expect(JSON.stringify(evidence)).toBe(before);
    },
  );

  it("preserves plural-only multi-ID sides and their ordering", () => {
    const fourth = source("4");
    const evidence = comparison(
      {
        left_evidence_ids: [extra.evidence_id, left.evidence_id],
        right_evidence_ids: [fourth.evidence_id, right.evidence_id],
      },
      {},
      [left, right, extra, fourth],
    );
    expect(
      verify(evidence, [left, right, extra, fourth]).claims.items,
    ).toMatchObject([
      {
        status: "pass",
        left_evidence_ids: [extra.evidence_id, left.evidence_id],
        right_evidence_ids: [fourth.evidence_id, right.evidence_id],
      },
    ]);
  });
});

describe("historical calls-only reconstruction changes", () => {
  it.each(["missing", "unknown", "partial", "unresolved"] as const)(
    "keeps historical calls-only changes unknown with %s call coverage",
    (coverage) => {
      const changedDossier = functionDossierSchema.parse({
        ...functionDossierSchema.parse(dossier),
        callees: [
          {
            address: "0x2000",
            name: "puts",
            symbol: {
              primary: true,
              dynamic: false,
              external: true,
              type: "function",
              source: "imported",
            },
            classification: null,
            body: { available: false, reason: "External function." },
          },
        ],
      });
      const complete = source("8", {
        result: jsonValueSchema.parse(changedDossier),
      });
      const incomplete = source(
        "9",
        {
          result: jsonValueSchema.parse({
            ...changedDossier,
            ...(coverage === "unresolved"
              ? {
                  unresolved_calls: [
                    {
                      address: "0x1004",
                      reason: "Computed target unresolved.",
                    },
                  ],
                }
              : {}),
          }),
          ...(coverage === "missing"
            ? {}
            : {
                relationshipCoverage:
                  coverage === "unknown"
                    ? { status: "unknown", reason: "Call graph unavailable." }
                    : coverage === "partial"
                      ? {
                          status: "partial",
                          limitations: ["Additional edges omitted."],
                        }
                      : { status: "complete" },
              }),
        },
        true,
        coverage !== "missing",
      );
      const historicalResult = compareFunctions(
        functionSnapshotFixture(left),
        functionSnapshotFixture(complete),
      );
      expect(historicalResult).toMatchObject({
        status: "changed",
        function_match: { status: "matched", method: "symbol" },
        summary: { changed: 1 },
      });
      expect(historicalResult.changes).toMatchObject([
        { dimension: "calls", status: "changed" },
      ]);
      const completeComparison = comparison(
        {
          left_evidence_id: left.evidence_id,
          right_evidence_id: complete.evidence_id,
        },
        {},
        [left, complete],
        {},
        historicalResult,
      );
      expect(
        admittedVerification(completeComparison, [left, complete], "overall")()
          .status,
      ).toBe("fail");
      const evidence = comparison(
        {
          left_evidence_id: left.evidence_id,
          right_evidence_id: incomplete.evidence_id,
        },
        {},
        [left, incomplete],
        {},
        historicalResult,
      );
      const before = JSON.stringify(evidence);
      for (const dimension of ["calls", "overall"] as const) {
        expect(
          admittedVerification(evidence, [left, incomplete], dimension)(),
        ).toMatchObject({
          status: "unknown",
          summary: { total: 1, passed: 0, failed: 0, unknown: 1 },
          claims: {
            items: [
              expect.objectContaining({
                status: "unknown",
                observed_status: "changed",
                limitations: expect.arrayContaining([
                  expect.stringContaining(`Source ${incomplete.evidence_id}:`),
                ]),
              }),
            ],
          },
        });
      }
      expect(
        admittedVerification(evidence, [left, incomplete], "pseudocode")()
          .status,
      ).toBe("pass");
      expect(JSON.stringify(evidence)).toBe(before);
    },
  );
});

describe("function reconstruction call coverage", () => {
  it("preserves complete call diagnostics while passing equal call claims", () => {
    const diagnostic = "Indirect calls remain unresolved.";
    const leftWithDiagnostic = source("a", {
      relationshipCoverage: { status: "complete", diagnostics: [diagnostic] },
    });
    const rightWithDiagnostic = source("b", {
      relationshipCoverage: { status: "complete", diagnostics: [diagnostic] },
    });
    const observed = compareFunctions(
      functionSnapshotFixture(leftWithDiagnostic),
      functionSnapshotFixture(rightWithDiagnostic),
    );
    expect(
      observed.dimensions.find(({ dimension }) => dimension === "calls"),
    ).toMatchObject({
      status: "unchanged",
      limitations: [`Left: ${diagnostic}`, `Right: ${diagnostic}`],
    });
    const evidence = comparison(
      {
        left_evidence_id: leftWithDiagnostic.evidence_id,
        right_evidence_id: rightWithDiagnostic.evidence_id,
      },
      {},
      [leftWithDiagnostic, rightWithDiagnostic],
      {},
      observed,
    );
    expect(
      admittedVerification(
        evidence,
        [leftWithDiagnostic, rightWithDiagnostic],
        "calls",
      )(),
    ).toMatchObject({
      status: "pass",
      claims: {
        items: [
          expect.objectContaining({
            status: "pass",
            observed_status: "unchanged",
            limitations: expect.arrayContaining([
              `Source ${leftWithDiagnostic.evidence_id}: ${diagnostic}`,
              `Source ${rightWithDiagnostic.evidence_id}: ${diagnostic}`,
            ]),
          }),
        ],
      },
    });
  });

  it("rechecks old unchanged comparisons without affecting unrelated finite dimensions", () => {
    const incomplete = source("7", {
      relationshipCoverage: {
        status: "unknown",
        reason: "Call graph unavailable.",
        diagnostics: ["Indirect calls remain unresolved."],
      },
    });
    const incompleteSides = {
      left_evidence_id: left.evidence_id,
      right_evidence_id: incomplete.evidence_id,
    };
    const oldUnchanged = comparison(incompleteSides, {}, [left, incomplete]);
    for (const dimension of ["calls", "overall"] as const) {
      const result = admittedVerification(
        oldUnchanged,
        [left, incomplete],
        dimension,
      )();
      expect(result).toMatchObject({
        status: "unknown",
        summary: { total: 1, passed: 0, failed: 0, unknown: 1 },
        claims: {
          items: [
            expect.objectContaining({
              dimension,
              status: "unknown",
              observed_status: "unchanged",
              limitations: expect.arrayContaining([
                `Source ${incomplete.evidence_id}: Call graph unavailable.`,
                `Source ${incomplete.evidence_id}: Indirect calls remain unresolved.`,
              ]),
            }),
          ],
        },
      });
    }
    expect(
      admittedVerification(oldUnchanged, [left, incomplete], "pseudocode")(),
    ).toMatchObject({
      status: "pass",
      claims: {
        items: [
          expect.objectContaining({
            dimension: "pseudocode",
            status: "pass",
            observed_status: "unchanged",
          }),
        ],
      },
    });
  });

  it("keeps a confirmed historical overall change as a failure despite unknown calls", () => {
    const changedDossier = jsonValueSchema.parse({
      ...functionDossierSchema.parse(dossier),
      pseudocode: "return 1;",
    });
    const changedComplete = source("8", { result: changedDossier });
    const incomplete = source("9", {
      result: changedDossier,
      relationshipCoverage: {
        status: "unknown",
        reason: "Call graph unavailable.",
      },
    });
    const changedResult = compareFunctions(
      functionSnapshotFixture(left),
      functionSnapshotFixture(changedComplete),
    );
    const oldChanged = comparison(
      {
        left_evidence_id: left.evidence_id,
        right_evidence_id: incomplete.evidence_id,
      },
      {},
      [left, incomplete],
      {},
      changedResult,
    );
    expect(oldChanged.normalized_result).toMatchObject({
      status: "changed",
      function_match: { status: "matched", method: "symbol" },
    });
    expect(
      admittedVerification(oldChanged, [left, incomplete], "overall")(),
    ).toMatchObject({
      status: "fail",
      summary: { total: 1, passed: 0, failed: 1, unknown: 0 },
      claims: {
        items: [
          expect.objectContaining({
            status: "fail",
            observed_status: "changed",
          }),
        ],
      },
    });
  });
});

describe("function reconstruction source aliases", () => {
  it.each([
    ["no source declarations", {}],
    ["missing right singular", { left_evidence_id: left.evidence_id }],
    ["missing left singular", { right_evidence_id: right.evidence_id }],
    ["missing right plural", { left_evidence_ids: [left.evidence_id] }],
    ["missing left plural", { right_evidence_ids: [right.evidence_id] }],
    [
      "mixed left singular/right plural",
      {
        left_evidence_id: left.evidence_id,
        right_evidence_ids: [right.evidence_id],
      },
    ],
    [
      "mixed left plural/right singular",
      {
        left_evidence_ids: [left.evidence_id],
        right_evidence_id: right.evidence_id,
      },
    ],
    [
      "partial singular alias with plural pair",
      { ...plural, left_evidence_id: left.evidence_id },
    ],
    [
      "other partial singular alias with plural pair",
      { ...plural, right_evidence_id: right.evidence_id },
    ],
    [
      "partial plural alias with singular pair",
      { ...singular, left_evidence_ids: [left.evidence_id] },
    ],
    [
      "other partial plural alias with singular pair",
      { ...singular, right_evidence_ids: [right.evidence_id] },
    ],
    [
      "contradictory left alias",
      { ...singular, ...plural, left_evidence_ids: [extra.evidence_id] },
    ],
    [
      "contradictory right alias",
      { ...singular, ...plural, right_evidence_ids: [extra.evidence_id] },
    ],
    [
      "reversed aliases",
      {
        ...singular,
        left_evidence_ids: [right.evidence_id],
        right_evidence_ids: [left.evidence_id],
      },
    ],
    [
      "extra left alias ID",
      {
        ...singular,
        ...plural,
        left_evidence_ids: [left.evidence_id, extra.evidence_id],
      },
    ],
    [
      "extra right alias ID",
      {
        ...singular,
        ...plural,
        right_evidence_ids: [right.evidence_id, extra.evidence_id],
      },
    ],
  ] satisfies [string, Record<string, JsonValue>][])(
    "rejects %s after valid digest admission",
    (_name, parameters) => {
      expect(admittedVerification(comparison(parameters))).toThrow(
        EvidenceIntegrityError,
      );
    },
  );
});

describe("function reconstruction malformed source IDs", () => {
  it.each(
    (
      [
        null,
        false,
        7,
        "",
        "ev_invalid",
        [],
        [left.evidence_id],
        { id: left.evidence_id },
      ] satisfies JsonValue[]
    ).map((invalid) => ({ invalid })),
  )(
    "rejects malformed singular values $invalid without falling back to plural aliases",
    ({ invalid }) => {
      for (const field of ["left_evidence_id", "right_evidence_id"]) {
        for (const aliases of [{}, plural]) {
          expect(
            admittedVerification(
              comparison({ ...singular, ...aliases, [field]: invalid }),
            ),
          ).toThrow(EvidenceIntegrityError);
        }
      }
    },
  );

  it.each(
    (
      [
        null,
        false,
        7,
        "",
        left.evidence_id,
        [],
        ["ev_invalid"],
        [null],
        { id: left.evidence_id },
      ] satisfies JsonValue[]
    ).map((invalid) => ({ invalid })),
  )(
    "rejects malformed plural values $invalid even with valid singular aliases",
    ({ invalid }) => {
      for (const field of ["left_evidence_ids", "right_evidence_ids"]) {
        for (const aliases of [{}, singular]) {
          expect(
            admittedVerification(
              comparison({ ...plural, ...aliases, [field]: invalid }),
            ),
          ).toThrow(EvidenceIntegrityError);
        }
      }
    },
  );

  it.each([
    [
      "duplicate left plural source",
      { ...plural, left_evidence_ids: [left.evidence_id, left.evidence_id] },
    ],
    [
      "duplicate right plural source",
      { ...plural, right_evidence_ids: [right.evidence_id, right.evidence_id] },
    ],
  ])("rejects %s", (_name, parameters) => {
    expect(admittedVerification(comparison(parameters))).toThrow(
      EvidenceIntegrityError,
    );
  });
});

describe("function reconstruction admission controls", () => {
  it.each([singular, plural, { ...singular, ...plural }])(
    "requires exact source closure for %j",
    (parameters) => {
      expect(
        admittedVerification(
          comparison(parameters, { evidenceLinks: [left.evidence_id] }),
        ),
      ).toThrow(EvidenceIntegrityError);
      expect(
        admittedVerification(
          comparison(parameters, {
            evidenceLinks: [
              left.evidence_id,
              right.evidence_id,
              extra.evidence_id,
            ],
          }),
          [left, right, extra],
        ),
      ).toThrow(EvidenceIntegrityError);
      try {
        admittedVerification(comparison(parameters), [left])();
        throw new Error("Expected a missing source to be rejected");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(AnalysisInputError);
        expect(error).toMatchObject({
          userMessage: expect.stringMatching(/Missing source Evidence/u),
          issues: [
            {
              path: ["claims", 0, "comparison_evidence_id"],
              reason: "invalid_value",
              message: expect.stringMatching(/Missing source Evidence/u),
            },
          ],
        });
      }
    },
  );

  it.each([
    { operation: "inventory_artifact" },
    { predicateType: "rea.process-capture" },
  ])("rejects source observation type %j", (observation) => {
    const wrong = source("1", observation);
    const evidence = comparison(
      { ...singular, left_evidence_id: wrong.evidence_id },
      {},
      [wrong, right],
    );
    expect(admittedVerification(evidence, [wrong, right])).toThrow(
      EvidenceIntegrityError,
    );
  });

  it.each(["procedure", "pseudocode", "assembly", "basic_blocks"])(
    "rejects a function dossier missing %s",
    (field) => {
      const incomplete = jsonObjectSchema.parse(dossier);
      delete incomplete[field];
      const wrong = source("1", { result: incomplete });
      const evidence = comparison(
        { ...singular, left_evidence_id: wrong.evidence_id },
        {},
        [wrong, right],
      );
      expect(admittedVerification(evidence, [wrong, right])).toThrow(
        EvidenceIntegrityError,
      );
    },
  );

  it.each([
    { authority: "historical-reference" as const },
    { confidence: "inferred" as const },
  ])("keeps insufficient source authority unknown: %j", (observation) => {
    const weak = source("1", observation);
    const evidence = comparison(
      { ...singular, left_evidence_id: weak.evidence_id },
      {},
      [weak, right],
    );
    expect(verify(evidence, [weak, right]).claims.items).toMatchObject([
      {
        status: "unknown",
        observed_status: "unchanged",
        limitations: expect.arrayContaining([
          "Source Evidence lacks qualifying shipped-artifact authority.",
        ]),
      },
    ]);
  });

  it("keeps a source without artifact identity unknown", () => {
    const unbound = source("1", {}, false);
    const evidence = comparison(
      { ...singular, left_evidence_id: unbound.evidence_id },
      {},
      [unbound, right],
    );
    expect(verify(evidence, [unbound, right]).claims.items).toMatchObject([
      {
        status: "unknown",
        limitations: expect.arrayContaining([
          "Structural source artifact identity is unavailable.",
        ]),
      },
    ]);
  });

  it("rejects any comparison finding link outside the top-level closure", () => {
    const evidence = comparison(singular, {
      result: jsonValueSchema.parse({
        ...baselineResult,
        dimensions: baselineResult.dimensions.map((dimension) =>
          dimension.dimension === "pseudocode"
            ? {
                ...dimension,
                evidence_links: [left.evidence_id, extra.evidence_id],
              }
            : dimension,
        ),
      }),
    });
    expect(admittedVerification(evidence, [left, right, extra])).toThrow(
      EvidenceIntegrityError,
    );
  });
});

describe("function reconstruction evidence integrity", () => {
  it.each([
    { operation: "compare_artifacts" },
    { predicateType: "rea.artifact-comparison" },
    { confidence: "observed" as const },
    { authority: "shipped-artifact" as const },
  ])("rejects changed comparison identity or authority %j", (observation) => {
    expect(admittedVerification(comparison(singular, observation))).toThrow(
      "operation" in observation ? AnalysisInputError : EvidenceIntegrityError,
    );
  });

  it.each([
    { ...provider, id: "other-comparison" },
    { ...provider, name: "Other comparison" },
    { ...provider, version: "2" },
  ])("rejects comparison provider %j", (identity) => {
    expect(
      admittedVerification(
        comparison(singular, {}, [left, right], { provider: identity }),
      ),
    ).toThrow(EvidenceIntegrityError);
  });

  it("rejects an artifact-bound comparison", () => {
    const evidence = comparison(singular, {}, [left, right], {
      target: {
        path: "/fixture/comparison",
        sha256: "4".repeat(64),
        format: "file",
      },
    });
    expect(admittedVerification(evidence)).toThrow(EvidenceIntegrityError);
  });

  it("retains active source unknowns as a gating result", () => {
    const evidence = comparison(singular);
    const mutation = createEvidence(undefined, provider, {
      predicateType: "rea.residual-unknown-mutation",
      operation: "record_unknown",
      parameters: {},
      result: { action: "record" },
      confidence: "derived",
      authority: "analyst-inference",
      evidenceLinks: [left.evidence_id],
    });
    const unknown = createResidualUnknown(
      {
        question: "Does the source analysis cover this function?",
        severity: "high",
        domain: "function-comparison",
        supporting_evidence_ids: [left.evidence_id],
        contradicting_evidence_ids: [],
        required_authority: "shipped-artifact",
        required_confidence: "observed",
        required_environment: null,
        recommended_probes: [],
        relationships: [],
      },
      mutation.evidence_id,
      null,
    );
    const result = verifyReconstruction(
      specification(evidence),
      createEvidenceBundle([left, right, evidence, mutation], [unknown]),
    );
    expect(result.claims.items).toMatchObject([
      {
        status: "unknown",
        observed_status: "unchanged",
        unknown_ids: [unknown.unknown_id],
      },
    ]);
  });

  it("separately rejects parameter tampering without a recomputed digest", () => {
    const evidence = comparison(singular);
    const tampered = { ...evidence, parameters: plural };
    expect(() =>
      verifyReconstruction(
        specification(evidence),
        createEvidenceBundle([left, right, tampered]),
      ),
    ).toThrow(EvidenceIntegrityError);
  });
});
