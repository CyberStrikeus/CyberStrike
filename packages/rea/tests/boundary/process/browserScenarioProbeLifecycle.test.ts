import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { expect, it, vi } from "vitest";

import type { BrowserScenarioCapturePort } from "../../../src/application/BrowserScenarioCapturePort.js";
import { createBrowserObservationProvider } from "../../../src/composition/browserObservation.js";
import { createElectronObservationProvider } from "../../../src/composition/electronObservation.js";
import { silentLogger } from "../../../src/logger.js";
import { startMcpTransport } from "../../../src/main/transport.js";
import type { RuntimeDependencies } from "../../../src/main/types.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";

it("keeps the shared browser scenario provider open when the SDK discards its discovery probe", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Unexpected deep provider");
  });
  const scenarioClose = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("Scenario cleanup failed"))
    .mockResolvedValue(undefined);
  const browserObservation = createBrowserObservationProvider();
  const browserClose = vi
    .spyOn(browserObservation, "close")
    .mockResolvedValue(undefined);
  const electronObservation = createElectronObservationProvider({});
  const electronClose = vi
    .spyOn(electronObservation, "close")
    .mockResolvedValue(undefined);
  const browserScenarioCapture: BrowserScenarioCapturePort = {
    identity: () => ({
      id: "fake-browser",
      name: "Fake browser",
      version: "1",
    }),
    captureScenario: async () => {
      throw new Error("Unexpected scenario capture");
    },
    close: scenarioClose,
  };
  const activeClose = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("Fuse preflight cleanup failed"))
    .mockResolvedValue(undefined);
  const electronActiveObservation = {
    identity: () => ({
      id: "active-electron",
      name: "Active Electron",
      version: "1",
    }),
    capture: async () => {
      throw new Error("Unexpected Electron capture");
    },
    close: activeClose,
  };
  const factories: Parameters<RuntimeDependencies["serve"]>[0][] = [];
  const runtime: RuntimeDependencies = {
    env: {},
    serve: (factory) => {
      factories.push(factory);
      return { close: async () => undefined };
    },
    writeStderr: () => undefined,
    setExitCode: () => undefined,
    registerShutdown: () => () => undefined,
  };
  const transport = await startMcpTransport(runtime, session, {
    logger: silentLogger,
    serverLogger: silentLogger,
    environment: runtime.env,
    delivery: createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
    loadOptionalProviders: async () => ({
      browserObservation,
      browserScenarioCapture,
      electronObservation,
      electronActiveObservation,
    }),
  });
  if (!transport.ok) throw new Error("Transport failed");
  const factory = factories[0];
  if (factory === undefined) throw new Error("Missing SDK server factory");
  try {
    const probe = await factory({ era: "modern" });
    await probe.close();
    const replacement = await factory({ era: "legacy" });
    await replacement.close();
    expect(browserClose).not.toHaveBeenCalled();
    expect(scenarioClose).not.toHaveBeenCalled();
    expect(electronClose).not.toHaveBeenCalled();
    expect(activeClose).not.toHaveBeenCalled();

    await expect(transport.closeOptionalProviders()).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: "Scenario cleanup failed" }),
        expect.objectContaining({ message: "Fuse preflight cleanup failed" }),
      ],
    });
    expect(browserClose).toHaveBeenCalledTimes(1);
    expect(scenarioClose).toHaveBeenCalledTimes(1);
    expect(activeClose).toHaveBeenCalledTimes(1);
    expect(electronClose).toHaveBeenCalledTimes(1);
    await transport.closeOptionalProviders();
    await transport.closeOptionalProviders();
    expect(browserClose).toHaveBeenCalledTimes(1);
    expect(scenarioClose).toHaveBeenCalledTimes(2);
    expect(activeClose).toHaveBeenCalledTimes(2);
    expect(electronClose).toHaveBeenCalledTimes(1);
  } finally {
    await transport.closeAndroid();
    await session.close();
  }
});

it("closes optional providers when MCP server startup throws", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Unexpected deep provider");
  });
  const scenarioClose = vi.fn(async () => undefined);
  const browserObservation = createBrowserObservationProvider();
  const browserClose = vi
    .spyOn(browserObservation, "close")
    .mockResolvedValue(undefined);
  const electronObservation = createElectronObservationProvider({});
  const electronClose = vi
    .spyOn(electronObservation, "close")
    .mockResolvedValue(undefined);
  const browserScenarioCapture: BrowserScenarioCapturePort = {
    identity: () => ({
      id: "fake-browser",
      name: "Fake browser",
      version: "1",
    }),
    captureScenario: async () => {
      throw new Error("Unexpected scenario capture");
    },
    close: scenarioClose,
  };
  const runtime: RuntimeDependencies = {
    env: {},
    serve: () => {
      throw new Error("Server startup failed");
    },
    writeStderr: () => undefined,
    setExitCode: () => undefined,
    registerShutdown: () => () => undefined,
  };
  try {
    const transport = await startMcpTransport(runtime, session, {
      logger: silentLogger,
      serverLogger: silentLogger,
      environment: runtime.env,
      delivery: createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
      loadOptionalProviders: async () => ({
        browserObservation,
        browserScenarioCapture,
        electronObservation,
      }),
    });

    expect(transport).toMatchObject({
      ok: false,
      cancelled: false,
      handle: { close: expect.any(Function) },
      closeAndroid: expect.any(Function),
      closeOptionalProviders: expect.any(Function),
    });
    // Failed admission still returns partial owners for idempotent retries.
    await transport.handle.close();
    await transport.closeOptionalProviders();
    await transport.closeAndroid();
    expect(browserClose).toHaveBeenCalledTimes(1);
    expect(scenarioClose).toHaveBeenCalledTimes(1);
    expect(electronClose).toHaveBeenCalledTimes(1);
  } finally {
    await session.close();
  }
});
