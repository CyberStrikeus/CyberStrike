import type { AppConfig } from "../config/types.js";
import { z } from "zod";
import { ABORTED, waitForAbortable } from "../process/AbortablePromise.js";
import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisOperation,
  type ExecutionOptions,
} from "../application/AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisProtocolError,
  AnalysisOutputError,
  AnalysisInputError,
  AnalysisTimeoutError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { AnalysisProfileCommitment } from "../domain/analysisProfile.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import type { IdaConfiguration } from "./IdaConfiguration.js";
import { idaCompatibilityProfile } from "./IdaConfiguration.js";
import { createIdaDiagnosticRedactor } from "./IdaDiagnosticRedactor.js";
import type { IdaMcpConnection } from "./IdaMcpConnection.js";
import { nativeTools } from "./IdaNativeProtocol.js";
import { readSettledHealth } from "./IdaBusyHealth.js";
import { isX86OnlyTarget } from "./IdaCallGraph.js";
import { IdaOperationRunner } from "./IdaOperationRunner.js";
import {
  IDA_LIMITATIONS,
  IDA_OPERATIONS,
  IDA_PROVIDER_IDENTITY,
  idaOperationUnavailableReason,
  type IdaOperation,
} from "./IdaProviderCapabilities.js";
import {
  absentDatabaseCloseSchema,
  closeDatabaseSchema,
  databaseListSchema,
  legacyMetadataSchema,
  modernHealthSchema,
  openDatabaseSchema,
  rejectedOpenDatabaseSchema,
} from "./IdaProtocolValues.js";
import {
  idaFileDigest,
  IdaWorkspace,
  sameIdaHostPath,
} from "./IdaWorkspace.js";
import { parseIdaInput } from "./IdaInput.js";
import { createEvidence } from "../domain/evidence.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  artifactFilePrimaryFacts,
  artifactFileCancellationCause,
  bindArtifactFileCleanup,
} from "../artifacts/ArtifactFileOperation.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import {
  analysisClientFailureContext,
  analysisClientFailureForOperation,
} from "../providers/AnalysisClientFailure.js";

const legacyTools = [
  "get_metadata",
  "list_functions",
  "list_strings",
  "get_function_by_name",
  "get_function_by_address",
  "decompile_function",
  "disassemble_function",
  "get_callers",
  "get_callees",
  "get_xrefs_to",
];
const modernTools = [
  "idb_open",
  "idb_list",
  "idb_close",
  "server_health",
  "list_funcs",
  "lookup_funcs",
  "find_regex",
  "decompile",
  "disasm",
  "callees",
  "xrefs_to",
];
const operationSet: ReadonlySet<string> = new Set(IDA_OPERATIONS);

const isIdaOperation = (operation: string): operation is IdaOperation =>
  operationSet.has(operation);
const wasCancelled = (options: ExecutionOptions | undefined): boolean =>
  options?.signal?.aborted === true;

interface IdaOperationFailureContext {
  runner: IdaOperationRunner | undefined;
  metadataBefore: JsonValue | undefined;
  metadataAfter: JsonValue | undefined;
  postOperationIdentityCheck: "not_attempted" | "started" | "verified";
  parameters: Readonly<Record<string, JsonValue>>;
}

/** Upstream session ids of inventory entries, omitting unreported ones. */
interface UpstreamSession {
  readonly session_id: string;
  readonly backend: "worker" | "gui";
  /** Upstream ownership; null when no inventory has reported it. */
  readonly owned: boolean | null;
  /** Last inventoried input binding; null until upstream reports it. */
  readonly input_path: string | null;
  /** Last inventoried activity; null before upstream reports it. */
  readonly is_active: boolean | null;
}

