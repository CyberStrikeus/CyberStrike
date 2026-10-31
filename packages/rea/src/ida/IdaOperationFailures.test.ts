import { rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createIdaTarget,
  RecordingIdaMcp,
} from "../../tests/fixtures/idaMcp.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { createAnalysisProfile } from "../domain/analysisProfile.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { createIdaDiagnosticRedactor } from "./IdaDiagnosticRedactor.js";
import { decodeIdaToolResult } from "./IdaMcpConnection.js";
import { IDA_PROVIDER_IDENTITY } from "./IdaProviderCapabilities.js";
import type { AnalysisOperation } from "../application/AnalysisProvider.js";
import { IdaSessionClient } from "./IdaSessionClient.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

it("preserves a rejected headless decompile diagnostic with completed lookup evidence and releases its owned worker", async () => {
  const { root, target } = await createIdaTarget();
  roots.push(root);
  const producer = new RecordingIdaMcp(target, "headless");
  const reason =
    "Invalid params: unexpected parameters: ['offset', 'max_lines']";
  const config = {
    url: "http://127.0.0.1:12345/mcp",
    headers: {
      Authorization: "Token custom-fixture-token",
      Cookie: "session=cookie-fixture-secret",
    },
    mode: "headless" as const,
    timeoutMs: 1000,
    workspaceRoot: root,
  };
  const redactor = createIdaDiagnosticRedactor(config);
  producer.beforeCall = async (name) => {
    if (name === "decompile")
      decodeIdaToolResult(
        {
          isError: true,
          content: [
            {
              type: "text",
              text: reason + " (custom-fixture-token / cookie-fixture-secret)",
            },
          ],
        },
        undefined,
        redactor,
      );
  };
  const safeReason =
    reason +
    " ([redacted transport credential] / [redacted transport credential])";
  const client = new IdaSessionClient(config, target, producer);
  try {
    const result = await client.execute("procedure_pseudo_code", {
      procedure: "main",
    });
    if (result.ok) throw new Error("Expected the upstream rejection");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unreadable_output",
      details: {
        diagnostics: { reason: safeReason },
        partial_observation: {
          provider: { id: "ida" },
          operation: "procedure_pseudo_code",
          normalized_result: {
            status: "partial",
            observations: [expect.objectContaining({ tool: "lookup_funcs" })],
            target_binding: {
              status: "not_verified",
              reason: "IDA MCP tool failed: \n" + safeReason,
            },
          },
        },
      },
    });
    expect(JSON.stringify(projectAnalysisError(result.error))).not.toContain(
      "custom-fixture-token",
    );
    expect(JSON.stringify(projectAnalysisError(result.error))).not.toContain(
      "cookie-fixture-secret",
    );
    expect(
      producer.calls.find(({ name }) => name === "decompile"),
    ).toMatchObject({
      args: { addr: "0x1000", offset: 0, max_lines: 100 },
    });
  } finally {
    const database = producer.database;
    expect((await client.close()).ok).toBe(true);
    expect(producer.calls.filter(({ name }) => name === "idb_close")).toEqual([
      { name: "idb_close", args: { database, save: false } },
    ]);
    expect(producer.closes).toBe(1);
    await expect(stat(dirname(producer.inputPath))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
});

