import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { createHmac } from "node:crypto";

/** Authenticate real v2 frames before dispatching controlled bridge replies. */
export const authenticatedServer = (
  token: string,
  sessionId: string,
  onRequest: (
    request: Record<string, unknown>,
    respond: (
      value: unknown,
      options?: { raw?: boolean; fragment?: boolean; chunkBytes?: number },
    ) => void,
    connection: import("node:net").Socket,
  ) => void,
  handleStatusRequests = false,
): ReturnType<typeof createServer> => {
  let nextConnectionOrdinal = 0;
  return createServer((connection) => {
    const connectionOrdinal = ++nextConnectionOrdinal;
    connection.setEncoding("utf8");
    let input = "";
    let clientNonce = "";
    let serverNonce = "";
    connection.on("data", (chunk: string) => {
      input += chunk;
      for (;;) {
        const end = input.indexOf("\n");
        if (end < 0) return;
        const frame = JSON.parse(input.slice(0, end)) as Record<
          string,
          unknown
        >;
        input = input.slice(end + 1);
        if (frame.kind === "rea-auth-v2") {
          clientNonce = String(frame.nonce);
          serverNonce = `${connectionOrdinal.toString(16).padStart(16, "0")}${"e".repeat(48)}`;
          const proof = createHmac("sha256", token)
            .update(
              `rea-cutter-server-v2:${sessionId}:${clientNonce}:${serverNonce}`,
            )
            .digest("hex");
          connection.write(
            `${JSON.stringify({ session_id: sessionId, nonce: serverNonce, proof })}\n`,
          );
          continue;
        }
        const requestBytes = String(frame.request);
        const expected = createHmac("sha256", token)
          .update(
            `rea-cutter-client-v2:${sessionId}:${clientNonce}:${serverNonce}:${requestBytes}`,
          )
          .digest("hex");
        if (frame.proof !== expected) {
          connection.destroy();
          return;
        }
        const respond = (
          value: unknown,
          options: {
            raw?: boolean;
            fragment?: boolean;
            chunkBytes?: number;
          } = {},
        ): void => {
          const response =
            options.raw === true ? String(value) : JSON.stringify(value);
          const responseProof = createHmac("sha256", token)
            .update(
              `rea-cutter-response-v2:${sessionId}:${clientNonce}:${serverNonce}:${response}`,
            )
            .digest("hex");
          const frame = `${JSON.stringify({ response, proof: responseProof })}\n`;
          const bytes = Buffer.from(frame);
          if (options.chunkBytes !== undefined) {
            const writeChunk = (offset: number): void => {
              if (connection.destroyed) return;
              const end = Math.min(offset + options.chunkBytes!, bytes.length);
              if (offset === bytes.length) {
                connection.end();
                return;
              }
              connection.write(bytes.subarray(offset, end));
              setImmediate(() => writeChunk(end));
            };
            setImmediate(() => writeChunk(0));
          } else if (options.fragment === true) {
            const midpoint = Math.floor(bytes.length / 2);
            connection.write(bytes.subarray(0, midpoint));
            setImmediate(() => connection.end(bytes.subarray(midpoint)));
          } else connection.end(frame);
        };
        const request = JSON.parse(requestBytes) as Record<string, unknown>;
        if (request.kind === "status" && !handleStatusRequests) {
          respond({
            ok: true,
            session_id: sessionId,
            completed_commands: [],
            completed_connection: (connectionOrdinal - 1)
              .toString(16)
              .padStart(16, "0"),
          });
          continue;
        }
        onRequest(request, respond, connection);
      }
    });
  });
};

export const writeDescriptor = async (
  directory: string,
  sessionId: string,
  port: number,
  token: string,
  options: {
    readonly currentFile?: string | null;
    readonly documentGeneration?: number;
    readonly maxRequestBytes?: number;
  } = {},
): Promise<void> =>
  writeFile(
    join(directory, `cutter-${process.pid}-${sessionId}.json`),
    JSON.stringify({
      session_id: sessionId,
      pid: process.pid,
      host: "127.0.0.1",
      port,
      token,
      document_generation: options.documentGeneration ?? 0,
      current_file: options.currentFile ?? null,
      cutter_version: "Cutter fixture version",
      identity_status: "partial",
      ...(options.maxRequestBytes === undefined
        ? {}
        : { max_request_bytes: options.maxRequestBytes }),
    }),
    { mode: 0o600 },
  );
