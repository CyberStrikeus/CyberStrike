import { describe, expect, it } from "vitest";

import { createJebAnalysisProvider } from "../composition/jeb.js";
import { JebProvider } from "./JebProvider.js";
import { decodeJebToolResult } from "./JebMcpConnection.js";
import type {
  JebMcpConnection,
  JebMcpConnectionTimeouts,
} from "./JebMcpConnection.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisProtocolError,
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import { parseEvidence } from "../domain/evidence.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  jebRequestSchema,
  jebResultSchemas,
} from "../domain/jeb/jebAnalysis.js";

const scriptedConnection = (
  responses: Readonly<Record<string, JsonValue | Error>>,
): JebMcpConnection & { readonly calls: unknown[][] } => {
  const calls: unknown[][] = [];
  return {
    calls,
    async connect() {
      return Object.keys(responses);
    },
    async listTools() {
      return Object.keys(responses);
    },
    async call(name, args) {
      calls.push([name, args]);
      const response = responses[name];
      if (response === undefined)
        throw new Error(`Unexpected JEB MCP call: ${name}`);
      if (response instanceof Error) throw response;
      return response;
    },
    async close() {},
  };
};

const providerWith = (connection: JebMcpConnection) =>
  new JebProvider({
    environment: { REA_JEB_MCP_URL: "http://127.0.0.1:8425/mcp" },
    connectionFactory: () => connection,
  });

describe("JebProvider live availability", () => {
  it("retains the caller-selected endpoint spelling in results and failures", async () => {
    const endpoint = "HTTP://127.0.0.1:08425/mcp";
    const provider = new JebProvider({
      environment: { REA_JEB_MCP_URL: endpoint },
      connectionFactory: () =>
        scriptedConnection({
          get_client_information: { success: true, version: "5.48.0" },
          list_units: new Error("connection closed"),
        }),
    });
    try {
      expect((await provider.inspectAvailability()).diagnostics).toMatchObject({
        endpoint,
      });
      const observation = await provider.execute({
        operation: "inspect_jeb_client",
        input: {},
      });
      if (!observation.ok) throw observation.error;
      expect(
        jebResultSchemas.inspect_jeb_client.parse(observation.value.result)
          .engine.endpoint,
      ).toBe(endpoint);
      const failure = await provider.execute({
        operation: "list_jeb_units",
        input: { count: 10, index: 0 },
      });
      if (failure.ok) throw new Error("Expected transport failure");
      expect(failure.error.diagnostics).toMatchObject({ endpoint });
    } finally {
      await provider.close();
    }
  });

  it("passes its validated environment timeout to the production connection", async () => {
    let configured: JebMcpConnectionTimeouts | undefined;
    const provider = createJebAnalysisProvider(
      { REA_JEB_MCP_TIMEOUT_MS: "900000" },
      (_endpoint, timeouts) => {
        configured = timeouts;
        return scriptedConnection({});
      },
    );
    expect(configured).toEqual({
      requestTimeoutMs: 900_000,
      discoveryTimeoutMs: 900_000,
    });
    await provider.close();
  });

  it("rejects an invalid JEB timeout before constructing its MCP connection", async () => {
    let constructed = false;
    const provider = createJebAnalysisProvider(
      { REA_JEB_MCP_TIMEOUT_MS: "0" },
      () => {
        constructed = true;
        return scriptedConnection({});
      },
    );
    expect(constructed).toBe(false);
    await expect(provider.inspectAvailability()).resolves.toMatchObject({
      status: "unavailable",
      diagnostics: { setting: "REA_JEB_MCP_TIMEOUT_MS" },
    });
    await provider.close();
  });

  it("reports only the operations advertised by the live engine", async () => {
    const connection = scriptedConnection({
      get_client_information: {
        success: true,
        version: "5.48.0",
        gui_client: false,
      },
      list_units: { success: true, units: [] },
      decompile_code_item: { success: true, text: "" },
    });
    const provider = providerWith(connection);
    expect(await provider.inspectAvailability()).toMatchObject({
      status: "available",
      supportedOperations: [
        "inspect_jeb_client",
        "list_jeb_units",
        "decompile_jeb_item",
      ],
    });
    expect(connection.calls).toEqual([["get_client_information", {}]]);
  });

  it("refreshes live operation support rather than reusing a readiness snapshot", async () => {
    const connection = scriptedConnection({
      get_client_information: { success: true, version: "5.48.0" },
    });
    let tools = ["get_client_information", "open_project"];
    connection.listTools = async () => tools;
    const provider = providerWith(connection);
    expect(await provider.inspectAvailability()).toMatchObject({
      supportedOperations: ["inspect_jeb_client", "open_jeb_project"],
    });
    tools = ["get_client_information"];
    expect(await provider.inspectAvailability()).toMatchObject({
      supportedOperations: ["inspect_jeb_client"],
    });
    expect(connection.calls).toHaveLength(2);
  });
});

