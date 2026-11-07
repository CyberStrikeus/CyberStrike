import pino from "pino";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";

import { TestReverseEngineeringService as ReverseEngineeringService } from "../../support/reverseEngineeringService.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import type { FridaDeviceList } from "../../../src/domain/fridaDiscovery.js";
import {
  createBinarySessionTargets,
  createCacheProvider,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import { EvidenceIntegrityError } from "../../../src/domain/evidenceErrors.js";
import { err, ok } from "../../../src/domain/result.js";
import type { WithAdmittedAnalysis } from "../../../src/server/analysisAdmission.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { registerReverseEngineeringTools } from "../../../src/server/registerReverseEngineeringTools.js";
import {
  createReverseEngineeringMcpHarness,
  invokeWithLiveSignal,
} from "../../support/reverseEngineeringMcpHarness.js";

const createTimedOutRizinService = (): ReverseEngineeringService =>
  new ReverseEngineeringService({
    run: async () => {
      throw Object.assign(new Error("timed out"), {
        stdout: "partial provider output",
        stderr: "",
        code: "ETIMEDOUT",
        signal: null,
        killed: true,
      });
    },
  });

it("keeps a non-Evidence partial with a caller-selected evidence_id inline in a reverse tool error", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const partial = {
    devices: [],
    cleanup_error: null,
    evidence_id: "caller-selected",
  };
  const observation: FridaDeviceList = partial;
  const reason = { request: "cancel inspection" };
  const failure = new AnalysisCancelledError("inspect_with_objdump", {
    cause: reason,
    partialObservation: observation,
  });
  const service = new ReverseEngineeringService();
  vi.spyOn(service, "inspectWithObjdump").mockResolvedValue(err(failure));
  const recordEvidence = vi.fn(() => ok("added" as const));
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    recordEvidence,
  );

  const result = (await invokeWithLiveSignal(handler("inspect_with_objdump"), {
    path: "package.json",
    operation: "file_headers",
  })) as CallToolResult;
  const projected = parseMcpToolError(result);
  expect(projected.error).toMatchObject({
    code: "cancelled",
    message: projectAnalysisError(failure).message,
    details: { operation: "inspect_with_objdump" },
  });
  expect(projected.error.details?.partial_observation).toEqual(partial);
  expect(result.structuredContent).toEqual(projected);
  expect(recordEvidence).not.toHaveBeenCalled();
  expect(failure.cause).toBe(reason);
  expect(failure.partialObservation).toBe(partial);
  expect(result._meta).toEqual({
    provenance: { untrusted_content: true, source: "analysis_target" },
  });
});

it("records partial Evidence and references it in the original MCP error", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const service = createTimedOutRizinService();
  const recordEvidence = vi.fn(() => ok("added" as const));
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    recordEvidence,
  );
  const invoke = handler("execute_rizin_command");

  const response = (await invokeWithLiveSignal(invoke, {
    path: "package.json",
    command: "iI",
  })) as {
    readonly isError?: boolean;
    readonly structuredContent?: {
      readonly error?: {
        readonly details?: Readonly<Record<string, unknown>>;
      };
    };
  };

  expect(response.isError).toBe(true);
  expect(recordEvidence).toHaveBeenCalledTimes(1);
  expect(response.structuredContent?.error?.details).toMatchObject({
    partial_observation: {
      kind: "retained-evidence",
      evidence_id: expect.any(String),
    },
  });
});

it("admits Rizin mutation after invalidating before dispatch", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const events: string[] = [];
  const service = new ReverseEngineeringService({
    run: async () => {
      events.push("dispatch");
      return { stdout: "rizin output", stderr: "" };
    },
  });
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    undefined,
    undefined,
    () => events.push("invalidate"),
    async (_path, _signal, operation) => {
      events.push("admit");
      return ok(await operation());
    },
  );
  const invoke = handler("execute_rizin_command");

  await invoke(
    { path: "package.json", command: "iI" },
    { mcpReq: { signal: new AbortController().signal } },
  );

  expect(events).toEqual(["admit", "invalidate", "dispatch"]);
});