describe("headless IDA tool diagnostics in partial evidence", () => {
  const callerPath = "/caller/input?token=visible";
  const marker = "[redacted transport credential]";
  it.each([
    {
      name: "a decoded Basic password matching the tool failure prefix",
      password: "failed",
      upstream: "Rejected decompile request for " + callerPath,
      safeReason: "Rejected decompile request for " + callerPath,
      forbiddenInBinding: ["failed"],
    },
    {
      name: "a JSON-encoded tool explanation",
      password: "<secret>",
      upstream: String.raw`{"reason":"\u003csecret\u003e","user":"user","path":"/caller/input?token=visible"}`,
      safeReason:
        '{"reason":"' +
        marker +
        '","user":"user","path":"/caller/input?token=visible"}',
      forbiddenInBinding: ["<secret>", String.raw`\u003csecret\u003e`],
    },
  ])(
    "redacts $name before retaining the public target-binding reason",
    async ({ password, upstream, safeReason, forbiddenInBinding }) => {
      const { root, target } = await createIdaTarget();
      roots.push(root);
      const producer = new RecordingIdaMcp(target, "headless");
      const config = {
        url: "http://127.0.0.1:12345/mcp",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from("user:" + password, "utf8").toString("base64"),
        },
        mode: "headless" as const,
        timeoutMs: 1000,
        workspaceRoot: root,
      };
      const redactor = createIdaDiagnosticRedactor(config);
      producer.beforeCall = async (name) => {
        if (name === "decompile")
          decodeIdaToolResult(
            { isError: true, content: [{ type: "text", text: upstream }] },
            undefined,
            redactor,
          );
      };
      const client = new IdaSessionClient(config, target, producer);
      try {
        const result = await client.execute("procedure_pseudo_code", {
          procedure: "main",
        });
        if (result.ok) throw new Error("Expected the producer's tool error");
        const projected = projectAnalysisError(result.error);
        expect(projected).toMatchObject({
          code: "unreadable_output",
          details: {
            partial_observation: {
              provider: { id: "ida" },
              operation: "procedure_pseudo_code",
              normalized_result: {
                status: "partial",
                observations: [
                  expect.objectContaining({ tool: "lookup_funcs" }),
                ],
                target_binding: {
                  status: "not_verified",
                  reason: expect.any(String),
                },
              },
            },
          },
        });
        const details = z
          .object({
            diagnostics: z.object({ reason: z.string() }),
            partial_observation: z.object({
              normalized_result: z.object({
                target_binding: z.object({ reason: z.string() }),
              }),
            }),
          })
          .parse(projected.details);
        const bindingReason =
          details.partial_observation.normalized_result.target_binding.reason;
        for (const credential of forbiddenInBinding)
          expect.soft(bindingReason).not.toContain(credential);
        expect.soft(bindingReason).toContain(marker);
        expect(bindingReason).toContain(callerPath);
        expect.soft(details.diagnostics.reason).toBe(safeReason);
      } finally {
        expect((await client.close()).ok).toBe(true);
        expect(
          producer.calls.filter(({ name }) => name === "idb_close"),
        ).toHaveLength(1);
        await expect(stat(dirname(producer.inputPath))).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    },
  );
});

