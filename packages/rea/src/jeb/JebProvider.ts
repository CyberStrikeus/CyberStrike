import {
  JebMcpAcquisitionCleanupFailure,
  JebMcpPhysicalFailure,
} from "./JebMcpConnectionOwner.js";
import { createAnalysisExecutionEvidence } from "../domain/analysisObservation.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { z } from "zod";
import type {
  JebAnalysisPort,
  JebAnalysisAvailability,
} from "../application/jeb/JebAnalysisPort.js";
import type {
  AnalysisExecution,
  ExecutionOptions,
  ProviderIdentity,
} from "../application/AnalysisProvider.js";
import { createAnalysisExecution } from "../application/AnalysisProvider.js";
import type { JebOperation, JebRequest } from "../domain/jeb/jebAnalysis.js";
import { jebResultSchemas } from "../domain/jeb/jebAnalysis.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisProtocolError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  parseJebMcpEndpoint,
  DEFAULT_JEB_MCP_ENDPOINT,
} from "../config/jebMcpEndpoint.js";
import {
  createStreamableHttpJebMcpConnection,
  JEB_ENGINE_TOOLS,
  type JebMcpConnection,
  type JebMcpConnectionFactory,
} from "./JebMcpConnection.js";

const JEB_CONNECTION_REMEDIATION = `Start a JEB client serving MCP (default ${DEFAULT_JEB_MCP_ENDPOINT}) or set REA_JEB_MCP_URL to the running endpoint.`;

export const JEB_PROVIDER_IDENTITY: ProviderIdentity = {
  id: "jeb",
  name: "JEB",
  version: null,
} as const;

export interface JebProviderOptions {
  /** Caller environment carrying REA_JEB_MCP_URL. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Per-tools/call budget selected by REA_JEB_MCP_TIMEOUT_MS. */
  readonly requestTimeoutMs?: number;
  /** Catalog discovery budget. Production uses the same REA_JEB_MCP_TIMEOUT_MS value. */
  readonly discoveryTimeoutMs?: number;
  /** Injectable MCP boundary; defaults to the streamable HTTP client. */
  readonly connectionFactory?: JebMcpConnectionFactory;
}

/** Published JEB refusal facts; retain the original JSON alongside parsed facts. */
const failure = z
  .object({
    success: z.literal(false),
    message: z.string().optional(),
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
        recovery_tool: z.string().optional(),
        recovery_required_before_retry: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();
const clientInformation = z
  .object({
    success: z.literal(true),
    version: z.string().optional(),
    gui_client: z.boolean().optional(),
    startup_ts: z.int().nonnegative().optional(),
    message: z.string().nullish(),
  })
  .passthrough();
const unitEntry = z.object({ unit_path: z.string(), unit_type: z.string() });
const openProject = z
  .object({
    success: z.literal(true),
    name: z.string().nullish(),
    creation_datetime: z.string().nullish(),
    input_files: z.array(
      z.object({
        file_name: z.string(),
        file_size: z.int().nonnegative(),
        contents_sha256_hash: z.string(),
      }),
    ),
    units: z.array(unitEntry),
  })
  .passthrough();
const listUnits = z
  .object({ success: z.literal(true), units: z.array(unitEntry) })
  .passthrough();
const decompiledItem = z
  .object({ success: z.literal(true), text: z.string() })
  .passthrough();

const envelope = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true) }).passthrough(),
  failure,
]);

/** Parse success/refusal once; operation-specific success data has its own owner. */
const parseJebEnvelope = (
  payload: JsonValue,
  operation: JebOperation,
  endpoint: string,
  input?: Readonly<Record<string, JsonValue | undefined>>,
): Result<JsonValue, AnalysisError> => {
  const diagnostics = {
    endpoint,
    upstream_response: payload,
    ...(input === undefined
      ? {}
      : {
          // Typed optional request fields can carry undefined; JSON omission is
          // established here before these selected inputs become diagnostics.
          input: Object.fromEntries(
            Object.entries(input).filter(
              (entry): entry is [string, JsonValue] => entry[1] !== undefined,
            ),
          ),
        }),
  };
  const parsed = envelope.safeParse(payload);
  if (!parsed.success)
    return err(
      new AnalysisProtocolError(
        "JEB MCP omitted or malformed its observation envelope",
        { cause: parsed.error, diagnostics },
      ),
    );
  if (parsed.data.success) return ok(payload);
  const refusal = parsed.data;
  const reason = [
    refusal.error?.message,
    refusal.message,
    refusal.error?.code,
  ].find((value) => value !== undefined && value.trim().length > 0);
  return err(
    new ProviderAdapterError("jeb", operation, {
      userMessage: reason ?? "The engine refused the request",
      diagnostics,
    }),
  );
};

