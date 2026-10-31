import { createServer } from "node:net";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { CutterBridgeClient } from "../../../src/cutter/CutterBridgeClient.js";

const SESSION_ID = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
const TOKEN = "synthetic-cutter-bridge-token-for-test";
let directory: string | undefined;
let server: ReturnType<typeof createServer> | undefined;

afterEach(async () => {
  if (server !== undefined)
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  server = undefined;
  directory = undefined;
});

const listen = async (
  listener: ReturnType<typeof createServer>,
): Promise<number> => {
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  const address = listener.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected an ephemeral IPv4 listener");
  return address.port;
};

const bridgeServer = (
  currentFile: string | null,
  documentGeneration: number,
): ReturnType<typeof createServer> => {
  let ordinal = 0;
  return createServer((connection) => {
    const connectionOrdinal = ++ordinal;
    connection.setEncoding("utf8");
    let input = "";
    let clientNonce = "";
    let serverNonce = "";
    connection.on("data", (chunk: string) => {
      input += chunk;
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      const frame = JSON.parse(input.slice(0, newline)) as Record<
        string,
        unknown
      >;
      input = input.slice(newline + 1);
      if (frame.kind === "rea-auth-v2") {
        clientNonce = String(frame.nonce);
        serverNonce =
          connectionOrdinal.toString(16).padStart(16, "0") + "d".repeat(48);
        connection.write(
          `${JSON.stringify({ session_id: SESSION_ID, nonce: serverNonce, proof: createHmac("sha256", TOKEN).update(`rea-cutter-server-v2:${SESSION_ID}:${clientNonce}:${serverNonce}`).digest("hex") })}\n`,
        );
        return;
      }
      const requestBytes = String(frame.request);
      const request = JSON.parse(requestBytes) as Record<string, unknown>;
      const expected = createHmac("sha256", TOKEN)
        .update(
          `rea-cutter-client-v2:${SESSION_ID}:${clientNonce}:${serverNonce}:${requestBytes}`,
        )
        .digest("hex");
      if (frame.proof !== expected) {
        connection.destroy();
        return;
      }
      if (!["status", "command", "ack"].includes(String(request.kind)))
        throw new Error(`Unmodeled bridge request: ${String(request.kind)}`);
      const response = JSON.stringify(
        request.kind === "ack"
          ? {
              ok: true,
              acknowledged: false,
            }
          : {
              ok: true,
              session_id: request.session_id,
              current_file: currentFile,
              document_generation: documentGeneration,
              cutter_version: "Cutter fixture version",
              identity_status: "partial",
              ...(request.kind === "status"
                ? {
                    completed_connection: (connectionOrdinal - 1)
                      .toString(16)
                      .padStart(16, "0"),
                    completed_commands: [],
                  }
                : { execution_state: "complete" }),
            },
      );
      const proof = createHmac("sha256", TOKEN)
        .update(
          `rea-cutter-response-v2:${SESSION_ID}:${clientNonce}:${serverNonce}:${response}`,
        )
        .digest("hex");
      connection.end(`${JSON.stringify({ response, proof })}\n`);
    });
  });
};

const clientFor = (bridgeDirectory: string): CutterBridgeClient =>
  process.platform === "win32"
    ? new CutterBridgeClient(
        { REA_CUTTER_BRIDGE_DIR: bridgeDirectory },
        {
          windowsPrivateReader: {
            verifyDirectory: () => true,
            readDescriptor: (root, name, maxBytes) => {
              const bytes = readFileSync(join(root, name));
              if (bytes.byteLength > maxBytes)
                throw new Error("Descriptor too large");
              return bytes;
            },
          },
        },
      )
    : new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: bridgeDirectory });

const writeDescriptor = async (port: number): Promise<void> => {
  if (directory === undefined) throw new Error("Test directory is unavailable");
  await writeFile(
    join(directory, `cutter-${process.pid}-${SESSION_ID}.json`),
    JSON.stringify({
      session_id: SESSION_ID,
      pid: process.pid,
      host: "127.0.0.1",
      port,
      token: TOKEN,
      document_generation: 1,
      current_file: "/old/sample.bin",
      cutter_version: "Cutter fixture version",
      identity_status: "partial",
    }),
    { mode: 0o600 },
  );
};

it("preserves a live Cutter status that explicitly has no active document", async () => {
  directory = await mkdtemp(join(tmpdir(), "rea-cutter-null-status-"));
  server = bridgeServer(null, 2);
  await writeDescriptor(await listen(server));

  const result = await clientFor(directory).listSessions();

  expect(result.sessions[0]).toMatchObject({
    session_id: SESSION_ID,
    document_generation: 2,
    current_file: null,
  });
});

it("preserves a null active document returned after a Cutter command", async () => {
  directory = await mkdtemp(join(tmpdir(), "rea-cutter-null-command-"));
  server = bridgeServer(null, 2);
  await writeDescriptor(await listen(server));

  const result = await clientFor(directory).execute({
    sessionId: SESSION_ID,
    expectedGeneration: 2,
    command: "ij",
    json: true,
  });

  expect(result.currentFile).toBeNull();
});