describe("headless IDA partial operation evidence", () => {
  it("retains completed rows when post-operation target identity changes", async () => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const producer = new RecordingIdaMcp(target, "headless");
    let healthReads = 0;
    producer.overrideCall = (name) => {
      if (name !== "server_health") return undefined;
      healthReads += 1;
      return healthReads === 2
        ? {
            status: "ok",
            input_path: "/different/target.elf",
            idb_path: "/different/target.elf.i64",
            module: "target.elf",
            imagebase: "0x1000",
            auto_analysis_ready: true,
          }
        : undefined;
    };
    const client = new IdaSessionClient(
      {
        command: "fixture",
        args: [],
        env: {},
        mode: "headless",
        timeoutMs: 1000,
        workspaceRoot: root,
      },
      target,
      producer,
    );
    try {
      const result = await client.execute("list_procedures", {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("identity changed");
        expect(result.error.partialObservation).toMatchObject({
          normalized_result: {
            status: "partial",
            observations: [expect.objectContaining({ tool: "list_funcs" })],
            target_binding: {
              status: "not_verified",
              reason: expect.stringContaining("identity changed"),
            },
            metadata_after: {
              input_path: "/different/target.elf",
              idb_path: "/different/target.elf.i64",
            },
          },
          raw_result: {
            post_operation_identity_check: "started",
            metadata_after: {
              input_path: "/different/target.elf",
              idb_path: "/different/target.elf.i64",
            },
          },
        });
      }
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("retains completed replies when cancellation arrives after a reply", async () => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const producer = new RecordingIdaMcp(target, "headless");
    const controller = new AbortController();
    producer.beforeCall = async (name) => {
      if (name === "list_funcs") controller.abort();
    };
    const client = new IdaSessionClient(
      {
        command: "fixture",
        args: [],
        env: {},
        mode: "headless",
        timeoutMs: 1000,
        workspaceRoot: root,
      },
      target,
      producer,
    );
    try {
      const result = await client.execute(
        "list_procedures",
        {},
        { signal: controller.signal },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.partialObservation).toMatchObject({
          analysis_profile: null,
          normalized_result: {
            status: "partial",
            observations: [expect.objectContaining({ tool: "list_funcs" })],
          },
        });
      }
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});

it("retains the session analysis profile when an operation fails after a completed reply", async () => {
  const { root, target } = await createIdaTarget();
  roots.push(root);
  const producer = new RecordingIdaMcp(target, "headless");
  producer.beforeCall = async (name) => {
    if (name === "decompile")
      decodeIdaToolResult({
        isError: true,
        content: [{ type: "text", text: "Decompiler failed" }],
      });
  };
  const profile = createAnalysisProfile(IDA_PROVIDER_IDENTITY, {
    mode: "headless",
    protocol: "modern",
    compatibility_profile: "database-supervisor",
    database_revision: null,
    cache_policy: "live",
    registration_digest: "a".repeat(64),
  });
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode: "headless",
      timeoutMs: 1000,
      workspaceRoot: root,
    },
    target,
    producer,
    profile,
  );
  try {
    const result = await client.execute("procedure_pseudo_code", {
      procedure: "main",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.partialObservation).toMatchObject({
        analysis_profile: profile,
        normalized_result: {
          status: "partial",
          observations: [expect.objectContaining({ tool: "lookup_funcs" })],
        },
      });
      expect(
        projectAnalysisError(result.error).details?.partial_observation,
      ).toMatchObject({
        analysis_profile: profile,
      });
    }
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
});

describe("headless IDA operation failures", () => {
  it.each<{
    tool: string;
    operation: AnalysisOperation;
    parameters: Readonly<Record<string, JsonValue>>;
    response: JsonValue;
  }>([
    {
      tool: "decompile",
      operation: "procedure_pseudo_code",
      parameters: { procedure: "main" },
      response: { code: "partial pseudocode", cursor: { done: true } },
    },
    {
      tool: "xrefs_to",
      operation: "xrefs",
      parameters: { address: "0x1000" },
      response: [{ xrefs: [], more: false }],
    },
    {
      tool: "callees",
      operation: "procedure_callees",
      parameters: { procedure: "main" },
      response: [{ callees: [], more: false }],
    },
    {
      tool: "decompile",
      operation: "analyze_function",
      parameters: { procedure: "main" },
      response: { code: "partial pseudocode", cursor: { done: true } },
    },
    {
      tool: "callees",
      operation: "analyze_function",
      parameters: { procedure: "main" },
      response: [{ callees: [], more: false }],
    },
  ])(
    "preserves $tool failure through $operation when the producer also supplies preview data",
    async ({ tool, operation, parameters, response }) => {
      const { root, target } = await createIdaTarget();
      roots.push(root);
      const producer = new RecordingIdaMcp(target, "headless");
      const failure =
        "Database analysis interrupted while reading observations";
      producer.overrideCall = (name) => {
        if (name !== tool) return undefined;
        const withError = (value: JsonValue): JsonValue => {
          if (
            value === null ||
            typeof value !== "object" ||
            Array.isArray(value)
          )
            throw new TypeError("Invalid operation fixture");
          return { ...value, error: failure };
        };
        return Array.isArray(response)
          ? response.map(withError)
          : withError(response);
      };
      const client = new IdaSessionClient(
        {
          command: "fixture",
          args: [],
          env: {},
          mode: "headless",
          timeoutMs: 1000,
          workspaceRoot: root,
        },
        target,
        producer,
      );
      try {
        const result = await client.execute(operation, parameters);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain(failure);
          expect(result.error.partialObservation).toMatchObject({
            provider: { id: "ida" },
            operation,
            parameters,
            normalized_result: {
              status: "partial",
              failed_operation: operation,
              observations: expect.arrayContaining([
                expect.objectContaining({ tool }),
              ]),
              metadata_before: expect.any(Object),
            },
            locations: expect.arrayContaining([
              { kind: "artifact-path", path: target.path },
            ]),
          });
          expect(
            projectAnalysisError(result.error).details?.partial_observation,
          ).toMatchObject({ normalized_result: { status: "partial" } });
        }
      } finally {
        expect((await client.close()).ok).toBe(true);
      }
    },
  );
});

const lookup = (query: string, fn: JsonValue, error: string | null) => [
  { query, fn, error },
];
const knownFunction = { addr: "0x1000", name: "main", size: "0x20" };

const missingProcedureFixture = async (
  answer: (query: string) => JsonValue | undefined,
) => {
  const { root, target } = await createIdaTarget();
  roots.push(root);
  const producer = new RecordingIdaMcp(target, "headless");
  producer.overrideCall = (name, args) => {
    if (name !== "lookup_funcs") return undefined;
    const queries = args.queries;
    const query = Array.isArray(queries) ? String(queries[0]) : "";
    return answer(query);
  };
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode: "headless",
      timeoutMs: 1000,
      workspaceRoot: root,
    },
    target,
    producer,
  );
  return client;
};

