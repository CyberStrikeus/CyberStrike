import { EventEmitter } from "node:events";
import { expect, it } from "vitest";
import pino from "pino";

import { createShutdown } from "../main/shutdown.js";
import {
  createExitStatus,
  latchSignalShutdown,
  registerProcessShutdown,
  registerSignalShutdown,
} from "../main/processShutdown.js";
import type { McpServerHandle, RuntimeDependencies } from "../main/types.js";
import { createManagedBinarySession } from "../composition/binary.js";

it("registers only signals for a listener and reports the signal exit status", () => {
  const signals = new EventEmitter();
  const statuses: number[] = [];
  const unregister = registerSignalShutdown(
    (status) => statuses.push(status),
    signals,
  );
  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  expect(statuses).toEqual([143, 130]);
  unregister();
  signals.emit("SIGTERM");
  expect(statuses).toEqual([143, 130]);
  expect(signals.listenerCount("SIGTERM")).toBe(0);
});

it("names the signal that fired, passes none for stdin, and ignores stdin when the events omit it", () => {
  const signals = new EventEmitter();
  const input = new EventEmitter();
  const triggers: (string | undefined)[] = [];
  const withInput = registerProcessShutdown((signal) => triggers.push(signal), {
    signals,
    stdin: input,
  });
  signals.emit("SIGINT");
  input.emit("end");
  expect(triggers).toEqual(["SIGINT", undefined]);
  withInput();
  const signalsOnly = registerProcessShutdown(
    (signal) => triggers.push(signal),
    { signals },
  );
  signals.emit("SIGTERM");
  input.emit("end");
  input.emit("close");
  expect(triggers).toEqual(["SIGINT", undefined, "SIGTERM"]);
  signalsOnly();
  signals.emit("SIGINT");
  expect(triggers).toEqual(["SIGINT", undefined, "SIGTERM"]);
  expect(input.listenerCount("end")).toBe(0);
});

const shutdownEvents = ["SIGINT", "SIGTERM", "end", "close"] as const;

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

it.each(shutdownEvents)(
  "retries failed cleanup after %s and unregisters every shutdown event on success",
  async (event) => {
    const signals = new EventEmitter();
    const input = new EventEmitter();
    const output: string[] = [];
    const exitCodes: number[] = [];
    let unregisterCount = 0;
    let transportCloseCalls = 0;
    let androidCloseCalls = 0;
    let optionalCloseCalls = 0;
    let sessionCloseCalls = 0;
    const session = createManagedBinarySession();
    const originalSessionClose = session.close.bind(session);
    session.close = async (...args) => {
      sessionCloseCalls += 1;
      return originalSessionClose(...args);
    };
    const dependencies: RuntimeDependencies = {
      env: {},
      serve: () => {
        throw new Error("unused fixture transport");
      },
      writeStderr: (text) => output.push(text),
      setExitCode: (code) => exitCodes.push(code),
      registerShutdown: (handler) => {
        const unregister = registerProcessShutdown(handler, {
          signals,
          stdin: input,
        });
        return () => {
          unregisterCount += 1;
          unregister();
        };
      },
    };
    const handle: McpServerHandle = {
      close: async () => {
        transportCloseCalls += 1;
        if (transportCloseCalls === 1)
          throw new Error("first transport close failed");
      },
    };
    const lifecycle = createShutdown({
      handle,
      closeAndroid: async () => {
        androidCloseCalls += 1;
      },
      closeOptionalProviders: async () => {
        optionalCloseCalls += 1;
      },
      session,
      dependencies,
      serverLogger: pino({ enabled: false }),
    });

    if (event === "SIGINT" || event === "SIGTERM") signals.emit(event);
    else input.emit(event);
    await flush();

    expect([
      transportCloseCalls,
      androidCloseCalls,
      optionalCloseCalls,
    ]).toEqual([1, 1, 1]);
    expect(sessionCloseCalls).toBe(1);
    expect(output).toHaveLength(1);

    if (event === "SIGINT" || event === "SIGTERM") signals.emit(event);
    else input.emit(event);
    await lifecycle.shutdown();

    expect([
      transportCloseCalls,
      androidCloseCalls,
      optionalCloseCalls,
    ]).toEqual([2, 1, 1]);
    expect(sessionCloseCalls).toBe(1);
    expect(unregisterCount).toBe(1);
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);

    signals.emit("SIGINT");
    input.emit("end");
    await flush();
    expect([
      transportCloseCalls,
      androidCloseCalls,
      optionalCloseCalls,
    ]).toEqual([2, 1, 1]);
  },
);

