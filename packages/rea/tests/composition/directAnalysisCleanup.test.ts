import { projectCliAnalysisResult } from "../../src/cli/projectCliAnalysisResult.js";
import {
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPackageWithOptions } from "@electron/asar";
import { createArtifactBinarySession } from "../../src/composition/binary.js";
import {
  runDirectAnalysis,
  runManagedProviderExecution,
  runProviderAnalysis,
} from "../../src/application/DirectAnalysis.js";
import type { DirectAnalysisDependencies } from "../../src/application/DirectAnalysisDependencies.js";
import { parseConfig } from "../../src/config/parseConfig.js";
import { analysisCliErrorEnvelopeSchema } from "../../src/contracts/errorSchemas.js";
import type { AnalysisError } from "../../src/domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisTimeoutError,
} from "../../src/domain/analysisErrorCore.js";
import {
  projectAnalysisError,
  projectAnalysisErrorWithoutCapturedOutput,
} from "../../src/domain/analysisErrorProjection.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../src/domain/evidence.js";
import { jsonObjectSchema } from "../../src/domain/jsonValue.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { ProviderCleanupError } from "../../src/domain/providerCleanupError.js";
import { ghidraFunctionDossier } from "../../src/domain/ghidraValues.fixture.js";
import {
  createAnalysisProfile,
  type AnalysisProfileCommitment,
} from "../../src/domain/analysisProfile.js";
import { OwnedStagedOutput } from "../../src/filesystem/OwnedStagedOutput.js";
import { readAnalysisSnapshot } from "../../src/application/binary/AnalysisSnapshotFiles.js";
import { EvidenceFileError } from "../../src/domain/evidenceErrors.js";
import { err, ok } from "../../src/domain/result.js";
import { isCliOperationFailure } from "../../src/cliLogging.js";
import { observed } from "../fixtures/analysisExecution.js";
import {
  createBinarySessionTargets,
  createTestBinarySession,
} from "../fixtures/binarySession.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { AnalysisCleanupLease } from "../../src/artifacts/AnalysisCleanupLease.js";

const cleanupError = new ProviderCleanupError(
  "fixture",
  ["fixture-provider-process"],
  { reason: "process exit could not be confirmed" },
  { remediationAction: "Close the retained fixture process before retrying." },
);

const primaryError = new AnalysisTimeoutError("read_bytes", 100, {
  capturedOutput: {
    stdout: "retained observation",
    stderr: "",
    truncated: false,
  },
});

const factories = (
  options: {
    readonly profile?: AnalysisProfileCommitment;
    readonly executionError?: AnalysisError;
    readonly thrownExecution?: Error;
    readonly cleanupError?: AnalysisError;
    readonly thrownCleanup?: Error;
    readonly onClose?: () => void;
  } = {},
) => {
  const profile = options.profile;
  const session = createTestBinarySession(
    () => ({
      execute: async (operation) => {
        if (operation === "health") return observed(null);
        if (options.thrownExecution !== undefined)
          throw options.thrownExecution;
        return options.executionError === undefined
          ? observed(
              operation === "analyze_function"
                ? ghidraFunctionDossier()
                : { operation, observation: "retained result" },
            )
          : err(options.executionError);
      },
      close: async () => {
        if (options.thrownCleanup !== undefined) throw options.thrownCleanup;
        options.onClose?.();
        return options.cleanupError === undefined
          ? ok(null)
          : err(options.cleanupError);
      },
    }),
    profile === undefined
      ? {}
      : { resolveAnalysisProfile: async () => ok({ profile }) },
  );
  const dependencies: DirectAnalysisDependencies = {
    readConfiguration: () => parseConfig({}),
    createBinarySession: () => session,
    createArtifactBinarySession: () => session,
    createNativeDispatchBinarySession: () => session,
    createNativeBinarySession: () => session,
    createManagedBinarySession: () => session,
  };
  return { dependencies, session };
};

