import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createModelFixtureServer } from "./model-fixture-server.mjs";

/** Exercise native Anthropic adapters locally, without live-provider claims. */
export const createAnthropicModelFixture = async ({ directory, onRequest }) => {
  const requests = [];
  const probes = [];
  let incoming = 0;
  const server = await createModelFixtureServer(
    async (request, response, recordFailure) => {
      try {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          assert(
            bytes <= 10 * 1024 * 1024,
            "Model fixture request exceeds 10 MiB budget",
          );
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw.length === 0 ? null : JSON.parse(raw);
        const path = new URL(request.url, "http://localhost").pathname;
        // Retain producer bodies and URLs, without transport authentication headers.
        await writeFile(
          join(directory, `claude-incoming-${++incoming}.json`),
          JSON.stringify({ method: request.method, path: request.url, body }),
        );
        if (path === "/v1/messages/count_tokens") {
          probes.push({ path, kind: "synthetic-token-count" });
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ input_tokens: 100 }));
          return;
        }
        if (path !== "/v1/messages") {
          probes.push({ path, status: 404 });
          response.statusCode = 404;
          response.end(
            JSON.stringify({
              error: { message: "Unsupported fixture endpoint" },
            }),
          );
          return;
        }
        assert.equal(request.method, "POST");
        assert(body && typeof body === "object" && !Array.isArray(body));
        assert(Array.isArray(body.messages));
        const tools = body.tools ?? [];
        requests.push({
          path: request.url,
          stream: body.stream,
          tools: tools.map((t) => t.name),
          messageRoles: body.messages.map((m) => m.role),
        });
        const content = await onRequest({
          body,
          tools,
          requestIndex: requests.length,
        });
        const stopReason = content.some((c) => c.type === "tool_use")
          ? "tool_use"
          : "end_turn";
        const usage = {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        };
        const result = {
          id: `msg_rea_${requests.length}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content,
          stop_reason: stopReason,
          stop_sequence: null,
          usage,
        };
        if (body.stream) {
          response.setHeader("Content-Type", "text/event-stream");
          const emit = (event, data) =>
            response.write(
              `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`,
            );
          emit("message_start", {
            message: {
              ...result,
              content: [],
              stop_reason: null,
              usage: { ...usage, output_tokens: 0 },
            },
          });
          for (const [index, block] of content.entries()) {
            emit("content_block_start", {
              index,
              content_block:
                block.type === "tool_use"
                  ? { ...block, input: {} }
                  : { type: "text", text: "" },
            });
            if (block.type === "tool_use") {
              const json = JSON.stringify(block.input);
              const split = Math.floor(json.length / 2);
              for (const partialJson of [
                json.slice(0, split),
                json.slice(split),
              ]) {
                emit("content_block_delta", {
                  index,
                  delta: {
                    type: "input_json_delta",
                    partial_json: partialJson,
                  },
                });
              }
            } else {
              emit("content_block_delta", {
                index,
                delta: { type: "text_delta", text: block.text },
              });
            }
            emit("content_block_stop", { index });
          }
          emit("message_delta", {
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: 20 },
          });
          emit("message_stop", {});
          response.end();
        } else {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(result));
        }
      } catch (cause) {
        const failure = recordFailure(cause);
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: failure },
          }),
        );
      }
    },
  );
  return {
    baseUrl: server.origin,
    requests,
    probes,
    get failure() {
      return server.failure;
    },
    close: () => server.close(),
  };
};
