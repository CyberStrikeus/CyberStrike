import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { createEvidence, type Evidence } from "../domain/evidence.js";
import { err, ok, type Result } from "../domain/result.js";
import { cutterCommandInputSchema } from "../contracts/cutterToolContracts.js";
import type { CutterBridgeDiscovery } from "../domain/cutterDiscovery.js";
import {
  CutterBridgeClient,
  type CutterBridgeExecution,
  type CutterDiscoveryOptions,
  CUTTER_PROVIDER_IDENTITY,
} from "./CutterBridgeClient.js";

interface CutterBridgePort {
  listSessions(
    options?: CutterDiscoveryOptions,
  ): Promise<CutterBridgeDiscovery>;
  close?(): Promise<void>;
  retryDescriptorCleanup?(): Promise<void>;
  confirmCommandCompletion?(
    sessionId: string,
    requestId: string,
    completionToken?: string,
  ): Promise<Result<boolean, AnalysisError>>;
  execute(input: {
    readonly sessionId: string;
    readonly expectedGeneration: number;
    readonly command: string;
    readonly json: boolean;
    readonly signal?: AbortSignal;
  }): Promise<CutterBridgeExecution>;
}

/** Shared Cutter bridge workflows used by the MCP adapter and CLI. */
export class CutterBridgeService {
  #cleanupAttempt: Promise<Result<null, AnalysisError>> | undefined;
  readonly #pendingCleanup = new Map<
    string,
    {
      readonly sessionId: string;
      readonly completionToken?: string;
      readonly failure: AnalysisOutputError;
    }
  >();

  constructor(readonly client: CutterBridgePort = new CutterBridgeClient()) {}

  /** Release timed-out work only after producer-owned terminal proof. */
  retryCleanup(): Promise<Result<null, AnalysisError>> {
    if (this.#cleanupAttempt !== undefined) return this.#cleanupAttempt;
    const attempt = this.#retryPendingCleanup().finally(() => {
      if (this.#cleanupAttempt === attempt) this.#cleanupAttempt = undefined;
    });
    this.#cleanupAttempt = attempt;
    return attempt;
  }

