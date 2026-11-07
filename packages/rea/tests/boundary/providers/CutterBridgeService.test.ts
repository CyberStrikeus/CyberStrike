import { expect, it, vi } from "vitest";

import { CutterBridgeService } from "../../../src/cutter/CutterBridgeService.js";
import {
  AnalysisInputError,
  AnalysisCancelledError,
} from "../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";

const cutterInput = {
  session_id: "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a",
  expected_generation: 7,
  command: "pd 4",
};

it.each(["descriptor-first", "command-first"] as const)(
  "retains receipt-read cleanup alongside pending command ownership: %s",
  async (order) => {
    const descriptor = new ProviderCleanupError(
      "cutter",
      ["descriptor-fixture"],
      { reason: "controlled receipt descriptor close failure" },
      { operation: "cutter_command" },
    );
    let readFails = true;
    let terminal = false;
    const execute = vi.fn(async () => ({
      requestId: "4b18ce4d-bf31-456e-ae31-e8c547b2f9db",
      output: null,
      currentFile: null,
      documentGeneration: 7,
      identityStatus: "partial" as const,
      cutterVersion: null,
      executionState: "unknown" as const,
      error: "missing-reply",
      message: "completion remains unknown",
      outputTruncated: false,
    }));
    const service = new CutterBridgeService({
      listSessions: async () => ({
        sessions: [],
        bridge_directory: "/fixture",
        discovery_status: "no_live_bridge_found",
        bridge_directory_security: "private_verified",
      }),
      confirmCommandCompletion: async () =>
        readFails
          ? { ok: false, error: descriptor }
          : { ok: true, value: terminal },
      execute,
    });
    const dispatched = await service.execute(cutterInput);
    if (dispatched.ok) throw new Error("Expected pending completion");
    const retried = await service.retryCleanup();
    if (retried.ok) throw new Error("Expected receipt-read failure");
    expect(retried.error.cleanupResources).toEqual(
      expect.arrayContaining([
        "descriptor-fixture",
        `cutter-session:${cutterInput.session_id}`,
      ]),
    );
    expect(retried.error.partialObservation).toBe(
      dispatched.error.partialObservation,
    );
    expect(retried.error.diagnostics).toMatchObject({
      cleanup_error: {
        details: {
          diagnostics: {
            reason: "controlled receipt descriptor close failure",
          },
        },
      },
    });
    if (order === "descriptor-first") {
      descriptor.resolveCleanup();
      expect(retried.error.cleanupResources).toEqual([
        `cutter-session:${cutterInput.session_id}`,
      ]);
      readFails = false;
      expect(await service.retryCleanup()).toEqual({
        ok: false,
        error: dispatched.error,
      });
      expect(retried.error.cleanupIncomplete).toBe(true);
      terminal = true;
      expect(await service.retryCleanup()).toEqual({ ok: true, value: null });
    } else {
      readFails = false;
      terminal = true;
      expect(await service.retryCleanup()).toEqual({ ok: true, value: null });
      expect(dispatched.error.cleanupIncomplete).toBe(false);
      expect(retried.error.cleanupIncomplete).toBe(true);
      expect(retried.error.cleanupResources).toEqual(["descriptor-fixture"]);
      descriptor.resolveCleanup();
    }
    expect(retried.error.cleanupIncomplete).toBe(false);
    expect(retried.error.cleanupResources).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
    await service.close();
  },
);

