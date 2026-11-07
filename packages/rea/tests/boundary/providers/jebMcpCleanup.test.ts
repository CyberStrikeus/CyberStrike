import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, expect, it, vi } from "vitest";
import { JebProvider } from "../../../src/jeb/JebProvider.js";
import { createStreamableHttpJebMcpConnection } from "../../../src/jeb/JebMcpConnection.js";
import {
  AnalysisProtocolError,
  AnalysisCancelledError,
} from "../../../src/domain/analysisErrorCore.js";
import { JebAnalysisService } from "../../../src/application/jeb/JebAnalysisService.js";
import {
  startJebMcpFixture,
  jebPrimaryResponses,
} from "../../fixtures/jebMcp.js";

afterEach(() => vi.restoreAllMocks());

const containsCause = (
  value: unknown,
  selected: (cause: unknown) => boolean,
): boolean => {
  if (selected(value)) return true;
  if (!(value instanceof Error)) return false;
  return (
    containsCause(value.cause, selected) ||
    (value instanceof AggregateError &&
      value.errors.some((cause: unknown) => containsCause(cause, selected)))
  );
};

it.each([null, "requested stop", new Error("requested stop")])(
  "preserves exact active SDK cancellation reason %s",
  async (reason) => {
    let entered!: () => void;
    let release!: () => void;
    const requested = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await startJebMcpFixture(async (tool) => {
      entered();
      await gate;
      return jebPrimaryResponses[tool]!;
    });
    const provider = new JebProvider({
      environment: { REA_JEB_MCP_URL: fixture.endpoint },
    });
    const caller = new AbortController();
    const pending = provider.execute(
      { operation: "inspect_jeb_client", input: {} },
      { signal: caller.signal },
    );
    try {
      await requested;
      caller.abort(reason);
      const result = await pending;
      if (result.ok) throw new Error("Cancelled SDK call passed");
      expect(result.error).toMatchObject({
        _tag: "AnalysisCancelledError",
        operation: "inspect_jeb_client",
      });
      expect(result.error.cause).toBe(reason);
    } finally {
      release();
      await pending;
      await provider.close();
      await fixture.close();
    }
  },
);

it.each([false, true])(
  "preserves a raw SDK catalog rejection before a late abort (cleanup fails=%s)",
  async (closeFails) => {
    const fixture = await startJebMcpFixture(
      (tool) => jebPrimaryResponses[tool]!,
      { tools: "invalid" },
    );
    const caller = new AbortController();
    const nativeRequest = Client.prototype.request;
    let physical: unknown;
    vi.spyOn(Client.prototype, "request").mockImplementation(async function (
      this: Client,
      ...args
    ) {
      try {
        return await nativeRequest.apply(this, args);
      } catch (cause: unknown) {
        physical = cause;
        caller.abort(null);
        throw cause;
      }
    });
    const nativeClose = Client.prototype.close;
    let allowClose = !closeFails;
    const close = vi
      .spyOn(Client.prototype, "close")
      .mockImplementation(async function (this: Client) {
        if (!allowClose) throw new Error("injected cleanup failure");
        await nativeClose.call(this);
      });
    const provider = new JebProvider({
      environment: { REA_JEB_MCP_URL: fixture.endpoint },
    });
    try {
      const result = await provider.execute(
        { operation: "inspect_jeb_client", input: {} },
        { signal: caller.signal },
      );
      if (result.ok) throw new Error("Invalid SDK catalog passed");
      expect(physical).toBeInstanceOf(Error);
      expect(containsCause(result.error, (cause) => cause === physical)).toBe(
        true,
      );
      expect(result.error).not.toBeInstanceOf(AnalysisCancelledError);
      expect(result.error.cleanupIncomplete).toBe(closeFails);
      allowClose = true;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      allowClose = true;
      close.mockRestore();
      await provider.close();
      await fixture.close();
    }
  },
);

it("retains completed JEB Evidence when the caller aborts after the tool returns", async () => {
  const caller = new AbortController();
  const fixture = await startJebMcpFixture(
    (tool) => jebPrimaryResponses[tool]!,
  );
  const nativeCall = Client.prototype.callTool;
  vi.spyOn(Client.prototype, "callTool").mockImplementation(async function (
    this: Client,
    ...args
  ) {
    const result = await nativeCall.apply(this, args);
    caller.abort(null);
    return result;
  });
  const provider = new JebProvider({
    environment: { REA_JEB_MCP_URL: fixture.endpoint },
  });
  try {
    const service = new JebAnalysisService(provider);
    const result = await service.execute(
      "inspect_jeb_client",
      {},
      { signal: caller.signal },
    );
    if (result.ok) throw new Error("Late cancellation passed");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: null,
      partialObservation: {
        operation: "inspect_jeb_client",
        provider: { id: "jeb", version: "5.48.0" },
      },
    });
    expect(result.error.partialObservation).toMatchObject({
      normalized_result: { engine: { version: "5.48.0", gui_client: false } },
    });
  } finally {
    await provider.close();
    await fixture.close();
  }
});

