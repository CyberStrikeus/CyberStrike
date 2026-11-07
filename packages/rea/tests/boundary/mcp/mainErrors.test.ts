import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { run, runEntrypoint } from "../../../src/main.js";
import {
  MCP_CONNECTION_LOST,
  MCP_TRANSPORT_ERROR,
  MCP_CONNECTION_START_FAILED,
  MCP_HTTP_LISTEN_FAILED,
  MCP_SHUTDOWN_FAILED,
  SERVER_START_FAILED,
} from "../../../src/main/messages.js";
import type { McpServeOptions } from "../../../src/main/types.js";
import {
  StreamableHttpHostAllowlistError,
  StreamableHttpListenError,
} from "../../../src/server/http/streamableHttpListenError.js";

type RuntimeDependencies = NonNullable<Parameters<typeof run>[0]>;

const nextTurn = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const wrappedListenerDisconnect = (code: "EPIPE" | "ECONNRESET") => {
  const error = new StreamableHttpListenError(
    Object.assign(new Error("SECRET listener stack"), { code }),
    "serving",
  );
  // Consumers must use the owner's parsed facts, not re-read its native cause.
  Object.defineProperty(error, "cause", { value: new Error("opaque cause") });
  return error;
};

const dependencies = ({
  serve,
  output,
  shutdown,
  exitCodes,
  shutdownUnregistrations = [],
  loadOptionalProviders,
}: {
  readonly serve: RuntimeDependencies["serve"];
  readonly output: string[];
  readonly shutdown: Array<() => void>;
  readonly exitCodes: number[];
  readonly shutdownUnregistrations?: string[];
  readonly loadOptionalProviders?: RuntimeDependencies["loadOptionalProviders"];
}): RuntimeDependencies => ({
  env: {},
  serve,
  writeStderr: (text) => output.push(text),
  setExitCode: (code) => exitCodes.push(code),
  registerShutdown: (handler) => {
    shutdown.push(handler);
    return () => shutdownUnregistrations.push("shutdown");
  },
  ...(loadOptionalProviders === undefined ? {} : { loadOptionalProviders }),
});

