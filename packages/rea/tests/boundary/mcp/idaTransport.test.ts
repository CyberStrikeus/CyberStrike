import { createVerifierHttpServer } from "../../../scripts/lib/verifier-http-server.mjs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { inspect } from "node:util";
import { ProtocolError } from "@modelcontextprotocol/client";
import { afterEach, expect, it } from "vitest";
import { constants } from "node:buffer";
import { IdaDiagnosticResourceError } from "../../../src/ida/IdaDiagnosticWriter.js";
import { createIdaDiagnosticRedactor } from "../../../src/ida/IdaDiagnosticRedactor.js";
import { z } from "zod";
import { AnalysisProtocolError } from "../../../src/domain/analysisErrorCore.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import { createIdaMcpConnection } from "../../../src/ida/IdaMcpConnection.js";
import type {
  IdaMcpConnection,
  IdaMcpConnectionDependencies,
} from "../../../src/ida/IdaMcpConnection.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const requestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z
    .object({
      protocolVersion: z.string().optional(),
      cursor: z.string().optional(),
    })
    .passthrough()
    .optional(),
});
type IdaTransportFixtureOptions = {
  readonly redirectUrl?: string;
  readonly cycle?: boolean;
  readonly native?: boolean;
  readonly toolResult?: JsonValue;
  readonly resourceResponseText?: string;
  readonly toolRpcError?: {
    readonly code: number;
    readonly message: string;
    readonly data?: JsonValue;
  };
  readonly toolStatus?: number;
  readonly toolStatusText?: string;
  readonly toolContentType?: string;
  readonly toolResponseBody?: string | Buffer;
  readonly configurationHeaders?: Readonly<Record<string, string>>;
  readonly connectionDependencies?: IdaMcpConnectionDependencies;
};
const fixtureResponse = (
  input: z.infer<typeof requestSchema>,
  options: IdaTransportFixtureOptions,
): unknown =>
  input.method === "initialize"
    ? {
        protocolVersion: input.params?.protocolVersion,
        capabilities: {
          tools: {},
          ...(options.native ? { resources: {} } : {}),
        },
        serverInfo: {
          name: "ida-transport-fixture",
          version: "observed-server-version",
        },
      }
    : input.method === "tools/list"
      ? {
          tools: [
            {
              name: input.params?.cursor === undefined ? "first" : "second",
              inputSchema: { type: "object", properties: {} },
            },
          ],
          ...(input.params?.cursor === undefined
            ? { nextCursor: "next-page" }
            : options.cycle
              ? {
                  nextCursor:
                    input.params.cursor === "next-page"
                      ? "other-page"
                      : "next-page",
                }
              : {}),
        }
      : input.method === "resources/read"
        ? {
            contents: [
              {
                uri: "ida://idb/metadata",
                mimeType: "application/json",
                text:
                  options.resourceResponseText ??
                  JSON.stringify({
                    path: "/fixture/input.i64",
                    sha256: "a".repeat(64),
                    base: "0x1000",
                    module: "input",
                  }),
              },
            ],
          }
        : options.toolResult !== undefined
          ? options.toolResult
          : options.native
            ? {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify([{ observed: true }]),
                  },
                ],
                structuredContent: { result: [], _output_truncated: true },
              }
            : { content: [], structuredContent: { observed: true } };

const fixture = async (options: IdaTransportFixtureOptions = {}) => {
  const {
    redirectUrl,
    native = false,
    toolRpcError,
    toolStatus = 200,
    toolStatusText,
    toolContentType = "application/json",
    toolResponseBody,
    configurationHeaders = { Authorization: "Bearer transport-fixture-secret" },
    connectionDependencies,
  } = options;
  const methods: string[] = [];
  const headers: (string | undefined)[] = [];
  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    if (redirectUrl !== undefined) {
      response.writeHead(307, { Location: redirectUrl });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const input = requestSchema.parse(JSON.parse(body));
    methods.push(input.method);
    headers.push(request.headers.authorization);
    if (input.id === undefined) {
      response.writeHead(202);
      response.end();
      return;
    }
    const result = fixtureResponse(input, options);
    if (input.method === "tools/call" && toolStatusText !== undefined)
      response.statusMessage = toolStatusText;
    response.writeHead(input.method === "tools/call" ? toolStatus : 200, {
      "Content-Type":
        input.method === "tools/call" ? toolContentType : "application/json",
    });
    response.end(
      input.method === "tools/call" && toolResponseBody !== undefined
        ? toolResponseBody
        : JSON.stringify({
            jsonrpc: "2.0",
            id: input.id,
            ...(input.method === "tools/call" && toolRpcError !== undefined
              ? { error: toolRpcError }
              : { result }),
          }),
    );
  };
  const { server, close } = createVerifierHttpServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(close);
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing HTTP fixture address");
  const connection: IdaMcpConnection = createIdaMcpConnection(
    {
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: configurationHeaders,
      mode: native ? "attached" : "headless",
      ...(native ? { protocol: "native" as const } : {}),
      timeoutMs: 2000,
    },
    {},
    connectionDependencies,
  );
  cleanups.push(() => connection.close());
  return {
    connection,
    methods,
    headers,
    url: `http://127.0.0.1:${address.port}/mcp`,
  };
};

it("uses the pinned SDK for a local Streamable HTTP handshake, paged discovery, structured results, and configured authentication", async () => {
  const { connection, methods, headers } = await fixture();
  expect(await connection.connect()).toEqual(["first", "second"]);
  expect(connection.serverInfo()).toEqual({
    name: "ida-transport-fixture",
    version: "observed-server-version",
  });
  expect(await connection.call("first", {})).toEqual({ observed: true });
  expect(methods).toContain("notifications/initialized");
  expect(methods.filter((name) => name === "tools/list")).toHaveLength(2);
  expect(
    headers.every((value) => value === "Bearer transport-fixture-secret"),
  ).toBe(true);
});