it("preserves an SDK HTTP tool failure when the caller aborts after rejection", async () => {
  const caller = new AbortController();
  const fixture = await startJebMcpFixture(() => {
    throw new Error("engine HTTP failure");
  });
  const nativeCall = Client.prototype.callTool;
  let physical: unknown;
  vi.spyOn(Client.prototype, "callTool").mockImplementation(async function (
    this: Client,
    ...args
  ) {
    try {
      return await nativeCall.apply(this, args);
    } catch (cause: unknown) {
      physical = cause;
      caller.abort(null);
      throw cause;
    }
  });
  const provider = new JebProvider({
    environment: { REA_JEB_MCP_URL: fixture.endpoint },
  });
  try {
    const result = await provider.execute(
      { operation: "inspect_jeb_client", input: {} },
      { signal: caller.signal },
    );
    if (result.ok) throw new Error("HTTP failure passed");
    expect(physical).toBeInstanceOf(Error);
    expect(containsCause(result.error, (cause) => cause === physical)).toBe(
      true,
    );
    expect(result.error).not.toBeInstanceOf(AnalysisCancelledError);
  } finally {
    await provider.close();
    await fixture.close();
  }
});

it("validates a completed catalog page before a late handoff abort", async () => {
  const caller = new AbortController();
  const fixture = await startJebMcpFixture(
    (tool) => jebPrimaryResponses[tool]!,
    { tools: [], nextCursor: "repeat" },
  );
  const nativeRequest = Client.prototype.request;
  vi.spyOn(Client.prototype, "request").mockImplementation(async function (
    this: Client,
    ...args
  ) {
    const result = await nativeRequest.apply(this, args);
    if (args[0].method === "tools/list" && args[0].params?.cursor === "repeat")
      caller.abort(null);
    return result;
  });
  const provider = new JebProvider({
    environment: { REA_JEB_MCP_URL: fixture.endpoint },
  });
  try {
    const result = await provider.execute(
      { operation: "inspect_jeb_client", input: {} },
      { signal: caller.signal },
    );
    if (result.ok) throw new Error("Repeated cursor passed");
    expect(result.error).toBeInstanceOf(AnalysisProtocolError);
    expect(result.error.message).toContain("repeated a tool catalog cursor");
  } finally {
    await provider.close();
    await fixture.close();
  }
});

it.each(["client", "transport", "both"] as const)(
  "retains %s acquisition cleanup and resolves the original error through exact-owner retry",
  async (failedStage) => {
    const fixture = await startJebMcpFixture(
      (tool) => jebPrimaryResponses[tool]!,
      { tools: [], nextCursor: "repeat" },
    );
    const primary = (cause: unknown) =>
      cause instanceof AnalysisProtocolError &&
      cause.message.includes("repeated a tool catalog cursor");
    const nativeClientClose = Client.prototype.close;
    const nativeTransportClose = StreamableHTTPClientTransport.prototype.close;
    const clients = new Set<Client>();
    const transports = new Set<StreamableHTTPClientTransport>();
    let allowClose = false;
    const clientClose = vi
      .spyOn(Client.prototype, "close")
      .mockImplementation(async function (this: Client) {
        clients.add(this);
        if (!allowClose && failedStage !== "transport")
          throw new Error("injected client cleanup failure");
        await nativeClientClose.call(this);
      });
    const transportClose = vi
      .spyOn(StreamableHTTPClientTransport.prototype, "close")
      .mockImplementation(async function (this: StreamableHTTPClientTransport) {
        transports.add(this);
        if (!allowClose && failedStage !== "client")
          throw new Error("injected transport cleanup failure");
        await nativeTransportClose.call(this);
      });
    const provider = new JebProvider({
      environment: { REA_JEB_MCP_URL: fixture.endpoint },
    });
    try {
      const result = await provider.execute({
        operation: "list_jeb_units",
        input: { count: 2, index: 0 },
      });
      if (result.ok) throw new Error("Injected acquisition failure passed");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources.length).toBeGreaterThan(0);
      expect(containsCause(result.error, primary)).toBe(true);
      await expect(provider.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
      });
      expect(result.error.cleanupIncomplete).toBe(true);
      allowClose = true;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(result.error.cleanupResources).toEqual([]);
      expect(containsCause(result.error, primary)).toBe(true);
      expect(clients.size).toBe(1);
      expect(transports.size).toBe(1);
      expect(fixture.calls).toEqual([]);
      expect(clientClose).toHaveBeenCalledTimes(3);
      expect(transportClose).toHaveBeenCalledTimes(
        failedStage === "client" ? 1 : failedStage === "transport" ? 5 : 3,
      );
    } finally {
      allowClose = true;
      clientClose.mockRestore();
      transportClose.mockRestore();
      await provider.close();
      await fixture.close();
    }
  },
);

