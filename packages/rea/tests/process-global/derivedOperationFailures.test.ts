import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { InMemoryTransport, Client } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";

import { ARTIFACT_COMPARISON_EXAMPLE } from "../../src/contracts/artifactComparisonExample.js";
import { FUNCTION_COMPARISON_EXAMPLE } from "../../src/contracts/functionComparisonExample.js";
import { completeReconstructionCoverageData } from "../../src/domain/reconstructionCoverage.fixture.js";
import { reconstructionClosureResultSchema } from "../../src/domain/reconstructionCoverage.js";
import { createEvidence } from "../../src/domain/evidence.js";
import { functionComparisonResultSchema } from "../../src/domain/functionComparisonSchemas.js";
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";

import {
  MANAGED_APPLICATION_GRAPH_EXAMPLE,
  MANAGED_MEMBER_COMPARISON_EXAMPLE,
  MANAGED_NATIVE_VERIFICATION_EXAMPLE,
  MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
} from "../../src/contracts/managed/managedWorkflowExamples.js";
import { managedApplicationGraphResultSchema } from "../../src/domain/managed/managedApplicationGraph.js";
import { managedMemberComparisonResultSchema } from "../../src/domain/managed/managedMemberComparison.js";
import { managedNativeVerificationResultSchema } from "../../src/domain/managed/managedNativeVerificationSchemas.js";
import { managedReconstructionImportResultSchema } from "../../src/domain/managed/managedReconstruction.js";

import { captureProcessScenarioFile } from "../../src/application/process/ProcessCli.js";
import { compareManagedMemberPaths } from "../../src/application/managed/ManagedMemberComparisonService.js";
import { RetainedRegularFileCleanupFailure } from "../../src/application/RegularFileRead.js";
import { OwnedFileHandle } from "../../src/filesystem/OwnedFileHandle.js";
import { primaryAnalysisError } from "../../src/domain/analysisErrorBase.js";
import { buildManagedPeFixture } from "../../src/dotnet/ManagedPe.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { ProcessCaptureError } from "../../src/process/capture/ProcessCaptureError.js";

import { reconstructionObligationLedgerSchema } from "../../src/domain/reconstructionObligationLedgerSchemas.js";
import {
  request as ledgerRequest,
  processEvidence,
} from "../../src/application/ReconstructionObligationLedger.fixture.js";
import { processCaptureSchema } from "../../src/domain/process/processCapture.js";
import {
  JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE,
  JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE,
} from "../../src/contracts/javascript/javascriptRuntimeReconciliationExample.js";
import { javascriptApplicationAnalysisResultSchema } from "../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { javaScriptSemanticQueryResultSchema } from "../../src/domain/javascript/javascriptSemanticQuerySchemas.js";
import {
  JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
  JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE,
  SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE,
} from "../../src/contracts/javascript/javascriptApplicationWorkflowExamples.js";
import { JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE } from "../../src/contracts/javascript/javascriptExportShapeComparisonExample.js";
import { applicationFeatureTraceResultSchema } from "../../src/domain/javascript/javascriptFeatureTraceSchemas.js";
import { ownedApplicationVersionComparisonResultSchema } from "../../src/domain/javascript/javascriptApplicationVersionComparisonSchemas.js";
import { javaScriptExportShapeComparisonResultSchema } from "../../src/domain/javascript/javascriptExportShapeComparisonSchemas.js";
import { sourceToBundleComparisonResultSchema } from "../../src/domain/javascript/sourceToBundleComparisonSchemas.js";
import { javascriptRuntimeReconciliationResultSchema } from "../../src/domain/javascript/javascriptRuntimeReconciliationSchemas.js";
import { browserCompletenessSchema } from "../../src/domain/browserCompleteness.js";
import { createElectronActiveEvidence } from "../../src/application/javascript/ElectronActiveEvidence.js";
import { electronActiveObservationInputSchema } from "../../src/domain/javascript/electronActiveObservation.js";
import { createElectronActiveObservationFixtureResult } from "../../src/domain/javascript/electronActiveObservation.fixture.js";

