import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { chmod, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";

import {
  createTestBinarySession,
  createCacheProvider,
} from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { silentLogger } from "../../../src/logger.js";

const assertUncertainEvidence = async (
  client: Client,
  session: ReturnType<typeof createTestBinarySession>,
  sessionId: string,
): Promise<void> => {
  const uncertain = await client.callTool({
    name: "cutter_command",
    arguments: {
      session_id: sessionId,
      expected_generation: 3,
      command: "Ps /tmp/uncertain.rzdb",
    },
  });
  expect(uncertain.isError).toBe(true);
  const uncertainText = uncertain.content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
  const uncertainError = JSON.parse(uncertainText) as {
    error: { details: { partial_observation: { evidence_id: string } } };
  };
  const uncertainEvidence = session.evidenceById(
    uncertainError.error.details.partial_observation.evidence_id,
  );
  expect(uncertainEvidence).toBeDefined();
  if (uncertainEvidence === undefined)
    throw new Error("partial Evidence missing");
  expect(uncertainEvidence.normalized_result).toMatchObject({
    execution_state: "unknown",
    error: "transport-response-missing",
    message: expect.stringContaining("do not retry automatically"),
    document_generation: 3,
  });
  expect(uncertainEvidence.limitations).toContain(
    "Command completion or its output could not be confirmed; " +
      "do not retry automatically because the command may have produced " +
      "partial or persistent effects.",
  );
};

const assertNotStartedEvidenceAndAdmission = async (
  client: Client,
  sessionId: string,
): Promise<void> => {
  const rejected = await client.callTool({
    name: "cutter_command",
    arguments: {
      session_id: sessionId,
      expected_generation: 3,
      command: "Ps /tmp/not-started.rzdb",
    },
  });
  expect(rejected.isError, JSON.stringify(rejected)).not.toBe(true);
  expect(
    parseEvidence(rejected.structuredContent).normalized_result,
  ).toMatchObject({
    execution_state: "not_started",
    error: "session-poisoned-after-ui-timeout",
  });

  const admitted = await client.callTool({
    name: "cutter_command",
    arguments: {
      session_id: sessionId,
      expected_generation: 3,
      command: "iI",
    },
  });
  expect(admitted.isError).not.toBe(true);
};

const createMcpBridge = async (
  directory: string,
  sessionId: string,
  token: string,
): Promise<ReturnType<typeof createNetServer>> => {
  let connectionOrdinal = 0;
  const bridge = createNetServer((connection) => {
    const ordinal = ++connectionOrdinal;
    let payload = "";
    let clientNonce = "";
    let serverNonce = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => {
      payload += chunk;
      const newline = payload.indexOf("\n");
      if (newline < 0) return;
      const frame = JSON.parse(payload.slice(0, newline)) as Record<
        string,
        unknown
      >;
      payload = payload.slice(newline + 1);
      if (frame.kind === "rea-auth-v2") {
        clientNonce = String(frame.nonce);
        serverNonce = `${ordinal.toString(16).padStart(16, "0")}${"c".repeat(48)}`;
        const proof = createHmac("sha256", token)
          .update(
            `rea-cutter-server-v2:${sessionId}:${clientNonce}:${serverNonce}`,
          )
          .digest("hex");
        connection.write(
          `${JSON.stringify({ session_id: sessionId, nonce: serverNonce, proof })}\n`,
        );
        return;
      }
      const requestBytes = String(frame.request);
      const request = JSON.parse(requestBytes) as Record<string, unknown>;
      const expected = createHmac("sha256", token)
        .update(
          `rea-cutter-client-v2:${sessionId}:${clientNonce}:${serverNonce}:${requestBytes}`,
        )
        .digest("hex");
      if (frame.proof !== expected) {
        connection.destroy();
        return;
      }
      if (request.command === "Ps /tmp/uncertain.rzdb") {
        connection.destroy();
        return;
      }
      const notStarted = request.command === "Ps /tmp/not-started.rzdb";
      const status = request.kind === "status";
      const response = JSON.stringify(
        request.kind === "ack"
          ? { ok: true, acknowledged: false }
          : {
              ok: !notStarted,
              ...(notStarted
                ? {
                    execution_state: "not_started",
                    error: "session-poisoned-after-ui-timeout",
                  }
                : {}),
              session_id: request.session_id,
              output: status ? undefined : "synthetic Cutter command output",
              current_file: "/fixtures/sample.bin",
              document_generation: 3,
              ...(status
                ? {
                    completed_connection: (ordinal - 1)
                      .toString(16)
                      .padStart(16, "0"),
                    completed_commands: [],
                  }
                : {}),
              cutter_version: "Cutter fixture version",
              identity_status: "partial",
            },
      );
      const responseProof = createHmac("sha256", token)
        .update(
          `rea-cutter-response-v2:${sessionId}:${clientNonce}:${serverNonce}:${response}`,
        )
        .digest("hex");
      connection.end(`${JSON.stringify({ response, proof: responseProof })}\n`);
    });
  });
  await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  const address = bridge.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected an ephemeral IPv4 Cutter test bridge.");
  await writeFile(
    join(directory, `cutter-${process.pid}-${sessionId}.json`),
    JSON.stringify({
      session_id: sessionId,
      pid: process.pid,
      host: "127.0.0.1",
      port: address.port,
      token,
      document_generation: 2,
      current_file: null,
      cutter_version: "Cutter fixture version",
      identity_status: "partial",
    }),
    { mode: 0o600 },
  );
  return bridge;
};

it("preserves live Cutter command Evidence and parity through the MCP boundary", async () => {
  const directory = await createTestTempDirectory("rea-cutter-mcp-");
  if (process.platform !== "win32") await chmod(directory, 0o700);
  const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
  const token = "synthetic-cutter-bridge-token-for-mcp-test";
  const bridge = await createMcpBridge(directory, sessionId, token);
  onTestFinished(
    async () => new Promise<void>((resolve) => bridge.close(() => resolve())),
  );
  const session = createTestBinarySession(createCacheProvider([]));
  const server = createServer(
    { kind: "session", session },
    {
      logger: silentLogger,
      providerEnvironment: { ...process.env, REA_CUTTER_BRIDGE_DIR: directory },
    },
  );
  const client = new Client({ name: "cutter-mcp-boundary", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const discovery = await client.callTool({
    name: "list_cutter_sessions",
    arguments: {},
  });
  expect(discovery.isError).not.toBe(true);
  expect(discovery.structuredContent).toMatchObject({
    discovery_status: "sessions_found",
    sessions: [{ session_id: sessionId, document_generation: 3 }],
  });

  const command = await client.callTool({
    name: "cutter_command",
    arguments: {
      session_id: sessionId,
      expected_generation: 3,
      command: "iI",
    },
  });
  expect(command.isError).not.toBe(true);
  const evidence = parseEvidence(command.structuredContent);
  expect(evidence).toMatchObject({
    operation: "cutter_command",
    provider: { id: "cutter.python-plugin" },
    normalized_result: {
      command: "iI",
      output: "synthetic Cutter command output",
      document_generation: 3,
      cutter_version: "Cutter fixture version",
    },
  });
  expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);

  await assertNotStartedEvidenceAndAdmission(client, sessionId);
  await assertUncertainEvidence(client, session, sessionId);
});