it("invalidates the snapshot in the legacy Rizin admission path", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const invalidateSnapshot = vi.fn();
  const service = new ReverseEngineeringService({
    run: async () => ({ stdout: "rizin output", stderr: "" }),
  });
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    undefined,
    undefined,
    invalidateSnapshot,
  );
  const invoke = handler("execute_rizin_command");

  const response = (await invokeWithLiveSignal(invoke, {
    path: "package.json",
    command: "iI",
  })) as { readonly isError?: boolean };

  expect(response.isError).not.toBe(true);
  expect(invalidateSnapshot).toHaveBeenCalledOnce();
});

it("skips snapshot invalidation for malformed Rizin input", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const invalidateSnapshot = vi.fn();
  const executeRizinCommandValidated = vi.fn();
  const service = {
    executeRizinCommandValidated,
  } as unknown as ReverseEngineeringService;
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    undefined,
    undefined,
    invalidateSnapshot,
  );
  const invoke = handler("execute_rizin_command");

  const response = (await invokeWithLiveSignal(invoke, {
    path: "package.json",
  })) as CallToolResult;

  expect(parseMcpToolError(response).error).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [
        { path: ["command"], reason: "missing_argument", expected: "string" },
      ],
    },
  });
  expect(executeRizinCommandValidated).not.toHaveBeenCalled();
  expect(invalidateSnapshot).not.toHaveBeenCalled();
});

it("delivers failed Rizin execution after external admission", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const service = new ReverseEngineeringService({
    run: async () => {
      throw new Error("Rizin command failed");
    },
  });
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    undefined,
    undefined,
    undefined,
    async (_path, _signal, operation) => ok(await operation()),
  );
  const invoke = handler("execute_rizin_command");

  const response = (await invokeWithLiveSignal(invoke, {
    path: "package.json",
    command: "iI",
  })) as { readonly isError?: boolean };

  expect(response.isError).toBe(true);
});

it("preserves the Rizin operation error when analysis retirement also fails", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const reason = { stage: "operation-input" };
  const primary = new AnalysisInputError("execute_rizin_command", {
    cause: reason,
  });
  const retirement = new AnalysisInputError("rebind");
  const service = {
    retryCleanup: async () => ok(null),
    executeRizinCommandValidated: async () => err(primary),
  } as unknown as ReverseEngineeringService;
  const observedOperationResult = vi.fn();
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    undefined,
    undefined,
    undefined,
    async (_path, _signal, operation, rebindFailure) => {
      const result = await operation();
      observedOperationResult(result);
      return err(rebindFailure(result, retirement));
    },
  );
  const invoke = handler("execute_rizin_command");

  const response = (await invoke(
    { path: "package.json", command: "iI" },
    { mcpReq: { signal: new AbortController().signal } },
  )) as {
    readonly isError?: boolean;
    readonly structuredContent?: {
      readonly error?: {
        readonly code?: string;
        readonly details?: { readonly reason?: string };
      };
    };
  };

  expect(primary.cause).toBe(reason);
  expect(primary.secondaryFailures).toEqual([retirement]);
  expect(response.isError).toBe(true);
  expect(observedOperationResult).toHaveBeenCalledWith(
    expect.objectContaining({ ok: false }),
  );
  expect(response.structuredContent?.error).toMatchObject({
    code: "invalid_request",
  });
});

