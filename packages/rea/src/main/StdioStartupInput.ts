import type { Readable } from "node:stream";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";

/** Raw startup bytes remain owned until the SDK's stdio transport can consume them. */
export const ownStdioStartupInput = (
  input: Readable,
  stop: (failure?: AnalysisError) => void,
): { handoff(): void; resume(): void; close(): void } => {
  const chunks: Buffer[] = [];
  let retainedBytes = 0;
  let tail: Buffer | undefined;
  let tailBytes = 0;
  let handedOff = false;
  let closed = false;
  const detach = (): void => {
    input.off("data", onData);
    input.off("end", onEnd);
    input.off("close", onEnd);
    input.off("error", onError);
  };
  const onEnd = (): void => stop();
  const onError = (cause: Error): void =>
    stop(
      new AnalysisOutputError(
        "mcp_startup",
        "MCP stdin could not be read during startup.",
        { cause, userMessage: "MCP stdin could not be read during startup." },
      ),
    );
  const onData = (chunk: Buffer | string): void => {
    const incomingBytes = Buffer.isBuffer(chunk)
      ? chunk.byteLength
      : Buffer.byteLength(chunk);
    if (retainedBytes + incomingBytes > STDIO_DEFAULT_MAX_BUFFER_SIZE) {
      input.pause();
      detach();
      stop(
        new AnalysisResourceConstraintError(
          "mcp_startup",
          "transport",
          "MCP input exceeded the stdio buffer capacity before startup completed.",
          {
            max_buffer_bytes: STDIO_DEFAULT_MAX_BUFFER_SIZE,
            retained_bytes: retainedBytes,
            incoming_bytes: incomingBytes,
          },
          {
            remediationAction:
              "Wait for the MCP server to finish startup before sending more requests. The stdio buffer capacity has no runtime override.",
          },
        ),
      );
      return;
    }
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < bytes.byteLength) {
      // Bound chunk bookkeeping too, even when stdin delivers one byte per event.
      tail ??= Buffer.allocUnsafe(
        Math.min(64 * 1024, STDIO_DEFAULT_MAX_BUFFER_SIZE - retainedBytes),
      );
      const copied = Math.min(
        tail.byteLength - tailBytes,
        bytes.byteLength - offset,
      );
      bytes.copy(tail, tailBytes, offset, offset + copied);
      offset += copied;
      retainedBytes += copied;
      tailBytes += copied;
      if (tailBytes === tail.byteLength) {
        chunks.push(tail);
        tail = undefined;
        tailBytes = 0;
      }
    }
  };
  input.on("data", onData);
  input.on("end", onEnd);
  input.on("close", onEnd);
  input.on("error", onError);
  if (input.readableEnded || input.destroyed) queueMicrotask(onEnd);
  return {
    handoff: () => {
      if (closed || handedOff) return;
      input.pause();
      detach();
      if (tail !== undefined && tailBytes > 0)
        chunks.push(tail.subarray(0, tailBytes));
      tail = undefined;
      tailBytes = 0;
      // Unshift in reverse chunk order; the SDK remains the only frame parser.
      for (let index = chunks.length - 1; index >= 0; index -= 1)
        input.unshift(chunks[index]!);
      chunks.length = 0;
      retainedBytes = 0;
      handedOff = true;
    },
    resume: () => {
      if (handedOff && !closed) input.resume();
    },
    close: () => {
      if (closed) return;
      closed = true;
      detach();
      chunks.length = 0;
      tail = undefined;
      tailBytes = 0;
      retainedBytes = 0;
      if (!handedOff) input.pause();
    },
  };
};
