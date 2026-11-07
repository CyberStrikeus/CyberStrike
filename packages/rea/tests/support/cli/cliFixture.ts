import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { INLINE_EVIDENCE_MCP_ENVIRONMENT } from "../../../scripts/lib/mcp-verification-environment.mjs";

import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../workspace/workspaceFixture.js";
import {
  processTest,
  type ProcessResult,
  type TestProcesses,
} from "../process/processFixture.js";
import {
  createCliCommandSession,
  type CliCommandSession,
} from "./cliCommandSession.js";

/** Caller-controlled values for one compiled REA CLI invocation. */
export interface CliInvocation {
  readonly arguments: readonly string[];
  readonly cwd?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly input?: string | Uint8Array;
  readonly timeoutMs?: number;
}

/** Normalized result from the compiled REA CLI. */
export interface CliResult extends ProcessResult {
  readonly json: unknown | undefined;
}

/** One compiled stdio MCP tool call. */
export type SharedMcpCall = Awaited<
  ReturnType<
    typeof import("../../fixtures/localToolsMcp.js").connectLocalToolsMcp
  >
>["call"];

/** Compiled REA CLI driver owned by one test. */
export interface TestCli {
  run(invocation: CliInvocation): Promise<CliResult>;
  /**
   * File-scoped stdio MCP caller. Present on `cliTest` drivers and absent for
   * drivers created with `createTestCli` alone.
   */
  sharedMcpCall?(): Promise<SharedMcpCall>;
  /**
   * File-scoped compiled CLI process for commands with no stdin. Present on
   * `cliTest` drivers. A different environment restarts the process. Stdin and
   * explicit deadlines stay on `run`, which starts a fresh process.
   */
  sharedCliRun?(invocation: CliInvocation): Promise<CliResult>;
}

/** One file-scoped stdio MCP session. */
export interface SharedMcpSession {
  call(): Promise<SharedMcpCall>;
}

const sharedMcpSessionClosed = (): Error =>
  new Error("Shared MCP session is closed");

/** Keep the handshake as the caller error and retain the cleanup failure beside it. */
const startupFailureWithCleanup = (
  startup: unknown,
  cleanup: unknown,
): Error => {
  const primary =
    startup instanceof Error ? startup : new Error(String(startup));
  return new Error(primary.message, {
    cause: new AggregateError([primary, cleanup], primary.message, {
      cause: primary,
    }),
  });
};

/**
 * Start at most one server for the file. Close waits for startup still in
 * flight. A connector that sees `isClosed` can skip the server; a server
 * registered after close is still cleaned up. A failed cleanup stays owned,
 * and the next call does not open another server until that cleanup succeeds.
 */
export const createSharedMcpSession = (
  connect: (
    registerCleanup: (cleanup: () => Promise<void>) => void,
    isClosed: () => boolean,
  ) => Promise<SharedMcpCall>,
): { session: SharedMcpSession; close(): Promise<void> } => {
  let pending: Promise<SharedMcpCall> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  let closeGeneration: symbol | undefined;
  let cleanupQueue: Promise<void> = Promise.resolve();
  const cleanups: Array<() => Promise<void>> = [];
  const drain = (): Promise<void> => {
    const run = cleanupQueue
      .then(
        () => undefined,
        () => undefined,
      )
      .then(async () => {
        const failures: unknown[] = [];
        const retained: Array<() => Promise<void>> = [];
        while (cleanups.length > 0) {
          const cleanup = cleanups.pop();
          if (cleanup === undefined) break;
          try {
            await cleanup();
          } catch (error) {
            failures.push(error);
            retained.push(cleanup);
          }
        }
        for (const cleanup of retained.reverse()) cleanups.push(cleanup);
        // A reasonless rejection is `undefined` and still owns the cleanup.
        if (failures.length > 1) {
          throw new AggregateError(
            failures,
            "Shared MCP session cleanup failed",
          );
        }
        if (failures.length === 1) throw failures[0];
      });
    cleanupQueue = run;
    return run;
  };
  const registerCleanup = (cleanup: () => Promise<void>): void => {
    cleanups.push(cleanup);
  };
  return {
    session: {
      call: () => {
        if (closed) return Promise.reject(sharedMcpSessionClosed());
        pending ??= (async () => {
          try {
            if (cleanups.length > 0) await drain();
          } catch (cleanupError) {
            // Close owns cleanup once shutdown has started, so a failed
            // handshake cannot clear the startup close is awaiting.
            if (!closed) pending = undefined;
            throw cleanupError;
          }
          if (closed) throw sharedMcpSessionClosed();
          try {
            const opened = await connect(registerCleanup, () => closed);
            if (closed) throw sharedMcpSessionClosed();
            return opened;
          } catch (error) {
            if (!closed) {
              pending = undefined;
              try {
                await drain();
              } catch (cleanupError) {
                throw startupFailureWithCleanup(error, cleanupError);
              }
            }
            throw error;
          }
        })();
        return pending;
      },
    },
    close: () => {
      closed = true;
      if (closing !== undefined) return closing;
      const starting = pending;
      const generation = Symbol("shared-mcp-close");
      closeGeneration = generation;
      const attempt = (async () => {
        try {
          if (starting !== undefined) {
            await starting.catch(() => undefined);
          }
          await drain();
        } catch (error) {
          // A failed close stays retryable. Completion is cached only after
          // every retained cleanup has succeeded.
          if (closeGeneration === generation) {
            closing = undefined;
            closeGeneration = undefined;
          }
          throw error;
        }
      })();
      closing = attempt;
      return attempt;
    },
  };
};