import { nativeFunctionMatchingSchema } from "../../src/domain/native/functionMatching.js";
import { FunctionByteCoverage } from "../../src/domain/native/functionByteCoverage.js";
import {
  nativeMatchingInventory,
  nativeMatchingDetails,
} from "../fixtures/nativeFunctionMatching.js";

/** Unexpected implementation failures retain the SDK text surface, without a typed caller error. */
const expectUnexpectedToolFailure = (
  response: Awaited<ReturnType<Client["callTool"]>>,
  failure: Error,
): void => {
  expect(response).toMatchObject({
    isError: true,
    content: [{ type: "text", text: failure.message }],
  });
  expect(response.structuredContent).toBeUndefined();
};

const unexpectedResultFailures = [
  ["TypeError", () => new TypeError("injected result parser TypeError")],
  ["Error", () => new Error("injected result parser Error")],
  [
    "ZodError",
    () => {
      const result = z.string().safeParse(1);
      if (result.success) throw new Error("Expected an invalid string parse");
      return result.error;
    },
  ],
] as const;

describe.each([
  {
    name: "trace_application_feature",
    input: JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
    result: applicationFeatureTraceResultSchema,
  },
  {
    name: "compare_application_versions",
    input: JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE,
    result: ownedApplicationVersionComparisonResultSchema,
  },
  {
    name: "compare_javascript_export_shapes",
    input: JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE,
    result: javaScriptExportShapeComparisonResultSchema,
  },
  {
    name: "compare_source_to_bundle",
    input: SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE,
    result: sourceToBundleComparisonResultSchema,
  },
])("$name output failures through the public SDK", (workflow) => {
  afterEach(() => vi.restoreAllMocks());

  it.each(unexpectedResultFailures)(
    "preserves an unexpected %s without recording sources or derived Evidence",
    async (_kind, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const failure = createFailure();
        vi.spyOn(workflow.result, "parse").mockImplementation(() => {
          throw failure;
        });
        const response = await client.callTool({
          name: workflow.name,
          arguments: workflow.input,
        });
        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle().records).toEqual([]);
        expect(session.exportEvidenceBundle().unknowns).toEqual([]);
      });
    },
  );
});

const invalidFunctionOperationEvidence = () => {
  const left = FUNCTION_COMPARISON_EXAMPLE.left;
  if (left.subject === null) throw new Error("Expected a function subject");
  return createEvidence(
    {
      path: "/tmp/wrong-function-operation",
      sha256: left.subject.digest.sha256,
      format: left.subject.format,
      ...(left.subject.architecture === null
        ? {}
        : { architecture: left.subject.architecture }),
    },
    left.provider,
    {
      predicateType: left.predicate_type,
      operation: "inspect_analysis_view",
      parameters: left.parameters,
      result: left.normalized_result,
      confidence: left.confidence,
      authority: left.authority,
      ...(left.relationship_coverage === null
        ? {}
        : { relationshipCoverage: left.relationship_coverage }),
    },
  );
};

const malformedFunctionResultEvidence = () => {
  const left = FUNCTION_COMPARISON_EXAMPLE.left;
  if (left.subject === null) throw new Error("Expected a function subject");
  return createEvidence(
    {
      path: "/tmp/malformed-function-result",
      sha256: left.subject.digest.sha256,
      format: left.subject.format,
      ...(left.subject.architecture === null
        ? {}
        : { architecture: left.subject.architecture }),
    },
    left.provider,
    {
      predicateType: left.predicate_type,
      operation: "analyze_function",
      parameters: left.parameters,
      result: { malformed: true },
      confidence: left.confidence,
      authority: left.authority,
      ...(left.relationship_coverage === null
        ? {}
        : { relationshipCoverage: left.relationship_coverage }),
    },
  );
};

