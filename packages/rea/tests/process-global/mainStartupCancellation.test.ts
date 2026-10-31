import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import type { BinarySession } from "../../src/application/binary/BinarySession.js";
import type { BinaryTarget } from "../../src/domain/binaryTargetTypes.js";
import { AnalysisCancelledError } from "../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../src/domain/providerCleanupError.js";
import { err, ok } from "../../src/domain/result.js";
import { run } from "../../src/main.js";
import { registerProcessShutdown } from "../../src/main/processShutdown.js";
import { ownStdioStartupInput } from "../../src/main/StdioStartupInput.js";
import { MCP_SHUTDOWN_FAILED } from "../../src/main/messages.js";
import {
  createDeferred,
  createTestBinarySession,
} from "../fixtures/binarySession.js";

const control = vi.hoisted(() => ({
  session: undefined as BinarySession | undefined,
}));
vi.mock("../../src/composition/binary.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/composition/binary.js")>();
  return {
    ...actual,
    createBinarySession: () => {
      const session = control.session;
      if (session === undefined)
        throw new Error("Missing startup session owner");
      return session;
    },
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  control.session = undefined;
});
const target: BinaryTarget = {
  path: "/fixture",
  sha256: "0".repeat(64),
  kind: "executable",
  format: "elf",
  architecture: "x86_64",
  availableArchitectures: ["x86_64"],
};
const sessionOwner = () => {
  const session = createTestBinarySession(() => {
    throw new Error("No real provider may start");
  });
  control.session = session;
  return session;
};

it.each([
  { trigger: "SIGINT", failedClose: false },
  { trigger: "SIGTERM", failedClose: false },
  { trigger: "EOF", failedClose: false },
  { trigger: "SIGINT", failedClose: true },
  { trigger: "CAPACITY", failedClose: true },
  { trigger: "READ_ERROR", failedClose: true },
] as const)(
  "owns initial open before $trigger (cleanup failure=$failedClose)",
  async ({ trigger, failedClose }) => {
    const session = sessionOwner();
    const input = new PassThrough();
    const signals = new EventEmitter();
    const entered = createDeferred<AbortSignal>();
    vi.spyOn(session, "open").mockImplementation(async (_path, options) => {
      const signal = options?.signal;
      if (signal === undefined)
        throw new Error("Initial open has no cancellation owner");
      entered.resolve(signal);
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return err(
        new AnalysisCancelledError("open_binary", { cause: signal.reason }),
      );
    });
    let closeFails = failedClose;
    const close = vi.spyOn(session, "close").mockImplementation(async () =>
      closeFails
        ? err(
            new ProviderCleanupError("fixture", ["retained provider"], {
              reason: "close denied",
            }),
          )
        : ok(null),
    );
    const serve = vi.fn(() => ({ close: async () => {} }));
    const output: string[] = [];
    const pending = run({
      env: { HOPPER_TARGET_PATH: target.path, REA_LOG_LEVEL: "silent" },
      stdin: input,
      serve,
      loadOptionalProviders: async () => ({}),
      writeStderr: (text) => output.push(text),
      setExitCode: () => {},
      registerShutdown: (handler) =>
        registerProcessShutdown(handler, { signals, stdin: input }),
    });
    const signal = await entered.promise;
    expect(signals.listenerCount("SIGINT")).toBe(1);
    expect(signals.listenerCount("SIGTERM")).toBe(1);
    if (trigger === "EOF") input.end();
    else if (trigger === "CAPACITY")
      input.write(Buffer.alloc(STDIO_DEFAULT_MAX_BUFFER_SIZE + 1));
    else if (trigger === "READ_ERROR")
      input.emit("error", new Error("controlled stdin read failure"));
    else signals.emit(trigger);
    expect(await pending).toBe(failedClose ? 1 : 0);
    expect(signal.aborted).toBe(true);
    expect(serve).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith({ retainProviderDocuments: true });
    if (failedClose) {
      expect(output.join("")).toContain(MCP_SHUTDOWN_FAILED);
      if (trigger === "CAPACITY" || trigger === "READ_ERROR") {
        const primary =
          trigger === "CAPACITY"
            ? "MCP input exceeded"
            : "MCP stdin could not be read";
        expect(output.join("")).toContain(primary);
        expect(output.join("").indexOf(primary)).toBeLessThan(
          output.join("").indexOf(MCP_SHUTDOWN_FAILED),
        );
      }
      closeFails = false;
      signals.emit("SIGINT");
      await expect.poll(() => signals.listenerCount("SIGINT")).toBe(0);
    } else expect(output).toEqual([]);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    input.destroy();
  },
);