/** A failed cleanup retains its private workspace and reports the remaining resource. */
class IdaCleanupError extends ProviderAdapterError {
  constructor(
    path: string,
    cause: unknown,
    sessions?: readonly UpstreamSession[],
  ) {
    super("ida", "close", {
      cause,
      cleanup: {
        reason:
          "IDA connection or private workspace cleanup remains unverified.",
        resources: [path],
      },
      capturedOutput:
        cause instanceof AnalysisError ? cause.capturedOutput : undefined,
      diagnostics: {
        ...(cause instanceof AnalysisError ? cause.diagnostics : undefined),
        reason:
          "IDA cleanup could not be verified; the remaining connection or private workspace is retained for retry.",
        failure_reason:
          cause instanceof AnalysisError
            ? (cause.diagnostics?.reason ?? cause.message)
            : cause instanceof Error
              ? cause.message
              : String(cause),
        workspace: path,
        ...(sessions === undefined
          ? {}
          : {
              upstream_sessions: {
                state: "unverified",
                sessions: sessions.map(
                  ({ session_id, backend, owned, input_path, is_active }) => ({
                    session_id,
                    backend,
                    owned,
                    input_path,
                    is_active,
                  }),
                ),
                reason:
                  "Release of upstream sessions matching the requested session ID or private input was not confirmed; input_path preserves the last observed binding and is null when no inventory has reported it. is_active preserves registry activity and is null when unknown; it does not establish process liveness. A worker outlives its supervisor and may keep running until it finishes and reaches its idle timeout; exiting REA does not stop it. A gui session belongs to an IDA instance REA does not control. An empty session_id means upstream reported none; owned is null when no inventory has reported ownership; an empty list means the requested worker's close was confirmed but no inventory has identified any remaining session.",
              },
            }),
      },
    });
  }
}

/**
 * A worker that is still tearing down can remain in inventory with its identity
 * already cleared: an empty `session_id`, `owned: false` and `is_active: false`,
 * while `input_path` still names the private copy. Such a row establishes no
 * live session, so the private-input arm must not report it as a blocker. The
 * owning worker is matched by its own session ID separately, and a genuine peer
 * on the same input keeps a session ID, so neither case is weakened.
 *
 * Limited to `backend: "worker"`: a gui row belongs to an IDA instance REA does
 * not control, and the observed teardown shape covers workers only, so a gui
 * row keeps blocking release whatever its flags say.
 */
const isReleasedWorkerRow = (entry: {
  readonly session_id: string;
  readonly owned: boolean;
  readonly is_active: boolean;
  readonly backend: "worker" | "gui";
}): boolean =>
  entry.backend === "worker" &&
  entry.session_id === "" &&
  entry.owned === false &&
  entry.is_active === false;

/** Format-owner facts for a refused database/target binding, before any operation replies exist. */
class IdaIdentityRefusal extends AnalysisProtocolError {
  constructor(
    readonly reason: string,
    readonly recovery: string,
    check: string,
  ) {
    super(reason, { diagnostics: { identity_check: check, reason, recovery } });
  }
}

/** Serial read-only session whose lifecycle authority excludes an attached GUI. */
export class IdaSessionClient implements AnalysisClient {
  #tail: Promise<void> = Promise.resolve();
  #startup: Promise<void> | undefined;
  #closed = false;
  #closing = false;
  #closePromise: Promise<Result<null, AnalysisError>> | undefined;
  #closeFailures: WeakRef<IdaCleanupError>[] = [];
  #workspace: IdaWorkspace | undefined;
  #database: string | undefined;
  #databaseCloseCompleted = false;
  #openAttempted = false;
  #openCompleted = false;
  #ready = false;
  #blockingSessions: readonly UpstreamSession[] | undefined;
  #openRejected = false;
  #callGraphAdvertised = false;
  #surveyAdvertised = false;
  #initialIdentity: string | undefined;
  #metadata: JsonValue = null;
  #lifecycle: JsonValue[] = [];

  constructor(
    private readonly config: IdaConfiguration,
    private readonly target: BinaryTarget,
    private readonly connection: IdaMcpConnection,
    private readonly profile?: AnalysisProfileCommitment,
    private readonly regexSettings?: Pick<
      AppConfig,
      "regexMatchingDeadline" | "regexWorkerHeapRequest"
    >,
  ) {}