const withSdk = async <Value>(
  run: (input: {
    readonly client: Client;
    readonly session: ReturnType<typeof createTestBinarySession>;
  }) => Promise<Value>,
): Promise<Value> => {
  const session = createTestBinarySession(() => {
    throw new Error(
      "These deterministic Evidence tools must not launch a provider",
    );
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({
    name: "derived-operation-failures",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await run({ client, session });
  } finally {
    await Promise.allSettled([client.close(), server.close(), session.close()]);
  }
};

const activeRuntimeFixture = () => {
  const root = join(process.cwd(), "active-runtime-fixture");
  const applicationPath = join(root, "main.js");
  const result = createElectronActiveObservationFixtureResult(applicationPath);
  const evidence = createElectronActiveEvidence(
    {
      ...electronActiveObservationInputSchema.parse({
        executable_path: process.execPath,
        application_path: applicationPath,
        application_root: root,
      }),
      application_root: root,
    },
    result,
    {
      id: "rea-playwright-electron-active",
      name: "REA Playwright active Electron observation provider",
      version: "1",
    },
  );
  return { evidence, result };
};

describe("runtime reconciliation failure ownership through the public SDK", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(unexpectedResultFailures)(
    "preserves an unexpected %s from generated reconciliation output",
    async (_label, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const failure = createFailure();
        vi.spyOn(
          javascriptRuntimeReconciliationResultSchema,
          "parse",
        ).mockImplementation(() => {
          throw failure;
        });
        const response = await client.callTool({
          name: "reconcile_javascript_runtime",
          arguments: JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE,
        });
        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle()).toMatchObject({
          records: [],
          unknowns: [],
        });
      });
    },
  );

  it.each(unexpectedResultFailures)(
    "preserves an unexpected %s while interpreting an authenticated active capture",
    async (_label, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const { evidence: runtime } = activeRuntimeFixture();
        const failure = createFailure();
        vi.spyOn(browserCompletenessSchema, "parse").mockImplementation(() => {
          throw failure;
        });
        const response = await client.callTool({
          name: "reconcile_javascript_runtime",
          arguments: {
            static_layers:
              JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers,
            runtime_observations: [runtime],
          },
        });
        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle()).toMatchObject({
          records: [],
          unknowns: [],
        });
      });
    },
  );

  it.each([
    {
      field: "payload",
      path: ["normalized_result", "application", "application_path"],
      reason: "invalid_type",
    },
    {
      field: "parameters",
      path: ["parameters", "application_root"],
      reason: "invalid_type",
    },
    {
      field: "scope",
      path: ["normalized_result", "application", "application_path"],
      reason: "invalid_value",
    },
  ])(
    "keeps an invalid active $field at its caller path",
    async ({ field, path, reason }) => {
      await withSdk(async ({ client, session }) => {
        const { evidence, result } = activeRuntimeFixture();
        const runtime = createEvidence(undefined, evidence.provider, {
          operation: evidence.operation,
          predicateType: evidence.predicate_type,
          authority: evidence.authority,
          confidence: evidence.confidence,
          parameters:
            field === "parameters"
              ? { ...evidence.parameters, application_root: 3 }
              : evidence.parameters,
          result:
            field === "parameters"
              ? result
              : {
                  ...result,
                  application: {
                    ...result.application,
                    application_path:
                      field === "payload"
                        ? 3
                        : join(process.cwd(), "another-application", "main.js"),
                  },
                },
        });
        const response = await client.callTool({
          name: "reconcile_javascript_runtime",
          arguments: {
            static_layers:
              JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers,
            runtime_observations: [runtime],
          },
        });
        expect(response.isError).toBe(true);
        expect(parseMcpToolError(response).error).toMatchObject({
          code: "invalid_request",
          details: {
            operation: "reconcile_javascript_runtime",
            issues: [{ path: ["runtime_observations", 0, ...path], reason }],
          },
        });
        expect(session.exportEvidenceBundle()).toMatchObject({
          records: [],
          unknowns: [],
        });
      });
    },
  );
});