it("retains own structured fields through the SDK before scalar-wrapper selection", async () => {
  const structuredContent = {
    ["__proto__"]: { observed: true },
    result: "ordinary field",
    nested: [{ ["__proto__"]: "nested fact" }],
  };
  const { connection } = await fixture({
    toolResult: { content: [], structuredContent },
  });
  await connection.connect();
  const result = await connection.call("first", {});
  expect(JSON.stringify(result)).toBe(JSON.stringify(structuredContent));
});

it("omits an oversized HTTP error body before retaining or redacting it", async () => {
  const { connection } = await fixture({
    toolStatus: 500,
    toolContentType: "text/plain",
    toolResponseBody: "owned-diagnostic-" + "x".repeat(70 * 1024),
  });
  await connection.connect();
  const failure = await connection
    .call("first", {})
    .catch((cause: unknown) => cause);
  if (!(failure instanceof Error)) throw new Error("Expected HTTP failure");
  expect(failure.message).toContain("response body omitted");
  expect(failure.message).not.toContain("owned-diagnostic-");
});

it("rejects redirects instead of forwarding transport credentials to another endpoint", async () => {
  const destination = await fixture();
  const { connection } = await fixture({ redirectUrl: destination.url });
  await expect(connection.connect()).rejects.toThrow();
  expect(destination.headers).toEqual([]);
});

it("rejects nonterminating SDK pagination instead of returning a partial tool catalog", async () => {
  const { connection, methods } = await fixture({ cycle: true });
  await expect(connection.connect()).rejects.toThrow(
    "pagination did not terminate",
  );
  expect(
    methods.filter((method) => method === "tools/list").length,
  ).toBeGreaterThan(2);
});

it("reads native metadata resources and complete JSON text through the real SDK transport", async () => {
  const { connection, methods } = await fixture({ native: true });
  expect(await connection.connect()).toEqual(["first", "second"]);
  expect(await connection.call("first", {})).toEqual([{ observed: true }]);
  expect(await connection.readResource?.("ida://idb/metadata")).toMatchObject({
    path: "/fixture/input.i64",
    sha256: "a".repeat(64),
  });
  await expect(connection.readResource?.("ida://other")).rejects.toThrow();
  expect(methods).toContain("resources/read");
});

it("accepts a legacy stdio reply over the SDK default while staying bounded", async () => {
  const script = String.raw`
let input = "";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const newline = input.indexOf("\n");
    if (newline < 0) break;
    const request = JSON.parse(input.slice(0, newline));
    input = input.slice(newline + 1);
    if (request.id === undefined) continue;
    const result = request.method === "initialize"
      ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "large-reply-fixture", version: "1" } }
      : request.method === "tools/list"
        ? { tools: [{ name: "list_strings", inputSchema: { type: "object", properties: {} } }] }
        : { content: [{ type: "text", text: "fixture" }], structuredContent: { result: "x".repeat(11 * 1024 * 1024) } };
    send({ jsonrpc: "2.0", id: request.id, result });
  }
});
`;
  const connection = createIdaMcpConnection(
    {
      command: process.execPath,
      args: ["-e", script],
      env: {},
      mode: "attached",
      timeoutMs: 10_000,
    },
    {},
  );
  cleanups.push(() => connection.close());
  expect(await connection.connect()).toEqual(["list_strings"]);
  expect(await connection.call("list_strings", {})).toEqual(
    "x".repeat(11 * 1024 * 1024),
  );
});

it.each([false, true])(
  "preserves an upstream tool rejection through SDK transport and public error projection (native: %s)",
  async (native) => {
    const reason =
      "Invalid params: unexpected parameters: ['offset', 'max_lines']";
    const { connection } = await fixture({
      native,
      toolResult: {
        isError: true,
        content: [{ type: "text", text: reason }],
      },
    });
    await connection.connect();
    const failure = await connection
      .call("first", {
        addr: "0x1000",
        offset: 0,
        max_lines: 100,
      })
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(AnalysisProtocolError);
    if (!(failure instanceof AnalysisProtocolError))
      throw new Error(
        "Expected the upstream rejection to remain a protocol error",
      );
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "unreadable_output",
      details: { diagnostics: { reason } },
    });
  },
);

it.each([false, true])(
  "redacts configured credentials from SDK tool errors while retaining caller context (native: %s)",
  async (native) => {
    const configurationHeaders = {
      aUtHoRiZaTiOn: "\r\n \tBearer transport-fixture-secret \r\n",
      "Proxy-Authorization": "Basic proxy-fixture-secret",
      CoOkIe: "session=cookie-fixture-secret",
      "X-Evidence": "selected-header-evidence",
    };
    const context =
      "/caller/input?cursor=visible API_KEY=caller-evidence selected-header-evidence";
    const { connection } = await fixture({
      native,
      configurationHeaders,
      toolResult: {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "Rejected Bearer transport-fixture-secret / transport-fixture-secret / Basic proxy-fixture-secret / proxy-fixture-secret / session=cookie-fixture-secret at " +
              context,
          },
        ],
      },
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof AnalysisProtocolError))
      throw new Error(
        "Expected the upstream rejection to remain a protocol error",
      );
    const reason =
      "Rejected [redacted transport credential] / [redacted transport credential] / [redacted transport credential] / [redacted transport credential] / [redacted transport credential] at " +
      context;
    expect(failure.message).toBe("IDA MCP tool failed: \n" + reason);
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "unreadable_output",
      details: { diagnostics: { reason } },
    });
  },
);