describe("JebProvider endpoint diagnostics", () => {
  it("retains the selected endpoint on malformed MCP results without replacing the protocol failure", async () => {
    let failure: unknown;
    try {
      decodeJebToolResult({ content: [] });
    } catch (cause) {
      failure = cause;
    }
    if (!(failure instanceof AnalysisProtocolError))
      throw new Error("Expected a protocol failure");
    failure.retainDiagnostics({ phase: "decode" });
    const connection = scriptedConnection({ get_client_information: failure });
    const provider = providerWith(connection);
    try {
      const result = await provider.execute({
        operation: "inspect_jeb_client",
        input: {},
      });
      if (result.ok) throw new Error("Expected a malformed response failure");
      expect(result.error).toBe(failure);
      expect(result.error.diagnostics).toEqual({
        phase: "decode",
        endpoint: "http://127.0.0.1:8425/mcp",
      });
    } finally {
      await provider.close();
    }
  });

  it("retains the selected endpoint when cancelled before execution", async () => {
    const connection = scriptedConnection({});
    const provider = providerWith(connection);
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    controller.abort(reason);
    try {
      const result = await provider.execute(
        { operation: "inspect_jeb_client", input: {} },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error).toBeInstanceOf(AnalysisCancelledError);
      expect(result.error.cause).toBe(reason);
      expect(result.error.diagnostics).toEqual({
        endpoint: "http://127.0.0.1:8425/mcp",
      });
      expect(connection.calls).toEqual([]);
    } finally {
      await provider.close();
    }
  });
});