describe("derived operation failures through the public SDK", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps a wrong function operation as a caller constraint at left", async () => {
    await withSdk(async ({ client, session }) => {
      const response = await client.callTool({
        name: "compare_functions",
        arguments: {
          left: invalidFunctionOperationEvidence(),
          right: FUNCTION_COMPARISON_EXAMPLE.right,
        },
      });

      expect(parseMcpToolError(response).error).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [expect.objectContaining({ path: ["left"] })],
        },
      });
      expect(session.exportEvidenceBundle().records).toEqual([]);
    });
  });

  it("keeps malformed analyze_function payloads as Evidence integrity failures", async () => {
    await withSdk(async ({ client, session }) => {
      const response = await client.callTool({
        name: "compare_functions",
        arguments: {
          left: malformedFunctionResultEvidence(),
          right: FUNCTION_COMPARISON_EXAMPLE.right,
        },
      });

      expect(parseMcpToolError(response).error.code).toBe(
        "evidence_integrity_mismatch",
      );
      expect(session.exportEvidenceBundle().records).toEqual([]);
    });
  });

  it("classifies a duplicated call-path function at its second selection", async () => {
    await withSdk(async ({ client, session }) => {
      const source = FUNCTION_COMPARISON_EXAMPLE.left;
      expect(session.recordEvidence(source).ok).toBe(true);
      const before = session.exportEvidenceBundle();
      const response = await client.callTool({
        name: "build_call_path",
        arguments: {
          functions: [source, source],
          start: { address: "0x1000" },
          goal: { address: "0x1001" },
        },
      });

      expect(parseMcpToolError(response).error).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [expect.objectContaining({ path: ["functions", 1] })],
        },
      });
      expect(session.exportEvidenceBundle()).toEqual(before);
    });
  });

  it("classifies a non-inventory artifact carrier at left", async () => {
    await withSdk(async ({ client, session }) => {
      const response = await client.callTool({
        name: "compare_artifacts",
        arguments: {
          left: FUNCTION_COMPARISON_EXAMPLE.left,
          right: ARTIFACT_COMPARISON_EXAMPLE.right,
        },
      });

      expect(parseMcpToolError(response).error).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [expect.objectContaining({ path: ["left"] })],
        },
      });
      expect(session.exportEvidenceBundle().records).toEqual([]);
    });
  });

  it.each(unexpectedResultFailures)(
    "preserves an unexpected %s from result validation",
    async (_label, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const failure = createFailure();
        vi.spyOn(functionComparisonResultSchema, "parse").mockImplementation(
          () => {
            throw failure;
          },
        );
        const response = await client.callTool({
          name: "compare_functions",
          arguments: {
            left: FUNCTION_COMPARISON_EXAMPLE.left,
            right: FUNCTION_COMPARISON_EXAMPLE.right,
          },
        });

        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    },
  );

  it.each(unexpectedResultFailures)(
    "preserves an unexpected %s from coverage result validation",
    async (_label, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const coverage = completeReconstructionCoverageData();
        const failure = createFailure();
        vi.spyOn(reconstructionClosureResultSchema, "parse").mockImplementation(
          () => {
            throw failure;
          },
        );
        const response = await client.callTool({
          name: "evaluate_reconstruction_coverage",
          arguments: { coverage, boundary_id: "replacement.cli" },
        });
        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    },
  );
});

