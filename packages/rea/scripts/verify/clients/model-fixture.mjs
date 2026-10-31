import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createModelFixtureServer } from "./model-fixture-server.mjs";

/** A loopback model fixture exercises real clients without claiming live-provider compatibility. */
export const createOpenAiModelFixture = async ({
  directory,
  prefix,
  onRequest,
}) => {
  const requests = [];
  const probes = [];
  let incoming = 0;
  const server = await createModelFixtureServer(
    async (request, response, recordFailure) => {
      try {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        if (request.method === "GET" && path.endsWith("/models")) {
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              object: "list",
              data: [
                {
                  id: "rea-client-fixture",
                  object: "model",
                  owned_by: "local-fixture",
                },
              ],
            }),
          );
          return;
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          assert(
            bytes <= 10 * 1024 * 1024,
            "Local model fixture exceeded its 10 MiB request resource budget",
          );
          chunks.push(chunk);
        }
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const body = rawBody.length === 0 ? null : JSON.parse(rawBody);
        await writeFile(
          join(directory, `${prefix}-incoming-${++incoming}.json`),
          JSON.stringify({ method: request.method, path: request.url, body }),
        );
        if (path !== "/v1/chat/completions") {
          // Hermes probes custom endpoints for Ollama/llama.cpp metadata.
          // Unsupported HTTP endpoints return 404, as on an OpenAI-only server.
          probes.push({
            method: request.method,
            path: request.url,
            body,
            status: 404,
          });
          response.statusCode = 404;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error:
                "This OpenAI fixture exposes models and chat completions only.",
            }),
          );
          return;
        }
        assert.equal(request.method, "POST");
        assert(
          body !== null && typeof body === "object" && !Array.isArray(body),
        );
        assert(Array.isArray(body.messages));
        const tools = (body.tools ?? [])
          .filter((t) => t.type === "function")
          .map((t) => t.function ?? t);
        requests.push({
          path: request.url,
          tools: tools.map((t) => t.name),
          stream: body.stream,
          messageRoles: body.messages.map((m) => m.role),
        });
        await writeFile(
          join(directory, `${prefix}-request-${requests.length}.json`),
          JSON.stringify(body),
        );
        const message = await onRequest({
          body,
          tools,
          requestIndex: requests.length,
        });
        const base = {
          id: `chatcmpl-rea-${requests.length}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
        };
        const finish = message.tool_calls ? "tool_calls" : "stop";
        const usage = {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
        };
        if (body.stream) {
          response.setHeader("Content-Type", "text/event-stream");
          const emit = (delta, finishReason = null) =>
            response.write(
              `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`,
            );
          if (message.tool_calls) {
            const fragments = message.tool_calls.map((call, index) => {
              const split = Math.floor(call.function.arguments.length / 2);
              return {
                first: {
                  index,
                  ...call,
                  function: {
                    name: call.function.name,
                    arguments: call.function.arguments.slice(0, split),
                  },
                },
                second: {
                  index,
                  function: { arguments: call.function.arguments.slice(split) },
                },
              };
            });
            emit({
              role: "assistant",
              content: null,
              tool_calls: fragments.map((f) => f.first),
            });
            emit({ tool_calls: fragments.map((f) => f.second) });
          } else emit(message);
          emit({}, finish);
          response.write(
            `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [], usage })}\n\n`,
          );
          response.end("data: [DONE]\n\n");
        } else {
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              ...base,
              choices: [{ index: 0, message, finish_reason: finish }],
              usage,
            }),
          );
        }
      } catch (cause) {
        const failure = recordFailure(cause);
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            error: { message: failure, type: "invalid_request_error" },
          }),
        );
      }
    },
  );
  return {
    baseUrl: `${server.origin}/v1`,
    requests,
    probes,
    get failure() {
      return server.failure;
    },
    close: () => server.close(),
  };
};
