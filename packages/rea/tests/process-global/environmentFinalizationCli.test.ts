import { expect, it, vi } from "vitest";
import { AnalysisError } from "../../src/domain/analysisErrorBase.js";
import { createCli } from "../../src/cli.js";
import type { ServedEnvironment } from "../../src/server/environment/serveEnvironment.js";
import type { ServeStreamableHttpOptions } from "../../src/server/http/serveStreamableHttp.js";
import { StreamableHttpListenError } from "../../src/server/http/streamableHttpListenError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { writeEnvironmentServeFiles } from "../fixtures/environmentServe.js";

const control = vi.hoisted(() => ({
  ready: undefined as (() => void) | undefined,
  served: undefined as ServedEnvironment | undefined,
  onerror: undefined as ServeStreamableHttpOptions["onerror"],
  failClose: false,
  closeCalls: 0,
  cleanupFailure: undefined as AnalysisError | undefined,
}));

// Read asynchronous mock observations through their declared owner contracts;
// assignments inside imported callbacks are not visible to local control flow.
const observedEnvironment = (): ServedEnvironment | undefined => control.served;
const observedCleanupFailure = (): AnalysisError | undefined =>
  control.cleanupFailure;

vi.mock(
  "../../src/server/http/serveStreamableHttp.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/server/http/serveStreamableHttp.js")
      >();
    return {
      ...actual,
      serveStreamableHttp: (options: ServeStreamableHttpOptions) => {
        control.onerror = options.onerror;
        return actual.serveStreamableHttp({
          ...options,
          createMcpServer: async (context) => {
            const server = await options.createMcpServer(context);
            const close = server.close.bind(server);
            server.close = async () => {
              control.closeCalls += 1;
              if (control.failClose) {
                control.failClose = false;
                throw new Error("controlled MCP cleanup failure");
              }
              await close();
            };
            return server;
          },
        });
      },
    };
  },
);

vi.mock(
  "../../src/server/environment/serveEnvironment.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/server/environment/serveEnvironment.js")
      >();
    return {
      ...actual,
      serveEnvironment: async (
        ...args: Parameters<typeof actual.serveEnvironment>
      ) => {
        const started = await actual.serveEnvironment(...args);
        if (!started.ok) return started;
        const served = {
          ...started.value,
          close: async () => {
            try {
              await started.value.close();
            } catch (cause) {
              if (cause instanceof AnalysisError)
                control.cleanupFailure = cause;
              throw cause;
            }
          },
        };
        control.served = served;
        control.ready?.();
        return { ...started, value: served };
      },
    };
  },
);

it.each([
  { ending: "signal", fails: false },
  { ending: "signal", fails: true },
  { ending: "listener", fails: false },
  { ending: "listener", fails: true },
] as const)(
  "retains environment $ending facts when final cleanup fails=$fails",
  async ({ ending, fails }) => {
    const files = await writeEnvironmentServeFiles(
      await createTestTempDirectory("rea-environment-finalization-"),
    );
    const originalExitCode = process.exitCode;
    const originalListeners = new Set(process.listeners("SIGINT"));
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    control.ready = ready;
    control.served = undefined;
    control.failClose = fails;
    control.closeCalls = 0;
    control.cleanupFailure = undefined;
    let stdout = "";
    const pending = createCli({ REA_LOG_LEVEL: "silent" }).serve(
      [
        "environment-serve",
        files.manifestPath,
        "--evidence",
        files.capturePath,
        "--port",
        "0",
        "--json",
      ],
      {
        env: {},
        exit: () => {},
        stdout: (text) => {
          stdout += text;
        },
      },
    );
    try {
      await started;
      const served = observedEnvironment();
      if (served === undefined) throw new Error("Environment was not admitted");
      if (ending === "signal") {
        const listeners = process
          .listeners("SIGINT")
          .filter((listener) => !originalListeners.has(listener));
        expect(listeners).toHaveLength(1);
        listeners[0]?.call(process, "SIGINT");
      } else
        control.onerror?.(
          new StreamableHttpListenError(
            Object.assign(new Error("controlled listener failure"), {
              code: "EIO",
            }),
            "serving",
          ),
        );
      await pending;
      const output: unknown = JSON.parse(stdout);
      expect(control.closeCalls).toBe(1);
      expect(process.exitCode).toBe(ending === "signal" ? 130 : 1);
      if (!fails) {
        expect(output).toMatchObject(
          ending === "signal"
            ? {
                status: "stopped",
                url: served.url,
                evidence_id: expect.any(String),
              }
            : {
                code: "resource_constraint",
                details: { diagnostics: { listener_phase: "serving" } },
              },
        );
      } else {
        expect(JSON.stringify(output)).toContain(
          "controlled MCP cleanup failure",
        );
        expect(output).not.toHaveProperty("status");
        expect(output).toMatchObject({
          code: "cleanup_incomplete",
          details: { resources: [served.url] },
        });
        expect(output).toMatchObject(
          ending === "signal"
            ? {
                details: {
                  diagnostics: {
                    shutdown_observation: {
                      status: "shutdown_requested",
                      url: served.url,
                      environment: served.card.name,
                      tools: served.card.capabilities.tools.length,
                      evidence_id: expect.any(String),
                      manifest_evidence_id: expect.any(String),
                    },
                  },
                },
              }
            : {
                details: {
                  diagnostics: {
                    primary_error: {
                      code: "resource_constraint",
                      details: {
                        diagnostics: {
                          listener_phase: "serving",
                          listener_failure: { system_code: "EIO" },
                        },
                      },
                      remediation: { action: expect.any(String) },
                    },
                  },
                },
              },
        );
        expect(observedCleanupFailure()?.cleanupIncomplete).toBe(true);
        expect(observedCleanupFailure()?.cleanupResources).toEqual([
          served.url,
        ]);
        await served.close();
        expect(control.closeCalls).toBe(2);
        expect(observedCleanupFailure()?.cleanupIncomplete).toBe(false);
        expect(observedCleanupFailure()?.cleanupResources).toEqual([]);
      }
      expect(process.listeners("SIGINT")).toEqual([...originalListeners]);
    } finally {
      control.failClose = false;
      await observedEnvironment()?.close();
      control.ready = undefined;
      control.served = undefined;
      process.exitCode = originalExitCode;
    }
  },
);