it("retains uncertain command completion as Evidence without encouraging a retry", async () => {
  const service = new CutterBridgeService({
    listSessions: async () => ({
      sessions: [],
      bridge_directory: "/private/bridge",
      discovery_status: "no_live_bridge_found",
      bridge_directory_security: "private_verified",
    }),
    execute: async () => ({
      requestId: "4b18ce4d-bf31-456e-ae31-e8c547b2f9db",
      output: null,
      currentFile: "/fixtures/sample.bin",
      documentGeneration: 7,
      identityStatus: "partial",
      cutterVersion: "Cutter fixture version",
      executionState: "unknown",
      error: "transport-response-missing",
      message: "The command may have completed; do not retry automatically",
      outputTruncated: false,
    }),
  });

  const result = await service.execute({
    session_id: "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a",
    expected_generation: 7,
    command: "Ps /tmp/project.rzdb",
  });

  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisOutputError",
      cleanupIncomplete: true,
      partialObservation: {
        normalized_result: {
          command: "Ps /tmp/project.rzdb",
          output: null,
          execution_state: "unknown",
          error: "transport-response-missing",
          message: expect.stringContaining("do not retry automatically"),
          document_generation: 7,
          cutter_version: "Cutter fixture version",
        },
        limitations: expect.arrayContaining([
          "Command completion or its output could not be confirmed; do not retry automatically because the command may have produced partial or persistent effects.",
        ]),
        provider: { version: "Cutter fixture version" },
      },
    },
  });
});

it("clears a poisoned command only after its exact UI-dispatcher receipt", async () => {
  const requestId = "4b18ce4d-bf31-456e-ae31-e8c547b2f9db";
  const wrongId = "8ca93d11-107d-41ed-8b40-31dd53cd26a6";
  let receipt: string | undefined;
  let uiPending = true;
  let dispatches = 0;
  const confirmCommandCompletion = vi.fn(
    async (_session: string, id: string) =>
      receipt === id && !uiPending
        ? { ok: true as const, value: true }
        : { ok: true as const, value: false },
  );
  const service = new CutterBridgeService({
    listSessions: async () => ({
      sessions: [],
      bridge_directory: "/private/bridge",
      discovery_status: "no_live_bridge_found",
      bridge_directory_security: "private_verified",
    }),
    confirmCommandCompletion,
    execute: async () => {
      dispatches += 1;
      return {
        requestId,
        output: null,
        currentFile: "/fixtures/sample.bin",
        documentGeneration: 7,
        identityStatus: "partial",
        cutterVersion: "Cutter fixture version",
        executionState: dispatches === 1 ? "unknown" : "complete",
        error: dispatches === 1 ? "ui-thread-request-timeout" : null,
        message: null,
        outputTruncated: false,
      };
    },
  });

  const first = await service.execute(cutterInput);
  expect(first).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });

  for (const unconfirmed of [
    undefined,
    "ede4bbfd-6348-46aa-963b-0de0e78ccbdc",
    wrongId,
  ]) {
    receipt = unconfirmed;
    const blocked = await service.execute(cutterInput);
    expect(blocked).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(dispatches).toBe(1);
  }
  receipt = requestId;
  const pending = await service.execute(cutterInput);
  expect(pending).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  expect(dispatches).toBe(1);
  expect(confirmCommandCompletion).toHaveBeenLastCalledWith(
    cutterInput.session_id,
    requestId,
    undefined,
  );

  receipt = requestId;
  uiPending = false;
  const recovered = await service.execute(cutterInput);
  expect(recovered.ok).toBe(true);
  expect(dispatches).toBe(2);
});

