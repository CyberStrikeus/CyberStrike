import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import type { WebSourceMapPort } from "../../application/WebSourceLocationPorts.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import { err, type Result } from "../../domain/result.js";
import { noRuntimeOverrideSentence } from "../../domain/browserDeadline.js";
import {
  DEFAULT_WEB_SOURCE_MAP_DECODE_TIMEOUT_MS,
  WEB_SOURCE_MAP_LIMITS,
  type WebSourceMapReport,
} from "../../domain/webSourceLocation.js";
import { sourceMapCodecInputSchema } from "./SourceMapCodecProtocol.js";
import {
  runSourceMapCommand,
  type SourceMapCleanupOwner,
  type SourceMapCleanupRetention,
  type SourceMapDecoderDependencies,
} from "./SourceMapCommand.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { jsonParts } from "../../domain/jsonSerialization.js";
const OPERATION = "trace_web_source_location";

/** Integrate the pinned upstream codec through an independently bounded owned process. */
export class SourceMapDecoder implements WebSourceMapPort {
  #tail: Promise<void> = Promise.resolve();
  #closing = false;
  #closePromise: Promise<void> | undefined;
  #pendingCleanup: SourceMapCleanupOwner | undefined;

  constructor(readonly dependencies: SourceMapDecoderDependencies = {}) {}
  /** Return complete point evidence after process and private-root cleanup. */
  trace(
    input: Parameters<WebSourceMapPort["trace"]>[0],
    options?: ExecutionOptions,
  ): Promise<Result<WebSourceMapReport, AnalysisError>> {
    if (this.#closing)
      return Promise.resolve(
        err(
          new ProviderCleanupError(
            "source-map-decoder",
            [],
            { reason: "Provider is closing" },
            { operation: OPERATION },
          ),
        ),
      );
    const operation = this.#tail.then(() =>
      this.#closing
        ? err(
            new ProviderCleanupError(
              "source-map-decoder",
              [],
              { reason: "Provider is closing" },
              { operation: OPERATION },
            ),
          )
        : this.#trace(input, options),
    );
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #trace(
    input: Parameters<WebSourceMapPort["trace"]>[0],
    options?: ExecutionOptions,
  ): Promise<Result<WebSourceMapReport, AnalysisError>> {
    const cleanupFailure = await this.#retryCleanup();
    if (cleanupFailure !== undefined) return err(cleanupFailure);
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError(OPERATION, { cause: options.signal.reason }),
      );
    const request = sourceMapCodecInputSchema.safeParse({
      text: input.text,
      url: input.url,
      position: input.position,
    });
    if (!request.success)
      return err(new AnalysisInputError(OPERATION, { cause: request.error }));
    const capacityFailure = () =>
      new ArtifactOperationError(
        OPERATION,
        "limit",
        undefined,
        `${input.path}: Source-map input exceeds the ${String(WEB_SOURCE_MAP_LIMITS.mapBytes)}-byte map or ${String(WEB_SOURCE_MAP_LIMITS.outputBytes)}-byte encoded request budget. ${noRuntimeOverrideSentence("Those budgets stay fixed.", "decode_timeout_ms")}`,
      );
    if (Buffer.byteLength(input.text) > WEB_SOURCE_MAP_LIMITS.mapBytes)
      return err(capacityFailure());
    const encoded: string[] = [];
    let encodedBytes = 0;
    for (const part of jsonParts(request.data)) {
      const bytes = Buffer.byteLength(part);
      if (bytes > WEB_SOURCE_MAP_LIMITS.outputBytes - encodedBytes)
        return err(capacityFailure());
      encoded.push(part);
      encodedBytes += bytes;
    }
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError(OPERATION, { cause: options.signal.reason }),
      );
    const serialized = encoded.join("");
    const retainedCleanup: SourceMapCleanupRetention = {};
    const response = await runSourceMapCommand(
      serialized,
      input.path,
      options,
      this.dependencies,
      retainedCleanup,
      input.decodeTimeoutMs ?? DEFAULT_WEB_SOURCE_MAP_DECODE_TIMEOUT_MS,
    );
    if (retainedCleanup.owner !== undefined)
      this.#pendingCleanup = retainedCleanup.owner;
    return response;
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#closePromise ??= this.#tail
      .then(async () => {
        const failure = await this.#retryCleanup();
        if (failure !== undefined) throw failure;
      })
      .catch((cause: unknown) => {
        this.#closePromise = undefined;
        throw cause;
      });
    return this.#closePromise;
  }

  async #retryCleanup(): Promise<AnalysisError | undefined> {
    const pending = this.#pendingCleanup;
    if (pending === undefined) return undefined;
    const failure = await pending.close();
    if (failure !== undefined) return failure;
    this.#pendingCleanup = undefined;
    return undefined;
  }
}
