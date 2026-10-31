import {
  mcpToolResultSchema,
  mcpTextBlocks,
  parseMcpJsonOrText,
} from "../providers/McpToolResult.js";
import { StructuredContentMcpClient } from "../providers/StructuredContentMcpClient.js";
import {
  createIdaDiagnosticRedactor,
  IDA_DIAGNOSTIC_SOURCE_BYTES,
} from "./IdaDiagnosticRedactor.js";
import { IdaDiagnosticResourceError } from "./IdaDiagnosticWriter.js";
import { MIMEType } from "node:util";
import { ChildProcess } from "node:child_process";
import { Socket } from "node:net";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import {
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  DEFAULT_INHERITED_ENV_VARS,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import {
  idaRegistrationTimeoutGuidance,
  type IdaConfiguration,
} from "./IdaConfiguration.js";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonValue,
} from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  AnalysisTimeoutError,
  AnalysisCancelledError,
  AnalysisProtocolError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import {
  McpHttpUtf8Error,
  validateMcpHttpResponse,
} from "../providers/Utf8McpResponse.js";

/** Injectable MCP boundary used by the provider and transport conformance tests. */
export interface IdaMcpConnection {
  connect(): Promise<readonly string[]>;
  call(
    name: string,
    args: Readonly<Record<string, JsonValue>>,
    options?: {
      readonly timeoutMs?: number | undefined;
      readonly signal?: AbortSignal | undefined;
    },
  ): Promise<JsonValue>;
  readResource?(
    uri: string,
    options?: { readonly signal?: AbortSignal | undefined },
  ): Promise<JsonValue>;
  serverInfo(): JsonValue;
  close(): Promise<void>;
  /**
   * Keep a connection retained after failed cleanup from holding the host
   * process open. A long-lived MCP server can still retry through it; a
   * one-shot CLI exits, and the upstream proxy observes end of input.
   */
  detach(): void;
}

export type IdaMcpConnectionDependencies = Readonly<{
  createDiagnosticRedactor?: typeof createIdaDiagnosticRedactor;
}>;

