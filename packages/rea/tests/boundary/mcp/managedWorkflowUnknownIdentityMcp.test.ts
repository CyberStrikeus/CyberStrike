import { expect, it, onTestFinished } from "vitest";

import {
  MANAGED_NATIVE_VERIFICATION_EXAMPLE,
  MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
} from "../../../src/contracts/managed/managedWorkflowExamples.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";

import {
  managedMemberInspectionSchema,
  managedNativeBoundaryInspectionSchema,
} from "../../../src/domain/managed/managedArtifact.js";
import { managedMemberComparisonResultSchema } from "../../../src/domain/managed/managedMemberComparison.js";
import { managedNativeVerificationResultSchema } from "../../../src/domain/managed/managedNativeVerificationSchemas.js";
import { inspectMachoSchema } from "../../../src/domain/native/nativeInspection.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";

const emptyExportEvidence = () => {
  const original = MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations[0];
  if (original === undefined || original.subject === null)
    throw new Error("Managed verification example is missing native Evidence");
  const result = inspectMachoSchema.parse(original.normalized_result);
  return createEvidence(
    {
      path: "/fixtures/empty-exports.dylib",
      sha256: "8".repeat(64),
      format: original.subject.format,
      ...(original.subject.architecture === null
        ? {}
        : { architecture: original.subject.architecture }),
    },
    original.provider,
    {
      operation: "inspect_macho",
      parameters: original.parameters,
      result: {
        ...result,
        exports: {
          items: [],
          total: 0,
          exhaustive: true,
          limitations: [],
        },
      },
      rawResult: null,
      limitations: [],
    },
  );
};

const secondDeclaration = () => {
  const original = MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries;
  const result = managedNativeBoundaryInspectionSchema.parse(
    original.normalized_result,
  );
  const pinvokes = result.pinvoke_imports;
  if (pinvokes.length !== 1)
    throw new Error("Managed verification example must contain one P/Invoke");
  const pinvoke = pinvokes[0];
  if (pinvoke === undefined)
    throw new Error("Managed verification example has invalid P/Invoke data");
  return createEvidence(undefined, original.provider, {
    operation: "inspect_managed_native_boundaries",
    parameters: original.parameters,
    result: {
      ...result,
      pinvoke_imports: [
        {
          ...pinvoke,
          token: "0x1c000002",
          member_token: "0x06000002",
          member_name: "OpenNativeAgain",
          import_name: "open_native_again",
        },
      ],
    },
    rawResult: null,
    limitations: original.limitations,
  });
};

const memberEvidence = (
  id: string,
  digest: string,
  methodName: string | null,
  partial: boolean,
) => {
  const original = MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE.static_members;
  const result = managedMemberInspectionSchema.parse(
    original.normalized_result,
  );
  const method = result.methods[0];
  if (method === undefined)
    throw new Error("Managed reconstruction example is missing a method");
  const normalized = managedMemberInspectionSchema.parse({
    ...result,
    artifact: {
      ...result.artifact,
      path: `/fixtures/${id}.dll`,
      sha256: digest,
    },
    identity_scope: {
      ...result.identity_scope,
      requires_artifact_sha256: digest,
    },
    methods: methodName === null ? [] : [{ ...method, name: methodName }],
    metadata: partial
      ? { ...result.metadata, status: "partial" }
      : result.metadata,
    coverage: partial
      ? {
          state: "partial",
          issues: [
            {
              code: "invalid-tables",
              scope: "MethodDef",
              offset: null,
              detail: "The method inventory is incomplete in this fixture.",
            },
          ],
        }
      : result.coverage,
  });
  return createEvidence(
    { path: `/fixtures/${id}.dll`, sha256: digest, format: "pe" },
    original.provider,
    {
      operation: "inspect_managed_members",
      parameters: original.parameters,
      result: normalized,
      rawResult: null,
      limitations: normalized.limitations,
    },
  );
};

it("records a residual question for partial verification with zero item counts", async () => {
  const harness = await createApplicationMcpHarness({
    session: createTestBinarySession(() => {
      throw new Error("No provider needed");
    }),
  });
  onTestFinished(harness.close);
  const original = MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries;
  const report = managedNativeBoundaryInspectionSchema.parse(
    original.normalized_result,
  );
  const managed = createEvidence(undefined, original.provider, {
    operation: "inspect_managed_native_boundaries",
    parameters: {},
    result: {
      ...report,
      pinvoke_imports: [],
      native_implementations: [],
      coverage: { state: "partial", issues: [] },
    },
  });
  const response = await harness.client.callTool({
    name: "verify_managed_native_boundaries",
    arguments: {
      managed_boundaries: managed,
      native_observations: [emptyExportEvidence()],
    },
  });
  expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
  const result = managedNativeVerificationResultSchema.parse(
    parseEvidence(response.structuredContent).normalized_result,
  );
  expect(result.summary).toMatchObject({
    unresolved: 0,
    contradicted: 0,
    native_body_unresolved: 0,
  });
  expect(result.coverage.status).toBe("partial");
  expect(harness.session.listUnknowns()).toHaveLength(1);
});