describe("headless IDA procedure lookup failures", () => {
  it.each([
    ["Not found", "procedure_pseudo_code", "main"],
    ["Not found", "procedure_address", "main"],
    ["Not found", "analyze_function", "main"],
    ["Not a function", "procedure_pseudo_code", "main"],
    ["Not a function", "read_function_instructions", "main"],
    ["Not a function", "procedure_pseudo_code", "0x1000"],
    ["Not found", "procedure_assembly", "_missing"],
    ["Not found", "procedure_pseudo_code", "main\nsecond line"],
  ] as const)(
    "reports the upstream %s answer for %s of %s as an invalid request naming the procedure",
    async (upstream, operation, procedure) => {
      const client = await missingProcedureFixture((query) =>
        lookup(query, null, upstream),
      );
      try {
        const result = await client.execute(operation, { procedure });

        if (result.ok) throw new Error("expected invalid input");
        expect(result.error._tag, "the caller's procedure is the fault").toBe(
          "AnalysisInputError",
        );
        const projected = projectAnalysisError(result.error);
        expect(projected.code, "the public code is invalid_request").toBe(
          "invalid_request",
        );
        expect(projected.category, "the category is invalid_input").toBe(
          "invalid_input",
        );
        expect(
          projected.retryable,
          "an unchanged invalid request is not retryable",
        ).toBe(false);
        expect(
          projected.details,
          "the operation and exactly one issue that names the procedure in its message",
        ).toMatchObject({
          operation,
          issues: [
            {
              path: [],
              reason: "invalid_value",
              message: `IDA could not resolve procedure ${JSON.stringify(procedure)}: ${upstream}.`,
            },
          ],
        });
        if (!(result.error instanceof AnalysisInputError))
          throw new Error("expected an AnalysisInputError");
        expect(
          result.error.issues.map(({ message }) => message ?? "").join(""),
          "a control character in the query is carried JSON-escaped, never raw",
        ).not.toContain("\n");
        expect(
          (result.error.cause as Error | undefined)?.message,
          "the upstream text stays on the retained cause",
        ).toContain(upstream);
        expect(
          JSON.stringify(projected).toLowerCase(),
          "no retry or doctor advice for a caller mistake",
        ).not.toMatch(/doctor|retry once/u);
      } finally {
        expect((await client.close()).ok).toBe(true);
      }
    },
  );

  it.each([
    ["an upstream exception text", lookup("main", null, "Database is closed")],
    ["a function with an error", lookup("main", knownFunction, "Not found")],
    ["neither a function nor an error", lookup("main", null, null)],
    [
      "a near-miss spelling of the not-found text",
      lookup("main", null, "not found"),
    ],
    [
      "an exception text that merely contains the not-found text",
      lookup("main", null, "Database lookup failed: Not found"),
    ],
    ["a padded not-found text", lookup("main", null, " Not found ")],
    ["an empty error", lookup("main", null, "")],
    ["a whitespace-only error", lookup("main", null, "  ")],
    ["an answer for a different query", lookup("helper", null, "Not found")],
    [
      "a successful answer for a different query",
      lookup("helper", knownFunction, null),
    ],
  ])("keeps %s as unreadable output", async (_label, answer) => {
    const client = await missingProcedureFixture(() => answer);
    try {
      const result = await client.execute("procedure_pseudo_code", {
        procedure: "main",
      });

      if (result.ok) throw new Error("expected unreadable output");
      expect(result.error._tag, "a producer fault, not caller input").toBe(
        "AnalysisProtocolError",
      );
      expect(
        projectAnalysisError(result.error).code,
        "unknown beats a wrong fact about the caller's input",
      ).toBe("unreadable_output");
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("keeps an unresolvable callee reported by IDA itself as unreadable output", async () => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const producer = new RecordingIdaMcp(target, "headless");
    producer.overrideCall = (name, args) => {
      if (name === "callees")
        return [
          {
            callees: [{ addr: "0x2000", name: "sub_2000", type: "internal" }],
            more: false,
          },
        ];
      if (name !== "lookup_funcs") return undefined;
      const queries = args.queries;
      const query = Array.isArray(queries) ? String(queries[0]) : "";
      return query === "0x2000"
        ? lookup(query, null, "Not a function")
        : lookup(query, knownFunction, null);
    };
    const client = new IdaSessionClient(
      {
        command: "fixture",
        args: [],
        env: {},
        mode: "headless",
        timeoutMs: 1000,
        workspaceRoot: root,
      },
      target,
      producer,
    );
    try {
      const result = await client.execute("procedure_callees", {
        procedure: "main",
      });

      if (result.ok) throw new Error("expected unreadable output");
      expect(
        projectAnalysisError(result.error).code,
        "an address IDA itself reported is not the caller's mistake",
      ).toBe("unreadable_output");
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});

describe("provider-derived procedure selectors", () => {
  it.each(["Not found", "Not a function"])(
    "reports a derived selector answered %s as a producer fault",
    async (upstream) => {
      const client = await missingProcedureFixture((query) =>
        lookup(query, null, upstream),
      );
      try {
        const result = await client.execute(
          "procedure_callees",
          { procedure: "0x2000" },
          { selectorOrigin: "provider" },
        );

        if (result.ok) throw new Error("expected a producer fault");
        expect(result.error._tag, "not the caller's mistake").toBe(
          "AnalysisProtocolError",
        );
        expect(
          projectAnalysisError(result.error).code,
          "projected as on main",
        ).toBe("unreadable_output");
      } finally {
        expect((await client.close()).ok).toBe(true);
      }
    },
  );
});

describe("attached IDA procedure lookup failures", () => {
  it("leaves a failed legacy lookup as unreadable output", async () => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const producer = new RecordingIdaMcp(target, "attached");
    producer.overrideCall = (name) =>
      name === "get_function_by_name" ? null : undefined;
    const client = new IdaSessionClient(
      {
        command: "fixture",
        args: [],
        env: {},
        mode: "attached",
        timeoutMs: 1000,
        workspaceRoot: root,
      },
      target,
      producer,
    );
    try {
      const result = await client.execute("procedure_pseudo_code", {
        procedure: "main",
      });

      if (result.ok) throw new Error("expected unreadable output");
      expect(
        projectAnalysisError(result.error).code,
        "the legacy profile keeps its pre-existing classification",
      ).toBe("unreadable_output");
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("leaves an MCP error reply for an unknown legacy name as unreadable output", async () => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const producer = new RecordingIdaMcp(target, "attached");
    producer.beforeCall = async (name) => {
      if (name === "get_function_by_name")
        decodeIdaToolResult({
          content: [{ type: "text", text: "Function not found: main" }],
          isError: true,
        });
    };
    const client = new IdaSessionClient(
      {
        command: "fixture",
        args: [],
        env: {},
        mode: "attached",
        timeoutMs: 1000,
        workspaceRoot: root,
      },
      target,
      producer,
    );
    try {
      const result = await client.execute("procedure_pseudo_code", {
        procedure: "main",
      });

      if (result.ok) throw new Error("expected unreadable output");
      expect(
        result.error._tag,
        "a producer error reply, not caller input",
      ).toBe("AnalysisProtocolError");
      expect(
        projectAnalysisError(result.error).code,
        "the legacy profile keeps its existing classification",
      ).toBe("unreadable_output");
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});