it("recovers canceled command A after B and does not retain poisoned B", async () => {
  const requestA = "4b18ce4d-bf31-456e-ae31-e8c547b2f9db";
  const completionTokenA = "0000000000000007";
  const requestB = "8ca93d11-107d-41ed-8b40-31dd53cd26a6";
  const receipts = new Set<string>();
  let dispatches = 0;
  const confirmCommandCompletion = vi.fn(
    async (_session: string, id: string) =>
      receipts.delete(id)
        ? { ok: true as const, value: true }
        : { ok: true as const, value: false },
  );
  const execute = async () => {
    dispatches += 1;
    if (dispatches === 1) {
      receipts.add(requestA);
      return {
        requestId: requestA,
        output: null,
        currentFile: "/fixtures/sample.bin",
        documentGeneration: 7,
        identityStatus: "partial" as const,
        cutterVersion: null,
        executionState: "unknown" as const,
        error: "transport-response-missing",
        message: "cancelled after dispatch",
        outputTruncated: false,
        completionToken: completionTokenA,
      };
    }
    if (dispatches === 2)
      return {
        requestId: requestB,
        output: "B complete",
        currentFile: "/fixtures/sample.bin",
        documentGeneration: 7,
        identityStatus: "partial" as const,
        cutterVersion: null,
        executionState: "complete" as const,
        error: null,
        message: null,
        outputTruncated: false,
      };
    if (dispatches === 3)
      return {
        requestId: requestB,
        output: null,
        currentFile: "/fixtures/sample.bin",
        documentGeneration: 7,
        identityStatus: "partial" as const,
        cutterVersion: null,
        executionState: "not_started" as const,
        error: "session-poisoned-after-ui-timeout",
        message: null,
        outputTruncated: false,
      };
    return {
      requestId: "c31130c6-fc6c-46ad-949e-586724d8fd84",
      output: "recovered",
      currentFile: "/fixtures/sample.bin",
      documentGeneration: 7,
      identityStatus: "partial" as const,
      cutterVersion: null,
      executionState: "complete" as const,
      error: null,
      message: null,
      outputTruncated: false,
    };
  };
  const client = {
    listSessions: async () => ({
      sessions: [],
      bridge_directory: "/private/bridge",
      discovery_status: "no_live_bridge_found" as const,
      bridge_directory_security: "private_verified" as const,
    }),
    confirmCommandCompletion,
    execute,
  };
  const callerA = new CutterBridgeService(client);
  const callerB = new CutterBridgeService(client);

  const cancelledA = await callerA.execute(cutterInput);
  expect(cancelledA).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  expect(await callerB.execute(cutterInput)).toMatchObject({ ok: true });
  expect(receipts.has(requestA)).toBe(true);

  const poisonedB = await callerA.execute(cutterInput);
  expect(poisonedB).toMatchObject({
    ok: true,
    value: { normalized_result: { execution_state: "not_started" } },
  });
  expect(confirmCommandCompletion).toHaveBeenCalledTimes(1);
  expect(confirmCommandCompletion).toHaveBeenCalledWith(
    cutterInput.session_id,
    requestA,
    completionTokenA,
  );

  expect(await callerA.execute(cutterInput)).toMatchObject({ ok: true });
  expect(confirmCommandCompletion).toHaveBeenCalledTimes(1);
  expect(dispatches).toBe(4);
});

it("rejects malformed Cutter commands and pre-aborted calls", async () => {
  const service = new CutterBridgeService({
    listSessions: async () => ({
      sessions: [],
      bridge_directory: "/private/bridge",
      discovery_status: "no_live_bridge_found",
      bridge_directory_security: "private_verified",
    }),
    execute: async () => {
      throw new Error("must not dispatch");
    },
  });

  const malformed = await service.execute({ ...cutterInput, command: "" });
  expect(malformed).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
  const controller = new AbortController();
  controller.abort();
  const cancelled = await service.execute(cutterInput, {
    signal: controller.signal,
  });
  expect(cancelled).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
});

it.each([
  [new AnalysisInputError("cutter_command"), "AnalysisInputError"],
  [new Error("bridge disconnected"), "AnalysisCapabilityUnavailableError"],
  ["plain failure", "AnalysisCapabilityUnavailableError"],
])("maps a Cutter bridge failure to %s", async (failure, tag) => {
  const service = new CutterBridgeService({
    listSessions: async () => ({
      sessions: [],
      bridge_directory: "/private/bridge",
      discovery_status: "no_live_bridge_found",
      bridge_directory_security: "private_verified",
    }),
    execute: async () => {
      throw failure;
    },
  });

  const result = await service.execute(cutterInput);
  expect(result).toMatchObject({ ok: false, error: { _tag: tag } });
});

it.each(["transport cancelled", "command may have completed"])(
  "preserves a port failure through a later unrelated cancellation: %s",
  async (message) => {
    const controller = new AbortController();
    const primary = new Error(message);
    const service = new CutterBridgeService({
      listSessions: async () => ({
        sessions: [],
        bridge_directory: "/private/bridge",
        discovery_status: "no_live_bridge_found",
        bridge_directory_security: "private_verified",
      }),
      execute: async () => {
        controller.abort(new Error("later cancellation"));
        throw primary;
      },
    });
    const result = await service.execute(cutterInput, {
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCapabilityUnavailableError", cause: primary },
    });
  },
);

