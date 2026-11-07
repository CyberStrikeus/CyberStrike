import { awaitAcknowledgement } from "../../tests/fixtures/lifecycleAcknowledgement.js";
import { AnalysisSettings } from "../application/AnalysisSettings.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { Tool, ServerContext } from "@modelcontextprotocol/server";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RecordedMcpCatalog } from "../recordedMcpCatalog.js";
import { DeferredEvidenceMcpServer } from "./DeferredEvidenceMcpServer.js";
import { ToolResultDelivery } from "./ToolResultDelivery.js";
import { promptArgumentsSchema } from "./promptArguments.js";

const barrier = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const input = z.strictObject({ n: z.number().int().nonnegative().default(3) });
const output = z.strictObject({ n: z.number().int() });
const parameters = {
  document: {
    description: "Document name",
    required: true,
    completion: "document" as const,
  },
};
const catalog: RecordedMcpCatalog = {
  version: 1,
  info: { name: "deferred-fixture", version: "1" },
  instructions: "Fixture",
  capabilities: {
    tools: { listChanged: true },
    prompts: { listChanged: true },
    completions: {},
  },
  identity: {
    counts: { cli_commands: 0, mcp_tools: 1, mcp_prompts: 1 },
    digests: {
      tools_sha256: "fixture",
      prompts_sha256: "fixture",
      combined_sha256: "fixture",
    },
  },
  tools: [
    {
      name: "fixture",
      inputSchema: z.toJSONSchema(input, {
        io: "input",
      }) as Tool["inputSchema"],
      outputSchema: z.toJSONSchema(output),
    },
  ],
  prompts: [
    {
      name: "explain",
      title: "Explain",
      description: "Explain a document",
      arguments: [
        { name: "document", description: "Document name", required: true },
      ],
      parameters,
    },
  ],
};
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const fixture = async (
  options: {
    readonly hold?: ReturnType<typeof barrier>;
    readonly analysisSettings?: AnalysisSettings;
    readonly execute?: () => Promise<void>;
    readonly failClose?: () => boolean;
    readonly failLoad?: boolean;
    readonly invalidOutput?: boolean;
    readonly failAfterTool?: boolean;
    readonly maximumInputElements?: number;
  } = {},
) => {
  const started = barrier();
  const calls = vi.fn<(n: number, context: ServerContext) => void>();
  const closed = vi.fn();
  let loads = 0;
  const server = new DeferredEvidenceMcpServer(
    catalog,
    new ToolResultDelivery(1024 * 1024),
    async (target) => {
      loads++;
      target.ownRuntimeCleanup(async () => {
        closed();
        if (options.failClose?.()) throw new Error("cleanup denied");
        await target.closePartialRuntime();
      });
      started.release();
      await options.hold?.promise;
      if (options.failLoad) throw new Error("PRIVATE startup cause");
      target.analysisSettings = options.analysisSettings;
      target.materialize(() => {
        target.registerTool(
          "fixture",
          { inputSchema: input, outputSchema: output },
          async (args, context) => {
            calls(args.n, context);
            await options.execute?.();
            return {
              content: [],
              structuredContent: {
                n: options.invalidOutput ? "invalid" : args.n,
              },
            };
          },
        );
        if (options.failAfterTool)
          throw new Error("PRIVATE partial startup failure");
        const completion = target.bindPromptCompletion({
          complete: async () => ["Example"],
        });
        target.registerCanonicalPrompt(
          "explain",
          {
            title: "Explain",
            description: "Explain a document",
            argsSchema: promptArgumentsSchema(
              { arguments: parameters },
              completion,
            ),
          },
          async (args) => ({
            messages: [
              {
                role: "user",
                content: { type: "text", text: String(args.document) },
              },
            ],
          }),
        );
      });
    },
    options.maximumInputElements,
  );
  const client = new Client({ name: "deferred-fixture-client", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return {
    server,
    client,
    serverTransport,
    started,
    calls,
    closed,
    loads: () => loads,
  };
};

it("refuses excess input before loading a deferred runtime, then admits a valid call", async () => {
  const f = await fixture({ maximumInputElements: 2 });
  const result = await f.client.callTool({
    name: "fixture",
    arguments: { n: 3, other: [0] },
  });
  expect(result.isError).toBe(true);
  const text = result.content.find((part) => part.type === "text")?.text;
  expect(JSON.parse(text ?? "null")).toMatchObject({
    error: {
      code: "resource_constraint",
      details: { reported_limits: { max_input_elements: 2 } },
    },
  });
  expect(f.loads()).toBe(0);
  expect(f.calls).not.toHaveBeenCalled();
  await f.client.ping();
  const admitted = await f.client.callTool({
    name: "fixture",
    arguments: { n: 4 },
  });
  expect(admitted.isError).not.toBe(true);
  expect(admitted.structuredContent).toEqual({ n: 4 });
  expect(f.loads()).toBe(1);
  expect(f.calls).toHaveBeenCalledOnce();
});

it("discovers without initialization, then shares one canonical runtime and preserves request metadata", async () => {
  const hold = barrier();
  const f = await fixture({ hold });
  const before = await f.client.listTools();
  expect(before.tools).toEqual(catalog.tools);
  expect((await f.client.listPrompts()).prompts).toEqual(
    catalog.prompts.map(({ parameters: _parameters, ...prompt }) => prompt),
  );
  expect(f.loads()).toBe(0);
  const changed = vi.fn();
  f.client.setNotificationHandler("notifications/tools/list_changed", changed);
  const a = f.client.callTool({
    name: "fixture",
    arguments: {},
    _meta: { caller: "retained" },
  });
  const pending: Promise<unknown>[] = [a];
  try {
    await awaitAcknowledgement(f.started.promise, a, "deferred initialization");
    const b = f.client.callTool({ name: "fixture", arguments: { n: 7 } });
    pending.push(b);
    hold.release();
    expect((await a).structuredContent).toEqual({ n: 3 });
    expect((await b).structuredContent).toEqual({ n: 7 });
    expect(f.loads()).toBe(1);
    expect(f.calls.mock.calls[0]?.[1].mcpReq._meta?.caller).toBe("retained");
    expect(await f.client.listTools()).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
    const invalid = await f.client.callTool({
      name: "fixture",
      arguments: { n: 1.5 },
    });
    expect(invalid.isError).toBe(true);
    expect(f.calls).toHaveBeenCalledTimes(2);
  } finally {
    hold.release();
    await Promise.allSettled(pending);
  }
});

it("preserves output validation after deferred registration", async () => {
  const f = await fixture({ invalidOutput: true });
  const result = await f.client.callTool({ name: "fixture", arguments: {} });
  expect(result.isError).toBe(true);
});

it("initializes through prompt retrieval or completion without an internal client", async () => {
  const f = await fixture();
  expect(
    (
      await f.client.complete({
        ref: { type: "ref/prompt", name: "explain" },
        argument: { name: "document", value: "Ex" },
      })
    ).completion.values,
  ).toEqual(["Example"]);
  expect(
    (
      await f.client.getPrompt({
        name: "explain",
        arguments: { document: "Example" },
      })
    ).messages[0]?.content,
  ).toEqual({ type: "text", text: "Example" });
  expect(f.loads()).toBe(1);
});

it("retrieves a prompt as the first operation", async () => {
  const f = await fixture();
  const result = await f.client.getPrompt({
    name: "explain",
    arguments: { document: "Example" },
  });
  expect(result.messages).toHaveLength(1);
  expect(f.loads()).toBe(1);
});

it("does not execute a tool cancelled while canonical loading is pending", async () => {
  const hold = barrier();
  const f = await fixture({ hold });
  const cancelled = barrier();
  const previous = f.serverTransport.onmessage;
  f.serverTransport.onmessage = (message, extra) => {
    previous?.(message, extra);
    if ("method" in message && message.method === "notifications/cancelled")
      cancelled.release();
  };
  const controller = new AbortController();
  const pending = f.client.callTool(
    { name: "fixture", arguments: {} },
    { signal: controller.signal },
  );
  const rejected = expect(pending).rejects.toBeDefined();
  try {
    await awaitAcknowledgement(
      f.started.promise,
      pending,
      "cancelled caller initialization",
    );
    controller.abort();
    await awaitAcknowledgement(
      cancelled.promise,
      f.server.ensureRuntime(),
      "cancellation notification",
    );
    hold.release();
    await rejected;
    await f.server.ensureRuntime();
    expect(f.calls).not.toHaveBeenCalled();
    expect(
      (await f.client.callTool({ name: "fixture", arguments: {} })).isError,
    ).not.toBe(true);
  } finally {
    controller.abort();
    hold.release();
    await Promise.allSettled([pending, rejected, f.server.ensureRuntime()]);
    if (previous === undefined) delete f.serverTransport.onmessage;
    else f.serverTransport.onmessage = previous;
  }
});

it("keeps an independent caller alive when its peer cancels during shared loading", async () => {
  const hold = barrier();
  const f = await fixture({ hold });
  const secondRequest = barrier();
  const cancelled = barrier();
  let toolCalls = 0;
  const previous = f.serverTransport.onmessage;
  f.serverTransport.onmessage = (message, extra) => {
    previous?.(message, extra);
    if (
      "method" in message &&
      message.method === "tools/call" &&
      ++toolCalls === 2
    )
      secondRequest.release();
    if ("method" in message && message.method === "notifications/cancelled")
      cancelled.release();
  };
  const controller = new AbortController();
  const a = f.client
    .callTool({ name: "fixture", arguments: {} }, { signal: controller.signal })
    .catch(() => undefined);
  const pending: Promise<unknown>[] = [a];
  try {
    await awaitAcknowledgement(f.started.promise, a, "shared initialization");
    const b = f.client.callTool({ name: "fixture", arguments: { n: 8 } });
    pending.push(b);
    await awaitAcknowledgement(
      secondRequest.promise,
      b,
      "independent caller admission",
    );
    controller.abort();
    await awaitAcknowledgement(
      cancelled.promise,
      f.server.ensureRuntime(),
      "peer cancellation notification",
    );
    hold.release();
    await a;
    expect((await b).structuredContent).toEqual({ n: 8 });
    expect(f.calls).toHaveBeenCalledTimes(1);
    expect(f.loads()).toBe(1);
  } finally {
    controller.abort();
    hold.release();
    await Promise.allSettled([...pending, f.server.ensureRuntime()]);
    if (previous === undefined) delete f.serverTransport.onmessage;
    else f.serverTransport.onmessage = previous;
  }
});

it("joins late initialization during close and prevents target execution", async () => {
  const hold = barrier();
  const f = await fixture({ hold });
  const pending = f.client
    .callTool({ name: "fixture", arguments: {} })
    .catch(() => undefined);
  let closing: Promise<void> | undefined;
  try {
    await awaitAcknowledgement(
      f.started.promise,
      pending,
      "initialization before close",
    );
    closing = f.server.close();
    hold.release();
    await closing;
    await pending;
    expect(f.calls).not.toHaveBeenCalled();
    expect(f.closed).toHaveBeenCalledTimes(1);
    await expect(f.server.ensureRuntime()).rejects.toThrow("closed");
  } finally {
    hold.release();
    await Promise.allSettled([pending, closing]);
  }
});

it("retains failed cleanup for retry without loading a replacement runtime", async () => {
  let denied = true;
  const f = await fixture({ failClose: () => denied });
  await f.client.callTool({ name: "fixture", arguments: {} });
  await expect(f.server.close()).rejects.toThrow("cleanup");
  await expect(f.server.ensureRuntime()).rejects.toThrow("closed");
  denied = false;
  await f.server.close();
  expect(f.closed).toHaveBeenCalledTimes(2);
  expect(f.loads()).toBe(1);
});

it("keeps startup failures redacted and owns partial cleanup", async () => {
  const f = await fixture({ failLoad: true });
  const result = await f.client.callTool({ name: "fixture", arguments: {} });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  await f.server.close();
  expect(f.closed).toHaveBeenCalledTimes(1);
});

it("closes an unused instance without constructing the runtime", async () => {
  const f = await fixture();
  await f.client.listTools();
  await f.server.close();
  expect(f.loads()).toBe(0);
  expect(f.closed).not.toHaveBeenCalled();
});

it("never executes a partially registered handler after initialization fails", async () => {
  const f = await fixture({ failAfterTool: true });
  const first = await f.client.callTool({ name: "fixture", arguments: {} });
  const retry = await f.client.callTool({ name: "fixture", arguments: {} });
  expect(first.isError).toBe(true);
  expect(retry.isError).toBe(true);
  expect(f.calls).not.toHaveBeenCalled();
  expect(f.loads()).toBe(1);
  await f.server.close();
  expect(f.closed).toHaveBeenCalledTimes(1);
});

it("keeps one accepted settings snapshot through a deferred handler while the next call sees updates", async () => {
  const settings = new AnalysisSettings({});
  const entered = barrier();
  const held = barrier();
  const seen: Array<number | undefined> = [];
  const f = await fixture({
    analysisSettings: settings,
    execute: async () => {
      entered.release();
      await held.promise;
      seen.push(settings.read().overrides["asar.max_header_bytes"]);
    },
  });
  const pending = f.client.callTool({ name: "fixture", arguments: {} });
  try {
    await awaitAcknowledgement(
      entered.promise,
      pending,
      "settings snapshot handler entry",
    );
    expect(
      settings.update({
        changes: [
          { setting: "asar.max_header_bytes", action: "set", value: 33554432 },
        ],
      }).ok,
    ).toBe(true);
  } finally {
    held.release();
    await Promise.allSettled([pending]);
  }
  expect((await pending).isError).not.toBe(true);
  await f.client.callTool({ name: "fixture", arguments: {} });
  expect(seen).toEqual([undefined, 33554432]);
});
