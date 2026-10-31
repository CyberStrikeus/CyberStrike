import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it, vi } from "vitest";

import { AnalysisCapabilityUnavailableError } from "../../src/domain/analysisErrorCore.js";
import { err } from "../../src/domain/result.js";
import { captureProcessScenario } from "../../src/process/capture/ProcessHarness.js";
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";

// Windows rejects capture before it reads the environment, so record the
// environment the MCP adapter hands to the capture owner on every host.
vi.mock(
  "../../src/process/capture/ProcessHarness.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/process/capture/ProcessHarness.js")
    >()),
    captureProcessScenario: vi.fn(async () =>
      err(
        new AnalysisCapabilityUnavailableError(
          "rea-process",
          "capture_process_scenario",
          "recorded by test",
        ),
      ),
    ),
  }),
);

const resources: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
  vi.unstubAllEnvs();
});

it("captures MCP process scenarios with the server's selected environment", async () => {
  vi.stubEnv("REA_CAPTURE_SELECTION_MARKER", "ambient");
  vi.stubEnv("REA_CAPTURE_AMBIENT_ONLY", "ambient");
  const session = createTestBinarySession(() => {
    throw new Error("Process capture must not launch a binary provider");
  });
  const server = createServer(
    { kind: "session", session },
    { environment: { REA_CAPTURE_SELECTION_MARKER: "selected" } },
  );
  const client = new Client({ name: "capture-environment", version: "1" });
  resources.push(client, server, session);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const result = await client.callTool({
    name: "capture_process_scenario",
    arguments: { executable: process.execPath },
  });

  expect(result.isError).toBe(true);
  const environment = vi.mocked(captureProcessScenario).mock.lastCall?.[3];
  expect(environment).toEqual({ REA_CAPTURE_SELECTION_MARKER: "selected" });
});