it("shares one cleanup attempt when commands retry the same receipt together", async () => {
  const requestId = "4b18ce4d-bf31-456e-ae31-e8c547b2f9db";
  let receiptPresent = false;
  let releaseConfirm: (() => void) | undefined;
  let confirms = 0;
  const confirmCommandCompletion = vi.fn(async () => {
    confirms += 1;
    if (!receiptPresent) return { ok: true as const, value: false };
    if (confirms === 1) {
      await new Promise<void>((resolve) => {
        releaseConfirm = resolve;
      });
    }
    if (!receiptPresent) return { ok: true as const, value: false };
    receiptPresent = false;
    return { ok: true as const, value: true };
  });
  let dispatches = 0;
  const service = new CutterBridgeService({
    listSessions: async () => ({
      sessions: [],
      bridge_directory: "/private/bridge",
      discovery_status: "no_live_bridge_found",
      bridge_directory_security: "private_verified",
    }),
    confirmCommandCompletion,
    execute: async () => {
      dispatches += 1;
      if (dispatches === 1) {
        receiptPresent = true;
        return {
          requestId,
          output: null,
          currentFile: "/fixtures/sample.bin",
          documentGeneration: 7,
          identityStatus: "partial" as const,
          cutterVersion: null,
          executionState: "unknown" as const,
          error: "transport-response-missing",
          message: "cancelled after dispatch",
          outputTruncated: false,
        };
      }
      return {
        requestId: "8ca93d11-107d-41ed-8b40-31dd53cd26a6",
        output: "complete",
        currentFile: "/fixtures/sample.bin",
        documentGeneration: 7,
        identityStatus: "partial" as const,
        cutterVersion: null,
        executionState: "complete" as const,
        error: null,
        message: null,
        outputTruncated: false,
      };
    },
  });

  const blocked = await service.execute(cutterInput);
  expect(blocked).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });

  const concurrent = [
    service.execute(cutterInput),
    service.execute(cutterInput),
  ];
  if (releaseConfirm === undefined) throw new Error("cleanup did not start");
  releaseConfirm();
  const recovered = await Promise.all(concurrent);
  expect(recovered.every((result) => result.ok)).toBe(true);
  expect(confirms).toBe(1);
  expect(dispatches).toBe(3);
});

it.each([
  { phase: "before", reason: { code: "EACCES" } },
  {
    phase: "before",
    reason: new ProviderCleanupError("caller-owned", ["opaque caller value"], {
      reason: "caller metadata",
    }),
  },
  {
    phase: "during",
    reason: new ProviderCleanupError("caller-owned", ["opaque caller value"], {
      reason: "caller metadata",
    }),
  },
  {
    phase: "during",
    reason: { cleanupIncomplete: true, resource: "caller resource" },
  },
])(
  "models opaque discovery cancellation $phase the port call",
  async ({ phase, reason }) => {
    const controller = new AbortController();
    let calls = 0;
    const service = new CutterBridgeService({
      listSessions: async () => {
        calls += 1;
        controller.abort(reason);
        return {
          sessions: [],
          bridge_directory: "/private/bridge",
          discovery_status: "no_live_bridge_found",
          bridge_directory_security: "private_verified",
        };
      },
      execute: async () => {
        throw new Error("Unexpected command dispatch");
      },
    });
    if (phase === "before") controller.abort(reason);
    const result = await service.listSessions({ signal: controller.signal });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", cleanupIncomplete: false },
    });
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error.cause).toBe(reason);
    expect(calls).toBe(phase === "before" ? 0 : 1);
  },
);