describe("JebProvider observations and failures", () => {
  it("normalizes client information and caches engine identity", async () => {
    const connection = scriptedConnection({
      get_client_information: {
        success: true,
        version: "5.48.0.202610071539",
        gui_client: false,
        startup_ts: 1791623439,
      },
    });
    const provider = providerWith(connection);
    const result = await provider.execute({
      operation: "inspect_jeb_client",
      input: {},
    });
    if (!result.ok) throw result.error;
    const normalized = jebResultSchemas.inspect_jeb_client.parse(
      result.value.result,
    );
    expect(normalized.engine.version).toBe("5.48.0.202610071539");
    expect(normalized.startup_ts).toBe(1791623439);
    expect(result.value.provider.version).toBe("5.48.0.202610071539");
  });

  it("reports unavailable when the engine endpoint is unreachable", async () => {
    const provider = providerWith(
      scriptedConnection({
        get_client_information: new Error(
          "connect ECONNREFUSED 127.0.0.1:8425",
        ),
        list_units: new Error("connect ECONNREFUSED 127.0.0.1:8425"),
      }),
    );
    const availability = await provider.inspectAvailability();
    expect(availability.status).toBe("unavailable");
    expect(availability.reason).toContain("Start a JEB client serving MCP");
    expect(availability.reason).toContain("REA_JEB_MCP_URL");
    const result = await provider.execute({
      operation: "list_jeb_units",
      input: { count: 10, index: 0 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCapabilityUnavailableError);
    expect(result.error.message).toContain("ECONNREFUSED");
    expect(projectAnalysisError(result.error)).toMatchObject({
      details: { diagnostics: { endpoint: "http://127.0.0.1:8425/mcp" } },
    });
  });

  it("maps transport failures during an operation to provider unavailability", async () => {
    const provider = providerWith(
      scriptedConnection({
        get_client_information: {
          success: true,
          version: "5.48.0",
          gui_client: false,
        },
        list_units: new Error("connect ECONNREFUSED 127.0.0.1:8425"),
      }),
    );
    const result = await provider.execute({
      operation: "list_jeb_units",
      input: { count: 10, index: 0 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCapabilityUnavailableError);
    expect(result.error.message).toContain("ECONNREFUSED");
  });

  it("preserves engine refusal reasons without inferring unsupported target formats", async () => {
    const provider = providerWith(
      scriptedConnection({
        get_client_information: {
          success: true,
          version: "5.48.0",
          gui_client: false,
        },
        decompile_code_item: {
          success: false,
          message:
            "The decompilation failed because the item address does not reference an existing code item",
        },
      }),
    );
    const result = await provider.execute({
      operation: "decompile_jeb_item",
      input: { item_address: "LNope;->x()V", item_kind: "method" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error).message).toContain(
      "does not reference an existing",
    );
  });

  it("derives partial coverage only from a full engine page", async () => {
    const provider = providerWith(
      scriptedConnection({
        get_client_information: {
          success: true,
          version: "5.48.0",
          gui_client: false,
        },
        list_units: {
          success: true,
          units: Array.from({ length: 3 }, (_, index) => ({
            unit_path: `a/class${index}.dex`,
            unit_type: "dex",
          })),
        },
      }),
    );
    const full = await provider.execute({
      operation: "list_jeb_units",
      input: { count: 3, index: 0 },
    });
    if (!full.ok) throw full.error;
    expect(
      jebResultSchemas.list_jeb_units.parse(full.value.result).coverage,
    ).toBe("partial");
    const last = await provider.execute({
      operation: "list_jeb_units",
      input: { count: 4, index: 0 },
    });
    if (!last.ok) throw last.error;
    expect(
      jebResultSchemas.list_jeb_units.parse(last.value.result).coverage,
    ).toBe("complete");
  });
});

describe("JebProvider open project inventories", () => {
  it.each(["input_files", "units"] as const)(
    "rejects an omitted %s inventory from a successful project response",
    async (omitted) => {
      const project = {
        success: true,
        name: "empty-project",
        creation_datetime: "2026-10-12T00:00:00",
        input_files: [],
        units: [],
      };
      const response = { ...project };
      delete response[omitted];
      const provider = providerWith(
        scriptedConnection({
          get_client_information: { success: true, version: "5.48.0" },
          open_project: response,
        }),
      );

      const result = await provider.execute({
        operation: "open_jeb_project",
        input: { path: "probe.apk" },
      });

      if (result.ok) throw new Error("Expected an omitted inventory failure");
      expect(result.error).toBeInstanceOf(AnalysisProtocolError);
    },
  );

  it("preserves explicitly empty project inventories", async () => {
    const provider = providerWith(
      scriptedConnection({
        get_client_information: { success: true, version: "5.48.0" },
        open_project: {
          success: true,
          name: "empty-project",
          creation_datetime: "2026-10-12T00:00:00",
          input_files: [],
          units: [],
        },
      }),
    );

    const result = await provider.execute({
      operation: "open_jeb_project",
      input: { path: "probe.apk" },
    });

    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({
      input_files: [],
      units: [],
    });
  });
});

describe("JebProvider target and endpoint selection", () => {
  it("keeps the implicitly selected unit unknown when unit_path is omitted", async () => {
    const provider = providerWith(
      scriptedConnection({
        get_client_information: {
          success: true,
          version: "5.48.0",
          gui_client: false,
        },
        decompile_code_item: { success: true, text: "int x() { return 1; }" },
      }),
    );
    const result = await provider.execute({
      operation: "decompile_jeb_item",
      input: { item_address: "LFoo;->x()I", item_kind: "method" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const normalized = result.value.result as {
      readonly unit_path: string | null;
    };
    expect(normalized.unit_path).toBeNull();
    expect(result.value.limitations.join(" ")).toContain("implicitly");
  });

  it("rejects unusable endpoints at construction", () => {
    const rejection = (value: string): AnalysisInputError => {
      try {
        new JebProvider({ environment: { REA_JEB_MCP_URL: value } });
      } catch (cause) {
        if (cause instanceof AnalysisInputError) return cause;
        throw cause;
      }
      throw new Error("endpoint should have been rejected");
    };
    expect(rejection("ftp://example.invalid/mcp").cause).toMatch(
      /http and https/,
    );
    expect(rejection("http://user:pass@127.0.0.1:8425/mcp").cause).toMatch(
      /credentials/,
    );
  });
});

it("refuses remote endpoints before constructing a connection", () => {
  expect(
    () =>
      new JebProvider({
        environment: { REA_JEB_MCP_URL: "http://example.com/mcp" },
      }),
  ).toThrow(AnalysisInputError);
});

it.each(["list_jeb_units", "decompile_jeb_item"] as const)(
  "rejects an omitted successful payload for %s",
  async (operation) => {
    const provider = providerWith(
      scriptedConnection({
        get_client_information: { success: true, version: "5.48.0" },
        list_units: { success: true },
        decompile_code_item: { success: true },
      }),
    );
    const result = await provider.execute(
      operation === "list_jeb_units"
        ? { operation, input: { count: 10, index: 0 } }
        : {
            operation,
            input: { item_address: "LTest;->x()V", item_kind: "method" },
          },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisProtocolError);
  },
);

it("forwards in-flight cancellation to the MCP call", async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const provider = providerWith({
    async connect() {
      return ["get_client_information"];
    },
    async listTools() {
      return ["get_client_information"];
    },
    async close() {},
    async call(_name, _args, signal) {
      entered();
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener(
          "abort",
          () =>
            reject(
              new AnalysisCancelledError(_name, { cause: signal!.reason }),
            ),
          { once: true },
        ),
      );
      return {};
    },
  });
  const pending = provider.execute(
    { operation: "inspect_jeb_client", input: {} },
    { signal: controller.signal },
  );
  await started;
  controller.abort();
  const result = await pending;
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(controller.signal.reason);
  }
});

it("refreshes cached unknown metadata only through an explicit information probe", async () => {
  const responses: Record<string, JsonValue> = {
    get_client_information: { success: true, gui_client: false },
    list_units: { success: true, units: [] },
  };
  const connection = scriptedConnection(responses);
  const provider = providerWith(connection);
  try {
    const first = await provider.execute({
      operation: "list_jeb_units",
      input: { count: 2, index: 0 },
    });
    if (!first.ok) throw first.error;
    expect(first.value.provider.version).toBeNull();
    responses.get_client_information = {
      success: true,
      version: "5.49.0",
      gui_client: true,
    };
    const inspected = await provider.execute({
      operation: "inspect_jeb_client",
      input: {},
    });
    if (!inspected.ok) throw inspected.error;
    const after = await provider.execute({
      operation: "list_jeb_units",
      input: { count: 2, index: 0 },
    });
    if (!after.ok) throw after.error;
    expect(after.value.provider.version).toBe("5.49.0");
    expect(after.value.result).toMatchObject({
      engine: { version: "5.49.0", gui_client: true },
    });
    expect(connection.calls.map(([name]) => name)).toEqual([
      "list_units",
      "get_client_information",
      "get_client_information",
      "list_units",
    ]);
  } finally {
    await provider.close();
  }
});

it("keeps concurrent client inspections bound to their own parsed metadata", async () => {
  const connection = scriptedConnection({});
  let replies = 0;
  connection.call = async () => ({
    success: true,
    version: `inspection-${++replies}`,
    gui_client: replies === 1,
  });
  const provider = providerWith(connection);
  try {
    const results = await Promise.all([
      provider.execute({ operation: "inspect_jeb_client", input: {} }),
      provider.execute({ operation: "inspect_jeb_client", input: {} }),
    ]);
    for (const [index, result] of results.entries()) {
      if (!result.ok) throw result.error;
      expect(result.value.provider.version).toBe(`inspection-${index + 1}`);
      expect(result.value.result).toMatchObject({
        engine: {
          version: result.value.provider.version,
          gui_client: index === 0,
        },
      });
    }
  } finally {
    await provider.close();
  }
});

it("preserves provider-authored timeout guidance when projecting the requested operation", async () => {
  const reason = new Error("selected deadline elapsed");
  const timeout = new AnalysisTimeoutError("list_units", 123, {
    cause: reason,
    diagnostics: { phase: "request" },
    userMessage: "The selected MCP request budget elapsed.",
    remediationAction: "Increase the selected MCP request budget.",
  });
  const provider = providerWith(scriptedConnection({ list_units: timeout }));
  try {
    const result = await provider.execute({
      operation: "list_jeb_units",
      input: { count: 2, index: 0 },
    });
    if (result.ok) throw new Error("Timed-out request passed");
    expect(result.error).toMatchObject({
      operation: "list_jeb_units",
      timeoutMs: 123,
      userMessage: timeout.userMessage,
      remediationAction: timeout.remediationAction,
      diagnostics: { phase: "request", endpoint: "http://127.0.0.1:8425/mcp" },
    });
    expect(result.error.cause).toBe(reason);
  } finally {
    await provider.close();
  }
});

it("project-open refusal retains the selected engine-host artifact path", async () => {
  const provider = providerWith(
    scriptedConnection({
      open_project: {
        success: false,
        message: "The input file could not be processed",
      },
    }),
  );
  const result = await provider.execute({
    operation: "open_jeb_project",
    input: { path: "/targets/Example.apk" },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Refused artifact accepted");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "execution_failure",
    message: "The input file could not be processed",
    details: {
      diagnostics: {
        input: { path: "/targets/Example.apk" },
        upstream_response: {
          success: false,
          message: "The input file could not be processed",
        },
      },
    },
  });
  await provider.close();
});

it.each([
  {
    operation: "list_jeb_units",
    input: {},
    tool: "list_units",
    payload: {
      success: true,
      units: [{ unit_path: "sample.dex", unit_type: "dex" }],
    },
  },
  {
    operation: "open_jeb_project",
    input: { path: "/targets/Example.apk" },
    tool: "open_project",
    payload: {
      success: true,
      name: "Example",
      input_files: [],
      units: [{ unit_path: "sample.dex", unit_type: "dex" }],
    },
  },
  {
    operation: "decompile_jeb_item",
    input: {
      item_kind: "type",
      item_address: "LExample;",
      unit_path: "sample.dex",
    },
    tool: "decompile_code_item",
    payload: { success: true, text: "class Example {}" },
  },
])(
  "retains completed $operation output when later client metadata is cancelled",
  async ({ operation, input, tool, payload }) => {
    const request = jebRequestSchema.parse({ operation, input });
    const controller = new AbortController();
    const reason = { source: "metadata-cancellation" };
    const primary = jsonValueSchema.parse(payload);
    const connection = scriptedConnection({ [tool]: primary });
    const call = connection.call.bind(connection);
    connection.call = async (name, args, signal) => {
      if (name === "get_client_information") {
        controller.abort(reason);
        throw new AnalysisCancelledError(name, { cause: reason });
      }
      return call(name, args, signal);
    };
    const provider = providerWith(connection);
    const result = await provider.execute(request, {
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Cancelled metadata lookup accepted");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      operation,
      cause: reason,
    });
    const partial = parseEvidence(result.error.partialObservation);
    expect(partial.operation).toBe(operation);
    expect(partial.parameters).toEqual(request.input);
    expect(partial.normalized_result).toMatchObject({
      status: "partial",
      observation: payload,
      engine_metadata: null,
    });
    expect(partial.raw_result).toEqual(payload);
    await provider.close();
    const control = providerWith(
      scriptedConnection({
        [tool]: primary,
        get_client_information: {
          success: true,
          version: "5.48.0",
          gui_client: false,
        },
      }),
    );
    const completed = await control.execute(request);
    expect(completed.ok).toBe(true);
    if (!completed.ok) throw completed.error;
    expect(completed.value.result).toMatchObject({
      engine: { version: "5.48.0" },
    });
    await control.close();
  },
);

// The published JEB 5.47 catalog leaves codes open and describes recovery as
// upstream advice, not permission for REA to invoke another engine operation.
describe("JEB refusal input and response preservation", () => {
  const requests = [
    {
      operation: "inspect_jeb_client",
      input: {},
      tool: "get_client_information",
    },
    {
      operation: "open_jeb_project",
      input: { path: "/targets/input.apk" },
      tool: "open_project",
    },
    {
      operation: "list_jeb_units",
      input: { count: 10, index: 0 },
      tool: "list_units",
    },
    {
      operation: "decompile_jeb_item",
      input: {
        item_address: "LExample;->x()V",
        item_kind: "method",
        unit_path: "0/1",
      },
      tool: "decompile_code_item",
    },
  ] as const;

  it.each(requests)(
    "retains unknown refusal facts for $operation",
    async ({ tool, ...request }) => {
      const payload = {
        success: false,
        message: "Engine state needs attention",
        error: {
          code: "future_vendor_code",
          recovery_required_before_retry: false,
          recovery_tool: "open_project",
          vendor_detail: { phase: "analysis" },
        },
        vendor_trace: ["first", "second"],
      };
      const connection = scriptedConnection({ [tool]: payload });
      const provider = providerWith(connection);
      const result = await provider.execute(request);
      if (result.ok) throw new Error("Engine refusal accepted");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "execution_failure",
        message: payload.message,
        details: {
          diagnostics: { input: request.input, upstream_response: payload },
        },
      });
      expect(connection.calls).toHaveLength(1);
      await provider.close();
    },
  );

  it("omits undefined optional inputs when retaining JSON diagnostics", async () => {
    const provider = providerWith(
      scriptedConnection({
        list_units: { success: false, message: "Refused" },
      }),
    );
    const result = await provider.execute({
      operation: "list_jeb_units",
      input: {
        count: 10,
        index: 0,
        filter: undefined,
        parent_unit_path: undefined,
      },
    });
    if (result.ok) throw new Error("Engine refusal accepted");
    expect(result.error.diagnostics?.input).toEqual({ count: 10, index: 0 });
    expect(result.error.diagnostics?.input).not.toHaveProperty("filter");
    await provider.close();
  });
});

describe("JEB refusal recovery and presentation", () => {
  it.each([undefined, false, true])(
    "preserves recovery flag %s without invoking recovery",
    async (flag) => {
      const payload = {
        success: false,
        error: {
          code: "not_documented",
          recovery_tool: "run_script",
          ...(flag === undefined
            ? {}
            : { recovery_required_before_retry: flag }),
        },
      };
      const connection = scriptedConnection({
        get_client_information: payload,
      });
      const provider = providerWith(connection);
      const result = await provider.execute({
        operation: "inspect_jeb_client",
        input: {},
      });
      if (result.ok) throw new Error("Engine refusal accepted");
      expect(result.error.diagnostics?.upstream_response).toEqual(payload);
      expect(connection.calls).toEqual([["get_client_information", {}]]);
      await provider.close();
    },
  );

  it.each([
    {
      payload: {
        success: false,
        message: "outer reason",
        error: { message: "", code: "code" },
      },
      expected: "outer reason",
    },
    {
      payload: {
        success: false,
        message: " ",
        error: { message: "", code: "code" },
      },
      expected: "code",
    },
    { payload: { success: false }, expected: "The engine refused the request" },
  ])(
    "selects a nonempty refusal message: $expected",
    async ({ payload, expected }) => {
      const provider = providerWith(
        scriptedConnection({ get_client_information: payload }),
      );
      const result = await provider.execute({
        operation: "inspect_jeb_client",
        input: {},
      });
      if (result.ok) throw new Error("Engine refusal accepted");
      expect(projectAnalysisError(result.error).message).toBe(expected);
      expect(result.error.diagnostics?.upstream_response).toEqual(payload);
      await provider.close();
    },
  );

  it("availability retains a reachable engine's refusal rather than prescribing connection setup", async () => {
    const payload = {
      success: false,
      message: "Client initialization pending",
      error: {
        code: "future_code",
        recovery_required_before_retry: true,
        recovery_tool: "get_client_information",
      },
    };
    const provider = providerWith(
      scriptedConnection({ get_client_information: payload }),
    );
    expect(await provider.inspectAvailability()).toMatchObject({
      status: "unavailable",
      code: "runtime_unavailable",
      reason: payload.message,
      diagnostics: { upstream_response: payload, input: {} },
    });
    await provider.close();
  });

  it.each([
    { success: false, error: { recovery_required_before_retry: "false" } },
    { message: "missing success" },
    { success: "false" },
  ])("retains malformed envelopes as protocol failures", async (payload) => {
    const provider = providerWith(
      scriptedConnection({ get_client_information: payload }),
    );
    const result = await provider.execute({
      operation: "inspect_jeb_client",
      input: {},
    });
    if (result.ok) throw new Error("Malformed envelope accepted");
    expect(result.error).toBeInstanceOf(AnalysisProtocolError);
    expect(result.error.diagnostics?.upstream_response).toEqual(payload);
    await provider.close();
  });
});