it.each([false, true])(
  "retains actual artifact sources and caller path after final-close cancellation (cleanup fails: %s)",
  async (closeFails) => {
    const root = await createTestTempDirectory("rea-artifact-final-close-");
    const source = join(root, "source");
    const archive = join(root, "fixture.asar");
    await mkdir(source);
    await writeFile(join(source, "main.js"), "console.log('retained');\n");
    await createPackageWithOptions(source, archive, {});
    const session = await createArtifactBinarySession({});
    const nativeClose = session.close.bind(session);
    const controller = new AbortController();
    const reason = {
      request: "cancel during actual artifact session final close",
    };
    let completed: Evidence | undefined;
    const close = vi
      .spyOn(session, "close")
      .mockImplementationOnce(async () => {
        completed = session
          .exportEvidenceBundle()
          .records.find(
            ({ operation, caller_input_path }) =>
              operation === "inspect_artifact" && caller_input_path === archive,
          );
        controller.abort(reason);
        // A controlled refusal retains the actual static session for finally
        // cleanup; successful cleanup runs its native owner here.
        return closeFails ? err(cleanupError) : nativeClose();
      });
    const unexpectedSession = () => {
      throw new Error("Artifact one-shot must select its static session");
    };
    const dependencies: DirectAnalysisDependencies = {
      readConfiguration: () => parseConfig({}),
      createArtifactBinarySession: () => session,
      createBinarySession: unexpectedSession,
      createNativeDispatchBinarySession: unexpectedSession,
      createNativeBinarySession: unexpectedSession,
      createManagedBinarySession: unexpectedSession,
    };
    try {
      const result = analysisCliErrorEnvelopeSchema.parse(
        await runProviderAnalysis(
          dependencies,
          archive,
          "inspect_artifact",
          {},
          undefined,
          controller.signal,
        ).then(projectCliAnalysisResult),
      );
      expect(result.code).toBe(closeFails ? "cleanup_incomplete" : "cancelled");
      expect(result.category).toBe("cancelled");
      expect(completed).toBeDefined();
      const details = jsonObjectSchema.parse(result.details);
      const partial = parseEvidence(details.partial_observation);
      expect(partial).toEqual(completed);
      expect(partial.operation).toBe("inspect_artifact");
      expect(partial.caller_input_path).toBe(archive);
      expect(partial.subject?.local_path).toBe(archive);
      const inspection = artifactInspectionResultSchema.parse(
        partial.normalized_result,
      );
      expect(inspection.subject.root_format).toBe("asar");
      expect(partial.evidence_links).toEqual(inspection.evidence_links);
      expect(partial.evidence_links).toEqual(
        inspection.substeps.map(({ evidence }) => evidence.evidence_id),
      );
      expect(inspection.substeps[0]?.evidence.normalized_result).toMatchObject({
        occurrences: expect.arrayContaining([
          expect.objectContaining({ logical_path: "main.js" }),
        ]),
      });
      if (closeFails)
        expect(details.cleanup_error).toEqual(
          projectAnalysisError(cleanupError),
        );
      else expect(result.details).not.toHaveProperty("cleanup_error");
      expect((await readdir(root)).sort()).toEqual(["fixture.asar", "source"]);
    } finally {
      close.mockRestore();
      const closed = await nativeClose();
      if (!closed.ok) throw closed.error;
    }
  },
);

it("retains both execution and final-close resources in one-shot failures", async () => {
  const [path] = await createBinarySessionTargets();
  const executionError = new AnalysisTimeoutError("read_bytes", 100, {
    capturedOutput: {
      stdout: "execution observation",
      stderr: "",
      truncated: false,
    },
    cleanup: {
      reason: "execution worker remains",
      resources: ["execution-worker", "shared-owner"],
    },
  });
  const closeError = new ProviderCleanupError(
    "fixture",
    ["session-owner", "shared-owner"],
    { reason: "session remains" },
  );
  const { dependencies } = factories({
    executionError,
    cleanupError: closeError,
  });
  const result = analysisCliErrorEnvelopeSchema.parse(
    await runDirectAnalysis(dependencies, path, "read_bytes", {
      address: "0x1000",
      length: 1,
    }).then(projectCliAnalysisResult),
  );
  expect(result).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      resources: ["execution-worker", "shared-owner", "session-owner"],
      execution_failure: "provider_timeout",
      captured_output: executionError.capturedOutput,
      cleanup_error: projectAnalysisError(closeError),
    },
  });
});

