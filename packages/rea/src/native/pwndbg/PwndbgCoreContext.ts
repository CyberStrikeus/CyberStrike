import {
  bindArtifactFileCleanup,
  artifactFileCancellationCause,
} from "../../artifacts/ArtifactFileOperation.js";
import { safeParseUtf8Json } from "../../domain/safeJson.js";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import type { AnalysisCapturedOutput } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import {
  recordedCrashDebuggerSchema,
  type RecordedCrash,
} from "../../domain/native/recordedCrash.js";
import {
  completedStableArtifact,
  readStableArtifact,
} from "../../artifacts/readStableArtifact.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import {
  capturedPwntoolsOutput,
  pwntoolsDecoderFailure,
} from "../pwntools/PwntoolsFailures.js";
import { PWNTOOLS_LIMITS } from "../pwntools/PwntoolsRelease.js";
import { readPwntoolsFailureEvidence } from "../pwntools/PwntoolsResourceLimits.js";
import type { PwntoolsCommand } from "../pwntools/PwntoolsDecoder.js";

const OPERATION = "inspect_recorded_crash";
const replySchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), value: recordedCrashDebuggerSchema }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum([
      "unavailable",
      "unsupported",
      "decoder",
      "format",
      "output-limit",
    ]),
    message: z.string(),
  }),
]);

/** Completed debugger observations stay separate from their reply descriptor's close. */
export interface PwndbgCoreInspection {
  readonly context: Extract<RecordedCrash["debugger"], { status: "available" }>;
  readonly finalization: AnalysisError | undefined;
}

