import { EventEmitter } from "node:events";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import pino from "pino";
import { expect, it } from "vitest";

import { createManagedBinarySession } from "../../../src/composition/binary.js";
import { MCP_SHUTDOWN_FAILED } from "../../../src/main/messages.js";
import { createShutdown } from "../../../src/main/shutdown.js";
import { registerProcessShutdown } from "../../../src/main/processShutdown.js";
import type { RuntimeDependencies } from "../../../src/main/types.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err, ok } from "../../../src/domain/result.js";
import { observed } from "../../fixtures/analysisExecution.js";
import {
  createBinarySessionTargets,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";

it("keeps shutdown output stable while logging the rejected cause at debug level", async () => {
  const logs: string[] = [];
  const output: string[] = [];
  const exitCodes: number[] = [];
  const requests: Array<() => void> = [];
  let androidClosed = false;
  const failure = Object.assign(
    new TypeError("fixture transport close failed"),
    {
      code: "ECONNRESET",
    },
  );
  const handle: StdioServerHandle = {
    close: () => Promise.reject(failure),
  };
  const dependencies: RuntimeDependencies = {
    env: {},
    serve: () => {
      throw new Error("unused fixture transport");
    },
    writeStderr: (text) => output.push(text),
    setExitCode: (code) => exitCodes.push(code),
    registerShutdown: (request) => {
      requests.push(request);
      return () => undefined;
    },
  };
  const logger = pino({ level: "debug" }, { write: (line) => logs.push(line) });
  createShutdown({
    handle,
    closeAndroid: async () => {
      androidClosed = true;
    },
    session: createManagedBinarySession(),
    dependencies,
    serverLogger: logger,
  });

  requests[0]?.();
  await new Promise((resolve) => setImmediate(resolve));

  expect(exitCodes).toEqual([1]);
  expect(androidClosed).toBe(true);
  expect(output).toEqual([`${MCP_SHUTDOWN_FAILED}\n`]);
  expect(logs.map((line) => JSON.parse(line))).toContainEqual(
    expect.objectContaining({
      level: 20,
      msg: "MCP shutdown rejected",
      failure_cause: {
        name: "TypeError",
        message: "fixture transport close failed",
        code: "ECONNRESET",
      },
    }),
  );
});

it("reports a typed binary cleanup failure and retains the client for retry", async () => {
  const [target] = await createBinarySessionTargets();
  const failure = new ProviderCleanupError("fixture", ["owned-runtime"], {
    reason: "fixture removal denied",
  });
  let cleanupAllowed = false;
  let retainDocument: boolean | undefined;
  const session = createTestBinarySession(() => ({
    execute: async () => observed(null),
    close: async (options) => {
      retainDocument = options?.retainDocument;
      return cleanupAllowed ? ok(null) : err(failure);
    },
  }));
  expect((await session.open(target)).ok).toBe(true);
  const output: string[] = [];
  const exitCodes: number[] = [];
  const requests: Array<() => void> = [];
  const dependencies: RuntimeDependencies = {
    env: {},
    serve: () => {
      throw new Error("unused fixture transport");
    },
    writeStderr: (text) => output.push(text),
    setExitCode: (code) => exitCodes.push(code),
    registerShutdown: (request) => {
      requests.push(request);
      return () => undefined;
    },
  };
  createShutdown({
    handle: { close: async () => undefined },
    session,
    dependencies,
    serverLogger: pino({ enabled: false }),
  });
  requests[0]?.();
  await new Promise((resolve) => setImmediate(resolve));
  expect(exitCodes).toEqual([1]);
  expect(output).toEqual([
    `${MCP_SHUTDOWN_FAILED}\n`,
    `${failure.userMessage}\n`,
  ]);
  expect(retainDocument).toBe(true);
  cleanupAllowed = true;
  requests[0]?.();
  await new Promise((resolve) => setImmediate(resolve));
  expect((await session.close()).ok).toBe(true);
});

it("retries only failed cleanup owners after concurrent shutdown requests", async () => {
  const requests: Array<() => void> = [];
  const logs: string[] = [];
  const exitCodes: number[] = [];
  let unregisterCount = 0;
  let handleCalls = 0;
  let androidCalls = 0;
  let sessionCalls = 0;
  const dependencies: RuntimeDependencies = {
    env: {},
    serve: () => {
      throw new Error("unused fixture transport");
    },
    writeStderr: () => undefined,
    setExitCode: (code) => exitCodes.push(code),
    registerShutdown: (request) => {
      requests.push(request);
      return () => {
        unregisterCount += 1;
      };
    },
  };
  const session = createTestBinarySession(() => ({
    execute: async () => observed(null),
    close: async () => {
      sessionCalls += 1;
      return ok(null);
    },
  }));
  const [target] = await createBinarySessionTargets();
  if (target === undefined) throw new Error("Missing fixture target");
  expect((await session.open(target)).ok).toBe(true);
  const lifecycle = createShutdown({
    handle: {
      close: async () => {
        handleCalls += 1;
        if (handleCalls === 1) throw new Error("first handle close failed");
      },
    },
    closeAndroid: async () => {
      androidCalls += 1;
      if (androidCalls === 1) throw new Error("first Android close failed");
    },
    session,
    dependencies,
    serverLogger: pino(
      { level: "debug" },
      { write: (line) => logs.push(line) },
    ),
  });

  const first = lifecycle.shutdown();
  const concurrent = lifecycle.shutdown();
  requests[0]?.();
  await expect(first).rejects.toBeInstanceOf(AggregateError);
  await expect(concurrent).rejects.toBeInstanceOf(AggregateError);
  await expect(first).rejects.toMatchObject({
    errors: [
      { message: "first handle close failed" },
      { message: "first Android close failed" },
    ],
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(exitCodes).toEqual([1]);
  expect(logs.map((line) => JSON.parse(line))).toContainEqual(
    expect.objectContaining({
      msg: "MCP shutdown rejected",
      failure_cause: expect.objectContaining({
        errors: [
          expect.objectContaining({ message: "first handle close failed" }),
          expect.objectContaining({ message: "first Android close failed" }),
        ],
      }),
    }),
  );
  expect([handleCalls, androidCalls, sessionCalls, unregisterCount]).toEqual([
    1, 1, 1, 0,
  ]);

  await lifecycle.shutdown();
  expect([handleCalls, androidCalls, sessionCalls, unregisterCount]).toEqual([
    2, 2, 1, 1,
  ]);
  await lifecycle.shutdown();
  expect([handleCalls, androidCalls, sessionCalls, unregisterCount]).toEqual([
    2, 2, 1, 1,
  ]);
});

it("retries failed MCP cleanup owners on a repeated signal and unregisters after success", async () => {
  const signals = new EventEmitter();
  const stdin = new EventEmitter();
  const exitCodes: number[] = [];
  let handleCalls = 0;
  let androidCalls = 0;
  let sessionCalls = 0;
  let unregisterCalls = 0;
  const dependencies: RuntimeDependencies = {
    env: {},
    serve: () => {
      throw new Error("unused fixture transport");
    },
    writeStderr: () => undefined,
    setExitCode: (code) => exitCodes.push(code),
    registerShutdown: (handler) => {
      const unregister = registerProcessShutdown(handler, { signals, stdin });
      return () => {
        unregisterCalls += 1;
        unregister();
      };
    },
  };
  const session = createTestBinarySession(() => ({
    execute: async () => observed(null),
    close: async () => {
      sessionCalls += 1;
      return ok(null);
    },
  }));
  const [target] = await createBinarySessionTargets();
  if (target === undefined) throw new Error("Missing fixture target");
  expect((await session.open(target)).ok).toBe(true);
  createShutdown({
    handle: {
      close: async () => {
        handleCalls += 1;
        if (handleCalls === 1) throw new Error("first handle close failed");
      },
    },
    closeAndroid: async () => {
      androidCalls += 1;
      if (androidCalls === 1) throw new Error("first Android close failed");
    },
    session,
    dependencies,
    serverLogger: pino({ enabled: false }),
  });

  signals.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  expect([handleCalls, androidCalls, sessionCalls, unregisterCalls]).toEqual([
    1, 1, 1, 0,
  ]);
  expect(exitCodes).toEqual([1]);

  signals.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  expect([handleCalls, androidCalls, sessionCalls, unregisterCalls]).toEqual([
    2, 2, 1, 1,
  ]);

  signals.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  expect([handleCalls, androidCalls, sessionCalls, unregisterCalls]).toEqual([
    2, 2, 1, 1,
  ]);
});

const idleShutdownDependencies = (): RuntimeDependencies => ({
  env: {},
  serve: () => {
    throw new Error("unused fixture transport");
  },
  writeStderr: () => undefined,
  setExitCode: () => undefined,
  registerShutdown: () => () => undefined,
});

it("does not leave a provider running when a target open is queued behind shutdown", async () => {
  const [target] = await createBinarySessionTargets();
  if (target === undefined) throw new Error("Missing fixture target");
  let created = 0;
  let closed = 0;
  let releaseHealth: (() => void) | undefined;
  const session = createTestBinarySession(() => {
    created += 1;
    return {
      execute: async (operation) => {
        if (operation === "health" && created === 1)
          await new Promise<void>((resolve) => {
            releaseHealth = resolve;
          });
        return observed(null);
      },
      close: async () => {
        closed += 1;
        return ok(null);
      },
    };
  });
  const opening = session.open(target);
  await expect.poll(() => releaseHealth).toBeTypeOf("function");
  let closeQueued = false;
  const originalClose = session.close.bind(session);
  session.close = (...args) => {
    closeQueued = true;
    return originalClose(...args);
  };
  const lifecycle = createShutdown({
    handle: { close: async () => undefined },
    session,
    dependencies: idleShutdownDependencies(),
    serverLogger: pino({ enabled: false }),
  });

  const shuttingDown = lifecycle.shutdown();
  await expect.poll(() => closeQueued).toBe(true);
  const reopening = session.open(target);
  const resources = session.openBundleResources(target);
  releaseHealth?.();

  expect((await opening).ok).toBe(true);
  await shuttingDown;
  await expect(reopening).resolves.toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError", operation: "open_binary" },
  });
  await expect(resources).resolves.toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      operation: "open_bundle_resources",
    },
  });
  expect(session.activeTarget()).toBeUndefined();
  expect(session.activeBundleResourceRoot()).toBeUndefined();
  expect(created).toBe(closed);
});

