import { expect } from "vitest";
import { chmod } from "node:fs/promises";
import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";
import {
  authenticatedServer,
  writeDescriptor,
} from "../../fixtures/cutterBridgeProtocol.js";

const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
workspaceCliTest.for([
  "missing-watermark",
  "invalid-identity",
  "valid",
] as const)(
  "retains caller operation and preflight proof through the CLI: %s",
  async (mode, { cli, workspace }) => {
    const directory = await workspace.mkdir("bridge");
    if (process.platform !== "win32") await chmod(directory, 0o700);
    const token = "synthetic-cutter-status-test-token";
    const calls: string[] = [];
    let phase = "discovery";
    const bridge = authenticatedServer(
      token,
      sessionId,
      (request, respond) => {
        calls.push(`${phase}:${String(request.kind)}`);
        if (request.kind === "ack") {
          respond({ ok: true, acknowledged: true });
          return;
        }
        if (request.kind === "status") {
          respond({
            ok: true,
            session_id:
              mode === "invalid-identity" && phase === "command"
                ? "00000000-0000-4000-8000-000000000001"
                : sessionId,
            current_file: null,
            document_generation: 0,
            cutter_version: "Cutter fixture",
            identity_status: "partial",
            completed_commands: [],
            ...(mode === "missing-watermark"
              ? {}
              : { completed_connection: "0000000000000000" }),
          });
          return;
        }
        expect(request.kind).toBe("command");
        expect(request.command).toBe("ij");
        respond({
          ok: true,
          session_id: sessionId,
          output: "fixture output",
          document_generation: 0,
          current_file: null,
          execution_state: "complete",
          output_truncated: false,
        });
      },
      true,
    );
    await new Promise<void>((resolve) =>
      bridge.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = bridge.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing bridge address");
      await writeDescriptor(directory, sessionId, address.port, token);
      const environment = {
        ...workspace.environment,
        REA_CUTTER_BRIDGE_DIR: directory,
        REA_LOG_LEVEL: "silent",
      };
      const discovery = await cli.run({
        arguments: ["list-cutter-sessions", "--json"],
        environment,
      });
      expect(discovery.exitCode).toBe(0);
      expect(discovery.json).toMatchObject({
        discovery_status: "sessions_found",
        sessions: [{ session_id: sessionId }],
      });
      phase = "command";
      const result = await cli.run({
        arguments: ["cutter-command", sessionId, "0", "ij", "--json"],
        environment,
      });
      expect(result.stderr).toBe("");
      if (mode === "valid") {
        expect(result.exitCode).toBe(0);
        expect(result.json).toMatchObject({
          operation: "cutter_command",
          normalized_result: {
            output: "fixture output",
            execution_state: "complete",
          },
        });
        expect(calls).toContain("command:command");
        expect(calls).toContain("command:ack");
      } else {
        expect(result.exitCode).toBe(1);
        expect(result.json).toMatchObject({
          code: "unreadable_output",
          details: {
            operation: "cutter_command",
            reason:
              mode === "missing-watermark"
                ? "The bridge did not provide authenticated proof that earlier connections reached a terminal state."
                : "The bridge status response did not contain a valid session identity.",
            diagnostics: { auxiliary_operation: "status" },
          },
        });
        expect(calls).toEqual(["discovery:status", "command:status"]);
      }
    } finally {
      await new Promise<void>((resolve) => bridge.close(() => resolve()));
    }
  },
);