  async #retryPendingCleanup(): Promise<Result<null, AnalysisError>> {
    for (const [requestId, pending] of this.#pendingCleanup) {
      const confirmCommandCompletion = this.client.confirmCommandCompletion;
      if (confirmCommandCompletion === undefined) return err(pending.failure);
      const receipt = await confirmCommandCompletion.call(
        this.client,
        pending.sessionId,
        requestId,
        pending.completionToken,
      );
      if (!receipt.ok)
        return err(
          analysisErrorWithCleanupFailure(
            pending.failure,
            receipt.error,
            "cutter_command",
          ).bindCleanupDependencies([pending.failure, receipt.error]),
        );
      if (!receipt.value) return err(pending.failure);
      const { failure } = pending;
      failure.resolveCleanup();
      this.#pendingCleanup.delete(requestId);
    }
    return ok(null);
  }

  async listSessions(
    options: CutterDiscoveryOptions = {},
  ): Promise<Result<CutterBridgeDiscovery, AnalysisError>> {
    const { signal } = options;
    if (signal?.aborted)
      return err(
        new AnalysisCancelledError("list_cutter_sessions", {
          cause: signal.reason,
        }),
      );
    try {
      const discovery = await this.client.listSessions(options);
      if (signal?.aborted)
        return err(
          new AnalysisCancelledError("list_cutter_sessions", {
            cause: signal.reason,
          }),
        );
      return ok(discovery);
    } catch (cause) {
      if (cause instanceof AnalysisError) return err(cause);
      return err(
        new AnalysisCapabilityUnavailableError(
          "cutter",
          "list_cutter_sessions",
          cause instanceof Error ? cause.message : "Cutter discovery failed",
          { cause },
        ),
      );
    }
  }

  async close(): Promise<void> {
    const pending = await this.retryCleanup();
    try {
      if (pending.ok) await this.client.close?.();
      else await this.client.retryDescriptorCleanup?.();
    } catch (cause: unknown) {
      const failure =
        cause instanceof AnalysisError
          ? cause
          : new ProviderCleanupError(
              "cutter",
              [],
              {
                reason: cause instanceof Error ? cause.message : String(cause),
              },
              { cause },
            );
      throw pending.ok
        ? failure
        : analysisErrorWithCleanupFailure(
            pending.error,
            failure,
            "close_cutter",
          ).bindCleanupDependencies([pending.error, failure]);
    }
    if (!pending.ok) throw pending.error;
  }

  async execute(
    rawInput: unknown,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<Result<Evidence, AnalysisError>> {
    const parsed = cutterCommandInputSchema.safeParse(rawInput);
    if (!parsed.success) return err(new AnalysisInputError("cutter_command"));
    if (options.signal?.aborted)
      return err(
        new AnalysisCancelledError("cutter_command", {
          cause: options.signal.reason,
        }),
      );
    const input = parsed.data;
    const cleanup = await this.retryCleanup();
    if (!cleanup.ok) return err(cleanup.error);
    try {
      const output = await this.client.execute({
        sessionId: input.session_id,
        expectedGeneration: input.expected_generation,
        command: input.command,
        json: input.json,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      const normalizedOutput = jsonValueSchema.parse(output.output);
      const evidence = createEvidence(
        undefined,
        {
          ...CUTTER_PROVIDER_IDENTITY,
          version: output.cutterVersion,
        },
        {
          predicateType: "rea.cutter.command-observation",
          operation: "cutter_command",
          parameters: {
            session_id: input.session_id,
            expected_generation: input.expected_generation,
            command: input.command,
            json: input.json,
          },
          result: {
            command: input.command,
            output: normalizedOutput,
            execution_state: output.executionState,
            error: output.error,
            message: output.message,
            output_truncated: output.outputTruncated,
            cutter_version: output.cutterVersion,
            current_file: output.currentFile,
            document_generation: output.documentGeneration,
            identity_status: output.identityStatus,
          },
          rawResult: normalizedOutput,
          subjectUnavailableReason:
            "Cutter exposes no verified stable identity for the active unsaved document or tab.",
          limitations: [
            "Document identity is partial: the bridge uses a plugin instance UUID and observed generation; a same-path tab switch or reload may not be distinguishable.",
            "Cutter command effects depend on the Rizin command and active plugins.",
            "The local IPC protocol is implemented by REA and is not an upstream Cutter API.",
            ...(output.executionState === "unknown"
              ? [
                  "Command completion or its output could not be confirmed; do not retry automatically because the command may have produced partial or persistent effects.",
                ]
              : []),
            ...(output.outputTruncated
              ? [
                  "The command completed or may have completed, but output exceeded the bridge transport limit and was omitted.",
                ]
              : []),
          ],
        },
      );
      if (output.executionState === "unknown") {
        const failure = new AnalysisOutputError(
          "cutter_command",
          "Cutter command completion is unknown; the bound binary remains unavailable until the UI dispatcher confirms this request reached a terminal state.",
          {
            cleanup: {
              reason:
                "The exact UI dispatcher completion receipt has not arrived; the dispatched command may still be running.",
              resources: [`cutter-session:${input.session_id}`],
            },
            partialObservation: evidence,
          },
        );
        this.#pendingCleanup.set(output.requestId, {
          sessionId: input.session_id,
          ...(output.completionToken === undefined
            ? {}
            : { completionToken: output.completionToken }),
          failure,
        });
        return err(failure);
      }
      if (options.signal?.aborted)
        return err(
          new AnalysisCancelledError("cutter_command", {
            cause: options.signal.reason,
            partialObservation: evidence,
          }),
        );
      return ok(evidence);
    } catch (cause) {
      if (cause instanceof AnalysisError) return err(cause);
      return err(
        new AnalysisCapabilityUnavailableError(
          "cutter",
          "cutter_command",
          cause instanceof Error
            ? cause.message
            : "Unknown Cutter bridge failure",
          { cause },
        ),
      );
    }
  }
}