it("records distinct unresolved managed boundary checks and makes exact replay idempotent", async () => {
  const harness = await createApplicationMcpHarness({
    session: createTestBinarySession(() => {
      throw new Error("Managed/native verification must not launch a provider");
    }),
  });
  onTestFinished(harness.close);
  const { client, session } = harness;
  const managed = MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries;
  const native = emptyExportEvidence();

  const verify = async (boundaries: typeof managed) => {
    const response = await client.callTool({
      name: "verify_managed_native_boundaries",
      arguments: {
        managed_boundaries: boundaries,
        native_observations: [native],
      },
    });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const evidence = parseEvidence(response.structuredContent);
    const result = managedNativeVerificationResultSchema.parse(
      evidence.normalized_result,
    );
    expect(result.summary).toMatchObject({ unresolved: 1 });
    expect(result.pinvoke_imports).toEqual([
      expect.objectContaining({
        status: "unresolved",
        basis: "no-native-candidate",
      }),
    ]);
    return evidence;
  };

  const first = await verify(managed);
  const firstBundle = session.exportEvidenceBundle();
  const replay = await verify(managed);
  expect(replay.evidence_id).toBe(first.evidence_id);
  expect(session.exportEvidenceBundle()).toEqual(firstBundle);
  expect(session.listUnknowns()).toHaveLength(1);

  const second = await verify(secondDeclaration());
  expect(second.evidence_id).not.toBe(first.evidence_id);
  const unknowns = await client.callTool({
    name: "list_unknowns",
    arguments: { domain: "managed-native-verification" },
  });
  expect(unknowns.isError, JSON.stringify(unknowns.content)).not.toBe(true);
  expect(unknowns.structuredContent).toMatchObject({
    result: {
      total: 2,
      items: expect.arrayContaining([
        expect.objectContaining({
          supporting_evidence_ids: [first.evidence_id],
        }),
        expect.objectContaining({
          supporting_evidence_ids: [second.evidence_id],
        }),
      ]),
    },
  });
});

it("retains distinct unresolved managed member comparisons and exact replay", async () => {
  const harness = await createApplicationMcpHarness({
    session: createTestBinarySession(() => {
      throw new Error("Managed member comparison must not launch a provider");
    }),
  });
  onTestFinished(harness.close);
  const { client, session } = harness;
  const right = memberEvidence("members-partial", "a".repeat(64), null, true);

  const compare = async (left: ReturnType<typeof memberEvidence>) => {
    const response = await client.callTool({
      name: "compare_managed_members",
      arguments: { left, right },
    });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const evidence = parseEvidence(response.structuredContent);
    const result = managedMemberComparisonResultSchema.parse(
      evidence.normalized_result,
    );
    expect(result.summary.unknown).toBeGreaterThan(0);
    return evidence;
  };

  const first = await compare(
    memberEvidence("members-first", "b".repeat(64), "Main", false),
  );
  const firstBundle = session.exportEvidenceBundle();
  const replay = await compare(
    memberEvidence("members-first", "b".repeat(64), "Main", false),
  );
  expect(replay.evidence_id).toBe(first.evidence_id);
  expect(session.exportEvidenceBundle()).toEqual(firstBundle);

  const second = await compare(
    memberEvidence("members-second", "c".repeat(64), "Open", false),
  );
  expect(second.evidence_id).not.toBe(first.evidence_id);
  const unknowns = await client.callTool({
    name: "list_unknowns",
    arguments: { domain: "managed-member-comparison" },
  });
  expect(unknowns.isError, JSON.stringify(unknowns.content)).not.toBe(true);
  expect(unknowns.structuredContent).toMatchObject({
    result: {
      total: 2,
      items: expect.arrayContaining([
        expect.objectContaining({
          supporting_evidence_ids: [first.evidence_id],
        }),
        expect.objectContaining({
          supporting_evidence_ids: [second.evidence_id],
        }),
      ]),
    },
  });
});