it.each([false, true])(
  "binds the exact caller path to provider failure Evidence (session cleanup fails: %s)",
  async (closeFails) => {
    const [path] = await createBinarySessionTargets();
    const callerPath = `${dirname(path)}/./${basename(path)}`;
    const original = createEvidence(
      { path, sha256: "a".repeat(64), format: "mach-o", architecture: "arm64" },
      { id: "fixture", name: "Fixture", version: null },
      { operation: "read_bytes", parameters: {}, result: { byte: 42 } },
    );
    const failure = new AnalysisCancelledError("read_bytes", {
      partialObservation: original,
    });
    const { dependencies } = factories({
      executionError: failure,
      ...(closeFails ? { cleanupError } : {}),
    });
    const result = analysisCliErrorEnvelopeSchema.parse(
      await runDirectAnalysis(dependencies, callerPath, "read_bytes", {}).then(
        projectCliAnalysisResult,
      ),
    );
    const observation = parseEvidence(
      jsonObjectSchema.parse(result.details).partial_observation,
    );
    expect(observation.caller_input_path).toBe(callerPath);
    expect(observation.subject?.local_path).toBe(path);
    expect(observation.evidence_id).toBe(original.evidence_id);
    expect(observation.normalized_result).toEqual({ byte: 42 });
    expect(original.caller_input_path).toBeUndefined();
  },
);

describe("one-shot finalization cancellation", () => {
  it.each(["read_bytes", "analyze_function"] as const)(
    "retains completed %s Evidence when cancellation arrives during final close",
    async (tool) => {
      const [path] = await createBinarySessionTargets();
      const parameters =
        tool === "analyze_function" ? { procedure: "fixture" } : {};
      const original = parseEvidence(
        await runDirectAnalysis(
          factories().dependencies,
          path,
          tool,
          parameters,
        ).then(projectCliAnalysisResult),
      );
      const controller = new AbortController();
      const reason = { request: "cancel during native close" };
      const { dependencies, session } = factories({
        onClose: () => controller.abort(reason),
      });
      const result = await runDirectAnalysis(
        dependencies,
        path,
        tool,
        parameters,
        { signal: controller.signal },
      ).then(projectCliAnalysisResult);
      expect(result).toEqual({
        error: "Analysis failed",
        ...projectAnalysisError(
          new AnalysisCancelledError(tool, {
            cause: reason,
            partialObservation: original,
          }),
        ),
      });
      expect(session.activeTarget()).toBeUndefined();
    },
  );

  it.each([false, true])(
    "preserves the execution failure during close cancellation (cleanup fails: %s)",
    async (closeFails) => {
      const [path] = await createBinarySessionTargets();
      const controller = new AbortController();
      const { dependencies } = factories({
        executionError: primaryError,
        onClose: () => controller.abort({ later: true }),
        ...(closeFails ? { cleanupError } : {}),
      });
      const result = await runDirectAnalysis(
        dependencies,
        path,
        "read_bytes",
        {},
        { signal: controller.signal },
      ).then(projectCliAnalysisResult);
      expect(result).toMatchObject({
        code: closeFails ? "cleanup_incomplete" : "provider_timeout",
        message: projectAnalysisError(primaryError).message,
        details: {
          captured_output: primaryError.capturedOutput,
          ...(closeFails
            ? { cleanup_error: projectAnalysisError(cleanupError) }
            : {}),
        },
      });
    },
  );

  it("retains completed Evidence and cancellation alongside unsuccessful cleanup", async () => {
    const [path] = await createBinarySessionTargets();
    const controller = new AbortController();
    const { dependencies } = factories({
      cleanupError,
      onClose: () => controller.abort({ during: "close" }),
    });
    const result = await runDirectAnalysis(
      dependencies,
      path,
      "read_bytes",
      {},
      { signal: controller.signal },
    ).then(projectCliAnalysisResult);
    expect(result).toMatchObject({
      code: "cleanup_incomplete",
      category: "cancelled",
      details: {
        execution_failure: "cancelled",
        resources: ["fixture-provider-process"],
        partial_observation: {
          operation: "read_bytes",
          normalized_result: { observation: "retained result" },
        },
        cleanup_error: projectAnalysisError(cleanupError),
      },
    });
  });
});

