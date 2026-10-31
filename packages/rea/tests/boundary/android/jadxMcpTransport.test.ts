import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import {
  serializeMessage,
  type JSONRPCMessage,
} from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import type { ProviderProcessHandle } from "../../../src/process/ProviderProcess.js";
import {
  JadxMcpTransport,
  type JadxLauncher,
} from "../../../src/android/JadxMcpTransport.js";

class FixtureProcess extends EventEmitter implements ProviderProcessHandle {
  readonly pid = 1;
  readonly stdout = new PassThrough();
  constructor(readonly stdin: Writable = new PassThrough()) {
    super();
  }
  readonly stderr = new PassThrough();
  readonly exitCode = null;
  readonly signalCode = null;

  kill(): boolean {
    return true;
  }
}

const fixtureLauncher =
  (process: FixtureProcess): JadxLauncher =>
  async ({ runId }) => ({
    process,
    ownership: {
      runId,
      leaderPid: process.pid,
      processGroupId: process.pid,
      expectedParentPid: process.pid,
    },
    cleanup: async () => {
      process.emit("exit", 0, null);
      process.emit("close", 0, null);
      process.stdout.end();
      process.stderr.end();
      process.stdin.end();
      return { cleaned: true, signaled: false };
    },
  });

it("joins pending input errors before detaching the owned protocol stream", async () => {
  let completeWrite: ((cause: Error) => void) | undefined;
  const failure = new Error("owned pipe closed during cancellation");
  const process = new FixtureProcess(
    new Writable({
      write: (_chunk, _encoding, callback) => {
        completeWrite = callback;
      },
    }),
  );
  const transport = new JadxMcpTransport(
    { command: "fixture", arguments: [] },
    async ({ runId }) => ({
      process,
      ownership: { runId, leaderPid: 1, processGroupId: 1 },
      cleanup: async () => {
        completeWrite?.(failure);
        process.emit("exit", 1, null);
        process.emit("close", 1, null);
        process.stdout.end();
        process.stderr.end();
        return { cleaned: true, signaled: true };
      },
    }),
  );
  const errors: Error[] = [];
  transport.onerror = (cause) => errors.push(cause);
  await transport.start();
  const pending = transport
    .send({ jsonrpc: "2.0", id: 1, method: "probe" })
    .then(
      () => undefined,
      (cause: unknown) => cause,
    );
  expect(completeWrite).toBeTypeOf("function");
  await transport.close();
  expect(await pending).toBe(failure);
  expect(errors).toEqual([failure]);
  expect(process.stdin.closed).toBe(true);
  await transport.close();
});

it("decodes split UTF-8 and newline bytes, then routes multiple complete frames", async () => {
  const process = new FixtureProcess();
  const transport = new JadxMcpTransport(
    { command: "fixture", arguments: [] },
    fixtureLauncher(process),
  );
  const received: JSONRPCMessage[] = [];
  transport.onmessage = (message) => received.push(message);

  await transport.start();
  const first = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "snow 雪 🦊 and literal �" }],
    },
  } satisfies JSONRPCMessage;
  const second = {
    jsonrpc: "2.0",
    id: 2,
    result: { content: [{ type: "text", text: "second" }] },
  } satisfies JSONRPCMessage;
  const third = {
    jsonrpc: "2.0",
    id: 3,
    result: { content: [{ type: "text", text: "third" }] },
  } satisfies JSONRPCMessage;
  for (const byte of Buffer.from(serializeMessage(first)))
    process.stdout.write(Buffer.from([byte]));
  process.stdout.write(
    Buffer.from(serializeMessage(second) + serializeMessage(third)),
  );

  expect(received).toEqual([first, second, third]);
  await transport.close();
});

it.each([
  ["invalid UTF-8 byte", Buffer.from([0xff])],
  ["truncated UTF-8 sequence", Buffer.from([0xe2, 0x82])],
])("rejects %s in a complete JSON-RPC frame", async (_label, invalid) => {
  const process = new FixtureProcess();
  const transport = new JadxMcpTransport(
    { command: "fixture", arguments: [] },
    fixtureLauncher(process),
  );
  const received: JSONRPCMessage[] = [];
  const errors: Error[] = [];
  transport.onmessage = (message) => received.push(message);
  transport.onerror = (cause) => errors.push(cause);

  await transport.start();
  process.stdout.write(
    Buffer.concat([
      Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"text":"'),
      invalid,
      Buffer.from('"}}\n'),
    ]),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  await transport.close();

  expect(received).toEqual([]);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.message).toMatch(/encoded data was not valid/i);
});

it("accepts a complete JSON-RPC frame at the 8 MiB boundary", async () => {
  const process = new FixtureProcess();
  const transport = new JadxMcpTransport(
    { command: "fixture", arguments: [] },
    fixtureLauncher(process),
  );
  const received: JSONRPCMessage[] = [];
  transport.onmessage = (message) => received.push(message);
  const response = {
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: "" }] },
  } satisfies JSONRPCMessage;
  const emptyFrameBytes = Buffer.byteLength(serializeMessage(response)) - 1;
  const maxFrameResponse = {
    ...response,
    result: {
      content: [
        { type: "text", text: "x".repeat(8 * 1024 * 1024 - emptyFrameBytes) },
      ],
    },
  } satisfies JSONRPCMessage;
  const frame = Buffer.from(serializeMessage(maxFrameResponse));

  expect(frame.at(-1)).toBe(10);
  expect(frame.length - 1).toBe(8 * 1024 * 1024);
  await transport.start();
  process.stdout.write(frame);

  expect(received).toEqual([maxFrameResponse]);
  await transport.close();
});

it("retries an incomplete owned stop while joining concurrent close callers", async () => {
  const process = new FixtureProcess();
  let cleanupFails = true;
  const transport = new JadxMcpTransport(
    { command: "fixture", arguments: [] },
    async ({ runId }) => ({
      process,
      ownership: {
        runId,
        leaderPid: process.pid,
        processGroupId: process.pid,
        expectedParentPid: process.pid,
      },
      cleanup: async () => {
        if (cleanupFails)
          return {
            cleaned: false,
            reason: "ownership verification unavailable",
          };
        process.emit("exit", 0, null);
        process.emit("close", 0, null);
        return { cleaned: true, signaled: false };
      },
    }),
  );
  await transport.start();
  const firstClose = transport.close();
  expect(transport.close()).toBe(firstClose);
  await expect(firstClose).rejects.toMatchObject({ cleanupIncomplete: true });
  cleanupFails = false;
  await transport.close();
  await transport.close();
});