it.each(["success", "timeout"])(
  "retains %s output and requires reopening after a symlink command",
  async (outcome) => {
    const [target] = await createBinarySessionTargets();
    const alias = join(dirname(target), "active-target-alias.hop");
    await symlink(target, alias);
    const session = createTestBinarySession(createCacheProvider([]));
    expect((await session.open(target)).ok).toBe(true);
    expect(session.activeTarget()?.path).toBe(target);
    const originalDigest = session.activeTarget()?.sha256;
    expect(originalDigest).toEqual(expect.any(String));

    const { server, handler } = createReverseEngineeringMcpHarness();
    const service = new ReverseEngineeringService({
      run: async () => {
        await writeFile(alias, "changed by Rizin");
        if (outcome === "timeout")
          throw Object.assign(new Error("timed out"), {
            stdout: "partial analysis output",
            stderr: "timeout diagnostics",
            code: "ETIMEDOUT",
            signal: null,
            killed: true,
          });
        return { stdout: "partial analysis output", stderr: "" };
      },
    });
    const recordEvidence = vi.fn(() => ok("added" as const));
    registerReverseEngineeringTools(
      server,
      service,
      pino({ enabled: false }),
      createToolResultDelivery(2 * 1024 * 1024),
      recordEvidence,
      undefined,
      () => session.invalidateSnapshotForExternalMutation(),
      (path, signal, operation, rebindFailure) =>
        session.withAdmittedExternalMutation(
          path,
          signal,
          operation,
          rebindFailure,
        ),
    );
    const invoke = handler("execute_rizin_command");

    const response = (await invoke(
      { path: alias, command: "wx 00 @ 0" },
      { mcpReq: { signal: new AbortController().signal } },
    )) as {
      readonly isError?: boolean;
      readonly structuredContent?: {
        readonly error?: {
          readonly code?: string;
          readonly details?: Readonly<Record<string, unknown>>;
        };
      };
    };

    expect(response.isError ?? false).toBe(outcome === "timeout");
    if (outcome === "timeout") {
      expect(response.structuredContent?.error?.code).toBe("provider_timeout");
      expect(response.structuredContent?.error?.details).toMatchObject({
        captured_output: {
          stdout: "partial analysis output",
          stderr: "timeout diagnostics",
        },
      });
      expect(response.structuredContent?.error?.details).toMatchObject({
        partial_observation: {
          kind: "retained-evidence",
          evidence_id: expect.any(String),
        },
      });
    }
    expect(recordEvidence).toHaveBeenCalledTimes(1);
    expect(session.activeTarget()).toBeUndefined();
    expect((await session.execute("address_name", {})).ok).toBe(false);
    expect((await session.open(target)).ok).toBe(true);
    expect(session.activeTarget()?.sha256).toEqual(expect.any(String));
    expect(session.activeTarget()?.sha256).not.toBe(originalDigest);
    await session.close();
    await rm(dirname(target), { recursive: true, force: true });
  },
);

it("preserves a partial MCP error without claiming failed Evidence retention", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const service = createTimedOutRizinService();
  const recordEvidence = vi.fn((_evidence: unknown) =>
    err(new EvidenceIntegrityError("retention failed")),
  );
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    recordEvidence,
  );
  const invoke = handler("execute_rizin_command");

  const response = (await invokeWithLiveSignal(invoke, {
    path: "package.json",
    command: "iI",
  })) as {
    readonly isError?: boolean;
    readonly structuredContent?: {
      readonly error?: {
        readonly details?: Readonly<Record<string, unknown>>;
      };
    };
  };

  expect(response.isError).toBe(true);
  expect(response.structuredContent?.error?.details).toMatchObject({
    partial_observation: expect.objectContaining({
      operation: "execute_rizin_command",
    }),
  });
  expect(
    JSON.stringify(response.structuredContent?.error?.details),
  ).not.toContain("retained-evidence");
});