it.each(["optional", "late-handle"] as const)(
  "closes resources settling after startup cancellation at %s",
  async (stage) => {
    const session = sessionOwner();
    vi.spyOn(session, "open").mockResolvedValue(ok(target));
    const closeSession = vi.spyOn(session, "close").mockResolvedValue(ok(null));
    const input = new PassThrough();
    const signals = new EventEmitter();
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const closeHandle = vi.fn(async () => {});
    const serve = vi.fn(async () => {
      entered.resolve();
      await release.promise;
      return { close: closeHandle };
    });
    const pending = run({
      env: { HOPPER_TARGET_PATH: target.path, REA_LOG_LEVEL: "silent" },
      stdin: input,
      serve,
      loadOptionalProviders: async () => {
        if (stage === "optional") {
          entered.resolve();
          await release.promise;
        }
        return {};
      },
      writeStderr: () => {},
      setExitCode: () => {},
      registerShutdown: (handler) =>
        registerProcessShutdown(handler, { signals, stdin: input }),
    });
    await entered.promise;
    if (stage === "optional") {
      await new Promise<void>((resolve) => {
        input.once("end", resolve);
        input.end();
      });
    } else signals.emit("SIGTERM");
    expect(closeHandle).not.toHaveBeenCalled();
    expect(closeSession).not.toHaveBeenCalled();
    release.resolve();
    expect(await pending).toBe(0);
    expect(serve).toHaveBeenCalledTimes(stage === "optional" ? 0 : 1);
    expect(closeHandle).toHaveBeenCalledTimes(stage === "optional" ? 0 : 1);
    expect(closeSession).toHaveBeenCalledTimes(1);
    expect(closeSession).toHaveBeenCalledWith({
      retainProviderDocuments: true,
    });
    expect(signals.listenerCount("SIGINT")).toBe(0);
    input.destroy();
  },
);

it("hands exact startup bytes to the installed SDK framing owner", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const stopped = vi.fn();
  const owner = ownStdioStartupInput(input, stopped);
  const request = Buffer.from(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "é🚀", version: "1" },
      },
    }) + "\n",
  );
  const ping = Buffer.from('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
  input.write(request.subarray(0, request.indexOf(Buffer.from("🚀")) + 1));
  input.write(request.subarray(request.indexOf(Buffer.from("🚀")) + 1));
  input.write(ping.subarray(0, 11));
  await new Promise<void>((resolve) => setImmediate(resolve));
  owner.handoff();
  const raw: Buffer[] = [];
  input.on("data", (chunk: Buffer) => raw.push(chunk));
  const messages: unknown[] = [];
  const transport = new StdioServerTransport(input, output);
  transport.onmessage = (message) => messages.push(message);
  try {
    await transport.start();
    owner.resume();
    input.write(ping.subarray(11));
    await expect.poll(() => messages.length).toBe(2);
    expect(
      Buffer.compare(Buffer.concat(raw), Buffer.concat([request, ping])),
    ).toBe(0);
    expect(messages[0]).toMatchObject({
      params: { clientInfo: { name: "é🚀" } },
    });
    expect(messages[1]).toMatchObject({ id: 2, method: "ping" });
    expect(stopped).not.toHaveBeenCalled();
  } finally {
    owner.close();
    await transport.close();
    input.destroy();
    output.destroy();
  }
});

it("bounds raw startup retention by the installed SDK stdio capacity", async () => {
  const input = new PassThrough();
  const stopped = vi.fn();
  const owner = ownStdioStartupInput(input, stopped);
  try {
    input.write(Buffer.alloc(STDIO_DEFAULT_MAX_BUFFER_SIZE + 1));
    await expect.poll(() => stopped.mock.calls.length).toBe(1);
    expect(stopped).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "AnalysisResourceConstraintError",
        resource: "transport",
      }),
    );
  } finally {
    owner.close();
    input.destroy();
  }
});