describe("snapshot publication finalization", () => {
  it.each([
    "success",
    "cancel",
    "recovered-write-cancel",
    "close-failure",
    "cancel-close-failure",
  ] as const)(
    "retains the actual snapshot publication through finalization: %s",
    async (mode) => {
      const [path] = await createBinarySessionTargets();
      const snapshotPath = join(dirname(path), "snapshot.json");
      const controller = new AbortController();
      const profile = createAnalysisProfile(
        { id: "fixture", name: "Fixture analysis provider", version: "1" },
        { fixture: true },
      );
      const cancelled = mode.includes("cancel");
      const { dependencies, session } = factories({
        profile,
        onClose: () => {
          if (cancelled) controller.abort({ during: "snapshot finalization" });
        },
        ...(mode.includes("close-failure") ? { cleanupError } : {}),
      });
      const stagingCleanup =
        mode === "recovered-write-cancel"
          ? vi
              .spyOn(OwnedStagedOutput.prototype, "close")
              .mockRejectedValueOnce(
                new Error("transient staging cleanup failure"),
              )
          : undefined;
      try {
        const result = await runDirectAnalysis(
          dependencies,
          path,
          "read_bytes",
          {},
          { signal: controller.signal, snapshotPath },
        ).then(projectCliAnalysisResult);
        const loaded = await readAnalysisSnapshot(snapshotPath);
        if (!loaded.ok) throw loaded.error;
        const evidence = loaded.value.evidence_bundle.records.find(
          (record) => record.operation === "read_bytes",
        );
        expect(evidence).toBeDefined();
        const receipt = {
          path: snapshotPath,
          bytes: (await stat(snapshotPath)).size,
        };
        expect((await readFile(snapshotPath)).byteLength).toBe(receipt.bytes);
        if (mode === "success") expect(result).toEqual(evidence);
        else {
          const failure = analysisCliErrorEnvelopeSchema.parse(result);
          expect(failure.code).toBe(
            mode.includes("close-failure") ? "cleanup_incomplete" : "cancelled",
          );
          expect(failure.details).toMatchObject({
            partial_observation: evidence,
            diagnostics: { analysis_snapshot: receipt },
          });
        }
        expect(session.activeTarget()).toBeUndefined();
        expect((await readdir(dirname(path))).toSorted()).toEqual([
          "first.hop",
          "second.hop",
          "snapshot.json",
        ]);
        if (stagingCleanup !== undefined)
          expect(stagingCleanup).toHaveBeenCalledTimes(2);
      } finally {
        stagingCleanup?.mockRestore();
      }
    },
  );

  it("preserves a snapshot write failure over later cancellation without a publication receipt", async () => {
    const [path] = await createBinarySessionTargets();
    const controller = new AbortController();
    const profile = createAnalysisProfile(
      { id: "fixture", name: "Fixture analysis provider", version: "1" },
      { fixture: true },
    );
    const { dependencies, session } = factories({
      profile,
      onClose: () => controller.abort({ later: true }),
    });
    const failure = new EvidenceFileError("write", "io", {
      path: join(dirname(path), "failed.json"),
    });
    const write = vi
      .spyOn(session, "writeAnalysisSnapshot")
      .mockResolvedValue(err(failure));
    try {
      const result = analysisCliErrorEnvelopeSchema.parse(
        await runDirectAnalysis(
          dependencies,
          path,
          "read_bytes",
          {},
          { signal: controller.signal, snapshotPath: failure.path },
        ).then(projectCliAnalysisResult),
      );
      expect(result.code).toBe(projectAnalysisError(failure).code);
      expect(result.details).toMatchObject({
        partial_observation: { operation: "read_bytes" },
      });
      expect(result.details).not.toHaveProperty(
        "diagnostics.analysis_snapshot",
      );
      expect(await readdir(dirname(path))).not.toContain("failed.json");
    } finally {
      write.mockRestore();
    }
  });
});

