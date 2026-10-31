import { it, expect, onTestFinished } from "vitest";
import {
  authenticatedServer,
  writeDescriptor,
} from "../../fixtures/cutterBridgeProtocol.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { CutterBridgeClient } from "../../../src/cutter/CutterBridgeClient.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";

it.each(["invalid-identity", "exact-receipt", "unrelated-receipt"] as const)(
  "checks command completion independently of preflight watermark admission: %s",
  async (mode) => {
    const directory = await createTestTempDirectory("rea-cutter-status-proof-");
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const requestId = "4b18ce4d-bf31-456e-ae31-e8c547b2f9db";
    const otherId = "ede4bbfd-6348-46aa-963b-0de0e78ccbdc";
    const token = "synthetic-cutter-status-proof-token";
    const calls: string[] = [];
    const server = authenticatedServer(
      token,
      sessionId,
      (request, respond) => {
        calls.push(String(request.kind));
        if (request.kind === "ack") {
          expect(request.request_id).toBe(requestId);
          respond({ ok: true, acknowledged: true });
          return;
        }
        respond({
          ok: true,
          session_id: mode === "invalid-identity" ? otherId : sessionId,
          completed_commands: [
            {
              request_id: mode === "exact-receipt" ? requestId : otherId,
              execution_state: "complete",
            },
          ],
        });
      },
      true,
    );
    onTestFinished(
      async () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing listener");
    const port = address.port;
    await writeDescriptor(directory, sessionId, port, token);
    const client = new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: directory });
    const result = await client.confirmCommandCompletion(sessionId, requestId);
    if (mode === "invalid-identity") {
      if (result.ok) throw new Error("Expected invalid status identity");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "unreadable_output",
        details: {
          operation: "cutter_command",
          diagnostics: { auxiliary_operation: "status" },
        },
      });
    } else
      expect(result).toEqual({ ok: true, value: mode === "exact-receipt" });
    expect(calls).toEqual(
      mode === "exact-receipt" ? ["status", "ack"] : ["status"],
    );
    await client.close();
  },
);