const managedWorkflows = [
  {
    name: "project_managed_application_graph",
    input: MANAGED_APPLICATION_GRAPH_EXAMPLE,
    result: managedApplicationGraphResultSchema,
    sourceField: "managed_members",
    source: MANAGED_APPLICATION_GRAPH_EXAMPLE.managed_members,
  },
  {
    name: "compare_managed_members",
    input: MANAGED_MEMBER_COMPARISON_EXAMPLE,
    result: managedMemberComparisonResultSchema,
    sourceField: "left",
    source: MANAGED_MEMBER_COMPARISON_EXAMPLE.left,
  },
  {
    name: "verify_managed_native_boundaries",
    input: MANAGED_NATIVE_VERIFICATION_EXAMPLE,
    result: managedNativeVerificationResultSchema,
    sourceField: "managed_boundaries",
    source: MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
  },
  {
    name: "import_managed_reconstruction",
    input: MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
    result: managedReconstructionImportResultSchema,
    sourceField: "static_members",
    source: MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE.static_members,
  },
] as const;

describe.each(managedWorkflows)(
  "$name failure ownership through the public SDK",
  (workflow) => {
    afterEach(() => vi.restoreAllMocks());

    it("rejects an authentic source with the wrong operation at its selection", async () => {
      await withSdk(async ({ client, session }) => {
        const response = await client.callTool({
          name: workflow.name,
          arguments: {
            ...workflow.input,
            [workflow.sourceField]: FUNCTION_COMPARISON_EXAMPLE.left,
          },
        });
        expect(parseMcpToolError(response).error).toMatchObject({
          code: "invalid_request",
          details: {
            issues: [expect.objectContaining({ path: [workflow.sourceField] })],
          },
        });
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    });

    it("rejects a malformed authenticated source payload as Evidence integrity", async () => {
      await withSdk(async ({ client, session }) => {
        const source = createEvidence(undefined, workflow.source.provider, {
          operation: workflow.source.operation,
          parameters: {},
          result: { malformed: true },
        });
        const response = await client.callTool({
          name: workflow.name,
          arguments: { ...workflow.input, [workflow.sourceField]: source },
        });
        expect(parseMcpToolError(response).error.code).toBe(
          "evidence_integrity_mismatch",
        );
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    });

    it("rejects a tampered source before recording any Evidence", async () => {
      await withSdk(async ({ client, session }) => {
        const response = await client.callTool({
          name: workflow.name,
          arguments: {
            ...workflow.input,
            [workflow.sourceField]: {
              ...workflow.source,
              normalized_result: { tampered: true },
            },
          },
        });
        expect(parseMcpToolError(response).error.code).toBe(
          "evidence_integrity_mismatch",
        );
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    });

    it.each(unexpectedResultFailures)(
      "preserves an unexpected %s from its generated output",
      async (_label, createFailure) => {
        await withSdk(async ({ client, session }) => {
          const failure = createFailure();
          vi.spyOn(workflow.result, "parse").mockImplementation(() => {
            throw failure;
          });
          const response = await client.callTool({
            name: workflow.name,
            arguments: workflow.input,
          });
          expectUnexpectedToolFailure(response, failure);
          expect(session.exportEvidenceBundle().records).toEqual([]);
        });
      },
    );
  },
);

describe("managed comparison output failure with completed source reads", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retains the left source and output failure cause after reading real artifacts", async () => {
    const root = await createTestTempDirectory("rea-managed-output-failure-");
    const leftPath = join(root, "left.dll");
    const rightPath = join(root, "right.dll");
    await writeFile(leftPath, buildManagedPeFixture());
    await writeFile(
      rightPath,
      buildManagedPeFixture({ methodName: "Changed" }),
    );
    const parsed = z.string().safeParse(1);
    if (parsed.success) throw new Error("Expected invalid output");
    const failure = parsed.error;
    vi.spyOn(managedMemberComparisonResultSchema, "parse").mockImplementation(
      () => {
        throw failure;
      },
    );

    const result = await compareManagedMemberPaths({ leftPath, rightPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.cause).toBe(failure);
    expect(result.error).toMatchObject({
      _tag: "AnalysisOutputError",
      partialObservation: {
        operation: "inspect_managed_members",
        subject: { local_path: leftPath },
        normalized_result: {
          methods: [expect.objectContaining({ token: "0x06000001" })],
        },
      },
    });
  });
});

it.each(["missing", "invalid", "cleanup"])(
  "retains both managed admission cleanup owners when the left has a %s failure",
  async (leftFailure) => {
    const root = await createTestTempDirectory(
      "rea-managed-admission-cleanup-",
    );
    const leftPath = join(root, "left.dll");
    const rightPath = join(root, "right.dll");
    await writeFile(rightPath, buildManagedPeFixture());
    if (leftFailure === "invalid") await writeFile(leftPath, "invalid PE");
    if (leftFailure === "cleanup")
      await writeFile(leftPath, buildManagedPeFixture());
    const rightIdentity = await stat(rightPath);
    const original = OwnedFileHandle.prototype.close;
    const owners = new Set<OwnedFileHandle>();
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        const identity = await this.handle.stat();
        if (identity.ino === rightIdentity.ino || leftFailure === "cleanup") {
          owners.add(this);
          throw new Error("injected managed admission close failure");
        }
        await original.call(this);
      });
    onTestFinished(async () => {
      close.mockRestore();
      for (const owner of owners) await owner.close();
    });

    const result = await compareManagedMemberPaths({ leftPath, rightPath });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(rightPath);
    expect(primaryAnalysisError(result.error)).toMatchObject({
      path: leftPath,
    });
    if (leftFailure === "cleanup")
      expect(result.error.cleanupResources).toContain(leftPath);
    expect(owners.size).toBe(leftFailure === "cleanup" ? 2 : 1);
    expect([...owners].every((owner) => owner.handle.fd >= 0)).toBe(true);

    close.mockRestore();
    const retry = async (cause: unknown): Promise<void> => {
      if (cause instanceof RetainedRegularFileCleanupFailure)
        await cause.cleanupLease.release();
      else if (cause instanceof AggregateError)
        for (const nested of cause.errors) await retry(nested);
      else if (cause instanceof Error) await retry(cause.cause);
    };
    await retry(result.error);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect([...owners].every((owner) => owner.handle.fd < 0)).toBe(true);
  },
);

describe("ledger generation failure ownership through the public SDK", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(unexpectedResultFailures)(
    "preserves an unexpected %s from generated ledger validation",
    async (_label, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const input = ledgerRequest([processEvidence()]);
        const failure = createFailure();
        vi.spyOn(
          reconstructionObligationLedgerSchema,
          "parse",
        ).mockImplementation(() => {
          throw failure;
        });
        const response = await client.callTool({
          name: "build_reconstruction_obligation_ledger",
          arguments: input,
        });
        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    },
  );

  it.each(unexpectedResultFailures)(
    "preserves an unexpected %s while deriving process candidates",
    async (_label, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const input = ledgerRequest([processEvidence()]);
        const failure = createFailure();
        vi.spyOn(processCaptureSchema, "safeParse").mockImplementation(() => {
          throw failure;
        });
        const response = await client.callTool({
          name: "build_reconstruction_obligation_ledger",
          arguments: input,
        });
        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    },
  );
});

describe("process capture CLI cleanup failure projection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves sanitized unknown-process IDs and reasons through the capture CLI boundary", async () => {
    const root = await createTestTempDirectory("rea-process-cli-cleanup-");
    const scenario = join(root, "scenario.json");
    await writeFile(
      scenario,
      JSON.stringify({ executable: process.execPath, arguments: [] }),
    );
    const reason =
      "process ownership token could not be read for 1 live process(es): environment_unavailable=1; live candidates 900=environment_unavailable";
    const failure = new ProcessCaptureError("cleanup incomplete", {
      reason: "cleanup_incomplete",
      cleanup: { reason, resources: ["owned_process_group"] },
      cleanupReport: {
        owned_process_group: {
          state: "unverified",
          reason,
          unverified_processes: [
            { pid: 900, reason: "environment_unavailable" },
          ],
        },
        terminal_renderer: { state: "cleaned", reason: null },
        temporary_root: { state: "cleaned", reason: null },
      },
    });
    const processHarness =
      await import("../../src/process/capture/ProcessHarness.js");
    vi.spyOn(processHarness, "captureProcessScenario").mockResolvedValue({
      ok: false,
      error: failure,
    });

    const projected = await captureProcessScenarioFile(scenario);

    expect(projected).toMatchObject({
      error: "Process command failed",
      code: "cleanup_incomplete",
      details: {
        cleanup_report: {
          owned_process_group: {
            reason,
            unverified_processes: [
              { pid: 900, reason: "environment_unavailable" },
            ],
          },
        },
      },
    });
  });
});