it.each([false, true])(
  "retains original cleanup diagnostics when final close fails: %s",
  async (closeFails) => {
    const [path] = await createBinarySessionTargets();
    const executionError = new AnalysisTimeoutError("read_bytes", 100, {
      cleanup: {
        reason: "snapshot removal failed during execution",
        resources: ["primary-snapshot"],
      },
      capturedOutput: primaryError.capturedOutput,
    });
    const primary = projectAnalysisError(executionError);
    const { dependencies } = factories({
      executionError,
      ...(closeFails ? { cleanupError } : {}),
    });
    const result = analysisCliErrorEnvelopeSchema.parse(
      await runDirectAnalysis(dependencies, path, "read_bytes", {}).then(
        projectCliAnalysisResult,
      ),
    );
    expect(result).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        ...primary.details,
        ...(closeFails
          ? {
              resources: ["primary-snapshot", "fixture-provider-process"],
              cleanup_error: projectAnalysisError(cleanupError),
            }
          : {}),
      },
    });
    expect(JSON.stringify(result).match(/retained observation/g)).toHaveLength(
      1,
    );
    if (!closeFails) expect(result.details).not.toHaveProperty("cleanup_error");
  },
);

describe("one-shot analysis cleanup outcomes", () => {
  it("retains successful evidence and reports CLI failure when close fails", async () => {
    const [path] = await createBinarySessionTargets();
    const { dependencies, session } = factories({ cleanupError });
    const result = await runDirectAnalysis(
      dependencies,
      path,
      "read_bytes",
      {},
    ).then(projectCliAnalysisResult);
    expect(result).toMatchObject({
      error: "Analysis failed",
      code: "cleanup_incomplete",
      details: {
        resources: ["fixture-provider-process"],
        partial_observation: {
          operation: "read_bytes",
          subject: { local_path: path },
          normalized_result: { observation: "retained result" },
          raw_result: null,
        },
      },
    });
    expect(isCliOperationFailure(result)).toBe(true);
    expect(session.activeTarget()).toBeUndefined();
  });

  it("preserves primary failure diagnostics alongside an unsuccessful close", async () => {
    const [path] = await createBinarySessionTargets();
    const { dependencies } = factories({
      executionError: primaryError,
      cleanupError,
    });
    const primary = projectAnalysisError(primaryError);
    const result = await runDirectAnalysis(
      dependencies,
      path,
      "read_bytes",
      {},
    ).then(projectCliAnalysisResult);
    const callerError = analysisCliErrorEnvelopeSchema.parse(result);
    expect(callerError).toMatchObject({
      code: "cleanup_incomplete",
      category: primary.category,
      message: primary.message,
      remediation: {
        action: "Close the retained fixture process before retrying.",
      },
      details: {
        execution_failure: primary.code,
        captured_output: primary.details?.captured_output,
        cleanup_error: projectAnalysisError(cleanupError),
      },
    });
    expect(callerError.details).not.toHaveProperty("primary_error");
    expect(
      JSON.stringify(callerError).match(/retained observation/g),
    ).toHaveLength(1);
    expect(isCliOperationFailure(result)).toBe(true);
  });

  it("reports provider close rejection with the successful observation", async () => {
    const [path] = await createBinarySessionTargets();
    const { dependencies } = factories({
      thrownCleanup: new Error("unexpected close rejection"),
    });
    const result = await runDirectAnalysis(
      dependencies,
      path,
      "read_bytes",
      {},
    ).then(projectCliAnalysisResult);
    expect(result).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: ["provider-client"],
        diagnostics: { reason: "provider client close rejected unexpectedly" },
        partial_observation: {
          normalized_result: { observation: "retained result" },
        },
      },
    });
  });

  it("retains both unexpected execution failure and cleanup failure", async () => {
    const [path] = await createBinarySessionTargets();
    const thrownExecution = new Error("unexpected execution rejection");
    const { dependencies } = factories({ thrownExecution, cleanupError });
    await expect(
      runDirectAnalysis(dependencies, path, "read_bytes", {}).then(
        projectCliAnalysisResult,
      ),
    ).rejects.toMatchObject({
      cause: thrownExecution,
      errors: [thrownExecution, cleanupError],
    });
  });

  it("keeps successful evidence unchanged after confirmed cleanup", async () => {
    const [path] = await createBinarySessionTargets();
    const { dependencies, session } = factories();
    const result = await runDirectAnalysis(
      dependencies,
      path,
      "read_bytes",
      {},
    ).then(projectCliAnalysisResult);
    expect(parseEvidence(result)).toMatchObject({
      operation: "read_bytes",
      normalized_result: { observation: "retained result" },
    });
    expect(isCliOperationFailure(result)).toBe(false);
    expect(session.activeTarget()).toBeUndefined();
  });
});