it("delivers pathless objdump capability Evidence and input errors through its named tool", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const service = new ReverseEngineeringService({
    run: async () => ({ stdout: "objdump output", stderr: "" }),
  });
  const delivery = createToolResultDelivery(2 * 1024 * 1024);
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    delivery,
  );
  const context = { mcpReq: { signal: new AbortController().signal } };
  const objdump = handler("inspect_with_objdump");
  const rizin = handler("execute_rizin_command");

  const success = (await objdump(
    { path: "package.json", operation: "file_headers" },
    context,
  )) as { readonly isError?: boolean };
  const architectures = (await objdump(
    { operation: "architectures" },
    context,
  )) as {
    readonly isError?: boolean;
  };
  const objdumpFailure = (await objdump({}, context)) as {
    readonly isError?: boolean;
  };
  const failure = (await rizin({}, context)) as {
    readonly isError?: boolean;
    readonly structuredContent?: {
      readonly error?: { readonly code?: string };
    };
  };
  const cancelled = new AbortController();
  cancelled.abort();
  const cancelledContext = { mcpReq: { signal: cancelled.signal } };
  const cancelledObjdump = (await objdump(
    { path: "package.json", operation: "file_headers" },
    cancelledContext,
  )) as { readonly isError?: boolean };
  const cancelledRizin = (await rizin(
    { path: "package.json", command: "iI" },
    cancelledContext,
  )) as { readonly isError?: boolean };

  expect(success.isError).not.toBe(true);
  expect(architectures.isError).not.toBe(true);
  expect(objdumpFailure.isError).toBe(true);
  expect(failure.isError).toBe(true);
  expect(cancelledObjdump.isError).toBe(true);
  expect(cancelledRizin.isError).toBe(true);
});

it("does not treat a malformed partial observation as retained Evidence", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const invalidError = Object.assign(
    new AnalysisInputError("execute_rizin_command"),
    { partialObservation: { evidence_id: 42 } },
  );
  const service = {
    inspectWithObjdump: async () => err(invalidError),
    executeRizinCommandValidated: async () => err(invalidError),
  } as unknown as ReverseEngineeringService;
  const recordEvidence = vi.fn(() => ok("added" as const));
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    recordEvidence,
  );
  const invoke = handler("execute_rizin_command");

  const response = (await invoke(
    { path: "package.json", command: "iI" },
    { mcpReq: { signal: new AbortController().signal } },
  )) as { readonly isError?: boolean };

  expect(response.isError).toBe(true);
  expect(recordEvidence).not.toHaveBeenCalled();
});

it("keeps provider execution and Evidence recording inside analysis admission", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const events: string[] = [];
  const service = new ReverseEngineeringService({
    run: async () => {
      events.push("provider");
      return { stdout: "objdump output", stderr: "" };
    },
  });
  const recordEvidence = vi.fn(() => {
    events.push("record");
    return ok("added" as const);
  });
  const admission: WithAdmittedAnalysis = async (_name, _signal, operation) => {
    events.push("admission-start");
    const result = await operation({} as AnalysisOperationPort);
    events.push("admission-end");
    return ok(result);
  };
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    recordEvidence,
    admission,
  );
  const invoke = handler("inspect_with_objdump");

  await invoke(
    { path: "package.json", operation: "file_headers" },
    { mcpReq: { signal: new AbortController().signal } },
  );

  expect(events).toEqual([
    "admission-start",
    "provider",
    "record",
    "admission-end",
  ]);
});

it("returns admission failures without invoking a reverse-engineering provider", async () => {
  const { server, handler } = createReverseEngineeringMcpHarness();
  const inspectWithObjdump = vi.fn();
  const service = {
    inspectWithObjdump,
    executeRizinCommandValidated: vi.fn(),
  } as unknown as ReverseEngineeringService;
  const admission: WithAdmittedAnalysis = async () =>
    err(new AnalysisInputError("inspect_with_objdump"));
  registerReverseEngineeringTools(
    server,
    service,
    pino({ enabled: false }),
    createToolResultDelivery(2 * 1024 * 1024),
    undefined,
    admission,
  );
  const invoke = handler("inspect_with_objdump");

  const response = (await invoke(
    { path: "package.json", operation: "file_headers" },
    { mcpReq: { signal: new AbortController().signal } },
  )) as { readonly isError?: boolean };

  expect(response.isError).toBe(true);
  expect(inspectWithObjdump).not.toHaveBeenCalled();
});