it.each(["descriptor-first", "command-first"])(
  "resolves mixed cleanup only after both owners: %s",
  async (order) => {
    const { ProviderCleanupError } =
      await import("../../../src/domain/providerCleanupError.js");
    const { AnalysisError } =
      await import("../../../src/domain/analysisErrorBase.js");
    const descriptorFailure = new ProviderCleanupError(
      "cutter",
      ["descriptor-fixture"],
      { reason: "controlled descriptor close failure" },
    );
    let terminal = false;
    const releaseDescriptors = async () => {
      if (descriptorFailure.cleanupIncomplete) throw descriptorFailure;
    };
    const close = vi.fn(releaseDescriptors);
    const service = new CutterBridgeService({
      listSessions: async () => ({
        sessions: [],
        bridge_directory: "/fixture",
        discovery_status: "no_live_bridge_found",
        bridge_directory_security: "private_verified",
      }),
      confirmCommandCompletion: async () => ({ ok: true, value: terminal }),
      retryDescriptorCleanup: releaseDescriptors,
      close,
      execute: async () => ({
        requestId: "4b18ce4d-bf31-456e-ae31-e8c547b2f9db",
        output: null,
        currentFile: null,
        documentGeneration: 7,
        identityStatus: "partial",
        cutterVersion: null,
        executionState: "unknown",
        error: "missing-reply",
        message: "completion remains unknown",
        outputTruncated: false,
      }),
    });
    const dispatched = await service.execute(cutterInput);
    if (dispatched.ok) throw new Error("Expected uncertain command");
    const mixed = await service.close().catch((cause: unknown) => cause);
    if (!(mixed instanceof AnalysisError))
      throw new Error("Expected typed mixed cleanup");
    expect(mixed.cleanupIncomplete).toBe(true);
    expect(close).not.toHaveBeenCalled();
    if (order === "descriptor-first") descriptorFailure.resolveCleanup();
    else terminal = true;
    await expect(service.close()).rejects.toBeInstanceOf(AnalysisError);
    expect(mixed.cleanupIncomplete).toBe(true);
    descriptorFailure.resolveCleanup();
    terminal = true;
    await service.close();
    expect(dispatched.error.cleanupIncomplete).toBe(false);
    expect(mixed.cleanupIncomplete).toBe(false);
  },
);

it.each([
  new Error("generation changed while recording transport diagnostics"),
  new Error("unavailable or stale is diagnostic text"),
])(
  "does not infer a session-selection failure from diagnostic prose: %s",
  async (cause) => {
    const service = new CutterBridgeService({
      listSessions: async () => ({
        sessions: [],
        bridge_directory: "/private/bridge",
        discovery_status: "no_live_bridge_found",
        bridge_directory_security: "private_verified",
      }),
      execute: async () => {
        throw cause;
      },
    });
    const result = await service.execute(cutterInput);
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCapabilityUnavailableError", cause },
    });
  },
);

it.each([
  new Error("command may have completed is an opaque abort reason"),
  new AnalysisInputError("caller-owned"),
  new ProviderCleanupError("caller-owned", ["caller resource"], {
    reason: "opaque value",
  }),
])(
  "retains typed cancellation without interpreting its opaque reason: %s",
  async (reason) => {
    const controller = new AbortController();
    const service = new CutterBridgeService({
      listSessions: async () => ({
        sessions: [],
        bridge_directory: "/private/bridge",
        discovery_status: "no_live_bridge_found",
        bridge_directory_security: "private_verified",
      }),
      execute: async () => {
        controller.abort(reason);
        throw new AnalysisCancelledError("cutter_command", { cause: reason });
      },
    });
    const result = await service.execute(cutterInput, {
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", cleanupIncomplete: false },
    });
    if (result.ok) throw new Error("Missing cancellation");
    expect(result.error.cause).toBe(reason);
  },
);

it.each([
  new AnalysisInputError("discovery producer failure"),
  new ProviderCleanupError("cutter", ["owned descriptor"], {
    reason: "physical descriptor close failure",
  }),
])(
  "preserves a discovery failure also selected as abort reason: $_tag",
  async (failure) => {
    const controller = new AbortController();
    const service = new CutterBridgeService({
      listSessions: async () => {
        controller.abort(failure);
        throw failure;
      },
      execute: async () => {
        throw new Error("Unexpected command dispatch");
      },
    });
    const result = await service.listSessions({ signal: controller.signal });
    if (result.ok) throw new Error("Expected discovery failure");
    expect(result.error).toBe(failure);
  },
);