it.each(["complete", "summary"] as const)(
  "retains completed Evidence when cancellation arrives during managed close before %s delivery",
  async (detail) => {
    const [path] = await createBinarySessionTargets();
    const files = (await readdir(dirname(path))).sort();
    const original = parseEvidence(
      await runProviderAnalysis(
        factories().dependencies,
        path,
        "inspect_managed_members",
        {},
      ).then(projectCliAnalysisResult),
    );
    const controller = new AbortController();
    const reason = new Error("cancel during managed close");
    const { dependencies, session } = factories({
      onClose: () => controller.abort(reason),
    });
    const result =
      detail === "summary"
        ? await runProviderAnalysis(
            dependencies,
            path,
            "inspect_managed_members",
            {},
            undefined,
            controller.signal,
            {
              detail,
              evidenceBundlePath: join(dirname(path), "bundle.json"),
            },
          ).then(projectCliAnalysisResult)
        : await runProviderAnalysis(
            dependencies,
            path,
            "inspect_managed_members",
            {},
            undefined,
            controller.signal,
          ).then(projectCliAnalysisResult);
    expect(result).toEqual({
      error: "Analysis failed",
      ...projectAnalysisError(
        new AnalysisCancelledError("inspect_managed_members", {
          cause: reason,
          partialObservation: original,
        }),
      ),
    });
    expect(session.activeTarget()).toBeUndefined();
    expect((await readdir(dirname(path))).sort()).toEqual(files);
  },
);

it("preserves a managed provider failure when cancellation arrives during close", async () => {
  const [path] = await createBinarySessionTargets();
  const controller = new AbortController();
  const failure = new AnalysisInputError("inspect_managed_members", undefined, [
    { path: ["path"], reason: "invalid_format" },
  ]);
  const { dependencies, session } = factories({
    executionError: failure,
    onClose: () => controller.abort(new Error("later cancellation")),
  });
  const result = await runProviderAnalysis(
    dependencies,
    path,
    "inspect_managed_members",
    {},
    undefined,
    controller.signal,
  ).then(projectCliAnalysisResult);
  expect(result).toEqual({
    error: "Analysis failed",
    ...projectAnalysisError(failure),
  });
  expect(session.activeTarget()).toBeUndefined();
});

describe("managed one-shot cleanup outcomes", () => {
  it("returns a managed cleanup error retaining the complete successful execution", async () => {
    const [path] = await createBinarySessionTargets();
    const { dependencies } = factories({ cleanupError });
    const result = await runManagedProviderExecution(
      dependencies,
      path,
      "inspect_managed_artifact",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      remediation: {
        action: "Close the retained fixture process before retrying.",
      },
      details: {
        resources: ["fixture-provider-process"],
        diagnostics: {
          cleanup_error: projectAnalysisError(cleanupError),
          partial_observation: {
            result: {
              operation: "inspect_managed_artifact",
              observation: "retained result",
            },
            rawResult: null,
            provider: { id: "fixture" },
          },
        },
      },
    });
  });

  it("retains the typed managed primary error when close also fails", async () => {
    const [path] = await createBinarySessionTargets();
    const { dependencies } = factories({
      executionError: primaryError,
      cleanupError,
    });
    const result = await runManagedProviderExecution(
      dependencies,
      path,
      "inspect_managed_artifact",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.cause).toBeInstanceOf(AggregateError);
    expect(result.error.cause).toMatchObject({
      cause: primaryError,
      errors: [primaryError, cleanupError],
    });
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        captured_output: primaryError.capturedOutput,
        diagnostics: {
          primary_error:
            projectAnalysisErrorWithoutCapturedOutput(primaryError),
          cleanup_error: projectAnalysisError(cleanupError),
        },
      },
    });
    expect(projected).not.toHaveProperty(
      "details.diagnostics.primary_error.details.captured_output",
    );
    expect(
      JSON.stringify(projected).split("retained observation"),
    ).toHaveLength(2);
  });

  it("exposes managed cleanup failure to the CLI error classifier", async () => {
    const [path] = await createBinarySessionTargets();
    const { dependencies } = factories({ cleanupError });
    const result = await runProviderAnalysis(
      dependencies,
      path,
      "inspect_managed_artifact",
      {},
    ).then(projectCliAnalysisResult);
    expect(isCliOperationFailure(result)).toBe(true);
    expect(result).toMatchObject({
      error: "Analysis failed",
      code: "cleanup_incomplete",
    });
  });
});