describe("process comparison Evidence authentication failures through the public SDK", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(unexpectedResultFailures.filter(([kind]) => kind !== "ZodError"))(
    "preserves an unexpected %s without retaining Evidence",
    async (_label, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const input = {
          left: processEvidence(),
          right: processEvidence(),
        };
        const failure = createFailure();
        const evidenceModule = await import("../../src/domain/evidence.js");
        vi.spyOn(evidenceModule, "parseEvidence").mockImplementation(() => {
          throw failure;
        });
        const response = await client.callTool({
          name: "compare_process_captures",
          arguments: input,
        });
        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle().records).toEqual([]);
        expect(session.exportEvidenceBundle().unknowns).toEqual([]);
      });
    },
  );
});

describe("semantic query output failures through the public SDK", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(unexpectedResultFailures)(
    "preserves an unexpected %s from generated query validation",
    async (_label, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const application = JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE;
        const analysis = javascriptApplicationAnalysisResultSchema.parse(
          application.normalized_result,
        );
        const node = analysis.semantic_graph.nodes[0];
        if (node === undefined)
          throw new Error("Expected a semantic fixture node");
        const failure = createFailure();
        vi.spyOn(
          javaScriptSemanticQueryResultSchema,
          "parse",
        ).mockImplementation(() => {
          throw failure;
        });
        const response = await client.callTool({
          name: "trace_javascript_semantics",
          arguments: {
            application,
            query: {
              seed: { kind: "semantic-node", node_id: node.node_id },
              direction: "backward-provenance",
            },
          },
        });
        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    },
  );
});