it("keeps shared provider owners open when the transport preparation barrier fails", async () => {
  const events: string[] = [];
  let attempts = 0;
  const session = createManagedBinarySession();
  const closeSession = session.close.bind(session);
  session.close = async (...args) => {
    events.push("session");
    return closeSession(...args);
  };
  const lifecycle = createShutdown({
    handle: {
      prepareShutdown: async () => {
        events.push("prepare");
        attempts += 1;
        if (attempts === 1) throw new Error("tool cleanup is still running");
      },
      close: async () => {
        events.push("transport");
      },
    },
    closeOptionalProviders: async () => {
      events.push("provider");
    },
    session,
    dependencies: {
      env: {},
      serve: () => {
        throw new Error("unused transport");
      },
      writeStderr: () => undefined,
      setExitCode: () => undefined,
      registerShutdown: () => () => undefined,
    },
    serverLogger: pino({ enabled: false }),
  });
  await expect(lifecycle.shutdown()).rejects.toThrow(
    "tool cleanup is still running",
  );
  expect(events).toEqual(["prepare"]);
  await lifecycle.shutdown();
  expect(events).toEqual([
    "prepare",
    "prepare",
    "transport",
    "provider",
    "session",
  ]);
});

it("joins concurrent shutdown events and retries only failed owners", async () => {
  const signals = new EventEmitter();
  const input = new EventEmitter();
  const output: string[] = [];
  let transportCloseCalls = 0;
  let androidCloseCalls = 0;
  let sessionCloseCalls = 0;
  let releaseFirstClose: ((error: Error) => void) | undefined;
  const session = createManagedBinarySession();
  const originalSessionClose = session.close.bind(session);
  session.close = async (...args) => {
    sessionCloseCalls += 1;
    return originalSessionClose(...args);
  };
  const dependencies: RuntimeDependencies = {
    env: {},
    serve: () => {
      throw new Error("unused fixture transport");
    },
    writeStderr: (text) => output.push(text),
    setExitCode: () => undefined,
    registerShutdown: (handler) =>
      registerProcessShutdown(handler, { signals, stdin: input }),
  };
  const handle: McpServerHandle = {
    close: async () => {
      transportCloseCalls += 1;
      if (transportCloseCalls === 1)
        await new Promise<never>((_resolve, reject) => {
          releaseFirstClose = reject;
        });
    },
  };
  createShutdown({
    handle,
    closeAndroid: async () => {
      androidCloseCalls += 1;
    },
    session,
    dependencies,
    serverLogger: pino({ enabled: false }),
  });

  signals.emit("SIGINT");
  signals.emit("SIGTERM");
  await flush();
  expect([transportCloseCalls, androidCloseCalls, sessionCloseCalls]).toEqual([
    1, 1, 1,
  ]);

  if (releaseFirstClose === undefined)
    throw new Error("First close attempt did not start");
  releaseFirstClose(new Error("first transport close failed"));
  await flush();
  input.emit("end");
  await flush();

  expect([transportCloseCalls, androidCloseCalls, sessionCloseCalls]).toEqual([
    2, 1, 1,
  ]);
  expect(output.length).toBeGreaterThan(0);
  expect(signals.listenerCount("SIGINT")).toBe(0);
  expect(signals.listenerCount("SIGTERM")).toBe(0);
  expect(input.listenerCount("end")).toBe(0);
  expect(input.listenerCount("close")).toBe(0);
});

it("latches the first startup signal, exits at once on a second, and hands the status over on release", () => {
  const signals = new EventEmitter();
  const exits: number[] = [];
  const latch = latchSignalShutdown(signals, (status) => exits.push(status));
  expect(signals.listenerCount("SIGINT")).toBe(1);
  signals.emit("SIGTERM");
  expect(exits).toEqual([]);
  signals.emit("SIGINT");
  expect(exits).toEqual([143]);
  expect(latch.release()).toBe(143);
  expect(signals.listenerCount("SIGINT")).toBe(0);
  expect(signals.listenerCount("SIGTERM")).toBe(0);
  const quiet = latchSignalShutdown(signals, (status) => exits.push(status));
  expect(quiet.release()).toBeUndefined();
});

it("keeps a signal's exit status through the entry's normal return and yields to a real failure", () => {
  const codes: number[] = [];
  const exit = createExitStatus((code) => codes.push(code));
  exit.set(0);
  exit.signal(143);
  exit.set(0);
  expect(codes).toEqual([0, 143, 143]);
  exit.set(1);
  expect(codes.at(-1)).toBe(1);
  const plain = createExitStatus((code) => codes.push(code));
  plain.set(0);
  expect(codes.at(-1)).toBe(0);
});