describe("managed one-shot cleanup retry ownership", () => {
  it.each(["success", "timeout", "independent primary"] as const)(
    "follows exact cleanup completion after a %s outcome",
    async (mode) => {
      const [path] = await createBinarySessionTargets();
      const resource = join(dirname(path), "retained-descriptor");
      const handle = await open(resource, "w+");
      const cleanup = new ProviderCleanupError("fixture", [resource], {
        reason: "controlled first close refusal",
      });
      let attempts = 0;
      const lease = new AnalysisCleanupLease(async () => {
        if (++attempts === 1) throw new Error("first close refused");
        await handle.close();
      }, [resource]);
      lease.bindCleanupError(cleanup);
      const primaryResource = join(dirname(path), "primary-descriptor");
      const primaryHandle =
        mode === "independent primary"
          ? await open(primaryResource, "w+")
          : undefined;
      const primary =
        mode === "success"
          ? undefined
          : new AnalysisTimeoutError("inspect_managed_members", 100, {
              capturedOutput: {
                stdout: "retained timeout observation",
                stderr: "",
                truncated: false,
              },
              ...(primaryHandle === undefined
                ? {}
                : {
                    cleanup: {
                      reason: "independent primary cleanup",
                      resources: [primaryResource],
                    },
                  }),
            });
      const primaryLease =
        primaryHandle === undefined
          ? undefined
          : new AnalysisCleanupLease(
              () => primaryHandle.close(),
              [primaryResource],
            );
      if (primary !== undefined) primaryLease?.bindCleanupError(primary);
      const session = createTestBinarySession(() => ({
        execute: async (operation) =>
          operation === "health"
            ? observed(null)
            : primary === undefined
              ? observed({ retained: true })
              : err(primary),
        close: async () => {
          try {
            await lease.release();
            return ok(null);
          } catch {
            return err(cleanup);
          }
        },
      }));
      try {
        const result = await runManagedProviderExecution(
          { createManagedBinarySession: () => session },
          path,
          "inspect_managed_members",
        );
        if (result.ok) throw new Error("Expected retained cleanup failure");
        expect(projectAnalysisError(result.error).code).toBe(
          "cleanup_incomplete",
        );
        expect(handle.fd).toBeGreaterThanOrEqual(0);
        expect(await session.close()).toMatchObject({ ok: true });
        expect(handle.fd).toBe(-1);
        expect(cleanup.cleanupIncomplete).toBe(false);
        if (primaryLease !== undefined) {
          expect(result.error.cleanupIncomplete).toBe(true);
          expect(result.error.cleanupResources).toEqual([primaryResource]);
          expect(primaryHandle?.fd).toBeGreaterThanOrEqual(0);
          await primaryLease.release();
        }
        expect(result.error.cleanupIncomplete).toBe(false);
        const projected = projectAnalysisError(result.error);
        if (primary === undefined)
          expect(projected).toMatchObject({
            details: {
              diagnostics: {
                partial_observation: { result: { retained: true } },
              },
            },
          });
        else
          expect(projected).toMatchObject({
            code: "provider_timeout",
            details: {
              captured_output: { stdout: "retained timeout observation" },
            },
          });
      } finally {
        await session.close();
        await lease.release();
        await primaryLease?.release();
        await handle.close();
        await primaryHandle?.close();
      }
    },
  );

  it.each([false, true])(
    "keeps rejected cleanup without a live completion owner unknown (primary failure: %s)",
    async (primaryFailure) => {
      const [path] = await createBinarySessionTargets();
      const unowned = new AnalysisInputError("close_binary");
      const { dependencies } = factories({
        ...(primaryFailure
          ? {
              executionError: new AnalysisTimeoutError(
                "inspect_managed_members",
                100,
              ),
            }
          : {}),
        cleanupError: unowned,
      });
      const result = await runManagedProviderExecution(
        dependencies,
        path,
        "inspect_managed_members",
      );
      if (result.ok) throw new Error("Expected cleanup rejection");
      expect(unowned.cleanupIncomplete).toBe(false);
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(projectAnalysisError(result.error).code).toBe(
        "cleanup_incomplete",
      );
    },
  );
});
