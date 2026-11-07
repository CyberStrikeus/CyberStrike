import { onTestFinished } from "vitest";
import { spawn } from "@lydell/node-pty";
import { RizinDebugSessionManager } from "../../../src/rizin/RizinDebugSessionManager.js";
import { stopOwnedDebuggerProcess } from "../../../src/process/ownedDebuggerSession.js";

let ttyPathPromise: Promise<string> | undefined;

export const rizinTestInferiorTty = (): Promise<string> => {
  if (process.platform === "win32")
    return Promise.reject(
      new Error("The Rizin test TTY requires a POSIX host."),
    );
  ttyPathPromise ??= new Promise<string>((resolve, reject) => {
    const terminal = spawn("sh", ["-c", "tty; exec sleep 600"], {
      name: "xterm",
      cols: 80,
      rows: 24,
      encoding: "utf8",
    });
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("test TTY path timeout")),
      2_000,
    );
    let exited = false;
    const ended = new Promise<void>((resolveExit) =>
      terminal.onExit(() => {
        exited = true;
        resolveExit();
      }),
    );
    // MCP workers reuse this module across files. A file-scoped afterAll would
    // leave later files holding a cached path whose native TTY was destroyed.
    onTestFinished(async () => {
      clearTimeout(timer);
      ttyPathPromise = undefined;
      if (!exited) terminal.kill();
      await ended;
    });
    terminal.onData((chunk) => {
      output += chunk;
      const pattern =
        process.platform === "darwin"
          ? /\/dev\/ttys[0-9a-z]+/u
          : /\/dev\/pts\/\d+/u;
      const match = pattern.exec(output);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
  return ttyPathPromise;
};

/** These fixture processes do not launch or attach an inferior. */
export const stopFakeNoInferior = async (
  session: Parameters<typeof stopOwnedDebuggerProcess>[0],
  debuggerName: string,
  options?: Parameters<typeof stopOwnedDebuggerProcess>[2],
) =>
  stopOwnedDebuggerProcess(
    {
      ...session,
      inferiorStateUnknown: () => false,
      detachInferior: async () => ({ status: "no-inferior" }),
    },
    debuggerName,
    options,
  );

export const createRizinTestManager = (
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
  options: ConstructorParameters<typeof RizinDebugSessionManager>[1] = {},
): RizinDebugSessionManager =>
  new RizinDebugSessionManager(
    { ...process.env, ...environment },
    {
      // These fake-provider tests model Linux protocol behavior independently of
      // the host running the suite. Real-provider coverage checks the host platform.
      platform: "linux",
      stopProcess: stopFakeNoInferior,
      ...options,
    },
  );