describe("MCP runtime errors", () => {
  it("imports the compiled runtime when argv[1] is a missing synthetic path", () => {
    const runtimeUrl = pathToFileURL(resolve("dist/main.js")).href;
    const script = [
      'process.argv[1] = "/rea-test-missing-entrypoint/main.js";',
      `await import(${JSON.stringify(runtimeUrl)});`,
      'console.log("IMPORT_OK");',
    ].join("\n");
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: process.cwd(), encoding: "utf8", timeout: 5_000 },
    );

    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stdout).toBe("IMPORT_OK\n");
    expect(child.stderr).toBe("");
  });

  it.each([
    {
      name: "a broken pipe",
      cause: Object.assign(new Error("SECRET broken pipe"), { code: "EPIPE" }),
      message: MCP_CONNECTION_LOST,
    },
    {
      name: "a wrapped HTTP broken pipe",
      cause: wrappedListenerDisconnect("EPIPE"),
      message: MCP_CONNECTION_LOST,
    },
    {
      name: "a wrapped HTTP reset",
      cause: wrappedListenerDisconnect("ECONNRESET"),
      message: MCP_CONNECTION_LOST,
    },
    {
      name: "an unknown connection state",
      cause: new Error("SECRET transport stack"),
      message: MCP_TRANSPORT_ERROR,
    },
  ])("reports $name without exposing its cause", async ({ cause, message }) => {
    const output: string[] = [];
    const shutdown: Array<() => void> = [];
    const shutdownUnregistrations: string[] = [];
    let options: McpServeOptions | undefined;
    let closeCalls = 0;
    const close = (): Promise<void> => {
      closeCalls += 1;
      return Promise.resolve();
    };
    const exitCodes: number[] = [];
    expect(
      await run(
        dependencies({
          serve: (_factory, received) => {
            options = received;
            return { close };
          },
          output,
          shutdown,
          exitCodes,
          shutdownUnregistrations,
        }),
      ),
    ).toBe(0);
    options?.onerror?.(cause);
    expect(output).toEqual([`${message}\n`]);
    shutdown[0]?.();
    await nextTurn();
    expect(closeCalls).toBe(1);
    expect(shutdownUnregistrations).toEqual(["shutdown"]);
  });

  it("unregisters every process-lifetime handler during idempotent shutdown", async () => {
    const shutdown: Array<() => void> = [];
    const unregistrations: string[] = [];
    let closeCalls = 0;
    const runtime: RuntimeDependencies = {
      ...dependencies({
        serve: () => ({
          close: async () => {
            closeCalls += 1;
          },
        }),
        output: [],
        shutdown,
        exitCodes: [],
        shutdownUnregistrations: unregistrations,
      }),
    };

    expect(await run(runtime)).toBe(0);
    expect(shutdown).toHaveLength(1);

    shutdown[0]?.();
    shutdown[0]?.();
    await nextTurn();

    expect(closeCalls).toBe(1);
    expect(unregistrations).toEqual(["shutdown"]);
  });

  it("reports transport startup failure without its cause", async () => {
    const output: string[] = [];
    expect(
      await run(
        dependencies({
          serve: () => {
            throw new Error("SECRET startup stack");
          },
          output,
          shutdown: [],
          exitCodes: [],
        }),
      ),
    ).toBe(1);
    expect(output).toEqual([`${MCP_CONNECTION_START_FAILED}\n`]);
  });

  it("reports shutdown failure and sets a failing exit code", async () => {
    const output: string[] = [];
    const shutdown: Array<() => void> = [];
    const exitCodes: number[] = [];
    await run(
      dependencies({
        serve: () => ({
          close: () => Promise.reject(new Error("SECRET close")),
        }),
        output,
        shutdown,
        exitCodes,
      }),
    );
    shutdown[0]?.();
    await nextTurn();
    expect(exitCodes).toEqual([1]);
    expect(output).toEqual([`${MCP_SHUTDOWN_FAILED}\n`]);
  });

  it("reports an unexpected entrypoint failure without its cause", async () => {
    const output: string[] = [];
    const exitCodes: number[] = [];
    await runEntrypoint(
      () => Promise.reject(new Error("SECRET entrypoint stack")),
      (text) => output.push(text),
      (code) => exitCodes.push(code),
    );
    expect(output).toEqual([`${SERVER_START_FAILED}\n`]);
    expect(exitCodes).toEqual([1]);
  });
});

describe("MCP runtime HTTP transport errors", () => {
  it("awaits an asynchronous transport start before installing shutdown", async () => {
    const shutdown: Array<() => void> = [];
    let closeCalls = 0;
    expect(
      await run(
        dependencies({
          serve: async () => ({
            close: async () => {
              closeCalls += 1;
            },
          }),
          output: [],
          shutdown,
          exitCodes: [],
        }),
      ),
    ).toBe(0);
    expect(shutdown).toHaveLength(1);
    shutdown[0]?.();
    await nextTurn();
    expect(closeCalls).toBe(1);
  });

  it("reports host allowlist recovery instead of port advice", async () => {
    const output: string[] = [];
    const refused = new StreamableHttpListenError(
      new StreamableHttpHostAllowlistError("0.0.0.0"),
    );
    expect(
      await run(
        dependencies({
          serve: () => Promise.reject(refused),
          output,
          shutdown: [],
          exitCodes: [],
        }),
      ),
    ).toBe(1);
    expect(output).toEqual([`${refused.remediationAction}\n`]);
    expect(output[0]).toContain("Set MCP_ALLOWED_HOSTS");
    expect(output[0]).not.toContain("Choose another --port");
  });

  it("reports an HTTP listener that cannot bind without its cause", async () => {
    const output: string[] = [];
    expect(
      await run(
        dependencies({
          serve: () =>
            Promise.reject(
              new StreamableHttpListenError(
                new Error("SECRET EADDRINUSE 127.0.0.1:1"),
              ),
            ),
          output,
          shutdown: [],
          exitCodes: [],
        }),
      ),
    ).toBe(1);
    expect(output).toEqual([`${MCP_HTTP_LISTEN_FAILED}\n`]);
  });
});