it("rejects target acquisition after shutdown has settled", async () => {
  const [target] = await createBinarySessionTargets();
  if (target === undefined) throw new Error("Missing fixture target");
  let created = 0;
  const session = createTestBinarySession(() => {
    created += 1;
    return {
      execute: async () => observed(null),
      close: async () => ok(null),
    };
  });
  const lifecycle = createShutdown({
    handle: { close: async () => undefined },
    session,
    dependencies: idleShutdownDependencies(),
    serverLogger: pino({ enabled: false }),
  });

  await lifecycle.shutdown();
  await expect(session.open(target)).resolves.toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError", operation: "open_binary" },
  });
  await expect(session.openBundleResources(target)).resolves.toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      operation: "open_bundle_resources",
    },
  });
  expect(created).toBe(0);
  expect(session.activeTarget()).toBeUndefined();
});

it("opens a target again after an ordinary close", async () => {
  const [target] = await createBinarySessionTargets();
  if (target === undefined) throw new Error("Missing fixture target");
  let created = 0;
  const session = createTestBinarySession(() => {
    created += 1;
    return {
      execute: async () => observed(null),
      close: async () => ok(null),
    };
  });

  expect((await session.open(target)).ok).toBe(true);
  expect((await session.close()).ok).toBe(true);
  expect((await session.open(target)).ok).toBe(true);
  expect(created).toBe(2);
  expect(session.activeTarget()?.path).toBe(target);
});