type ParsedCredentialCase = {
  readonly label: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly payloads: readonly string[];
};
const basicCredentialCases: readonly ParsedCredentialCase[] = [
  {
    label: "decoded Basic ASCII credentials",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from("basic-fixture-user:basic-fixture:password").toString(
          "base64",
        ),
    },
    payloads: [
      "basic-fixture-user:basic-fixture:password",
      "basic-fixture:password",
    ],
  },
  {
    label: "decoded Proxy Basic UTF-8 credentials",
    headers: {
      "Proxy-Authorization":
        "bAsIc " +
        Buffer.from("utf8-fixture-user:páss-fixture:☃", "utf8").toString(
          "base64",
        ),
    },
    payloads: ["utf8-fixture-user:páss-fixture:☃", "páss-fixture:☃"],
  },
  {
    label: "decoded Basic Latin-1 credentials",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          "latin-fixture-user:café-fixture:password",
          "latin1",
        ).toString("base64"),
    },
    payloads: [
      "latin-fixture-user:café-fixture:password",
      "café-fixture:password",
    ],
  },
];
const parsedCredentialCases: readonly ParsedCredentialCase[] = [
  ...basicCredentialCases,
  {
    label: "Cookie values",
    headers: {
      Cookie:
        'session=cookie-fixture-secret; quoted="quoted-fixture=value=="; empty=',
    },
    payloads: ["cookie-fixture-secret", "quoted-fixture=value=="],
  },
  {
    label: "Authorization Token payload",
    headers: { Authorization: "Token custom-fixture-token+/==" },
    payloads: ["custom-fixture-token+/=="],
  },
  {
    label: "Proxy-Authorization custom token68",
    headers: { "Proxy-Authorization": "Custom proxy-fixture-token._~+/-==" },
    payloads: ["proxy-fixture-token._~+/-=="],
  },
  {
    label: "Digest auth-param values",
    headers: {
      Authorization:
        'Digest username="fixture-user", nonce="nonce,fixture", response="response\\\"secret", opaque="back\\\\slash"',
    },
    payloads: [
      "fixture-user",
      "nonce,fixture",
      'response"secret',
      "back\\slash",
    ],
  },
];

it.each(
  parsedCredentialCases.flatMap((testCase) =>
    [false, true].map((native) => ({ ...testCase, native })),
  ),
)(
  "redacts parsed $label from tool errors (native: $native)",
  async ({ headers, payloads, native }) => {
    const context = "/caller/input?cursor=visible API_KEY=caller-evidence";
    const { connection } = await fixture({
      native,
      configurationHeaders: headers,
      toolResult: {
        isError: true,
        content: [
          {
            type: "text",
            text: "Rejected " + payloads.join(" / ") + " at " + context,
          },
        ],
      },
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof AnalysisProtocolError))
      throw new Error(
        "Expected the upstream rejection to remain a protocol error",
      );
    const reason =
      "Rejected " +
      payloads.map(() => "[redacted transport credential]").join(" / ") +
      " at " +
      context;
    expect(failure.message).toBe("IDA MCP tool failed: \n" + reason);
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "unreadable_output",
      details: { diagnostics: { reason } },
    });
  },
);

it.each([false, true])(
  "retains successful credential-like evidence through SDK transport (native: %s)",
  async (native) => {
    const evidence = {
      observed: "custom-fixture-token+/==",
      cookie: "quoted-fixture=value==",
      digest: 'response"secret',
    };
    const { connection } = await fixture({
      native,
      configurationHeaders: {
        Authorization: "Token custom-fixture-token+/==",
        Cookie: 'session="quoted-fixture=value=="',
        "Proxy-Authorization": 'Digest response="response\\\"secret"',
      },
      toolResult: native
        ? { content: [{ type: "text", text: JSON.stringify(evidence) }] }
        : { content: [], structuredContent: evidence },
    });
    await connection.connect();
    expect(await connection.call("first", {})).toEqual(evidence);
  },
);

it.each<{
  label: string;
  headers: Readonly<Record<string, string>>;
  payloads: readonly string[];
}>([
  {
    label: "Cookie and custom token payloads",
    headers: {
      Authorization: "Token custom-fixture-token",
      Cookie: "session=cookie-fixture-secret",
    },
    payloads: ["custom-fixture-token", "cookie-fixture-secret"],
  },
  {
    label: "JSON-escaped Digest payloads and header",
    headers: {
      Authorization: 'Digest response="q\\\"uote", opaque="back\\\\slash"',
    },
    payloads: [
      'q"uote',
      "back\\slash",
      'Digest response="q\\\"uote", opaque="back\\\\slash"',
    ],
  },
  ...basicCredentialCases,
])(
  "redacts $label echoed in an HTTP failure through the SDK rejection path",
  async ({ headers, payloads }) => {
    const context = "/caller/input?cursor=visible API_KEY=caller-evidence";
    const { connection } = await fixture({
      toolStatus: 500,
      configurationHeaders: headers,
      toolResult: {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "Transport rejected " + payloads.join(" / ") + " at " + context,
          },
        ],
      },
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    expect(failure).not.toBeInstanceOf(AnalysisProtocolError);
    if (!(failure instanceof Error))
      throw new Error("Expected the SDK to reject the HTTP failure");
    expect(failure.message).toContain(
      "Transport rejected " +
        payloads.map(() => "[redacted transport credential]").join(" / ") +
        " at " +
        context,
    );
    for (const payload of payloads)
      expect(failure.message).not.toContain(
        JSON.stringify(payload).slice(1, -1),
      );
  },
);