const toolResultSchema = mcpToolResultSchema.extend({
  _meta: z
    .object({
      ida_mcp: z
        .object({
          output_truncated: z.boolean().optional(),
          download_hint: z.string().optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
});

const IDA_STDIO_MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

const parseIdaJsonText = (text: string): JsonValue => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AnalysisProtocolError("IDA MCP returned malformed JSON text.");
  }
  return jsonValueSchema.parse(value);
};

/** Decode Python FastMCP's scalar wrapper without dropping structured dictionaries. */
export const decodeIdaToolResult = (
  input: unknown,
  protocol?: "native",
  diagnostic: IdaDiagnosticRedactor = createIdaDiagnosticRedactor(),
): JsonValue => {
  const result = toolResultSchema.parse(input);
  const blocks = mcpTextBlocks(result.content);
  if (result.isError === true) {
    const reason = diagnostic.blocks(blocks);
    throw new AnalysisProtocolError(
      diagnostic.message("IDA MCP tool failed: ", reason),
      {
        diagnostics: { reason },
      },
    );
  }
  if (result._meta?.ida_mcp?.output_truncated === true)
    throw new AnalysisProtocolError(
      diagnostic.message(
        "IDA MCP truncated its output; the preview cannot establish a complete observation. ",
        diagnostic.blocks([
          result._meta.ida_mcp.download_hint ??
            "Use the upstream output download workflow to retrieve the full result.",
        ]),
      ),
    );
  // Native MCP retains the complete JSON text while structuredContent may
  // contain a shortened preview. Parse that producer-owned representation once.
  const text = blocks.length === 1 ? blocks[0] : undefined;
  if (protocol === "native") {
    if (text === undefined)
      throw new AnalysisProtocolError(
        "Native IDA MCP omitted its complete JSON text result.",
      );
    return parseIdaJsonText(text);
  }
  if (result.structuredContent !== undefined) {
    const value = jsonObjectSchema.parse(result.structuredContent);
    return Object.keys(value).length === 1 && Object.hasOwn(value, "result")
      ? value.result!
      : value;
  }
  if (text === undefined)
    throw new AnalysisProtocolError(
      "IDA MCP omitted a single structured or text result; unsupported content cannot establish an empty observation.",
    );
  return parseMcpJsonOrText(text);
};

// Retain only producer-sanitized JSON diagnostics, never a native parser cause.
class IdaHttpJsonError extends Error {
  constructor(text: string, redactor: IdaDiagnosticRedactor) {
    super(
      redactor.message(
        "IDA MCP returned malformed HTTP JSON. Response body: ",
        text,
      ),
    );
  }
}

type IdaDiagnosticRedactor = ReturnType<typeof createIdaDiagnosticRedactor>;

type IdaContentType = Readonly<{
  essence: string;
  subtype: string;
  charset: string | undefined;
  parameters: ReadonlyMap<string, string>;
}>;

const httpQuotedOctet = (code: number): boolean =>
  code === 9 ||
  code === 32 ||
  (code >= 33 && code <= 126) ||
  (code >= 128 && code <= 255);

/** Consume one complete RFC 9110 media type; never discard a malformed parameter. */
const parseIdaContentType = (
  text: string,
): Result<IdaContentType, "malformed" | "ambiguous"> => {
  let cursor = 0;
  const token = new RegExp("[!#$%&'*+.^_`|~0-9A-Za-z-]+", "y");
  const readToken = (): string | undefined => {
    token.lastIndex = cursor;
    const match = token.exec(text);
    if (match === null) return undefined;
    cursor = token.lastIndex;
    return match[0];
  };
  const readOws = (): void => {
    while (text[cursor] === " " || text[cursor] === "\t") cursor++;
  };
  const readQuoted = (): string | undefined => {
    cursor++;
    let value = "";
    while (cursor < text.length) {
      let code = text.charCodeAt(cursor++);
      if (code === 34) return value;
      if (code === 92) {
        code = text.charCodeAt(cursor++);
        if (!httpQuotedOctet(code)) return undefined;
      } else if (!httpQuotedOctet(code)) return undefined;
      value += String.fromCharCode(code);
    }
    return undefined;
  };
  readOws();
  const type = readToken()?.toLowerCase();
  if (type === undefined || text[cursor++] !== "/") return err("malformed");
  const subtype = readToken()?.toLowerCase();
  if (subtype === undefined) return err("malformed");
  const parameters = new Map<string, string>();
  let ambiguous = false;
  while (true) {
    readOws();
    if (cursor === text.length) break;
    if (text[cursor++] !== ";") return err("malformed");
    readOws();
    // RFC 9110 parameters admit an empty item after a semicolon.
    if (cursor === text.length || text[cursor] === ";") continue;
    const name = readToken()?.toLowerCase();
    if (name === undefined || text[cursor++] !== "=") return err("malformed");
    const value = text[cursor] === '"' ? readQuoted() : readToken();
    if (value === undefined) return err("malformed");
    // Repetition is ambiguous for this owner, even if both values agree.
    // Keep parsing so syntax errors anywhere in the field cannot be discarded.
    if (parameters.has(name)) ambiguous = true;
    else parameters.set(name, value);
  }
  return ambiguous
    ? err("ambiguous")
    : ok({
        essence: type + "/" + subtype,
        subtype,
        charset: parameters.get("charset"),
        parameters,
      });
};
const httpErrorBody = (
  response: Response,
  text: string,
  redactor: IdaDiagnosticRedactor,
): string => {
  const omitted = redactor.text(
    "IDA MCP response body omitted: unsupported or unknown format or character encoding.",
  );
  const contentType = response.headers.get("content-type");
  if (contentType === null) return omitted;
  const mediaType = parseIdaContentType(contentType);
  if (!mediaType.ok) return omitted;
  const charset = mediaType.value.charset?.toLowerCase();
  if (
    charset !== undefined &&
    !["utf-8", "utf8", "us-ascii", "ascii"].includes(charset)
  )
    return omitted;
  if (
    mediaType.value.subtype === "json" ||
    mediaType.value.subtype.endsWith("+json")
  )
    return redactor.json(text);
  if (mediaType.value.essence === "text/plain") return redactor.text(text);
  return omitted;
};

/** Keep error-body materialization within the diagnostic source-byte budget. */
const readBoundedResponseText = async (
  response: Response,
): Promise<string | undefined> => {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, total).toString("utf8");
      total += value.byteLength;
      if (total > IDA_DIAGNOSTIC_SOURCE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
};

const diagnosticFetch =
  (
    redactor: IdaDiagnosticRedactor,
    rejectTransport: (failure: McpHttpUtf8Error) => void,
  ): typeof fetch =>
  async (input, init) => {
    const response = validateMcpHttpResponse(
      await fetch(input, init),
      rejectTransport,
    );
    const readText = response.text.bind(response);
    let safeBody: string | undefined;
    if (!response.ok) {
      // Normalize before the SDK can swallow a body-consumer failure or drop
      // its format metadata. Both consumers use this one owned diagnostic.
      const sourceBody = await readBoundedResponseText(response);
      safeBody =
        sourceBody === undefined
          ? redactor.text(
              `IDA MCP response body omitted: exceeds ${IDA_DIAGNOSTIC_SOURCE_BYTES} UTF-8 bytes.`,
            )
          : httpErrorBody(response, sourceBody, redactor);
      const body = safeBody;
      Object.defineProperty(response, "text", {
        value: async (): Promise<string> => body,
      });
    }
    // Successful JSON remains lazy, and SSE keeps its original body stream.
    Object.defineProperty(response, "json", {
      value: async (): Promise<unknown> => {
        const text = safeBody ?? (await readText());
        try {
          const value: unknown = JSON.parse(text);
          return value;
        } catch {
          // Parsing failure owns diagnostics even when the HTTP status succeeded.
          throw new IdaHttpJsonError(
            safeBody ?? httpErrorBody(response, text, redactor),
            redactor,
          );
        }
      },
    });
    return response;
  };

const retainedTransportCause = (cause: unknown, message: string): Error => {
  // Do not clone arbitrary upstream fields, stacks, data or nested causes.
  if (cause instanceof SdkHttpError)
    return new SdkHttpError(cause.code, message, {
      status: cause.data.status,
      statusText: "",
    });
  if (cause instanceof ProtocolError)
    return new ProtocolError(cause.code, message);
  return new Error(message);
};
/** Create a standard SDK connection to an existing upstream registration. */
export const createIdaMcpConnection = (
  config: IdaConfiguration,
  environment: Readonly<NodeJS.ProcessEnv>,
  dependencies: IdaMcpConnectionDependencies = {},
): IdaMcpConnection => {
  const client = new StructuredContentMcpClient({
    name: "rea-ida-provider",
    version: "1",
  });
  const redactor = (
    dependencies.createDiagnosticRedactor ?? createIdaDiagnosticRedactor
  )(config);
  let stderr = Buffer.alloc(0);
  let stderrBytes = 0;
  let httpUtf8Failure: McpHttpUtf8Error | undefined;
  const capturedTransportOutput = () => {
    let start = 0;
    if (stderrBytes > stderr.length)
      while (start < stderr.length && (stderr[start]! & 0xc0) === 0x80) start++;
    return {
      stdout: "",
      stderr: redactor.blocks([stderr.subarray(start).toString("utf8")]),
      truncated: stderrBytes > stderr.length - start,
      stdout_bytes: 0,
      stderr_bytes: stderrBytes,
    };
  };
  // SDK 2.3.1 returns an SdkError abort reason by identity. A fresh private
  // reason distinguishes this caller abort from an already established failure.
  const requestWithCallerSignal = async <Value>(
    operation: string,
    signal: AbortSignal | undefined,
    request: (requestSignal: AbortSignal | undefined) => Promise<Value>,
  ): Promise<Value> => {
    if (signal === undefined) return request(undefined);
    const controller = new AbortController();
    const cancellation = new SdkError(
      SdkErrorCode.RequestTimeout,
      "REA caller cancelled this IDA MCP request",
    );
    const abort = () => controller.abort(cancellation);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    try {
      return await request(controller.signal);
    } catch (cause: unknown) {
      if (cause === cancellation)
        throw new AnalysisCancelledError(operation, {
          cause: signal.reason,
          capturedOutput: capturedTransportOutput(),
        });
      throw cause;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
  const transportFailure = (
    cause: unknown,
    operation = "ida_mcp_response",
    requestTimeoutMs = config.timeoutMs,
  ): never => {
    const bufferLimit =
      cause instanceof Error
        ? /ReadBuffer exceeded maximum size of (\d+) bytes/u.exec(cause.message)
        : null;
    if (cause instanceof IdaDiagnosticResourceError) throw cause;
    if (cause instanceof McpHttpUtf8Error) throw cause;
    if (
      httpUtf8Failure !== undefined &&
      cause instanceof SdkError &&
      cause.code === SdkErrorCode.ConnectionClosed
    )
      throw httpUtf8Failure;
    let failure: Error;
    if (cause instanceof IdaHttpJsonError)
      failure = new Error(cause.message, { cause });
    else {
      const message =
        cause instanceof Error
          ? cause.message
          : "Unknown IDA MCP transport failure";
      const body = cause instanceof SdkHttpError ? cause.data.text : undefined;
      // Only the pinned SDK POST producer places this owned body at a known
      // span. Equal substrings elsewhere remain untrusted SDK context.
      const prefix = "Error POSTing to endpoint: ";
      const ownedPostBody =
        cause instanceof SdkHttpError &&
        cause.code === SdkErrorCode.ClientHttpNotImplemented &&
        typeof body === "string" &&
        message === prefix + body;
      // Normalized wire headers and supported decoded candidates have no LF.
      // Separating owners prevents their concatenation from spelling a credential.
      const safeMessage = ownedPostBody
        ? redactor.message(prefix, body)
        : redactor.blocks([message]);
      failure = new Error(safeMessage, {
        cause: retainedTransportCause(cause, safeMessage),
      });
    }
    const capturedOutput = capturedTransportOutput();
    if (cause instanceof SdkError && cause.code === SdkErrorCode.RequestTimeout)
      throw new AnalysisTimeoutError(operation, requestTimeoutMs, {
        cause: failure,
        capturedOutput,
        ...idaRegistrationTimeoutGuidance(
          requestTimeoutMs,
          "request",
          config.timeoutMs,
        ),
      });
    if (bufferLimit !== null)
      throw new AnalysisResourceConstraintError(
        operation,
        "transport",
        `Upstream IDA MCP reply exceeded the ${bufferLimit[1]}-byte transport limit; no partial Evidence was returned.`,
        { max_response_bytes: Number(bufferLimit[1]) },
        { cause, capturedOutput },
      );
    if (stderrBytes === 0) throw failure;
    throw new ProviderAdapterError("ida", "transport", {
      cause: failure,
      diagnostics: { reason: failure.message },
      capturedOutput,
    });
  };
  const transport: StdioClientTransport | StreamableHTTPClientTransport =
    "command" in config
      ? new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: {
            // The SDK always merges ambient defaults. Its string-only environment
            // API requires empty values to suppress omitted caller-selected keys.
            ...Object.fromEntries(
              DEFAULT_INHERITED_ENV_VARS.map((key) => [key, ""]),
            ),
            ...Object.fromEntries(
              Object.entries(snapshotEnvironment(environment)).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            ),
            IDA_MCP_MAX_WORKERS: "1",
            ...snapshotEnvironment(config.env),
          },
          stderr: "pipe",
          maxBufferSize: IDA_STDIO_MAX_MESSAGE_BYTES,
        })
      : new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers, redirect: "error" },
          fetch: diagnosticFetch(redactor, (failure) => {
            httpUtf8Failure ??= failure;
            void transport.close().catch(() => undefined);
          }),
        });
  // Keep a bounded diagnostic tail for genuine failures; never persist ambient variables.
  if (transport instanceof StdioClientTransport)
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      const combined = Buffer.concat([stderr, chunk]);
      stderr = Buffer.from(
        combined.subarray(Math.max(0, combined.length - 16_384)),
      );
    });
  return {
    async connect() {
      await client
        .connect(transport, { timeout: config.timeoutMs })
        .catch((cause: unknown) => transportFailure(cause, "ida_mcp_connect"));
      const catalog = await client
        .listTools(undefined, {
          timeout: config.timeoutMs,
        })
        .catch((cause: unknown) => transportFailure(cause, "ida_mcp_catalog"));
      return catalog.tools.map(({ name }) => name);
    },
    async call(name, args, options) {
      const requestTimeoutMs = Math.min(
        config.timeoutMs,
        options?.timeoutMs ?? config.timeoutMs,
      );
      return decodeIdaToolResult(
        await requestWithCallerSignal(name, options?.signal, (signal) =>
          client.callTool(
            { name, arguments: args },
            {
              timeout: requestTimeoutMs,
              ...(signal === undefined ? {} : { signal }),
            },
          ),
        ).catch((cause: unknown) => {
          if (cause instanceof AnalysisCancelledError) throw cause;
          return transportFailure(cause, name, requestTimeoutMs);
        }),
        config.protocol,
        redactor,
      );
    },
    async readResource(uri, options) {
      const response = await requestWithCallerSignal(
        "ida_mcp_read_resource",
        options?.signal,
        (signal) =>
          client.readResource(
            { uri },
            {
              timeout: config.timeoutMs,
              ...(signal === undefined ? {} : { signal }),
            },
          ),
      ).catch((cause: unknown) => {
        if (cause instanceof AnalysisCancelledError) throw cause;
        return transportFailure(cause, "ida_mcp_read_resource");
      });
      return decodeIdaJsonResource(uri, response);
    },
    serverInfo: () => jsonValueSchema.parse(client.getServerVersion() ?? null),
    close: () => client.close().catch(transportFailure),
    detach() {
      if (!(transport instanceof StdioClientTransport)) return;
      // The SDK exposes only the child's pid, not the handles it holds.
      const child: unknown = Reflect.get(transport, "_process");
      if (!(child instanceof ChildProcess)) return;
      child.unref();
      for (const stream of [child.stdin, child.stdout, child.stderr])
        if (stream instanceof Socket) stream.unref();
    },
  };
};

/** Resource metadata follows the SDK's optional media type; content/identity stay strict. */
export const decodeIdaJsonResource = (
  uri: string,
  response: unknown,
): JsonValue => {
  const resource = z
    .object({
      contents: z
        .array(
          z.object({
            uri: z.literal(uri),
            mimeType: z
              .string()
              .refine((value) => {
                try {
                  return new MIMEType(value).essence === "application/json";
                } catch {
                  return false;
                }
              }, "Expected a JSON resource media type")
              .optional(),
            text: z.string(),
          }),
        )
        .length(1),
    })
    .parse(response);
  return parseIdaJsonText(resource.contents[0]!.text);
};