describe("native matching failure ownership through the public SDK", () => {
  afterEach(() => vi.restoreAllMocks());

  const matchingInput = () => ({
    left: nativeMatchingInventory("1", [{ address: "0x10", value: "main" }]),
    right: nativeMatchingInventory("2", [{ address: "0x20", value: "main" }]),
    left_observations: nativeMatchingDetails("1", "0x10", "c3"),
    right_observations: nativeMatchingDetails("2", "0x20", "c3"),
    detail: "complete",
  });

  it.each(unexpectedResultFailures)(
    "preserves an unexpected %s from native matching result validation",
    async (_label, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const input = matchingInput();
        const failure = createFailure();
        vi.spyOn(nativeFunctionMatchingSchema, "parse").mockImplementation(
          () => {
            throw failure;
          },
        );
        const response = await client.callTool({
          name: "match_native_functions",
          arguments: input,
        });
        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    },
  );

  it.each(unexpectedResultFailures)(
    "preserves an unexpected %s from native byte fingerprint derivation",
    async (_label, createFailure) => {
      await withSdk(async ({ client, session }) => {
        const input = matchingInput();
        const failure = createFailure();
        vi.spyOn(
          FunctionByteCoverage.prototype,
          "fingerprint",
        ).mockRejectedValue(failure);
        const response = await client.callTool({
          name: "match_native_functions",
          arguments: input,
        });
        expectUnexpectedToolFailure(response, failure);
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    },
  );
});
