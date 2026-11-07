import { randomUUID } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";

import { expect, it } from "vitest";

import { CutterBridgeClient } from "../../../src/cutter/CutterBridgeClient.js";
import { CutterBridgeService } from "../../../src/cutter/CutterBridgeService.js";
import { cutterDiscoverySchema } from "../../../src/domain/cutterDiscovery.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const descriptor = async (directory: string, port: number): Promise<string> => {
  const sessionId = randomUUID();
  await writeFile(
    join(directory, `cutter-${process.pid}-${sessionId}.json`),
    JSON.stringify({
      session_id: sessionId,
      pid: process.pid,
      host: "127.0.0.1",
      port,
      token: "capacity-test-token-123456789",
      document_generation: 0,
      current_file: null,
      cutter_version: null,
      identity_status: "partial",
    }),
    { mode: 0o600 },
  );
  return sessionId;
};

it("reports descriptor capacity without opening candidates or claiming no live sessions", async () => {
  const directory = await createTestTempDirectory("rea-cutter-capacity-");
  await chmod(directory, 0o700);
  const selectedSession = await descriptor(directory, 1);
  for (let index = 1; index < 257; index += 1) await descriptor(directory, 1);
  const client = new CutterBridgeClient(
    { REA_CUTTER_BRIDGE_DIR: directory },
    { platform: "linux" },
  );
  const result = await client.listSessions();
  expect(cutterDiscoverySchema.parse(result)).toMatchObject({
    sessions: [],
    discovery_status: "bridge_directory_capacity_exceeded",
    bridge_directory_security: "private_verified",
  });
  const service = new CutterBridgeService(client);
  expect(
    await service.execute({
      session_id: selectedSession,
      expected_generation: 0,
      command: "iI",
      json: false,
    }),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      cleanupIncomplete: false,
    },
  });
});

it("bounds simultaneous socket probes while examining every admitted descriptor", async () => {
  const directory = await createTestTempDirectory("rea-cutter-probes-");
  await chmod(directory, 0o700);
  const sockets = new Set<Socket>();
  let peak = 0;
  let probes = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    probes += 1;
    peak = Math.max(peak, sockets.size);
    socket.once("close", () => sockets.delete(socket));
    setTimeout(() => socket.destroy(), 20);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("listener missing");
    for (let index = 0; index < 24; index += 1)
      await descriptor(directory, address.port);
    const client = new CutterBridgeClient(
      { REA_CUTTER_BRIDGE_DIR: directory },
      { platform: "linux" },
    );
    expect((await client.listSessions()).discovery_status).toBe(
      "no_live_bridge_found",
    );
    expect(probes).toBe(24);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("rejects expanded authenticated frames before dispatch and retains no cleanup owner", async () => {
  const directory = await createTestTempDirectory("rea-cutter-frame-");
  await chmod(directory, 0o700);
  const sessionId = await descriptor(directory, 1);
  const service = new CutterBridgeService(
    new CutterBridgeClient(
      { REA_CUTTER_BRIDGE_DIR: directory },
      { platform: "linux" },
    ),
  );
  const input = { session_id: sessionId, expected_generation: 0, json: false };
  const rejected = await service.execute({
    ...input,
    command: '"'.repeat(4 * 1024 * 1024 + 1024),
  });
  expect(rejected).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      cleanupIncomplete: false,
    },
  });
  expect(await service.retryCleanup()).toEqual({ ok: true, value: null });
  // A later valid command reaches transport, rather than replaying the resource failure.
  expect(await service.execute({ ...input, command: "iI" })).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCapabilityUnavailableError",
      cleanupIncomplete: false,
    },
  });
});