const createFileMcpSession = (
  compileCache: string,
): { session: SharedMcpSession; close(): Promise<void> } =>
  createSharedMcpSession(async (registerCleanup, isClosed) => {
    const { connectLocalToolsMcp } =
      await import("../../fixtures/localToolsMcp.js");
    if (isClosed()) throw sharedMcpSessionClosed();
    const mcp = await connectLocalToolsMcp(
      {
        ...INLINE_EVIDENCE_MCP_ENVIRONMENT,
        NODE_COMPILE_CACHE: compileCache,
      },
      registerCleanup,
    );
    return mcp.call;
  });

const parseJson = (stdout: string): unknown | undefined => {
  const document = stdout.trim();
  if (document.length === 0) return undefined;
  try {
    return JSON.parse(document) as unknown;
  } catch {
    return undefined;
  }
};

/** Child environment for one compiled CLI process, without the parent environment. */
export const cliProcessEnvironment = (
  environment: NodeJS.ProcessEnv | undefined,
  compileCache?: string,
): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? "",
  // Native Windows APIs need the system root and a writable temporary
  // directory even when the command's application environment is empty.
  ...(process.platform === "win32"
    ? {
        SystemRoot: process.env.SystemRoot,
        TEMP: tmpdir(),
        TMP: tmpdir(),
      }
    : {}),
  ...cliCompileCacheEnvironment(environment, compileCache),
});

/** Keep string entries. A shared process cannot round-trip an absent variable as JSON. */
export const definedCliEnvironment = (
  environment: NodeJS.ProcessEnv,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value] as const] : [],
    ),
  );

/** Reuse CLI compilation without overriding caller-selected cache or coverage. */
export const cliCompileCacheEnvironment = (
  environment: NodeJS.ProcessEnv | undefined,
  compileCache?: string,
): NodeJS.ProcessEnv => ({
  ...(compileCache === undefined || environment?.NODE_V8_COVERAGE !== undefined
    ? {}
    : { NODE_COMPILE_CACHE: compileCache }),
  ...environment,
});

/**
 * Run one command on the file-scoped compiled CLI. Stdin and explicit
 * deadlines stay on `TestCli.run`, which starts a fresh process.
 */
export const runFileCli = (
  cli: TestCli,
  invocation: CliInvocation,
): Promise<CliResult> => {
  const run = cli.sharedCliRun;
  if (run === undefined)
    throw new Error("cliTest did not provide a shared CLI session");
  return run(invocation);
};

/** Create a compiled CLI driver backed by the supplied process registry. */
export const createTestCli = (
  processes: TestProcesses,
  compileCache?: string,
): TestCli => ({
  run: async ({
    arguments: arguments_,
    cwd,
    environment,
    input,
    timeoutMs,
  }) => {
    const result = await processes.run(
      process.execPath,
      [resolve("scripts/rea.mjs"), ...arguments_],
      {
        cwd: cwd ?? process.cwd(),
        env: cliProcessEnvironment(environment, compileCache),
        ...(input === undefined ? {} : { input }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      },
    );
    return { ...result, json: parseJson(result.stdout) };
  },
});

/** Vitest API extended with an owned process registry and compiled CLI driver. */
export const cliTest = processTest.extend<{
  $test: { cli: TestCli };
  $file: { mcpSession: SharedMcpSession; cliCommandSession: CliCommandSession };
  $worker: { cliCompileCache: string };
}>({
  cliCompileCache: [
    // oxlint-disable-next-line no-empty-pattern -- Vitest parses fixture dependencies from object destructuring.
    async ({}, use) => {
      const workspace = await createTestWorkspace("rea-cli-compile-cache-");
      try {
        await use(workspace.path("node-compile"));
      } finally {
        await removeTestWorkspace(workspace.root);
      }
    },
    { scope: "worker" },
  ],
  mcpSession: [
    async ({ cliCompileCache }, use) => {
      const opened = createFileMcpSession(cliCompileCache);
      try {
        await use(opened.session);
      } finally {
        await opened.close();
      }
    },
    { scope: "file" },
  ],
  cliCommandSession: [
    // oxlint-disable-next-line no-empty-pattern -- Vitest parses fixture dependencies from object destructuring.
    async ({}, use) => {
      const session = createCliCommandSession();
      try {
        await use(session);
      } finally {
        await session.close();
      }
    },
    { scope: "file" },
  ],
  cli: async (
    { processes, cliCompileCache, mcpSession, cliCommandSession },
    use,
  ) => {
    const cli = createTestCli(processes, cliCompileCache);
    await use({
      ...cli,
      sharedMcpCall: () => mcpSession.call(),
      sharedCliRun: (invocation) => {
        if (
          invocation.input !== undefined ||
          invocation.timeoutMs !== undefined
        )
          return cli.run(invocation);
        return cliCommandSession.run({
          arguments: invocation.arguments,
          cwd: invocation.cwd ?? process.cwd(),
          environment: definedCliEnvironment(
            cliProcessEnvironment(invocation.environment, cliCompileCache),
          ),
        });
      },
    });
  },
});
