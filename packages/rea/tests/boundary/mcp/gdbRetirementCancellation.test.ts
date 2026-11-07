import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { expect, it, vi } from "vitest";
import {
  registerGdbTools,
  type GdbToolManager,
} from "../../../src/server/registerGdbTools.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { silentLogger } from "../../../src/logger.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { ok, err } from "../../../src/domain/result.js";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { primaryAnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisProvider,
} from "../../../src/application/AnalysisProvider.js";
import { CompositeProvider } from "../../../src/application/binary/CompositeProvider.js";
import { runWithExternalMutationAdmission } from "../../../src/server/externalMutationAdmission.js";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import {
  createBinarySessionTargets,
  createDeferred,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";

it(
  "compares cancellation before dispatch, during retirement, and an uncancelled control",
  { timeout: 8000 },
  async () => {
    for (const mode of [
      "pre-aborted",
      "during-retirement",
      "control",
    ] as const) {
      const [target] = await createBinarySessionTargets();
      const entered = createDeferred<void>();
      const released = createDeferred<void>();
      let closes = 0;
      const session = createTestBinarySession(
        () =>
          ({
            execute: async () => ok({ operation: "health", value: null }),
            close: async () => {
              closes++;
              entered.resolve();
              await released.promise;
              return ok(null);
            },
          }) as never,
      );
      expect((await session.open(target)).ok).toBe(true);
      const id = "00000000-0000-4000-8000-000000000001";
      const evidence = createEvidence(
        undefined,
        { id: "gdb", name: "GDB", version: null },
        {
          predicateType: "rea.debugger.command-observation",
          operation: "gdb_console",
          parameters: { session_id: id, command: "info files" },
          result: { command: "info files", completion_status: "complete" },
          rawResult: { command: "info files" },
        },
      );
      let handler!: (
        input: unknown,
        context: unknown,
      ) => Promise<CallToolResult>;
      const server = {
        registerTool(name: string, _options: unknown, fn: typeof handler) {
          if (name === "gdb_console") handler = fn;
        },
      } as unknown as McpServer;
      const execute = vi.fn(async () => ok({ evidence }));
      const manager = {
        execute,
        retryCleanupFailures: async () => ok(null),
      } as unknown as GdbToolManager;
      const record = vi.fn((value: typeof evidence) =>
        session.recordEvidence(value),
      );
      registerGdbTools(
        server,
        manager,
        silentLogger,
        createToolResultDelivery(undefined),
        record,
        session,
      );
      const controller = new AbortController();
      const reason = { phase: mode };
      if (mode === "pre-aborted") controller.abort(reason);
      try {
        const pending = handler(
          { session_id: id, command: "info files", detail: "complete" },
          { mcpReq: { signal: controller.signal } },
        );
        if (mode !== "pre-aborted") {
          await awaitAcknowledgement(
            entered.promise,
            pending,
            "session retirement",
          );
          expect(execute).toHaveBeenCalledTimes(1);
          expect(record).not.toHaveBeenCalled();
          if (mode === "during-retirement") controller.abort(reason);
        }
        released.resolve();
        const result = await pending;
        const body = result.structuredContent as any;
        const observation = {
          mode,
          aborted: controller.signal.aborted,
          executions: execute.mock.calls.length,
          retirementCloses: closes,
          recordings: record.mock.calls.length,
          isError: result.isError === true,
          code: body.error?.code ?? null,
          hasEvidence: typeof body.evidence_id === "string",
          stored: session.hasEvidence(evidence.evidence_id),
        };
        expect(observation).toEqual({
          mode,
          aborted: mode !== "control",
          executions: mode === "pre-aborted" ? 0 : 1,
          retirementCloses: mode === "pre-aborted" ? 0 : 1,
          recordings: mode === "pre-aborted" ? 0 : 1,
          isError: mode !== "control",
          code: mode === "control" ? null : "cancelled",
          hasEvidence: mode === "control",
          stored: mode !== "pre-aborted",
        });

        if (mode === "during-retirement")
          expect(record.mock.calls[0]?.[0]).toEqual(evidence);
      } finally {
        released.resolve();
        await session.close();
      }
    }
  },
);

it.each(["completed", "failed"] as const)(
  "preserves a %s command and cleanup ownership when cancellation overlaps failed retirement",
  async (mode) => {
    const [target] = await createBinarySessionTargets();
    const entered = createDeferred<void>();
    const released = createDeferred<void>();
    const cleanup = new ProviderCleanupError("fixture", ["document"], {});
    let closes = 0;
    const session = createTestBinarySession(
      () =>
        ({
          execute: async () => ok({ operation: "health", value: null }),
          close: async () => {
            if (++closes === 1) {
              entered.resolve();
              await released.promise;
              return err(cleanup);
            }
            return ok(null);
          },
        }) as never,
    );
    expect((await session.open(target)).ok).toBe(true);
    const commandFailure = new AnalysisInputError("command");
    const evidence = createEvidence(
      undefined,
      { id: "gdb", name: "GDB", version: null },
      {
        operation: "gdb_console",
        parameters: {},
        result: { completed: true },
      },
    );
    const controller = new AbortController();
    const reason = { stage: "retirement" };
    try {
      const pending = runWithExternalMutationAdmission(
        session,
        "gdb_console",
        controller.signal,
        async () => (mode === "completed" ? ok(evidence) : err(commandFailure)),
        (value) => value,
      );
      await awaitAcknowledgement(
        entered.promise,
        pending,
        "failed session retirement",
      );
      controller.abort(reason);
      released.resolve();
      const result = await pending;
      if (result.ok) throw new Error("Expected a failure");
      expect(result.error.cleanupIncomplete).toBe(true);
      const primary = primaryAnalysisError(result.error);
      expect(
        primary.secondaryFailures.some((failure) => failure.cause === reason),
      ).toBe(true);
      if (mode === "completed")
        expect(result.error.partialObservation).toEqual(evidence);
      else expect(primary).toBe(commandFailure);
      expect(await session.status()).toMatchObject({ cleanup_pending: true });
      expect((await session.close()).ok).toBe(true);
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      released.resolve();
      await session.close();
    }
  },
);

it.each(["started", "failed"] as const)(
  "keeps a %s mutation outcome when successful retirement is cancelled",
  async (mode) => {
    const [target] = await createBinarySessionTargets();
    const entered = createDeferred<void>();
    const released = createDeferred<void>();
    const session = createTestBinarySession(
      () =>
        ({
          execute: async () => ok({ operation: "health", value: null }),
          close: async () => {
            entered.resolve();
            await released.promise;
            return ok(null);
          },
        }) as never,
    );
    expect((await session.open(target)).ok).toBe(true);
    const failure = new AnalysisInputError("start_rizin_debug_session");
    const reason = { stage: "retirement" };
    const controller = new AbortController();
    try {
      const pending = runWithExternalMutationAdmission(
        session,
        "start_rizin_debug_session",
        controller.signal,
        async () =>
          mode === "started" ? ok({ session_id: "retained" }) : err(failure),
        undefined,
        undefined,
        (value) => ({ session_id: value.session_id }),
      );
      await awaitAcknowledgement(
        entered.promise,
        pending,
        "session retirement",
      );
      controller.abort(reason);
      released.resolve();
      const result = await pending;
      if (result.ok) throw new Error("Expected a failure");
      if (mode === "started") {
        expect(result.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.cause).toBe(reason);
        expect(result.error.diagnostics).toEqual({ session_id: "retained" });
      } else {
        expect(result.error).toBe(failure);
        expect(
          result.error.secondaryFailures.some((item) => item.cause === reason),
        ).toBe(true);
      }
    } finally {
      released.resolve();
      await session.close();
    }
  },
);

it("follows the original owner of a completed mutation's retirement failure", async () => {
  const [target] = await createBinarySessionTargets();
  let closed = false;
  const cleanup = new ProviderCleanupError(
    "ida",
    ["workspace"],
    {},
  ).bindCleanupResourceOwner({
    get cleanupResources() {
      return closed ? [] : ["workspace"];
    },
  });
  const session = createTestBinarySession(
    () =>
      ({
        execute: async () => ok({ operation: "health", value: null }),
        close: async () => {
          if (!closed) return err(cleanup);
          cleanup.resolveCleanup();
          return ok(null);
        },
      }) as never,
  );
  expect((await session.open(target)).ok).toBe(true);
  try {
    const result = await runWithExternalMutationAdmission(
      session,
      "gdb_console",
      undefined,
      async () => ok(null),
      undefined,
    );
    if (result.ok) throw new Error("Expected cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    closed = true;
    expect((await session.close()).ok).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    closed = true;
    await session.close();
  }
});

it("resolves nested unowned child cleanup errors after the client confirms retry", async () => {
  const [target] = await createBinarySessionTargets();
  const first = new ProviderCleanupError("hopper", ["hopper"], {});
  const second = new ProviderCleanupError("auxiliary", ["file"], {});
  const child = (
    id: string,
    operation: "address_name" | "procedure_info",
    failure: ProviderCleanupError,
  ): AnalysisProvider => {
    const identity = { id, name: id, version: "1" };
    let attempts = 0;
    return {
      identity: () => identity,
      capabilities: () => [
        {
          provider: identity,
          operation,
          available: true,
          reason: null,
          effects: {
            mutatesArtifact: false,
            launchesProcess: false,
            mayShowUi: false,
            mayAccessNetwork: false,
            mayWriteFilesystem: false,
            changesPermissions: false,
            requiresRoot: false,
          },
          limitations: [],
        },
      ],
      createClient: (): AnalysisClient => ({
        execute: async (name) => ok(createAnalysisExecution(name, identity)),
        close: async () => (++attempts === 1 ? err(failure) : ok(null)),
      }),
    };
  };
  const composite = new CompositeProvider([
    child("hopper", "address_name", first),
    child("auxiliary", "procedure_info", second),
  ]);
  const session = createTestBinarySession((target) => {
    const client = composite.createClient(target);
    let initialized = false;
    return {
      ...client,
      execute: async (operation, parameters, options) => {
        if (!initialized && operation === "health") {
          initialized = true;
          await client.execute("address_name", {});
          await client.execute("procedure_info", {});
        }
        return client.execute(operation, parameters, options);
      },
    };
  });
  expect((await session.open(target)).ok).toBe(true);
  try {
    const result = await runWithExternalMutationAdmission(
      session,
      "gdb_console",
      undefined,
      async () => ok(null),
      undefined,
    );
    if (result.ok) throw new Error("Expected cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect((await session.close()).ok).toBe(true);
    expect(first.cleanupIncomplete).toBe(false);
    expect(second.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    await session.close();
  }
});