/** Serve REA's JEB operations from a running engine client over MCP. */
export class JebProvider implements JebAnalysisPort {
  readonly #connection: JebMcpConnection;
  readonly #endpoint: URL;
  /** Caller-selected spelling, retained only after endpoint admission succeeds. */
  readonly #selectedEndpoint: string;
  #clientInformation:
    | Pick<z.infer<typeof clientInformation>, "version" | "gui_client">
    | undefined;

  #identity(version: string | null | undefined): ProviderIdentity {
    return {
      ...JEB_PROVIDER_IDENTITY,
      version: version ?? null,
    };
  }

  constructor(options: JebProviderOptions = {}) {
    const environment = options.environment ?? {};
    const endpoint = parseJebMcpEndpoint(environment.REA_JEB_MCP_URL);
    if (!endpoint.ok) throw endpoint.error;
    this.#endpoint = endpoint.value;
    this.#selectedEndpoint =
      environment.REA_JEB_MCP_URL || DEFAULT_JEB_MCP_ENDPOINT;
    const createConnection =
      options.connectionFactory ?? createStreamableHttpJebMcpConnection;
    const timeouts = {
      ...(options.discoveryTimeoutMs === undefined
        ? {}
        : { discoveryTimeoutMs: options.discoveryTimeoutMs }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
    };
    this.#connection =
      Object.keys(timeouts).length === 0
        ? createConnection(this.#endpoint)
        : createConnection(this.#endpoint, timeouts);
  }

  async inspectAvailability(
    signal?: AbortSignal,
  ): Promise<JebAnalysisAvailability> {
    try {
      const tools = new Set(await this.#connection.listTools(signal));
      const { information } = await this.#refreshClientInformation(
        "inspect_jeb_client",
        signal,
      );
      return {
        status: "available",
        code: null,
        reason: null,
        supportedOperations: (
          Object.keys(JEB_ENGINE_TOOLS) as JebOperation[]
        ).filter((operation) => tools.has(JEB_ENGINE_TOOLS[operation])),
        diagnostics: {
          endpoint: this.#selectedEndpoint,
          engine_version: information.version ?? null,
        },
      };
    } catch (cause) {
      if (signal?.aborted === true) throw cause;
      if (cause instanceof AnalysisError) {
        const projected = projectAnalysisError(cause);
        return {
          status: "unavailable",
          code: "runtime_unavailable",
          reason: projected.message,
          diagnostics: {
            ...cause.diagnostics,
            endpoint: this.#selectedEndpoint,
          },
        };
      }
      return {
        status: "unavailable",
        code: "not_configured",
        reason: `${cause instanceof Error ? cause.message : "The JEB MCP endpoint did not respond"}. ${JEB_CONNECTION_REMEDIATION}`,
        diagnostics: { endpoint: this.#selectedEndpoint },
      };
    }
  }

  async close(): Promise<void> {
    await this.#connection.close();
  }

  async execute(
    request: JebRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    if (options?.signal?.aborted === true)
      return err(
        new AnalysisCancelledError(request.operation, {
          cause: options.signal.reason,
          diagnostics: { endpoint: this.#selectedEndpoint },
        }),
      );
    try {
      const execution = await this.#dispatch(request, options?.signal);
      return execution;
    } catch (cause) {
      return err(this.#providerFailure(request.operation, cause));
    }
  }

  async #dispatch(
    request: JebRequest,
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const cancelled = (operation: JebOperation) => {
      if (signal?.aborted === true)
        throw new AnalysisCancelledError(operation, { cause: signal.reason });
    };
    switch (request.operation) {
      case "inspect_jeb_client": {
        cancelled(request.operation);
        return this.#inspectClient(signal);
      }
      case "open_jeb_project": {
        cancelled(request.operation);
        return this.#openProject(request, signal);
      }
      case "list_jeb_units": {
        cancelled(request.operation);
        return this.#listUnits(request, signal);
      }
      case "decompile_jeb_item": {
        cancelled(request.operation);
        return this.#decompileItem(request, signal);
      }
    }
  }

  async #engine(
    operation: JebOperation,
    signal?: AbortSignal,
  ): Promise<{
    readonly name: string;
    readonly version: string | null;
    readonly endpoint: string;
    readonly gui_client: boolean | null;
  }> {
    const information =
      this.#clientInformation ??
      (await this.#refreshClientInformation(operation, signal)).information;
    return {
      name: "jeb",
      version: information.version ?? null,
      endpoint: this.#selectedEndpoint,
      gui_client: information.gui_client ?? null,
    };
  }

  async #engineForObservation(
    request: JebRequest,
    payload: JsonValue,
    observation: unknown,
    signal?: AbortSignal,
  ) {
    try {
      return await this.#engine(request.operation, signal);
    } catch (cause: unknown) {
      throw this.#providerFailure(
        request.operation,
        cause,
      ).retainPartialObservation(
        createAnalysisExecutionEvidence(
          request.operation,
          request.input,
          createAnalysisExecution(
            {
              status: "partial",
              observation: jsonValueSchema.parse(observation),
              engine_metadata: null,
            },
            JEB_PROVIDER_IDENTITY,
            {
              rawResult: payload,
              limitations: [
                "The primary engine reply completed; client metadata was not obtained, so the full operation result could not be assembled.",
              ],
            },
          ),
          "observed",
        ),
      );
    }
  }

  async #refreshClientInformation(
    operation: JebOperation,
    signal: AbortSignal | undefined,
  ) {
    if (signal?.aborted === true)
      throw new AnalysisCancelledError(operation, { cause: signal.reason });
    const payload = await this.#connection.call(
      "get_client_information",
      {},
      signal,
    );
    const information = clientInformation.parse(
      this.#requireSuccess(
        payload,
        operation,
        operation === "inspect_jeb_client" ? {} : undefined,
      ),
    );
    this.#clientInformation = {
      version: information.version,
      gui_client: information.gui_client,
    };
    return { information, payload };
  }

  async #inspectClient(signal?: AbortSignal) {
    const { information, payload } = await this.#refreshClientInformation(
      "inspect_jeb_client",
      signal,
    );
    const result = jebResultSchemas.inspect_jeb_client.parse({
      engine: {
        name: "jeb",
        version: information.version ?? null,
        endpoint: this.#selectedEndpoint,
        gui_client: information.gui_client ?? null,
      },
      startup_ts: information.startup_ts ?? null,
      message: information.message ?? null,
    });
    return ok(
      createAnalysisExecution(result, this.#identity(information.version), {
        rawResult: payload,
        limitations:
          information.version === undefined
            ? ["The engine did not report its version."]
            : [],
      }),
    );
  }

  async #openProject(
    request: Extract<JebRequest, { operation: "open_jeb_project" }>,
    signal?: AbortSignal,
  ) {
    const payload = await this.#connection.call(
      "open_project",
      {
        file_path: request.input.path,
      },
      signal,
    );
    const opened = openProject.parse(
      this.#requireSuccess(payload, request.operation, request.input),
    );
    const engine = await this.#engineForObservation(
      request,
      payload,
      opened,
      signal,
    );
    const result = jebResultSchemas.open_jeb_project.parse({
      engine,
      project_name: opened.name ?? null,
      creation_datetime: opened.creation_datetime ?? null,
      input_files: opened.input_files,
      units: opened.units,
    });
    return ok(
      createAnalysisExecution(result, this.#identity(engine.version), {
        rawResult: payload,
        limitations: [
          "JEB resolves and analyzes the artifact on the engine host; REA did not open the target itself.",
        ],
      }),
    );
  }

  async #listUnits(
    request: Extract<JebRequest, { operation: "list_jeb_units" }>,
    signal?: AbortSignal,
  ) {
    const { count, index, filter, parent_unit_path } = request.input;
    const payload = await this.#connection.call(
      "list_units",
      {
        count,
        index,
        ...(filter === undefined ? {} : { filter }),
        ...(parent_unit_path === undefined ? {} : { parent_unit_path }),
      },
      signal,
    );
    const listed = listUnits.parse(
      this.#requireSuccess(payload, request.operation, request.input),
    );
    const units = listed.units;
    const engine = await this.#engineForObservation(
      request,
      payload,
      listed,
      signal,
    );
    const result = jebResultSchemas.list_jeb_units.parse({
      engine,
      filter: filter ?? null,
      parent_unit_path: parent_unit_path ?? null,
      index,
      count,
      units,
      coverage: units.length < count ? "complete" : "partial",
    });
    return ok(
      createAnalysisExecution(result, this.#identity(engine.version), {
        rawResult: payload,
        limitations: [
          "The engine caps unit pages at 100; a full page means more units may exist.",
        ],
      }),
    );
  }

  async #decompileItem(
    request: Extract<JebRequest, { operation: "decompile_jeb_item" }>,
    signal?: AbortSignal,
  ) {
    const { item_address, item_kind, unit_path } = request.input;
    const payload = await this.#connection.call(
      "decompile_code_item",
      {
        item_address,
        item_kind,
        ...(unit_path === undefined ? {} : { unit_path }),
      },
      signal,
    );
    const decompiled = decompiledItem.parse(
      this.#requireSuccess(payload, request.operation, request.input),
    );
    const engine = await this.#engineForObservation(
      request,
      payload,
      decompiled,
      signal,
    );
    const result = jebResultSchemas.decompile_jeb_item.parse({
      engine,
      unit_path: unit_path ?? null,
      item_address,
      item_kind,
      text: decompiled.text,
    });
    return ok(
      createAnalysisExecution(result, this.#identity(engine.version), {
        rawResult: payload,
        limitations:
          unit_path === undefined
            ? [
                "The engine selected the project's first code unit implicitly; the effective unit identity is unknown.",
              ]
            : [],
      }),
    );
  }

  #requireSuccess(
    payload: JsonValue,
    operation: JebOperation,
    input?: Readonly<Record<string, JsonValue | undefined>>,
  ): JsonValue {
    const parsed = parseJebEnvelope(
      payload,
      operation,
      this.#selectedEndpoint,
      input,
    );
    if (!parsed.ok) throw parsed.error;
    return parsed.value;
  }

  #providerFailure(operation: JebOperation, cause: unknown): AnalysisError {
    if (cause instanceof JebMcpAcquisitionCleanupFailure)
      return analysisErrorWithCleanupFailure(
        this.#providerFailure(operation, cause.primaryFailure),
        cause.cleanupFailure,
        operation,
      )
        .bindCleanupDependencies([cause.cleanupFailure])
        .bindCleanupResourceOwner(cause.cleanupFailure);
    if (
      cause instanceof AnalysisCancelledError ||
      cause instanceof AnalysisTimeoutError
    ) {
      const options = {
        cause: cause.cause,
        diagnostics: {
          ...cause.diagnostics,
          endpoint: this.#selectedEndpoint,
        },
        capturedOutput: cause.capturedOutput,
        cleanup: cause.cleanup,
        partialObservation: cause.partialObservation,
      };
      const failure =
        cause instanceof AnalysisTimeoutError
          ? new AnalysisTimeoutError(operation, cause.timeoutMs, {
              ...options,
              ...(cause.userMessage === undefined
                ? {}
                : { userMessage: cause.userMessage }),
              ...(cause.remediationAction === undefined
                ? {}
                : { remediationAction: cause.remediationAction }),
            })
          : new AnalysisCancelledError(operation, options);
      return failure
        .bindCleanupDependencies([cause])
        .bindCleanupResourceOwner(cause);
    }
    if (cause instanceof AnalysisError)
      return cause.retainDiagnostics({ endpoint: this.#selectedEndpoint });
    if (cause instanceof z.ZodError)
      return new AnalysisProtocolError(
        "JEB omitted or malformed required observation fields",
        { cause, diagnostics: { endpoint: this.#selectedEndpoint } },
      );
    const physical =
      cause instanceof JebMcpPhysicalFailure ? cause.cause : cause;
    return new AnalysisCapabilityUnavailableError(
      "jeb",
      operation,
      physical instanceof Error ? physical.message : String(physical),
      {
        cause,
        diagnostics: { endpoint: this.#selectedEndpoint },
        userMessage: JEB_CONNECTION_REMEDIATION,
      },
    );
  }
}