it("coalesces concurrent close and lets the SDK close its attached transport once", async () => {
  const fixture = await startJebMcpFixture(
    (tool) => jebPrimaryResponses[tool]!,
  );
  const connection = createStreamableHttpJebMcpConnection(
    new URL(fixture.endpoint),
  );
  const nativeClose = Client.prototype.close;
  let entered!: () => void;
  let release!: () => void;
  const closing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const clientClose = vi
    .spyOn(Client.prototype, "close")
    .mockImplementation(async function (this: Client) {
      entered();
      await gate;
      await nativeClose.call(this);
    });
  const transportClose = vi.spyOn(
    StreamableHTTPClientTransport.prototype,
    "close",
  );
  try {
    await connection.connect();
    const first = connection.close();
    await closing;
    const second = connection.close();
    expect(clientClose).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    await connection.close();
    expect(clientClose).toHaveBeenCalledTimes(1);
    expect(transportClose).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await connection.close();
    await fixture.close();
  }
});

it.each(["caller", "owner"] as const)(
  "joins a late SDK handshake when %s stops acquisition",
  async (stop) => {
    const fixture = await startJebMcpFixture(
      (tool) => jebPrimaryResponses[tool]!,
    );
    const connection = createStreamableHttpJebMcpConnection(
      new URL(fixture.endpoint),
    );
    const nativeConnect = Client.prototype.connect;
    let entered!: () => void;
    let release!: () => void;
    const connected = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(Client.prototype, "connect").mockImplementation(async function (
      this: Client,
      ...args
    ) {
      await nativeConnect.apply(this, args);
      entered();
      await gate;
    });
    const clientClose = vi.spyOn(Client.prototype, "close");
    const transportClose = vi.spyOn(
      StreamableHTTPClientTransport.prototype,
      "close",
    );
    const caller = new AbortController();
    const acquisition = connection.connect(caller.signal);
    const failure = acquisition.catch((cause: unknown) => cause);
    let settled = false;
    void failure.then(() => {
      settled = true;
    });
    let closing: Promise<void> | undefined;
    try {
      await connected;
      if (stop === "caller") caller.abort(null);
      else closing = connection.close();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(clientClose).not.toHaveBeenCalled();
      release();
      expect(await failure).toMatchObject({ _tag: "AnalysisCancelledError" });
      await closing;
      await connection.close();
      expect(clientClose).toHaveBeenCalledTimes(1);
      expect(transportClose).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await failure;
      await closing;
      await connection.close();
      await fixture.close();
    }
  },
);

it("allows one startup caller to leave while its peer completes on the same client", async () => {
  let entered!: () => void;
  let release!: () => void;
  const requested = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = await startJebMcpFixture(
    (tool) => jebPrimaryResponses[tool]!,
    async () => {
      entered();
      await gate;
      return {
        tools: [
          { name: "get_client_information", inputSchema: { type: "object" } },
        ],
      };
    },
  );
  const connection = createStreamableHttpJebMcpConnection(
    new URL(fixture.endpoint),
  );
  const clientClose = vi.spyOn(Client.prototype, "close");
  const caller = new AbortController();
  const first = connection
    .connect(caller.signal)
    .catch((cause: unknown) => cause);
  const second = connection.connect();
  try {
    await requested;
    caller.abort(null);
    expect(await first).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: null,
    });
    expect(clientClose).not.toHaveBeenCalled();
    release();
    expect(await second).toEqual(["get_client_information"]);
  } finally {
    release();
    await first;
    await second;
    await connection.close();
    await fixture.close();
  }
});

it.each([false, true])(
  "joins established acquisition failure when caller aborts during cleanup (close fails=%s)",
  async (closeFails) => {
    const fixture = await startJebMcpFixture(
      (tool) => jebPrimaryResponses[tool]!,
      { tools: [], nextCursor: "repeat" },
    );
    const nativeClose = Client.prototype.close;
    let entered!: () => void;
    let release!: () => void;
    const closing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let allowClose = !closeFails;
    const close = vi
      .spyOn(Client.prototype, "close")
      .mockImplementation(async function (this: Client) {
        entered();
        await gate;
        if (!allowClose) throw new Error("client cleanup unavailable");
        await nativeClose.call(this);
      });
    const controller = new AbortController();
    const provider = new JebProvider({
      environment: { REA_JEB_MCP_URL: fixture.endpoint },
    });
    const pending = provider.execute(
      { operation: "list_jeb_units", input: { count: 2, index: 0 } },
      { signal: controller.signal },
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    try {
      await closing;
      controller.abort(null);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      release();
      const result = await pending;
      if (result.ok) throw new Error("Physical acquisition failure passed");
      expect(
        containsCause(
          result.error,
          (cause) =>
            cause instanceof AnalysisProtocolError &&
            cause.message.includes("repeated a tool catalog cursor"),
        ),
      ).toBe(true);
      expect(
        containsCause(
          result.error,
          (cause) => cause instanceof AnalysisCancelledError,
        ),
      ).toBe(false);
      expect(result.error.cleanupIncomplete).toBe(closeFails);
      allowClose = true;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      release();
      allowClose = true;
      await pending;
      close.mockRestore();
      await provider.close();
      await fixture.close();
    }
  },
);