  execute(
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
  ) {
    const call = this.#tail.then(() =>
      this.#execute(operation, parameters, options),
    );
    this.#tail = call.then(
      () => undefined,
      () => undefined,
    );
    return call;
  }

  async executeIfReady(
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
  ) {
    if (!this.#ready || this.#closed || this.#closing)
      return Promise.resolve(undefined);
    const call = this.#tail.then(() => {
      if (!this.#ready || this.#closed || this.#closing) return undefined;
      if (wasCancelled(options))
        return err(
          new AnalysisCancelledError(operation, {
            cause: options?.signal?.reason,
          }),
        );
      return this.#execute(operation, parameters, options, true);
    });
    this.#tail = call.then(
      () => undefined,
      () => undefined,
    );
    const result = await waitForAbortable(call, options?.signal);
    return result === ABORTED
      ? err(
          new AnalysisCancelledError(operation, {
            cause: options?.signal?.reason,
          }),
        )
      : result;
  }

  async #execute(
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
    readyOnly = false,
  ) {
    if (this.#closed || this.#closing)
      return err(
        new AnalysisProtocolError(
          "IDA session is closing or closed; reopen the target.",
        ),
      );
    if (wasCancelled(options))
      return err(
        new AnalysisCancelledError(operation, {
          cause: options?.signal?.reason,
        }),
      );
    if (operation !== "health" && !isIdaOperation(operation))
      return err(
        new AnalysisCapabilityUnavailableError(
          "ida",
          operation,
          "This integration admits read-only analysis operations only.",
        ),
      );
    const unavailableReason =
      operation === "health"
        ? undefined
        : idaOperationUnavailableReason(
            operation,
            idaCompatibilityProfile(this.config),
          );
    if (unavailableReason !== undefined)
      return err(
        new AnalysisCapabilityUnavailableError(
          "ida",
          operation,
          unavailableReason,
        ),
      );
    if (operation !== "health") {
      const parsed = parseIdaInput(operation, parameters);
      if (!parsed.ok) return parsed;
      parameters = parsed.value;
    }
    const document = parameters.document;
    if (
      document !== undefined &&
      (typeof document !== "string" ||
        (!sameIdaHostPath(document, this.target.path) &&
          (this.target.sourcePath === undefined ||
            !sameIdaHostPath(document, this.target.sourcePath))))
    )
      return err(
        new AnalysisInputError(operation, undefined, [
          {
            path: ["document"],
            reason: "invalid_value",
            expected: this.target.path,
            message:
              "IDA document must be the REA-bound target; omit document or use its admitted path.",
          },
        ]),
      );
    const failureContext: IdaOperationFailureContext = {
      runner: undefined,
      metadataBefore: undefined,
      metadataAfter: undefined,
      postOperationIdentityCheck: "not_attempted",
      parameters,
    };
    try {
      if (!readyOnly) await this.#start(operation);
      const before = await this.#observe(options);
      failureContext.metadataBefore = before;
      if (wasCancelled(options))
        throw new AnalysisCancelledError(operation, {
          cause: options?.signal?.reason,
        });
      if (operation === "health") return this.#health(before);
      if (!isIdaOperation(operation))
        throw new AnalysisProtocolError(
          "IDA operation changed after validation.",
        );
      const runner = this.#runner(options);
      failureContext.runner = runner;
      const result = await runner.run(operation, parameters);
      if (wasCancelled(options))
        throw new AnalysisCancelledError(operation, {
          cause: options?.signal?.reason,
        });
      failureContext.postOperationIdentityCheck = "started";
      const after = await this.#observe(
        options,
        (observed) => (failureContext.metadataAfter = observed),
      );
      failureContext.postOperationIdentityCheck = "verified";
      if (wasCancelled(options))
        throw new AnalysisCancelledError(operation, {
          cause: options?.signal?.reason,
        });
      return ok(
        createAnalysisExecution(result, IDA_PROVIDER_IDENTITY, {
          rawResult: {
            upstream: this.connection.serverInfo(),
            metadata_before: before,
            metadata_after: after,
            observations: jsonValueSchema.parse(runner.raw),
          },
          limitations: [...IDA_LIMITATIONS, ...runner.limitations],
          ...(runner.relationshipCoverage === undefined
            ? {}
            : { relationshipCoverage: runner.relationshipCoverage }),
          ...(runner.referencesTruncated !== undefined
            ? { referencesTruncated: runner.referencesTruncated }
            : {}),
          locations: [
            { kind: "artifact-path", path: this.target.path },
            ...runner.locations,
          ],
          ...(this.profile === undefined
            ? {}
            : { analysisProfile: this.profile }),
        }),
      );
    } catch (cause: unknown) {
      return this.#failure(operation, cause, options, failureContext);
    }
  }

  #runner(options: ExecutionOptions | undefined): IdaOperationRunner {
    return new IdaOperationRunner(
      this.connection,
      idaCompatibilityProfile(this.config).protocol,
      this.#database,
      {
        regexMatchingDeadline: this.regexSettings?.regexMatchingDeadline,
        regexWorkerHeapRequest: this.regexSettings?.regexWorkerHeapRequest,
        signal: options?.signal,
        selectorOrigin: options?.selectorOrigin,
        x86Only: isX86OnlyTarget(this.target),
        callGraphAvailable: this.#callGraphAdvertised,
        surveyAvailable: this.#surveyAdvertised,
        admittedDocument: this.target.path,
      },
    );
  }

  #health(metadata: JsonValue) {
    return ok(
      createAnalysisExecution(
        {
          ready: true,
          mode: this.config.mode,
          database: this.#database ?? null,
          upstream: this.connection.serverInfo(),
          metadata,
          lifecycle: this.#lifecycle,
        },
        IDA_PROVIDER_IDENTITY,
        {
          limitations: IDA_LIMITATIONS,
          ...(this.profile === undefined
            ? {}
            : { analysisProfile: this.profile }),
        },
      ),
    );
  }

  #failure(
    operation: string,
    cause: unknown,
    options: ExecutionOptions | undefined,
    context: IdaOperationFailureContext,
  ) {
    const artifactFailure =
      cause instanceof ArtifactReaderFailure ? cause : undefined;
    // The validated registration owns the exact endpoint spelling. Apply the
    // same credential exclusions used for upstream transport diagnostics.
    const endpoint =
      artifactFailure === undefined && "url" in this.config
        ? {
            endpoint: createIdaDiagnosticRedactor(this.config).url(
              this.config.url,
            ),
          }
        : {};
    if (artifactFailure !== undefined)
      cause = artifactFilePrimaryFacts(artifactFailure).cause;
    let failure: AnalysisError;
    if (cause instanceof IdaIdentityRefusal) {
      failure = new AnalysisOutputError(operation, cause.reason, {
        cause,
        userMessage: cause.reason,
        remediationAction: cause.recovery,
        diagnostics: cause.diagnostics,
      });
    } else if (artifactFailure?.reason === "cancelled") {
      failure = new AnalysisCancelledError(operation, {
        cause: artifactFileCancellationCause(artifactFailure),
      });
    } else if (cause instanceof AnalysisCancelledError) {
      failure = new AnalysisCancelledError(operation, {
        cause:
          cause.cause === undefined ? options?.signal?.reason : cause.cause,
        capturedOutput: cause.capturedOutput,
        diagnostics: { ...cause.diagnostics, ...endpoint },
        partialObservation: cause.partialObservation,
        cleanup:
          cause.cleanup ??
          (cause.cleanupIncomplete
            ? { reason: cause.message, resources: cause.cleanupResources }
            : undefined),
      })
        .bindCleanupDependencies([cause])
        .bindCleanupResourceOwner(cause);
    } else if (
      (cause instanceof AnalysisTimeoutError ||
        cause instanceof AnalysisResourceConstraintError) &&
      cause.operation === operation &&
      cause.diagnostics?.startup_operation !== undefined
    ) {
      // #start has already attributed this failure and its endpoint; wrapping
      // it again would replace the original producer cause with an intermediate.
      failure = cause;
    } else if (
      cause instanceof AnalysisTimeoutError ||
      cause instanceof AnalysisResourceConstraintError
    ) {
      failure = analysisClientFailureForOperation(
        cause,
        "ida",
        operation,
        endpoint,
      ).bindCleanupResourceOwner(cause);
    } else if (
      cause instanceof ProviderAdapterError &&
      cause.operation === "transport"
    )
      failure = analysisClientFailureForOperation(cause, "ida", operation, {
        ...endpoint,
        recovery:
          "Check the configured upstream MCP registration and selected target; see docs/ida-provider.md.",
      }).bindCleanupResourceOwner(cause);
    else if (cause instanceof AnalysisProtocolError && "endpoint" in endpoint)
      failure = new AnalysisProtocolError(cause.message, {
        ...analysisClientFailureContext(cause, "ida", operation),
        diagnostics: { ...cause.diagnostics, ...endpoint },
      }).bindCleanupResourceOwner(cause);
    else if (cause instanceof AnalysisError) failure = cause;
    else if (cause instanceof z.ZodError)
      failure = new AnalysisOutputError(
        operation,
        `IDA MCP returned malformed or unsupported producer data: ${cause.issues.map((issue) => `${issue.path.join(".") || "$"}: ${issue.message}`).join("; ")}`,
        { cause },
      );
    else
      failure = new ProviderAdapterError("ida", operation, {
        cause,
        diagnostics: {
          ...endpoint,
          reason:
            cause instanceof Error ? cause.message : "Unknown upstream failure",
          recovery:
            "Check the configured upstream MCP registration and selected target; see docs/ida-provider.md.",
        },
      });
    if (artifactFailure?.cleanup !== undefined) {
      const cleanup = new ProviderCleanupError(
        "ida",
        artifactFailure.cleanup.resources,
        { reason: artifactFailure.cleanup.reason },
        { operation, cause: artifactFailure },
      );
      bindArtifactFileCleanup(artifactFailure, cleanup);
      failure = analysisErrorWithCleanupFailure(
        failure,
        cleanup,
        operation,
      ).bindCleanupDependencies([cleanup]);
    }
    // Only operation calls made after target identity/readiness validation can
    // become partial Evidence. The failing call itself is absent from `raw`
    // when its transport or MCP envelope could not be decoded.
    const { runner, metadataBefore, metadataAfter } = context;
    if (
      runner !== undefined &&
      runner.raw.length > 0 &&
      metadataBefore !== undefined
    ) {
      const observations = jsonValueSchema.parse(runner.raw);
      const upstream = this.connection.serverInfo();
      const binding =
        context.postOperationIdentityCheck !== "verified"
          ? {
              status: "not_verified",
              reason:
                cause instanceof Error
                  ? cause.message
                  : "Post-operation target identity was not observed.",
            }
          : { status: "verified" };
      failure.retainPartialObservation(
        createEvidence(this.target, IDA_PROVIDER_IDENTITY, {
          predicateType: "analysis-observation",
          operation,
          parameters: context.parameters,
          result: {
            status: "partial",
            failed_operation: operation,
            observations,
            metadata_before: metadataBefore,
            target_binding: binding,
            ...(metadataAfter === undefined
              ? {}
              : { metadata_after: metadataAfter }),
          },
          rawResult: {
            upstream,
            observations,
            metadata_before: metadataBefore,
            ...(metadataAfter === undefined
              ? {}
              : { metadata_after: metadataAfter }),
            post_operation_identity_check: context.postOperationIdentityCheck,
          },
          confidence: "observed",
          authority: "external-service",
          limitations: [
            ...IDA_LIMITATIONS,
            ...runner.limitations,
            "The requested IDA operation failed after these completed upstream replies; the partial Evidence does not establish a complete result.",
            "Replies are bound to the selected target only by the pre-operation identity check unless post_operation_identity_check is verified.",
          ],
          locations: [
            { kind: "artifact-path", path: this.target.path },
            ...runner.locations,
          ],
          ...(this.profile === undefined
            ? {}
            : { analysisProfile: this.profile }),
        }),
      );
    }
    return err(failure);
  }

  async #start(operation: string): Promise<void> {
    this.#startup ??= this.#initialize();
    try {
      await this.#startup;
    } catch (cause: unknown) {
      if (
        !(cause instanceof AnalysisTimeoutError) &&
        !(cause instanceof AnalysisResourceConstraintError) &&
        !(cause instanceof ProviderAdapterError)
      )
        throw cause;
      // Transport adapters already receive caller attribution in #failure.
      if (
        cause instanceof ProviderAdapterError &&
        cause.operation === "transport"
      )
        throw cause;
      // Startup is shared, but each accepted operation owns its attribution.
      // The shared boundary preserves typed outcome and cleanup facts without
      // mutating the cached startup failure.
      throw analysisClientFailureForOperation(cause, "ida", operation, {
        startup_operation: cause.operation,
        ...("url" in this.config
          ? {
              endpoint: createIdaDiagnosticRedactor(this.config).url(
                this.config.url,
              ),
            }
          : {}),
      }).bindCleanupResourceOwner(cause);
    }
  }

  async #initialize(): Promise<void> {
    const tools = new Set(await this.connection.connect());
    this.#callGraphAdvertised = tools.has("callgraph");
    this.#surveyAdvertised = tools.has("survey_binary");
    const profile = idaCompatibilityProfile(this.config);
    const expected = {
      native: nativeTools,
      legacy: legacyTools,
      modern: modernTools,
    }[profile.protocol];
    const missing = expected.filter((name) => !tools.has(name));
    if (missing.length > 0) {
      const summary = `IDA MCP ${profile.diagnosticLabel} compatibility profile is missing tools: ${missing.join(", ")}. Native attached mode requires the native IDA MCP tool catalog; legacy attached mode requires the legacy 1.4 profile; headless mode requires the database supervisor profile. See docs/ida-provider.md.`;
      // The caller cannot act on a profile mismatch it never sees, so the
      // missing names travel as adapter diagnostics rather than a bare message.
      throw new ProviderAdapterError("ida", "initialize", {
        userMessage: summary,
        diagnostics: {
          reason: summary,
          mode: this.config.mode,
          expected_profile: profile.diagnosticIdentity,
          missing_tools: [...missing],
          recovery:
            "Install an IDA MCP build that serves the selected profile; see docs/ida-provider.md.",
        },
      });
    }
    if (this.config.mode === "headless") {
      this.#workspace = await IdaWorkspace.allocate(
        this.target,
        this.config.workspaceRoot,
      );
      await this.#workspace.copyInput();
      this.#openAttempted = true;
      const raw = await this.connection.call("idb_open", {
        input_path: this.#workspace.inputPath,
        mode: "force_headless",
        run_auto_analysis: true,
        build_caches: true,
        init_hexrays: true,
        preferred_session_id: this.#workspace.sessionId,
      });
      this.#openCompleted = true;
      // A completed but malformed/positive open may still own a live Worker.
      // Only an explicit producer rejection keeps the old no-worker branch.
      this.#openRejected = rejectedOpenDatabaseSchema.safeParse(raw).success;
      this.#lifecycle.push(raw);
      const opened = openDatabaseSchema.parse(raw);
      if (
        !sameIdaHostPath(opened.session.input_path, this.#workspace.inputPath)
      )
        throw new IdaIdentityRefusal(
          "IDA opened a different input than the private admitted target copy.",
          "Check the selected input and upstream worker binding. Retry only after retained private-worker cleanup is confirmed.",
          "opened_input",
        );
      if (opened.session.session_id !== this.#workspace.sessionId)
        throw new IdaIdentityRefusal(
          "IDA returned an adopted or unexpected session instead of the requested private worker.",
          "Use an IDA supervisor that honors the requested private worker session ID. Confirm retained cleanup before reopening the target.",
          "worker_session",
        );
      const inventory = databaseListSchema.parse(
        await this.connection.call("idb_list", {}),
      );
      this.#lifecycle.push(jsonValueSchema.parse(inventory));
      const workspace = this.#workspace;
      this.#recordBlockingSessions(
        inventory.sessions.filter(
          (entry) =>
            entry.session_id === workspace.sessionId ||
            sameIdaHostPath(entry.input_path, workspace.inputPath),
        ),
      );
      const entry = inventory.sessions.find(
        ({ session_id }) => session_id === opened.session.session_id,
      );
      if (
        entry?.owned !== true ||
        entry.backend !== "worker" ||
        entry.is_active !== true ||
        !sameIdaHostPath(entry.input_path, this.#workspace.inputPath)
      )
        throw new IdaIdentityRefusal(
          "IDA did not return an active owned headless worker for the private input copy.",
          "Configure the supervisor to return an active owned worker for the private input. Confirm retained cleanup before reopening the target.",
          "owned_worker_binding",
        );
      this.#database = opened.session.session_id;
    }
    this.#ready = true;
  }

  async #nativeMetadata(signal?: AbortSignal): Promise<JsonValue> {
    if (this.connection.readResource === undefined)
      throw new AnalysisProtocolError(
        "Native IDA MCP requires resources/read for recorded input metadata.",
      );
    return this.connection.readResource("ida://idb/metadata", { signal });
  }

  async #observe(
    options?: ExecutionOptions,
    onObserved?: (metadata: JsonValue) => void,
  ): Promise<JsonValue> {
    let identity: string;
    if (this.config.mode === "attached") {
      const raw =
        idaCompatibilityProfile(this.config).protocol === "native"
          ? await this.#nativeMetadata(options?.signal)
          : await this.connection.call(
              "get_metadata",
              {},
              { signal: options?.signal },
            );
      const metadata = legacyMetadataSchema.parse(raw);
      this.#metadata = raw;
      onObserved?.(raw);
      if (metadata.sha256.toLowerCase() !== this.target.sha256.toLowerCase())
        throw new IdaIdentityRefusal(
          `The attached IDA input SHA-256 does not match the selected target ${this.target.path}; open that target in IDA or use headless mode.`,
          "Open the selected original input in IDA, or configure headless mode and reopen the target through REA.",
          "attached_sha256",
        );
      identity = JSON.stringify([
        metadata.path,
        metadata.sha256.toLowerCase(),
        metadata.base,
      ]);
    } else {
      if (this.#database === undefined || this.#workspace === undefined)
        throw new IdaIdentityRefusal(
          "IDA headless session has no database binding.",
          "Close the REA analysis session and reopen the selected target using the configured headless supervisor.",
          "database_binding",
        );
      const raw = await readSettledHealth(this.connection, {
        database: this.#database,
        timeoutMs: this.config.timeoutMs,
        signal: options?.signal,
      });
      const metadata = modernHealthSchema.parse(raw);
      this.#metadata = raw;
      onObserved?.(raw);
      if (
        !sameIdaHostPath(metadata.input_path, this.#workspace.inputPath) ||
        (await idaFileDigest(this.#workspace.inputPath)) !==
          this.#workspace.inputSha256
      )
        throw new IdaIdentityRefusal(
          "IDA headless input identity changed after target admission.",
          "Close the REA analysis session, confirm private-worker cleanup, then reopen the selected original target.",
          "headless_input",
        );
      if (metadata.auto_analysis_ready !== true)
        throw new AnalysisCapabilityUnavailableError(
          "ida",
          "server_health",
          metadata.auto_analysis_ready === false
            ? "IDA auto-analysis is incomplete."
            : "IDA auto-analysis readiness is unknown.",
          {
            retryable: metadata.auto_analysis_ready === false,
            remediationAction:
              metadata.auto_analysis_ready === false
                ? "Wait for IDA auto-analysis to complete, then retry the request."
                : "Inspect the upstream IDA worker's analysis readiness before retrying; unknown readiness does not establish active analysis.",
            diagnostics: { auto_analysis_ready: metadata.auto_analysis_ready },
          },
        );
      identity = JSON.stringify([
        this.#database,
        metadata.input_path,
        metadata.idb_path,
        metadata.imagebase,
      ]);
    }
    if (
      this.#initialIdentity !== undefined &&
      identity !== this.#initialIdentity
    )
      throw new IdaIdentityRefusal(
        "The IDA target or image base changed during the REA session; reopen the target.",
        "Close the REA analysis session and reopen the selected target after confirming the intended input and image base in IDA.",
        "session_identity",
      );
    this.#initialIdentity = identity;
    return this.#metadata;
  }

  async close(): Promise<Result<null, AnalysisError>> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    const closing = this.#closeOnce();
    const shared = closing.finally(() => {
      if (this.#closePromise === shared) this.#closePromise = undefined;
    });
    this.#closePromise = shared;
    return shared;
  }

  /**
   * Upstream sessions whose release cleanup has not confirmed: the entries
   * the latest successful inventory found blocking release; else the
   * requested private worker until its close is confirmed, and then none
   * known.
   */
  #unreleasedSessions(): readonly UpstreamSession[] | undefined {
    if (this.#blockingSessions !== undefined) return this.#blockingSessions;
    if (
      !this.#openAttempted ||
      this.#workspace === undefined ||
      this.#openRejected
    )
      return undefined;
    return this.#databaseCloseCompleted
      ? []
      : [
          {
            session_id: this.#workspace.sessionId,
            backend: "worker",
            owned: null,
            input_path: null,
            is_active: null,
          },
        ];
  }

  /** Drop a session whose release upstream confirmed, keeping other blockers. */
  #forgetReleasedSession(sessionId: string): void {
    const remaining = this.#blockingSessions?.filter(
      ({ session_id }) => session_id !== sessionId,
    );
    this.#blockingSessions =
      remaining !== undefined && remaining.length > 0 ? remaining : undefined;
  }

  /** Replace blocker evidence from a successful inventory; true when blocked. */
  #recordBlockingSessions(
    entries: readonly (UpstreamSession & { readonly owned: boolean })[],
  ): boolean {
    this.#blockingSessions =
      entries.length > 0
        ? entries.map(
            ({ session_id, backend, owned, input_path, is_active }) => ({
              session_id,
              backend,
              owned,
              input_path,
              is_active,
            }),
          )
        : undefined;
    return entries.length > 0;
  }

  async #closeDatabase(database: string): Promise<void> {
    const response = await this.connection.call("idb_close", {
      database,
      save: false,
    });
    const closed = closeDatabaseSchema.safeParse(response);
    if (!closed.success) {
      if (!absentDatabaseCloseSchema(database).safeParse(response).success)
        throw closed.error;
      return;
    }
    if (
      closed.data.session_id !== database ||
      closed.data.saved === true ||
      closed.data.owned !== true ||
      closed.data.backend !== "worker"
    )
      throw new AnalysisProtocolError(
        "IDA database close did not confirm the requested owned, unsaved session release.",
      );
  }

  async #closeOnce(): Promise<Result<null, AnalysisError>> {
    this.#closing = true;
    await this.#tail;
    if (this.#closed) return ok(null);
    try {
      if (this.#workspace !== undefined && this.#openAttempted) {
        if (this.#database === undefined) {
          const inventory = databaseListSchema.parse(
            await this.connection.call("idb_list", {}),
          );
          const workspace = this.#workspace;
          this.#database = inventory.sessions.find(
            (entry) =>
              entry.owned &&
              entry.backend === "worker" &&
              entry.session_id === workspace.sessionId &&
              sameIdaHostPath(entry.input_path, workspace.inputPath),
          )?.session_id;
          // Every same-input session and any entry under the requested ID,
          // whatever its input, stays reported until a later successful
          // inventory confirms release.
          const blocked = this.#recordBlockingSessions(
            inventory.sessions.filter(
              (entry) =>
                entry.session_id === workspace.sessionId ||
                sameIdaHostPath(entry.input_path, workspace.inputPath),
            ),
          );
          if (this.#database === undefined && blocked)
            throw new AnalysisProtocolError(
              "A registered session still matches the requested ID or private input without a verified private worker binding; the workspace was retained.",
            );
          if (
            this.#database === undefined &&
            this.#openCompleted &&
            !this.#openRejected
          )
            throw new AnalysisProtocolError(
              "IDA open returned without a verified private worker binding. An empty session inventory does not prove that its Worker exited; the private workspace was retained.",
            );
        }
        if (this.#database !== undefined) {
          if (!this.#databaseCloseCompleted) {
            await this.#closeDatabase(this.#database);
            this.#databaseCloseCompleted = true;
            this.#forgetReleasedSession(this.#database);
          }
          const inventory = databaseListSchema.parse(
            await this.connection.call("idb_list", {}),
          );
          const remaining = inventory.sessions.filter(
            (entry) =>
              !isReleasedWorkerRow(entry) &&
              (entry.session_id === this.#database ||
                sameIdaHostPath(
                  entry.input_path,
                  this.#workspace?.inputPath ?? "",
                )),
          );
          if (this.#recordBlockingSessions(remaining))
            throw new AnalysisProtocolError(
              "IDA worker remains registered after close.",
            );
          this.#database = undefined;
        }
        if (!this.#openCompleted)
          throw new AnalysisProtocolError(
            "IDA database open did not return a completed response. Worker inventory cannot prove that the request has stopped; the private workspace was retained.",
          );
        this.#openAttempted = false;
      }
      await this.connection.close();
      await this.#workspace?.remove();
      this.#closed = true;
      for (const failure of this.#closeFailures)
        failure.deref()?.resolveCleanup();
      this.#closeFailures = [];
      return ok(null);
    } catch (cause: unknown) {
      this.connection.detach();
      const path = this.#workspace?.directory ?? "IDA MCP connection";
      const failure = new IdaCleanupError(
        path,
        cause,
        this.#unreleasedSessions(),
      );
      const client = this;
      failure.bindCleanupResourceOwner({
        get cleanupResources() {
          return client.#closed ? [] : [path];
        },
      });
      this.#closeFailures = [
        ...this.#closeFailures.filter(
          (reference) => reference.deref() !== undefined,
        ),
        new WeakRef(failure),
      ];
      return err(failure);
    }
  }
}