it.each<{
  label: string;
  headers: Readonly<Record<string, string>>;
  credential: string;
  wire: string;
  toolContentType: string;
}>([
  {
    label: "Go-style HTML escapes",
    toolContentType: "application/problem+json; charset=utf-8",
    headers: { Cookie: "session=<secret>&/fixture" },
    credential: "<secret>&/fixture",
    wire: String.raw`\u003csecret\u003e\u0026/fixture`,
  },
  {
    label: "fully escaped ASCII with mixed hex case and solidus",
    toolContentType: "application/json",
    headers: { Authorization: "Token aBz/secret" },
    credential: "aBz/secret",
    wire: String.raw`\u0061\u0042\u007A\/\u0073\u0065\u0063\u0072\u0065\u0074`,
  },
  {
    label: "Latin-1 auth-param Unicode and solidus escapes",
    toolContentType: "application/json",
    headers: { Authorization: 'Digest response="café/secret"' },
    credential: "café/secret",
    wire: String.raw`caf\u00E9\/secret`,
  },
])(
  "redacts $label in SDK HTTP failures without rewriting unrelated wire evidence",
  async ({ headers, credential, wire, toolContentType }) => {
    const prefix = '{\n  "reason": "Rejected ';
    const suffix =
      String.raw`", "numeric": 9007199254740993, "duplicate": "first", "duplicate": "second", "context": "\u003cpublic\u003e\/asset", "symbol": "\ud83d\uDE00"` +
      "\n}\n";
    const toolResponseBody = prefix + wire + suffix;
    expect(JSON.parse(toolResponseBody)).toMatchObject({
      reason: "Rejected " + credential,
    });
    const { connection } = await fixture({
      toolStatus: 500,
      toolContentType,
      configurationHeaders: headers,
      toolResponseBody,
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    expect(failure).not.toBeInstanceOf(AnalysisProtocolError);
    if (!(failure instanceof Error))
      throw new Error("Expected the SDK to reject the HTTP failure");
    expect(failure.message).toContain(
      prefix + "[redacted transport credential]" + suffix,
    );
    expect(failure.message).not.toContain(wire);
  },
);

const jsonFailureResponses = [
  { toolStatus: 200, toolContentType: "application/json" },
  { toolStatus: 500, toolContentType: "application/json" },
  {
    toolStatus: 500,
    toolContentType: "application/problem+json; charset=utf-8",
  },
] as const;

it.each(
  jsonFailureResponses.flatMap((response) =>
    [
      {
        label: "unquoted escaped body",
        credential: "<token>",
        wire: String.raw`\u003ctoken\u003e`,
        toolResponseBody: String.raw`\u003ctoken\u003e`,
        safeBody: "[redacted transport credential]",
      },
      {
        label: "quoted escaped array entry before invalid JSON",
        credential: "<s>",
        wire: String.raw`\u003cs\u003e`,
        toolResponseBody: String.raw`["\u003cs\u003e",x]`,
        safeBody: '["[redacted transport credential]",x]',
      },
    ].map((body) => ({ ...response, ...body })),
  ),
)(
  "redacts $label from malformed HTTP $toolStatus $toolContentType responses",
  async ({
    credential,
    wire,
    toolResponseBody,
    safeBody,
    toolStatus,
    toolContentType,
  }) => {
    const { connection } = await fixture({
      configurationHeaders: { Cookie: "token=" + credential },
      toolResponseBody,
      toolStatus,
      toolContentType,
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    expect(failure).not.toBeInstanceOf(AnalysisProtocolError);
    if (!(failure instanceof Error))
      throw new Error("Expected the SDK to reject malformed JSON");
    expect(failure.message).toContain(safeBody);
    if (toolStatus === 200)
      expect(failure.message).toMatch(/malformed.*HTTP.*JSON/iu);
    else expect(failure.cause).toMatchObject({ data: { status: 500 } });
    expect(failure.message).not.toContain(toolResponseBody);
    expect(failure.message).not.toContain(wire);
    expect(failure.message).not.toContain(credential);
  },
);

it.each(
  jsonFailureResponses.flatMap((response) =>
    [
      {
        credentialLabel: "literal short escape",
        credential: String.raw`folder\tmp`,
      },
      {
        credentialLabel: "literal Unicode escape",
        credential: String.raw`folder\u0061`,
      },
    ].flatMap((credentialCase) =>
      [
        {
          bodyLabel: "unquoted body",
          prefix: "Rejected ",
          suffix: " at /caller/input?cursor=visible",
        },
        {
          bodyLabel: "quoted value in an invalid document",
          prefix: 'Rejected "',
          suffix: '" at /caller/input?cursor=visible',
        },
        {
          bodyLabel: "unfinished JSON string",
          prefix: '{"reason":"Rejected ',
          suffix: " at /caller/input?cursor=visible",
        },
      ].map((body) => ({ ...response, ...credentialCase, ...body })),
    ),
  ),
)(
  "redacts $credentialLabel in $bodyLabel from HTTP $toolStatus $toolContentType diagnostics and their public projection",
  async ({ credential, toolStatus, toolContentType, prefix, suffix }) => {
    const { connection } = await fixture({
      configurationHeaders: { Authorization: "Custom " + credential },
      toolStatus,
      toolContentType,
      toolResponseBody: prefix + credential + suffix,
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof Error))
      throw new Error("Expected the SDK to reject malformed JSON");
    expect(failure.message).toContain(
      prefix + "[redacted transport credential]" + suffix,
    );
    expect(failure.message).not.toContain(credential);
    if (toolStatus === 200)
      expect(failure.message).toMatch(/malformed.*HTTP.*JSON/iu);
    else expect(failure.cause).toMatchObject({ data: { status: 500 } });
    const projected = projectAnalysisError(
      new ProviderAdapterError("ida", "decompile", {
        cause: failure,
        diagnostics: { reason: failure.message },
      }),
    );
    expect(projected).toMatchObject({
      code: "execution_failure",
      details: { diagnostics: { reason: failure.message } },
    });
    expect(JSON.stringify(projected)).not.toContain(
      JSON.stringify(credential).slice(1, -1),
    );
  },
);

it("preserves JSON escape syntax that spells a configured credential without containing its value", async () => {
  const toolResponseBody = String.raw`{"reason":"\u003cpublic\u003e","numeric":9007199254740993}`;
  const { connection } = await fixture({
    toolStatus: 500,
    configurationHeaders: { Cookie: "token=u003c" },
    toolResponseBody,
  });
  await connection.connect();
  const failure = await connection
    .call("first", {})
    .catch((cause: unknown) => cause);
  expect(failure).not.toBeInstanceOf(AnalysisProtocolError);
  if (!(failure instanceof Error))
    throw new Error("Expected the SDK to reject the HTTP failure");
  expect(failure.message).toContain(toolResponseBody);
  expect(failure.message).not.toContain("[redacted transport credential]");
});

it("redacts complete opaque authentication values containing quotes from plain HTTP error bodies", async () => {
  const credential = 'prefix"quoted"suffix';
  const header = "Custom " + credential;
  const context = "/caller/input?cursor=visible API_KEY=caller-evidence";
  const { connection } = await fixture({
    toolStatus: 500,
    toolContentType: "text/plain",
    configurationHeaders: { Authorization: header },
    toolResponseBody:
      "Rejected " + header + " / " + credential + " at " + context,
  });
  await connection.connect();
  const failure = await connection
    .call("first", {})
    .catch((cause: unknown) => cause);
  expect(failure).not.toBeInstanceOf(AnalysisProtocolError);
  if (!(failure instanceof Error))
    throw new Error("Expected the SDK to reject the HTTP failure");
  expect(failure.message).toContain(
    "Rejected [redacted transport credential] / [redacted transport credential] at " +
      context,
  );
  expect(failure.message).not.toContain(credential);
});

it.each(["Rejected ", ""])(
  "redacts quoted literal credentials from text/plain HTTP failures with prefix %j",
  async (prefix) => {
    const credential = String.raw`folder\tmp`;
    const { connection } = await fixture({
      toolStatus: 500,
      toolContentType: "text/plain",
      configurationHeaders: { Authorization: "Custom " + credential },
      toolResponseBody: prefix + '"' + credential + '"',
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    expect(failure).not.toBeInstanceOf(AnalysisProtocolError);
    if (!(failure instanceof Error))
      throw new Error("Expected the SDK to reject the HTTP failure");
    expect(failure.message).toContain(
      prefix + '"[redacted transport credential]"',
    );
    expect(failure.message).not.toContain(credential);
  },
);

it("redacts a JSON-RPC error exactly once after successful HTTP delivery", async () => {
  const { connection } = await fixture({
    configurationHeaders: { Cookie: "token=redacted" },
    toolRpcError: { code: -32602, message: "redacted at /caller/input" },
  });
  await connection.connect();
  const failure = await connection
    .call("first", {})
    .catch((cause: unknown) => cause);
  if (!(failure instanceof Error))
    throw new Error("Expected the SDK to reject the JSON-RPC error");
  expect(failure.cause).toBeInstanceOf(ProtocolError);
  expect(failure.message.endsWith("␟ at /caller/input")).toBe(true);
  expect(failure.message.match(/␟/gu)).toHaveLength(1);
  expect(failure.message).not.toContain("redacted");
});

it.each([
  "<cause-fixture-secret>",
  String.raw`\u003ccause-fixture-secret\u003e`,
])(
  "does not retain sensitive malformed HTTP JSON in inspected causes: %s",
  async (wire) => {
    const { connection } = await fixture({
      configurationHeaders: { Cookie: "session=<cause-fixture-secret>" },
      toolResponseBody: '{"reason":"Rejected ' + wire + " at /caller/input",
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof Error))
      throw new Error("Expected malformed JSON rejection");
    expect(failure.message).toContain(
      "[redacted transport credential] at /caller/input",
    );
    const inspected = inspect(failure, {
      depth: null,
      showHidden: true,
      maxStringLength: null,
    });
    for (const value of [
      "<cause-fixture-secret>",
      wire,
      JSON.stringify(wire).slice(1, -1),
    ])
      expect(inspected).not.toContain(value);
  },
);

it("retains safe JSON-RPC code and message without unknown remote cause data", async () => {
  const { connection } = await fixture({
    configurationHeaders: { Authorization: "Bearer rpc-cause-fixture-secret" },
    toolRpcError: {
      code: -32602,
      message: "Rejected request at /caller/input",
      data: {
        echo: "rpc-cause-fixture-secret",
        nested: { caller: "/caller/input" },
      },
    },
  });
  await connection.connect();
  const failure = await connection
    .call("first", {})
    .catch((cause: unknown) => cause);
  if (!(failure instanceof Error))
    throw new Error("Expected JSON-RPC rejection");
  expect(failure.message).toContain("Rejected request at /caller/input");
  expect(failure.cause).toBeInstanceOf(ProtocolError);
  expect(failure.cause).toMatchObject({ code: -32602 });
  expect(inspect(failure, { depth: null, showHidden: true })).not.toContain(
    "rpc-cause-fixture-secret",
  );
});

it.each([
  "text/html",
  "application/problem+xml",
  "application/octet-stream",
  "text/plain; charset=utf-16",
  "not a media type",
])(
  "omits HTTP error bodies whose declared encoding is unsupported: %s",
  async (toolContentType) => {
    const body =
      "<error>&lt;format-fixture-secret&gt;&amp;/fixture at /caller/input</error>";
    const { connection } = await fixture({
      configurationHeaders: {
        Cookie: "session=<format-fixture-secret>&/fixture",
      },
      toolStatus: 500,
      toolContentType,
      toolResponseBody: body,
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof Error)) throw new Error("Expected HTTP error");
    expect(failure.message).toMatch(/body.*omitted|omitted.*body/iu);
    expect(failure.cause).toMatchObject({ data: { status: 500 } });
    const inspected = inspect(failure, {
      depth: null,
      showHidden: true,
      maxStringLength: null,
    });
    expect(inspected).not.toContain(body);
    expect(inspected).not.toContain("format-fixture-secret");
  },
);

it.each(["native tool", "resource"] as const)(
  "does not retain the producer JSON parse cause for %s text",
  async (source) => {
    const malformedText = '["token",x]';
    const { connection } = await fixture({
      native: true,
      configurationHeaders: { Authorization: "Bearer token" },
      ...(source === "native tool"
        ? { toolResult: { content: [{ type: "text", text: malformedText }] } }
        : { resourceResponseText: malformedText }),
    });
    await connection.connect();
    const failure = await (
      source === "native tool"
        ? connection.call("first", {})
        : connection.readResource?.("ida://idb/metadata")
    )?.catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AnalysisProtocolError);
    expect(inspect(failure, { depth: null, showHidden: true })).not.toContain(
      "token",
    );
  },
);

it.each([200, 500])(
  "preserves owned diagnostic capacity failures through HTTP %s SDK handling",
  async (toolStatus) => {
    const { connection } = await fixture({
      toolStatus,
      toolResponseBody: "malformed fixture JSON",
      connectionDependencies: {
        createDiagnosticRedactor: (config) => {
          const redactor = createIdaDiagnosticRedactor(config);
          return {
            ...redactor,
            json(message: string) {
              throw new IdaDiagnosticResourceError(
                message.length,
                constants.MAX_STRING_LENGTH + 1,
              );
            },
          };
        },
      },
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(IdaDiagnosticResourceError);
    if (!(failure instanceof IdaDiagnosticResourceError))
      throw new Error("Expected an owned diagnostic capacity failure");
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "resource_constraint",
      details: {
        resource: "memory",
        reported_limits: { boundary: "ida-diagnostic-redaction" },
      },
    });
  },
);

it.each(
  [200, 500].flatMap((toolStatus) =>
    ["utf-16le", "utf-16", " = utf-16", "=utf-8; charset=utf-16"].map(
      (charset) => ({ toolStatus, charset }),
    ),
  ),
)(
  "omits unsupported $charset diagnostic bytes from HTTP $toolStatus JSON failures",
  async ({ toolStatus, charset }) => {
    const credential = "charset-fixture-secret";
    const utf16 = Buffer.from('{"reason":"' + credential + '"}', "utf16le");
    const encoded =
      charset === "utf-16"
        ? Buffer.concat([Buffer.from([0xff, 0xfe]), utf16])
        : utf16;
    const { connection } = await fixture({
      configurationHeaders: { Cookie: "session=" + credential },
      toolStatus,
      toolContentType:
        "application/json; charset" +
        (charset.startsWith("=") || charset.startsWith(" ")
          ? charset
          : "=" + charset),
      toolResponseBody: encoded,
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof Error))
      throw new Error("Expected unsupported encoded JSON error");
    expect(failure.message).toMatch(/body.*omitted|omitted.*body/iu);
    expect(failure.message).not.toContain(encoded.toString("utf8"));
    const inspected = inspect(failure, {
      depth: null,
      showHidden: true,
      maxStringLength: null,
    });
    expect(
      inspected
        .replaceAll("\\x00", "")
        .replaceAll("\\u0000", "")
        .replaceAll("\0", ""),
    ).not.toContain(credential);
  },
);

it("retains successfully parsed analysis values despite unsupported declared charset metadata", async () => {
  const observed = "charset-fixture-secret";
  const { connection } = await fixture({
    configurationHeaders: { Cookie: "session=" + observed },
    toolContentType: "application/json; charset=utf-16le",
    toolResult: { content: [], structuredContent: { observed } },
  });
  await connection.connect();
  expect(await connection.call("first", {})).toEqual({ observed });
});

it.each(
  [200, 500].flatMap((toolStatus) =>
    [
      "application/json; charset = utf-16",
      "application/json; charset\t=utf-16le",
      "application/json; charset=utf-8; CHARSET=utf-16le",
      'application/json; note="unterminated; charset=utf-16le',
    ].map((toolContentType) => ({ toolStatus, toolContentType })),
  ),
)(
  "omits encoded diagnostic bytes when Content-Type is incomplete or ambiguous: HTTP $toolStatus $toolContentType",
  async ({ toolStatus, toolContentType }) => {
    const credential = "mime-fixture-secret";
    const { connection } = await fixture({
      configurationHeaders: { Cookie: "session=" + credential },
      toolStatus,
      toolContentType,
      toolResponseBody: Buffer.from(
        '{"reason":"' + credential + '"}',
        "utf16le",
      ),
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof Error))
      throw new Error("Expected malformed Content-Type failure");
    expect(failure.message).toMatch(/body.*omitted|omitted.*body/iu);
    expect(
      inspect(failure, { depth: null, showHidden: true }).replaceAll(
        "\\x00",
        "",
      ),
    ).not.toContain(credential);
  },
);

it.each([
  "application/json; charset=",
  'application/json; charset="utf-8',
  'application/json; charset="utf-8"junk',
  "application/json; note=a,b",
  "application/json; note=a; NOTE=b",
  "text/plain; charset = utf-16",
])(
  "omits error bodies whose whole Content-Type is invalid or conflicting: %s",
  async (toolContentType) => {
    const { connection } = await fixture({
      toolStatus: 500,
      toolContentType,
      toolResponseBody: "untrusted /caller/body",
    });
    await connection.connect();
    await expect(connection.call("first", {})).rejects.toThrow(
      /body.*omitted|omitted.*body/iu,
    );
  },
);

it.each([
  "application/json",
  'Application/Problem+JSON\t; Note="a; charset=utf-16"; ChArSeT="UTF-8"',
  String.raw`application/json; charset="utf\-8"; note="escaped\"quote; slash\\"`,
  'application/json; note=""; charset=utf-8;',
  "application/json;; ;charset=utf-8;",
  "text/plain; note=caller; charset=utf8",
])(
  "retains safe producer diagnostics for complete legal Content-Type: %s",
  async (toolContentType) => {
    const credential = "mime-fixture-secret";
    const reason = "Rejected " + credential + " at /caller/input";
    const { connection } = await fixture({
      configurationHeaders: { Cookie: "session=" + credential },
      toolStatus: 500,
      toolContentType,
      toolResponseBody: toolContentType.startsWith("text/plain")
        ? reason
        : JSON.stringify({ reason }),
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof Error)) throw new Error("Expected upstream error");
    expect(failure.message).toContain(
      "Rejected [redacted transport credential] at /caller/input",
    );
    expect(failure.message).not.toContain("omitted");
    expect(failure.message).not.toContain(credential);
  },
);

it.each(["endpoint", ""])(
  "redacts the complete SDK context when the trusted body repeats its text: %s",
  async (toolResponseBody) => {
    const credential = "Error POSTing to endpoint";
    const { connection } = await fixture({
      toolStatus: 500,
      toolContentType: "text/plain",
      configurationHeaders: { Authorization: "Custom " + credential },
      toolResponseBody,
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof Error)) throw new Error("Expected HTTP failure");
    expect(failure.message).toBe(
      "[redacted transport credential]: \n" + toolResponseBody,
    );
    expect(failure.cause).toMatchObject({ data: { status: 500 } });
    expect(inspect(failure, { depth: null, showHidden: true })).not.toContain(
      credential,
    );
  },
);

it("keeps a sanitized plain HTTP body intact without exempting matching status text", async () => {
  const { connection } = await fixture({
    toolStatus: 500,
    toolStatusText: "abcXdef",
    toolContentType: "text/plain",
    configurationHeaders: {
      Authorization: "Custom abcXdef",
      Cookie: "token=redacted",
    },
    toolResponseBody: "X redacted at /caller/input",
  });
  await connection.connect();
  const failure = await connection
    .call("first", {})
    .catch((cause: unknown) => cause);
  if (!(failure instanceof Error)) throw new Error("Expected HTTP failure");
  expect(failure.message).toContain("X ␟ at /caller/input");
  expect(inspect(failure, { depth: null, showHidden: true })).not.toContain(
    "abcXdef",
  );
});

it("keeps SDK context and the owned body separate when joining them would form a credential", async () => {
  const credential = "endpoint: public";
  const { connection } = await fixture({
    toolStatus: 500,
    toolContentType: "text/plain",
    configurationHeaders: { Authorization: "Custom " + credential },
    toolResponseBody: "public",
  });
  await connection.connect();
  const failure = await connection
    .call("first", {})
    .catch((cause: unknown) => cause);
  if (!(failure instanceof Error)) throw new Error("Expected HTTP failure");
  expect(failure.message).toContain("endpoint: \npublic");
  expect(inspect(failure, { depth: null, showHidden: true })).not.toContain(
    credential,
  );
});

it("keeps owned HTTP JSON failure context separate from the sanitized body", async () => {
  const credential = "Response body: public";
  const { connection } = await fixture({
    configurationHeaders: { Authorization: "Custom " + credential },
    toolResponseBody: "public",
  });
  await connection.connect();
  const failure = await connection
    .call("first", {})
    .catch((cause: unknown) => cause);
  if (!(failure instanceof Error))
    throw new Error("Expected malformed JSON failure");
  expect(failure.message).toContain("Response body: \npublic");
  expect(inspect(failure, { depth: null, showHidden: true })).not.toContain(
    credential,
  );
});

it.each(["tool rejection", "HTTP rejection", "malformed HTTP JSON"] as const)(
  "redacts overlapping credential spans through the SDK: %s",
  async (source) => {
    const reason = "Rejected X]SECRET at /caller/input";
    const { connection } = await fixture({
      configurationHeaders: { Authorization: "Custom X]", Cookie: "a=]SECRET" },
      ...(source === "tool rejection"
        ? {
            toolResult: {
              isError: true,
              content: [{ type: "text", text: reason }],
            },
          }
        : {
            toolStatus: source === "HTTP rejection" ? 500 : 200,
            toolResponseBody:
              String.raw`{"reason":"Rejected X\u005dSECRET at /caller/input"` +
              (source === "HTTP rejection" ? "}" : ",x"),
          }),
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof Error))
      throw new Error("Expected producer failure");
    expect(failure.message).toContain("at /caller/input");
    const retained = inspect(failure, { depth: null, showHidden: true });
    expect(retained).not.toContain("SECRET");
    expect(retained).not.toContain("X]");
  },
);

it("does not introduce a credential at a redaction-marker boundary in a real HTTP failure", async () => {
  const { connection } = await fixture({
    toolStatus: 500,
    toolContentType: "text/plain",
    configurationHeaders: { Authorization: "Custom X", Cookie: "a=]SECRET" },
    toolResponseBody: "Rejected XSECRET at /caller/input",
  });
  await connection.connect();
  const failure = await connection
    .call("first", {})
    .catch((cause: unknown) => cause);
  if (!(failure instanceof Error)) throw new Error("Expected HTTP failure");
  expect(failure.message).toContain("SECRET at /caller/input");
  expect(inspect(failure, { depth: null, showHidden: true })).not.toContain(
    "]SECRET",
  );
});

it.each(
  [
    {
      label: "Basic pair and leading-space password",
      authorization: "Basic ZmFpbGVkOiBwdWJsaWM=",
      forbidden: ["failed: public", " public"],
    },
    {
      label: "opaque payload spanning the tool prefix and body",
      authorization: "Custom failed: public",
      forbidden: ["failed: public"],
    },
    {
      label: "credential equal to the fixed tool prefix",
      authorization: "Custom IDA MCP tool failed",
      forbidden: ["IDA MCP tool failed"],
    },
  ].flatMap((testCase) =>
    [false, true].map((native) => ({ ...testCase, native })),
  ),
)(
  "keeps tool-error owners separate for $label (native: $native)",
  async ({ authorization, forbidden, native }) => {
    const { connection } = await fixture({
      native,
      configurationHeaders: { Authorization: authorization },
      toolResult: {
        isError: true,
        content: [{ type: "text", text: "public" }],
      },
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof AnalysisProtocolError))
      throw new Error("Expected the tool rejection to remain a protocol error");
    expect(failure.message).toContain("public");
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "unreadable_output",
      details: { diagnostics: { reason: "public" } },
    });
    for (const credential of forbidden)
      expect(inspect(failure, { depth: null, showHidden: true })).not.toContain(
        credential,
      );
  },
);

const toolDiagnosticBlockCases: readonly {
  label: string;
  headers: Readonly<Record<string, string>>;
  blocks: readonly string[];
  safeBlocks: readonly string[];
}[] = [
  {
    label: "JSON-escaped quoted credential without rewriting other source",
    headers: { Authorization: 'Custom q"uote' },
    blocks: [
      '{"error":"Rejected q\\"uote at /caller/input","amount":9007199254740993,"duplicate":1,"duplicate":2}',
    ],
    safeBlocks: [
      '{"error":"Rejected [redacted transport credential] at /caller/input","amount":9007199254740993,"duplicate":1,"duplicate":2}',
    ],
  },
  {
    label: "independent JSON arrays, escaped keys and surrogate pairs",
    headers: {
      Authorization:
        "Basic " + Buffer.from("user:😀", "utf8").toString("base64"),
      Cookie: "token=<json-secret>; syntax=u003c",
    },
    blocks: [
      "Plain status at /caller/plain",
      '[{"path":"/caller/array"},"\\u003cjson-secret\\u003e"]',
      '{"\\u003cjson-secret\\u003e":"key context","emoji":"\\uD83d\\uDE00 at /caller/emoji"}',
      '{"public":"\\u003cpublic\\u003e","amount":9007199254740993}',
    ],
    safeBlocks: [
      "Plain status at /caller/plain",
      '[{"path":"/caller/array"},"[redacted transport credential]"]',
      '{"[redacted transport credential]":"key context","emoji":"[redacted transport credential] at /caller/emoji"}',
      '{"public":"\\[redacted transport credential]public\\u003e","amount":9007199254740993}',
    ],
  },
  {
    label:
      "unclassified text retains both raw and decoded credential candidates",
    headers: {
      Authorization: "Custom folder\\tmp",
      Cookie: "token=<public>",
    },
    blocks: [
      "Rejected folder\\tmp at /caller/plain; literal \\u003cpublic\\u003e",
    ],
    safeBlocks: [
      "Rejected [redacted transport credential] at /caller/plain; literal [redacted transport credential]",
    ],
  },
  {
    label: "quoted plain backslash credential despite valid JSON appearance",
    headers: { Authorization: "Custom folder\\tmp" },
    blocks: [String.raw`"folder\tmp at /caller/input"`],
    safeBlocks: ['"[redacted transport credential] at /caller/input"'],
  },
  {
    label: "malformed JSON quote escapes and independent context",
    headers: { Authorization: 'Custom q"uote' },
    blocks: [
      String.raw`{"error":"Rejected q\"uote at /caller/input`,
      "Second context at /caller/second",
    ],
    safeBlocks: [
      '{"error":"Rejected [redacted transport credential] at /caller/input',
      "Second context at /caller/second",
    ],
  },
];

it.each(
  toolDiagnosticBlockCases.flatMap((testCase) =>
    [false, true].map((native) => ({ ...testCase, native })),
  ),
)(
  "owns each SDK tool diagnostic block as $label (native: $native)",
  async ({ headers, blocks, safeBlocks, native }) => {
    const { connection } = await fixture({
      native,
      configurationHeaders: headers,
      toolResult: {
        isError: true,
        content: blocks.map((text) => ({ type: "text", text })),
      },
    });
    await connection.connect();
    const failure = await connection
      .call("first", {})
      .catch((cause: unknown) => cause);
    if (!(failure instanceof AnalysisProtocolError))
      throw new Error("Expected the tool rejection to remain a protocol error");
    const reason = safeBlocks.join("\n");
    expect(failure.message.endsWith(reason)).toBe(true);
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "unreadable_output",
      details: { diagnostics: { reason } },
    });
  },
);
