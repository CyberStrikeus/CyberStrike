import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { expect, it, vi } from "vitest";
import { WebSourceLocationService } from "../../src/application/WebSourceLocationService.js";
import { ok } from "../../src/domain/result.js";
import { systemProcessOwnershipHost } from "../../src/process/ProcessOwnershipObservation.js";
import { createServer } from "../../src/server/createServer.js";
import * as nativeLoader from "../../src/windows/WindowsNativeLoader.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  webSourceLocationArgs,
  webSourceLocationFixture,
} from "../fixtures/webSourceLocation.js";

// Bun on Windows is the runtime whose codec launch requests a Job Object limit.
vi.mock(
  "../../src/process/JavaScriptWorkerMemoryLimit.js",
  async (original) => {
    const actual =
      await original<
        typeof import("../../src/process/JavaScriptWorkerMemoryLimit.js")
      >();
    return {
      ...actual,
      javaScriptWorkerMemoryLimitBytes: (heapBudgetMiB: number) =>
        actual.javaScriptWorkerMemoryLimitBytes(heapBudgetMiB, {
          platform: "win32",
          versions: { node: "24.18.0", bun: "1.4.2" },
        }),
    };
  },
);

/** An admitted artifact that predates the optional Job Object limit control. */
const earlierArtifact = (
  spawns: string[],
): nativeLoader.WindowsNativeAuthority => ({
  inspection: {
    abiVersion: 1,
    nodeApiVersion: 8,
    architecture: "x64",
    filesystem: {
      requestedPath: "C:\\probe",
      finalPath: "C:\\probe",
      filesystem: "NTFS",
      volumeSerial: "0".repeat(16),
      fileId: "0".repeat(32),
      size: 0,
      directory: true,
    },
    privateDacl: true,
    privateBridgeDescriptorAccess: true,
    atomicJobAssignment: true,
    killOnOwnerClose: true,
    protocolStdin: true,
  },
  call: (operation) => {
    spawns.push(operation);
    throw new Error(`Unexpected native ${operation}`);
  },
});

it("reports a missing Windows native control as an unavailable capability", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const spawns: string[] = [];
  const parent = await createTestTempDirectory("rea-native-control-");
  const root = join(parent, "runtime");
  await mkdir(root);
  let rootClosed = false;
  const session = createTestBinarySession(() => {
    throw new Error("binary provider must not start");
  });
  let client: Client | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  try {
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    vi.spyOn(nativeLoader, "requireWindowsNativeAuthority").mockReturnValue(
      earlierArtifact(spawns),
    );
    vi.spyOn(systemProcessOwnershipHost, "prepare").mockResolvedValue(
      undefined,
    );
    const { SourceMapDecoder } =
      await import("../../src/javascript/sourceMaps/SourceMapDecoder.js");
    const decoder = new SourceMapDecoder({
      prepareOwnership: async () => {},
      createRuntime: async () => ({
        path: root,
        close: async () => {
          await rm(root, { recursive: true, force: true });
          rootClosed = true;
        },
      }),
    });
    server = createServer(
      { kind: "session", session },
      {
        webSourceLocation: new WebSourceLocationService(
          { load: async () => ok(webSourceLocationFixture()) },
          decoder,
        ),
      },
    );
    client = new Client({ name: "native-control-capability", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const response = await client.callTool({
      name: "trace_web_source_location",
      arguments: webSourceLocationArgs,
    });

    const { error } = parseMcpToolError(response as CallToolResult);
    expect(error).toMatchObject({
      code: "capability_unavailable",
      retryable: false,
      message: expect.stringContaining(
        "does not support Job Object memory limits",
      ),
      remediation: {
        action: expect.stringContaining(
          "matching current Windows x64 REA package",
        ),
      },
      details: {
        provider_id: "source-map-decoder",
        operation: "trace_web_source_location",
      },
    });
    // The refusal still precedes any native launch and releases the runtime.
    expect(spawns).toEqual([]);
    expect(rootClosed).toBe(true);
    await decoder.close();
  } finally {
    Object.defineProperty(process, "platform", platform);
    vi.restoreAllMocks();
    await client?.close();
    await server?.close();
    await session.close();
  }
});
