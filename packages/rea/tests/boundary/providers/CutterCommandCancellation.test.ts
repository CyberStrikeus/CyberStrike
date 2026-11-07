import { chmod } from "node:fs/promises";
import {
  authenticatedServer,
  writeDescriptor,
} from "../../fixtures/cutterBridgeProtocol.js";
import { expect, it, onTestFinished } from "vitest";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { CutterBridgeClient } from "../../../src/cutter/CutterBridgeClient.js";
import { CutterBridgeService } from "../../../src/cutter/CutterBridgeService.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each([
  new AnalysisInputError("opaque caller metadata"),
  new ProviderCleanupError("caller-owned", ["opaque caller resource"], {
    reason: "caller metadata",
  }),
])(
  "keeps a typed caller abort reason opaque at command admission: $_tag",
  async (reason) => {
    const directory = await createTestTempDirectory(
      "rea-cutter-command-cancel-",
    );
    const client = new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: directory });
    const service = new CutterBridgeService(client);
    onTestFinished(() => service.close());
    const controller = new AbortController();
    const executing = service.execute(
      {
        session_id: "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a",
        expected_generation: 0,
        command: "ij",
      },
      { signal: controller.signal },
    );
    queueMicrotask(() => controller.abort(reason));
    const result = await executing;
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "cutter_command",
        cleanupIncomplete: false,
      },
    });
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupResources).toEqual([]);
  },
);

it.each([
  new AnalysisOutputError("cutter_command", "physical provider failure"),
  new ProviderCleanupError("cutter", ["actual producer resource"], {
    reason: "physical producer close failure",
  }),
])(
  "preserves a genuine typed provider failure also selected as abort reason: $_tag",
  async (physical) => {
    const controller = new AbortController();
    const service = new CutterBridgeService({
      listSessions: async () => {
        throw new Error("Unexpected discovery");
      },
      execute: async () => {
        controller.abort(physical);
        throw physical;
      },
    });
    const result = await service.execute(
      {
        session_id: "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a",
        expected_generation: 0,
        command: "ij",
      },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected provider failure");
    expect(result.error).toBe(physical);
  },
);

it.skipIf(process.platform === "win32").each([
  new Error("caller stopped before command admission"),
  new AnalysisInputError("caller-owned"),
  new ProviderCleanupError("caller-owned", ["opaque caller resource"], {
    reason: "opaque caller metadata",
  }),
])(
  "records cancellation during status recovery before command dispatch: %s",
  async (reason) => {
    const directory = await createTestTempDirectory(
      "rea-cutter-status-cancel-",
    );
    await chmod(directory, 0o700);
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const token = "synthetic-cutter-bridge-token-for-test";
    const controller = new AbortController();
    let commands = 0;
    const peer = authenticatedServer(
      token,
      sessionId,
      (request, respond) => {
        if (request.kind === "status") {
          controller.abort(reason);
          return;
        }
        commands++;
        respond({
          ok: true,
          session_id: sessionId,
          completed_commands: [],
          completed_connection: "0000000000000000",
        });
      },
      true,
    );
    await new Promise<void>((resolve) => peer.listen(0, "127.0.0.1", resolve));
    const address = peer.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing listener");
    await writeDescriptor(directory, sessionId, address.port, token);
    const client = new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: directory });
    try {
      const failure = await client
        .execute({
          sessionId,
          expectedGeneration: 0,
          command: "pd 1",
          json: false,
          signal: controller.signal,
        })
        .catch((cause: unknown) => cause);
      expect(failure).toMatchObject({
        _tag: "AnalysisCancelledError",
        cause: reason,
        cleanupIncomplete: false,
      });
      if (!(failure instanceof Error))
        throw new Error("Expected typed cancellation");
      expect(failure.cause).toBe(reason);
      expect(commands).toBe(0);
    } finally {
      await client.close();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
    }
  },
);