/** Add mapping candidates from an owned core-only debugger, using the existing snapshot. */
export const inspectPwndbgCore = async ({
  environment,
  architecture,
  rootPath,
  resources,
  diagnostics,
  options,
  runCommand,
  timeoutMs,
  probePath,
}: {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly architecture: RecordedCrash["architecture"];
  readonly rootPath: string;
  readonly resources: ArtifactResourceScope;
  readonly diagnostics: AnalysisCapturedOutput;
  readonly options: ExecutionOptions | undefined;
  readonly runCommand: PwntoolsCommand;
  /** Effective `pwntools_timeout_ms` for this debugger command. */
  readonly timeoutMs: number;
  readonly probePath?: (
    path: string,
    kind: "file" | "directory",
    mode: number,
  ) => Promise<void>;
}): Promise<PwndbgCoreInspection> => {
  const gdb = environment.REA_PWNDBG_GDB ?? "/usr/bin/gdb";
  const entry = environment.REA_PWNDBG_GDBINIT ?? "";
  const venv = environment.REA_PWNDBG_VENV_PATH ?? "";
  const unavailable = (message: string, cause?: unknown) =>
    new AnalysisCapabilityUnavailableError("pwndbg-core", OPERATION, message, {
      ...(cause === undefined ? {} : { cause }),
      userMessage: message,
      capturedOutput: diagnostics,
    });
  const checkCancelled = () => {
    if (options?.signal?.aborted)
      throw new AnalysisCancelledError(OPERATION, {
        cause: options.signal.reason,
        capturedOutput: diagnostics,
      });
  };
  checkCancelled();
  for (const [key, path, kind] of [
    ["REA_PWNDBG_GDB", gdb, "file"],
    ["REA_PWNDBG_GDBINIT", entry, "file"],
    ["REA_PWNDBG_VENV_PATH", venv, "directory"],
  ] as const) {
    try {
      checkCancelled();
      if (!isAbsolute(path))
        throw new Error("Expected an absolute caller-supplied path.");
      const mode = key === "REA_PWNDBG_GDB" ? constants.X_OK : constants.R_OK;
      if (probePath !== undefined) {
        await probePath(path, kind, mode);
      } else {
        await access(path, mode);
        checkCancelled();
        const information = await stat(path);
        checkCancelled();
        if (
          kind === "file" ? !information.isFile() : !information.isDirectory()
        )
          throw new Error(`Expected a ${kind}.`);
      }
      checkCancelled();
    } catch (cause: unknown) {
      if (cause instanceof AnalysisCancelledError) throw cause;
      throw unavailable(
        `${key} is unavailable at ${path}: ${cause instanceof Error ? cause.message : String(cause)}. Configure the requested core-only context, or omit include_debugger_context for basic recorded evidence.`,
        cause,
      );
    }
  }
  checkCancelled();
  const stage = join(rootPath, "debugger");
  await mkdir(stage, { mode: 0o700 });
  const requestPath = join(stage, "request.json");
  const replyPath = join(stage, "reply.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      snapshot_path: join(rootPath, "object.snapshot"),
      reply_path: replyPath,
      gdb,
      architecture,
      gdbinit: entry,
      venv,
    }),
    { flag: "wx", mode: 0o600 },
  );
  let output: AnalysisCapturedOutput | undefined;
  const failureContext = {
    operation: OPERATION,
    providerId: "pwndbg-core",
    precedingOutput: diagnostics,
    timeoutMs,
  };
  const failure = (cause: unknown) =>
    pwntoolsDecoderFailure(
      cause,
      "debugger",
      gdb,
      environment.REA_PWNTOOLS_PYTHON ?? "",
      {},
      failureContext,
    );
  try {
    checkCancelled();
    const execution = await runCommand(
      {
        command: environment.REA_PWNTOOLS_PYTHON ?? "",
        arguments: [
          "-I",
          fileURLToPath(
            new URL("../../../bridge/pwndbg/launch.py", import.meta.url),
          ),
          join(stage, "resource.failure"),
          requestPath,
        ],
        cwd: stage,
        runId: `rea-recorded-core-debugger-${randomUUID()}`,
        hostEnvironment: {
          ...environment,
          PWNDBG_NO_AUTOUPDATE: "1",
          PWNDBG_VENV_PATH: venv,
          PWNLIB_NOTERM: "1",
          TERM: "dumb",
          HOME: stage,
          XDG_CACHE_HOME: join(stage, "cache"),
          XDG_CONFIG_HOME: join(stage, "config"),
          PYTHONNOUSERSITE: "1",
          OPENBLAS_NUM_THREADS: "1",
          OMP_NUM_THREADS: "1",
        },
      },
      failure,
    );
    output = capturedPwntoolsOutput(execution);
    let reply: z.output<typeof replySchema>;
    let finalization: AnalysisError | undefined;
    try {
      let raw;
      try {
        raw = await readStableArtifact(
          replyPath,
          PWNTOOLS_LIMITS.outputBytes,
          options?.signal,
          undefined,
          resources,
        );
      } catch (cause: unknown) {
        const completed = completedStableArtifact(cause);
        if (
          !(cause instanceof ArtifactReaderFailure) ||
          completed === undefined
        )
          throw cause;
        finalization = completedReplyFailure(
          cause,
          recordedCrashStageOutput(diagnostics, output),
        );
        raw = completed;
      }
      const decoded = safeParseUtf8Json(raw.bytes);
      if (!decoded.ok) throw decoded.cause;
      reply = replySchema.parse(decoded.value);
    } catch (cause: unknown) {
      if (
        cause instanceof ArtifactReaderFailure &&
        cause.reason === "cancelled"
      ) {
        const error = new AnalysisCancelledError(OPERATION, {
          cause: artifactFileCancellationCause(cause),
          capturedOutput: recordedCrashStageOutput(diagnostics, output),
          ...(cause instanceof ArtifactReaderFailure &&
          cause.cleanup !== undefined
            ? { cleanup: cause.cleanup }
            : {}),
        });
        bindArtifactFileCleanup(cause, error);
        throw pwndbgContextFinalizationFailure(error, finalization);
      }
      const error = new AnalysisOutputError(
        OPERATION,
        `Core-only debugger reply failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        {
          cause,
          ...(cause instanceof ArtifactReaderFailure
            ? { cleanup: cause.cleanup }
            : {}),
          capturedOutput: recordedCrashStageOutput(diagnostics, output),
        },
      );
      bindArtifactFileCleanup(cause, error);
      throw pwndbgContextFinalizationFailure(error, finalization);
    }
    if (!reply.ok) {
      if (reply.reason === "unavailable" || reply.reason === "unsupported")
        throw pwndbgContextFinalizationFailure(
          new AnalysisCapabilityUnavailableError(
            "pwndbg-core",
            OPERATION,
            reply.message,
            {
              userMessage: reply.message,
              capturedOutput: recordedCrashStageOutput(diagnostics, output),
            },
          ),
          finalization,
        );
      if (reply.reason === "format" || reply.reason === "output-limit")
        throw pwndbgContextFinalizationFailure(
          new AnalysisOutputError(OPERATION, reply.message, {
            capturedOutput: recordedCrashStageOutput(diagnostics, output),
          }),
          finalization,
        );
      throw pwndbgContextFinalizationFailure(
        new ProviderAdapterError("pwndbg-core", OPERATION, {
          diagnostics: {
            stage: "debugger",
            reason: reply.message,
            captured_output: {
              ...recordedCrashStageOutput(diagnostics, output),
            },
          },
        }),
        finalization,
      );
    }
    if (reply.value.status !== "available")
      throw pwndbgContextFinalizationFailure(
        new AnalysisOutputError(
          OPERATION,
          "Requested debugger context returned no core evidence.",
          { capturedOutput: recordedCrashStageOutput(diagnostics, output) },
        ),
        finalization,
      );
    return { context: { ...reply.value, diagnostics: output }, finalization };
  } catch (cause: unknown) {
    if (cause instanceof AnalysisError && cause.cleanupIncomplete) throw cause;
    const primary = pwntoolsDecoderFailure(
      cause,
      "debugger",
      gdb,
      environment.REA_PWNTOOLS_PYTHON ?? "",
      await readPwntoolsFailureEvidence(cause, stage, resources),
      failureContext,
    );
    throw primary;
  }
};

const completedReplyFailure = (
  cause: ArtifactReaderFailure,
  capturedOutput: AnalysisCapturedOutput,
): AnalysisError => {
  const cancellation =
    cause.reason === "cancelled"
      ? new AnalysisCancelledError(OPERATION, {
          cause: artifactFileCancellationCause(cause),
          capturedOutput,
        })
      : undefined;
  if (cause.cleanup === undefined) {
    if (cancellation !== undefined) return cancellation;
    return new AnalysisOutputError(OPERATION, cause.message, {
      cause,
      capturedOutput,
    });
  }
  const cleanup = new ProviderCleanupError(
    "pwndbg-core",
    cause.cleanup.resources,
    { stage: "debugger_reply_descriptor_close", reason: cause.cleanup.reason },
    { operation: OPERATION, cause, capturedOutput },
  );
  bindArtifactFileCleanup(cause, cleanup);
  return cancellation === undefined
    ? cleanup
    : pwndbgContextFinalizationFailure(cancellation, cleanup);
};

/** A rejected/malformed context stays primary over its descriptor finalization. */
export const pwndbgContextFinalizationFailure = (
  primary: AnalysisError,
  finalization: AnalysisError | undefined,
): AnalysisError =>
  finalization === undefined
    ? primary
    : finalization.cleanupIncomplete
      ? analysisErrorWithCleanupFailure(
          primary,
          finalization,
          OPERATION,
        ).bindCleanupDependencies([primary, finalization])
      : primary.retainSecondaryFailure(finalization);

/** Preserve both stages' exact text and their independently observed truncation state. */
export const recordedCrashStageOutput = (
  basic: AnalysisCapturedOutput,
  debuggerOutput?: AnalysisCapturedOutput,
): AnalysisCapturedOutput =>
  debuggerOutput === undefined
    ? basic
    : {
        stdout: `[core decoder]\n${basic.stdout}\n[debugger]\n${debuggerOutput.stdout}`,
        stderr: `[core decoder]\n${basic.stderr}\n[debugger]\n${debuggerOutput.stderr}`,
        truncated: basic.truncated || debuggerOutput.truncated,
      };
