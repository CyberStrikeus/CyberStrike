import z from "zod"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "./fixture"

export const GoalRequest = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional(),
})
export type GoalReply = { text?: string; calls?: { name: string; input: unknown }[]; status?: number; finish?: string }

export async function withGoal(
  respond: (request: z.infer<typeof GoalRequest>, count: number) => GoalReply | Promise<GoalReply>,
  run: (sessionID: string, requests: z.infer<typeof GoalRequest>[]) => Promise<void>,
) {
  const requests: z.infer<typeof GoalRequest>[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = GoalRequest.parse(await request.json())
      requests.push(body)
      const reply = await respond(body, requests.length)
      if (reply.status)
        return Response.json(
          { error: { message: "Provider unavailable", type: "server_error" } },
          { status: reply.status },
        )
      const chunks = [
        {
          choices: [
            {
              delta: {
                role: "assistant",
                content: reply.text,
                ...(reply.calls
                  ? {
                      tool_calls: reply.calls.map((call, index) => ({
                        index,
                        id: `call-${requests.length}-${index}`,
                        type: "function",
                        function: { name: call.name, arguments: JSON.stringify(call.input) },
                      })),
                    }
                  : {}),
              },
            },
          ],
        },
        {
          choices: [{ delta: {}, finish_reason: reply.finish ?? (reply.calls ? "tool_calls" : "stop") }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_tokens: 12,
            prompt_tokens_details: { cached_tokens: 4 },
            completion_tokens_details: { reasoning_tokens: 1 },
          },
        },
      ]
      return new Response(
        chunks
          .map(
            (chunk) =>
              `data: ${JSON.stringify({ id: "goal-response", object: "chat.completion.chunk", ...chunk })}\n\n`,
          )
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  await using dir = await tmpdir({
    config: {
      model: "alibaba/qwen-plus",
      snapshot: false,
      default_agent: "goaltest",
      enabled_providers: ["alibaba"],
      provider: { alibaba: { options: { apiKey: "test-key", baseURL: `${server.url.origin}/v1` } } },
      agent: {
        goaltest: {
          mode: "primary",
          prompt: "Complete the user's objective with evidence.",
          permission: { "*": "allow" },
        },
      },
    },
  })
  try {
    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const session = await Session.create({ title: "Goal integration" })
        try {
          await run(session.id, requests)
        } finally {
          await Session.remove(session.id)
          await Instance.dispose()
        }
      },
    })
  } finally {
    server.stop(true)
  }
}
