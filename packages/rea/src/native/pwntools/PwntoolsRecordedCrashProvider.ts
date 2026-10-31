import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  recordedCrashPayloadSchema,
  recordedCrashSchema,
  type InspectRecordedCrashInput,
  type RecordedCrash,
  type RecordedCrashPartialObservation,
} from "../../domain/native/recordedCrash.js";
import type { RecordedCrashPort } from "../../application/binaryDiagnostics/RecordedCrashPort.js";
import { PrivateRuntimeRoot } from "../../process/PrivateRuntimeRoot.js";
import { PwntoolsDecoder, type PwntoolsLauncher } from "./PwntoolsDecoder.js";
import { PWNTOOLS_PROVIDER_IDENTITY } from "./PwntoolsRelease.js";
import { validateCoreFileMappingAuthority } from "../pwndbg/CoreFileMappingAuthority.js";
import { validateRecordedCrashSources } from "./RecordedCrashSourceBindings.js";
import { validateRecordedCrashStructure } from "./RecordedCrashStructureBindings.js";
import {
  inspectPwndbgCore,
  pwndbgContextFinalizationFailure,
  recordedCrashStageOutput,
} from "../pwndbg/PwndbgCoreContext.js";
import type { z } from "zod";

/** Preserve every recorded thread while optionally enriching the same owned snapshot. */
export class PwntoolsRecordedCrashProvider
  extends PwntoolsDecoder<
    InspectRecordedCrashInput,
    z.output<typeof recordedCrashPayloadSchema>,
    RecordedCrash
  >
  implements RecordedCrashPort
{
  constructor(
    environment: Readonly<NodeJS.ProcessEnv>,
    launcher?: PwntoolsLauncher,
    createRuntime: () => Promise<
      Pick<PrivateRuntimeRoot, "path" | "close">
    > = () => PrivateRuntimeRoot.create({ prefix: "rea-recorded-crash-" }),
  ) {
    super(
      {
        identity: PWNTOOLS_PROVIDER_IDENTITY,
        operation: "inspect_recorded_crash",
        bridge: new URL(
          "../../../bridge/pwntools/recorded_crash.py",
          import.meta.url,
        ),
        payloadSchema: recordedCrashPayloadSchema,
        project: ({ input, payload, snapshot, diagnostics }): RecordedCrash => {
          const validate = (debuggerContext: RecordedCrash["debugger"]) =>
            recordedCrashSchema.safeParse({
              ...payload,
              artifact: {
                path: input.path,
                sha256: snapshot.sha256,
                bytes: snapshot.bytes.length,
              },
              debugger: debuggerContext,
              decoder_diagnostics: diagnostics,
              diagnostics:
                debuggerContext.status === "available"
                  ? recordedCrashStageOutput(
                      diagnostics,
                      debuggerContext.diagnostics,
                    )
                  : diagnostics,
            });
          const checked = validate({ status: "not-requested" });
          if (!checked.success)
            throw new AnalysisOutputError(
              "inspect_recorded_crash",
              `Recorded core reply is invalid: ${checked.error.issues[0]?.message ?? "schema mismatch"}`,
              { capturedOutput: diagnostics },
            );
          const value = checked.data;
          validateRecordedCrashStructure(value, snapshot.bytes, diagnostics);
          const checkBytes = (
            raw: string,
            range: { readonly offset: string; readonly bytes: string },
          ) => {
            const start = Number(BigInt(range.offset));
            const length = Number(BigInt(range.bytes));
            if (
              !Buffer.from(raw, "base64").equals(
                snapshot.bytes.subarray(start, start + length),
              )
            )
              throw new AnalysisOutputError(
                "inspect_recorded_crash",
                "Reported raw note bytes differ from the selected snapshot.",
                { capturedOutput: diagnostics },
              );
          };
          for (const note of value.notes) {
            checkBytes(note.owner_bytes_base64, note.owner_location);
            checkBytes(note.descriptor_bytes_base64, note.descriptor_location);
          }
          for (const padding of value.note_padding)
            checkBytes(padding.bytes_base64, padding.location);
          validateRecordedCrashSources(value, snapshot.bytes, diagnostics);
          for (const thread of value.threads)
            for (const register of thread.registers) {
              const start = Number(BigInt(register.location.offset));
              if (
                snapshot.bytes.readBigUInt64LE(start) !== BigInt(register.value)
              )
                throw new AnalysisOutputError(
                  "inspect_recorded_crash",
                  "Reported register value differs from its recorded source bytes.",
                  { capturedOutput: diagnostics },
                );
            }
          return value;
        },
        partialObservation: (input, value) =>
          input.include_debugger_context ? unavailableDebugger(value) : value,
        enrich: async ({
          environment,
          input,
          report: value,
          snapshot,
          rootPath,
          resources,
          options,
          runCommand,
          timeoutMs,
        }) => {
          if (!input.include_debugger_context) return value;
          const diagnostics = value.decoder_diagnostics;
          const validate = (debuggerContext: RecordedCrash["debugger"]) =>
            recordedCrashSchema.safeParse({
              ...value,
              debugger: debuggerContext,
              diagnostics:
                debuggerContext.status === "available"
                  ? recordedCrashStageOutput(
                      diagnostics,
                      debuggerContext.diagnostics,
                    )
                  : diagnostics,
            });
          try {
            if (options?.signal?.aborted)
              throw new AnalysisCancelledError("inspect_recorded_crash", {
                cause: options.signal.reason,
                capturedOutput: diagnostics,
              });
            const authority = validateCoreFileMappingAuthority(
              value,
              snapshot.bytes,
            );
            if (!authority.ok) throw authority.error;
            const completed = await inspectPwndbgCore({
              environment,
              architecture: value.architecture,
              rootPath,
              resources,
              diagnostics,
              options,
              runCommand,
              timeoutMs,
            });
            const context = completed.context;
            const enriched = validate(context);
            if (!enriched.success)
              throw pwndbgContextFinalizationFailure(
                new AnalysisOutputError(
                  "inspect_recorded_crash",
                  `Recorded debugger context is invalid: ${enriched.error.issues[0]?.message ?? "schema mismatch"}`,
                  {
                    capturedOutput: recordedCrashStageOutput(
                      diagnostics,
                      context.diagnostics,
                    ),
                  },
                ),
                completed.finalization,
              );
            if (completed.finalization !== undefined)
              throw completed.finalization.retainPartialObservation(
                enriched.data,
              );
            return enriched.data;
          } catch (cause: unknown) {
            if (cause instanceof AnalysisError)
              cause.retainPartialObservation(unavailableDebugger(value));
            throw cause;
          }
        },
      },
      environment,
      launcher,
      createRuntime,
    );
  }
}

const unavailableDebugger = (
  value: RecordedCrash,
): RecordedCrashPartialObservation => ({
  ...value,
  debugger: { status: "unavailable", requested: true },
});
