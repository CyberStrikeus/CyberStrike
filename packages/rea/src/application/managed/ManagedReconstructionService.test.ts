import { describe, expect, it } from "vitest";

import { MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE } from "../../contracts/managed/managedWorkflowExamples.js";
import {
  managedReconstructionImportInputSchema,
  resolveManagedReconstructionImport,
} from "../../domain/managed/managedReconstruction.js";
import { managedMemberInspectionSchema } from "../../domain/managed/managedArtifact.js";
import { createEvidence } from "../../domain/evidence.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { importManagedReconstructionEvidence } from "./ManagedReconstructionService.js";

const exampleInput = () =>
  managedReconstructionImportInputSchema.parse(
    MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
  );

const exampleMethod = () => {
  const method = exampleInput().methods[0];
  if (method === undefined) throw new Error("missing example method");
  return method;
};

it("managed reconstruction reports UTF-8 byte totals while preserving UTF-16 text lengths", () => {
  const text = 'return "é"; // 😀';
  const method = exampleMethod();
  const result = importManagedReconstructionEvidence({
    ...MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
    methods: [
      {
        ...method,
        reconstruction: { ...method.reconstruction, text },
      },
    ],
  });
  if (!result.ok) throw result.error;

  expect(result.value.normalized_result).toMatchObject({
    summary: { total_text_bytes: 20 },
    methods: [{ reconstruction: { text, text_length: 17 } }],
  });
});

it("managed reconstruction rejects text hash drift", () => {
  const rejected = resolveManagedReconstructionImport({
    ...exampleInput(),
    methods: [
      {
        ...exampleMethod(),
        reconstruction: {
          ...exampleMethod().reconstruction,
          text_sha256: "0".repeat(64),
        },
      },
    ],
  });
  expect(rejected).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      operation: "import_managed_reconstruction",
      issues: [
        {
          path: ["methods", 0, "reconstruction", "text_sha256"],
          reason: "invalid_value",
          message: expect.stringContaining("Reconstruction text hash mismatch"),
        },
      ],
    },
  });
  if (!rejected.ok) expect(rejected.error).toBeInstanceOf(AnalysisInputError);
});

it("managed reconstruction rejects stale method locks", () => {
  const staleInput = {
    ...exampleInput(),
    methods: [
      {
        ...exampleMethod(),
        normalized_il_sha256: "6".repeat(64),
      },
    ],
  };
  const rejected = resolveManagedReconstructionImport(staleInput);
  expect(rejected).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      operation: "import_managed_reconstruction",
      issues: [
        {
          path: ["methods", 0],
          reason: "invalid_value",
          message: expect.stringMatching(/does not match/u),
        },
      ],
    },
  });
  if (!rejected.ok) expect(rejected.error).toBeInstanceOf(AnalysisInputError);

  const result = importManagedReconstructionEvidence(staleInput);
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["methods", 0],
          reason: "invalid_value",
          message: expect.stringMatching(/does not match/u),
        },
      ],
    });
});

it("managed reconstruction rejects static Evidence with a token MVID but no module identity", () => {
  const input = exampleInput();
  const members = managedMemberInspectionSchema.parse(
    input.static_members.normalized_result,
  );
  if (members.module === null || members.module.mvid === null)
    throw new Error("Expected fixture module identity and MVID");
  const inconsistentEvidence = createEvidence(
    undefined,
    input.static_members.provider,
    {
      operation: "inspect_managed_members",
      parameters: {},
      result: { ...members, module: null },
      rawResult: null,
      limitations: members.limitations,
    },
  );

  const rejected = resolveManagedReconstructionImport({
    ...input,
    static_members: inconsistentEvidence,
  });
  expect(rejected).toMatchObject({
    ok: false,
    error: {
      _tag: "EvidenceIntegrityError",
      message: `Managed Evidence inspect_managed_members (${inconsistentEvidence.evidence_id}) token scope MVID ${members.identity_scope.requires_mvid} does not match module MVID null`,
    },
  });
});

it("managed reconstruction rejects locks for partial CIL without normalized identity", () => {
  const input = exampleInput();
  const observed = managedMemberInspectionSchema.parse(
    input.static_members.normalized_result,
  );
  const method = observed.methods[0];
  if (method === undefined) throw new Error("missing observed method");
  const partial = {
    ...observed,
    methods: [
      {
        ...method,
        body: {
          ...method.body,
          status: "partial" as const,
          normalized_il_sha256: null,
          truncated_instructions: 1,
          issue: "instruction limit reached",
        },
      },
    ],
    coverage: { state: "partial" as const, issues: [] },
  };
  const partialEvidence = createEvidence(
    undefined,
    input.static_members.provider,
    {
      operation: "inspect_managed_members",
      parameters: {},
      result: partial,
      rawResult: null,
      limitations: partial.limitations,
    },
  );

  const rejected = resolveManagedReconstructionImport({
    ...input,
    static_members: partialEvidence,
    methods: [
      {
        ...exampleMethod(),
        normalized_il_sha256: null,
      },
    ],
  });
  expect(rejected).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      operation: "import_managed_reconstruction",
      issues: [
        {
          path: ["methods", 0],
          reason: "invalid_value",
          message: expect.stringMatching(/does not match/u),
        },
      ],
    },
  });
  if (!rejected.ok) expect(rejected.error).toBeInstanceOf(AnalysisInputError);
});
describe("managed reconstruction input diagnostics", () => {
  it("lists schema issues for malformed raw input", () => {
    const result = importManagedReconstructionEvidence({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: expect.arrayContaining([
        expect.objectContaining({ reason: "missing_argument" }),
      ]),
    });
  });

  it("keeps the failed domain constraint as an issue message", () => {
    const result = importManagedReconstructionEvidence({
      ...MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
      methods: [
        {
          ...exampleMethod(),
          reconstruction: {
            ...exampleMethod().reconstruction,
            text_sha256: "0".repeat(64),
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["methods", 0, "reconstruction", "text_sha256"],
          reason: "invalid_value",
          message: expect.stringMatching(/text hash mismatch/u),
        },
      ],
    });
  });

  it("reports nested Evidence schema issues without a misleading request path", () => {
    const input = exampleInput();
    const malformed = createEvidence(undefined, input.static_members.provider, {
      operation: "inspect_managed_members",
      parameters: {},
      result: {
        ...managedMemberInspectionSchema.parse(
          input.static_members.normalized_result,
        ),
        artifact: { sha256: 7 },
      },
      rawResult: null,
    });
    const result = importManagedReconstructionEvidence({
      ...MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
      static_members: malformed,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "EvidenceIntegrityError",
      message: expect.stringContaining("artifact"),
    });
  });
});
