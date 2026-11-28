import { Effect, Schema } from "effect"
import { Agent as WireAgent } from "@opencode/schema/agent"
import { HttpApiBuilder } from "effect/http-api"
import { Location } from "@opencode/schema/location"
import { AgentNotFoundError } from "@opencode/protocol/errors"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Agent } from "../../agent/agent"
import { inInstance } from "../instance"

const wire = (agent: Agent.Info) =>
  compact({
    id: agent.name,
    name: agent.name,
    description: agent.description,
    mode: agent.mode,
    hidden: agent.hidden ?? false,
    color: agent.color,
    steps: agent.steps,
    model: agent.model && { id: agent.model.modelID, providerID: agent.model.providerID },
    request: { settings: {}, headers: {}, body: {} },
    permissions: agent.permission.map((rule) => ({
      action: rule.permission,
      resource: rule.pattern,
      effect: rule.action,
    })),
  })

export const AgentHandler = HttpApiBuilder.group(Api, "server.agent", (handlers) =>
  handlers
    .handle(
      "agent.list",
      Effect.fn(function* () {
        const directory = yield* Directory
        const agents = yield* inInstance(directory, () => Agent.list())
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(WireAgent.Info)))({
          location: { directory },
          data: agents.map(wire),
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "agent.get",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const agentID = ctx.params.agentID
        const agent = yield* inInstance(directory, () => Agent.get(agentID))
        if (!agent) return yield* new AgentNotFoundError({ agentID, message: `Agent not found: ${agentID}` })
        return yield* Schema.decodeUnknownEffect(Location.response(WireAgent.Info))({
          location: { directory },
          data: wire(agent),
        }).pipe(Effect.orDie)
      }),
    ),
)
