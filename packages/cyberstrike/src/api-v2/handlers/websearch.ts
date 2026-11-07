import { Effect, Option, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Location } from "@opencode/schema/location"
import { WebSearch } from "@opencode/schema/websearch"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Agent } from "../../agent/agent"
import { Config } from "../../config/config"
import { PermissionNext } from "../../permission/next"
import { inInstance } from "../instance"

// The one provider v1 ships: the hosted Exa MCP endpoint that the websearch tool calls.
const exa = { id: "exa", name: "Exa" }
const endpoint = "https://mcp.exa.ai/mcp"

const Reply = Schema.Struct({
  result: Schema.Struct({ content: Schema.Array(Schema.Struct({ text: Schema.String })) }),
})
const decodeReply = Schema.decodeUnknownOption(Reply)

// The tool asks the user before searching. This endpoint has no session to ask in, so it searches only when the
// default agent and the config both allow websearch for this query. An "ask" or "deny" answer is refused.
const permitted = async (query: string) => {
  const name = await Agent.defaultAgent().catch(() => undefined)
  const agent = name ? await Agent.get(name) : undefined
  if (!agent) return false
  const config = await Config.get()
  const rule = PermissionNext.evaluate(
    "websearch",
    query,
    agent.permission,
    PermissionNext.fromConfig(config.permission ?? {}),
  )
  return rule.action === "allow"
}

// Same MCP call the websearch tool makes. Exa answers in SSE; the first event carrying content is the reply.
const search = async (query: string) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: { query, type: "auto", numResults: 8, livecrawl: "fallback" },
      },
    }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new Error(`Search error (${response.status})`)
  const events = (await response.text()).split("\n").filter((line) => line.startsWith("data: "))
  const texts = events.flatMap((line) => {
    const reply = decodeReply(JSON.parse(line.slice("data: ".length)))
    if (Option.isNone(reply) || reply.value.result.content.length === 0) return []
    return [reply.value.result.content[0].text]
  })
  return texts[0] ?? ""
}

// Exa's text is one block of results separated by "---", each opening with Title, URL and Published lines.
export const parse = (text: string) =>
  text.split("\n---\n").flatMap((block) => {
    const url = block.match(/^URL: (.+)$/m)?.[1]?.trim()
    if (!url) return []
    const title = block.match(/^Title: (.*)$/m)?.[1]?.trim()
    const published = block.match(/^Published: (.+)$/m)?.[1]?.trim()
    const time = published && published !== "N/A" ? Date.parse(published) : Number.NaN
    const content = block.split("\nHighlights:\n")[1]?.trim()
    return [
      compact({
        url,
        title,
        content,
        time: compact({ published: Number.isNaN(time) ? undefined : time }),
      }),
    ]
  })

export const WebsearchHandler = HttpApiBuilder.group(Api, "server.websearch", (handlers) =>
  handlers
    .handle(
      "websearch.providers",
      Effect.fn(function* () {
        const directory = yield* Directory
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(WebSearch.Provider)))({
          location: { directory },
          data: [exa],
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "websearch.query",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const providerID = ctx.payload.providerID ?? exa.id
        if (providerID !== exa.id)
          return yield* new InvalidRequestError({ message: `Unknown web search provider: ${providerID}`, field: "providerID" })
        const query = ctx.payload.query
        const allowed = yield* inInstance(directory, () => permitted(query))
        if (!allowed)
          return yield* new InvalidRequestError({
            message: "Web search is not allowed for this query by the default agent or config",
            kind: "permission",
          })
        const text = yield* Effect.tryPromise({
          try: () => search(query),
          catch: () => new ServiceUnavailableError({ message: "Web search failed", service: exa.id }),
        })
        return yield* Schema.decodeUnknownEffect(Location.response(WebSearch.Response))({
          location: { directory },
          data: { providerID, results: parse(text) },
        }).pipe(Effect.orDie)
      }),
    ),
)
