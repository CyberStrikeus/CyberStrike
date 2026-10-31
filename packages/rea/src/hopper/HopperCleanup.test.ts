import { access, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";

import { EventEmitter } from "node:events";
import { Socket } from "node:net";

import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { ok } from "../domain/result.js";
import type { BridgeLaunch } from "./BridgeLauncher.js";
import {
  cleanupHopperSession,
  confirmExternalApplicationExit,
  type HopperOwnedResources,
} from "./HopperCleanup.js";

const loggerHarness = () => {
  const logs: unknown[] = [];
  return {
    logs,
    logger: pino(
      { level: "warn" },
      {
        write: (line) => logs.push(JSON.parse(line)),
      },
    ),
  };
};

const processCleanupLaunch = (): BridgeLaunch => ({
  process: Object.assign(new EventEmitter(), {
    stdout: null,
    stderr: null,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  }),
  ownsProcessLifetime: true,
  providerLifetime: "launcher-process",
  shutdownMode: "process-cleanup",
  cleanup: () =>
    Promise.resolve({
      cleaned: false as const,
      reason: "fixture cleanup unavailable",
    }),
});

const failure = (message: string) =>
  Object.assign(new TypeError(message), { code: "ECONNRESET" });

const externalApplicationResources = (): HopperOwnedResources => ({
  launch: {
    process: Object.assign(new EventEmitter(), {
      stdout: null,
      stderr: null,
      exitCode: null,
      signalCode: null,
      kill: () => true,
    }),
    ownsProcessLifetime: false,
    providerLifetime: "external-application",
    shutdownMode: "bridge-request",
  },
  processSupervisor: undefined,
  runtimeRoot: undefined,
  shutdownConfirmed: false,
  externalApplication: {
    pid: 123,
    identity: { state: "readable", identity: "captured-start" },
  },
});

describe("external Hopper process exit confirmation", () => {
  it("confirms only the captured GUI process exit and releases its transport", async () => {
    const resources = externalApplicationResources();
    const released: unknown[] = [];
    const observeExit = vi.fn().mockResolvedValue("exited");
    await confirmExternalApplicationExit(
      resources,
      undefined,
      (socket) => released.push(socket),
      observeExit,
    );
    expect(observeExit).toHaveBeenCalledWith(123, "captured-start");
    expect(resources.shutdownConfirmed).toBe(true);
    expect(released).toEqual([undefined]);
  });

  it.each(["present", "unverified"] as const)(
    "does not confirm an external application while its exact identity is %s",
    async (observation) => {
      const resources = externalApplicationResources();
      const releaseTransport = vi.fn();
      await confirmExternalApplicationExit(
        resources,
        undefined,
        releaseTransport,
        async () => observation,
      );
      expect(resources.shutdownConfirmed).toBe(false);
      expect(releaseTransport).not.toHaveBeenCalled();
    },
  );
});

describe("Hopper shutdown rejection diagnostics", () => {
  it("retains the primary shutdown operation and rejection cause", async () => {
    const { logger, logs } = loggerHarness();
    const result = await cleanupHopperSession({
      socket: new Socket(),
      resources: {
        launch: undefined,
        processSupervisor: undefined,
        runtimeRoot: undefined,
        shutdownConfirmed: false,
        externalApplication: undefined,
      },
      activeRequest: null,
      retainDocument: false,
      progress: undefined,
      logger,
      onDiagnostic: undefined,
      request: () => Promise.reject(failure("fixture primary rejection")),
      releaseTransport: () => undefined,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { cleanupResources: ["hopper-document"] },
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        msg: "Hopper document shutdown was not confirmed",
        status: "failed",
        errorTag: "HopperProcessError",
        operation: "shutdown_document",
        failure_cause: {
          name: "TypeError",
          message: "fixture primary rejection",
          code: "ECONNRESET",
        },
      }),
    );
  });

  it("retains the fallback shutdown operation and rejection cause", async () => {
    const { logger, logs } = loggerHarness();
    const methods: string[] = [];
    const result = await cleanupHopperSession({
      socket: new Socket(),
      resources: {
        launch: processCleanupLaunch(),
        processSupervisor: undefined,
        runtimeRoot: undefined,
        shutdownConfirmed: false,
        externalApplication: undefined,
      },
      activeRequest: null,
      retainDocument: false,
      progress: undefined,
      logger,
      onDiagnostic: undefined,
      request: (method) => {
        methods.push(method);
        return method === "shutdown"
          ? Promise.resolve(ok({ shutdown: true, cleanup_required: true }))
          : Promise.reject(failure("fixture fallback rejection"));
      },
      releaseTransport: () => undefined,
    });

    expect(methods).toEqual(["shutdown", "shutdown_document"]);
    expect(result).toMatchObject({
      ok: false,
      error: { cleanupResources: ["hopper-document"] },
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        msg: "Hopper document shutdown fallback was not confirmed",
        status: "failed",
        errorTag: "HopperProcessError",
        operation: "shutdown_document",
        failure_cause: {
          name: "TypeError",
          message: "fixture fallback rejection",
          code: "ECONNRESET",
        },
      }),
    );
  });
});

it("keeps a prepared backing image when native document closure cannot be confirmed", async () => {
  const parent = await createTestTempDirectory("rea-hopper-backing-lifetime-");
  const runtimeRoot = await PrivateRuntimeRoot.create({ parent });
  const preparedImagePath = join(runtimeRoot.path, "image.macho");
  await writeFile(preparedImagePath, "owned backing bytes");
  const { logger } = loggerHarness();
  try {
    const launch = {
      ...processCleanupLaunch(),
      preparedImagePath,
      shutdownMode: "bridge-request" as const,
      providerLifetime: "external-application" as const,
    };
    const result = await cleanupHopperSession({
      socket: new Socket(),
      resources: {
        launch,
        runtimeRoot,
        processSupervisor: undefined,
        shutdownConfirmed: false,
        externalApplication: undefined,
      },
      activeRequest: null,
      retainDocument: true,
      progress: undefined,
      logger,
      onDiagnostic: undefined,
      request: () => Promise.reject(failure("document closure unobserved")),
      releaseTransport: () => undefined,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        cleanupResources: expect.arrayContaining([
          "hopper-document",
          runtimeRoot.path,
        ]),
      },
    });
    await expect(access(preparedImagePath)).resolves.toBeUndefined();
  } finally {
    await runtimeRoot.close();
    await rm(parent, { recursive: true, force: true });
  }
});
