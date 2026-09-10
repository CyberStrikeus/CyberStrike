// Vortex agent tools — the framework-neutral `agentCapabilities` from @cyberstrike-io/vortex,
// adapted into CS Tool.define. This is the ONLY surface a Vortex-consuming agent gets: query the
// corpus, read leads, inspect a transaction, correlate, and http_replay — all over the session's
// Vortex store. (SDK-produced fixed tools; the agent calls them, it doesn't code against the SDK.)
// Import from the "/agent" subpath, NOT the package root: that entry exposes ONLY the sanctioned
// agent surface (forAgent + agentCapabilities + facade types) — never the store, rule engine, or
// send internals. This makes the agent↔Vortex boundary structural and reviewable: agent-facing code
// imports "@cyberstrike-io/vortex/agent"; only the platform assembler (vortex-bridge) imports the
// package root for the full assembly API.
import { agentCapabilities } from "@cyberstrike-io/vortex/agent"
import { Tool } from "./tool"
import { Session } from "../session"
import { vortexApi } from "../session/web/vortex-bridge"

// One CS tool per Vortex capability, EXCEPT the "http_replay" capability — CS already ships a richer
// HttpReplayTool (credential swap / compare / sweep / marker) under the same id, so agents use that
// one for the send/act surface. The store is keyed by the ROOT session (a subagent runs under a
// child session id), matching how http_replay resolves its data.
export const VortexTools: Tool.Info[] = agentCapabilities
  .filter((cap) => cap.name !== "http_replay")
  .map((cap) =>
  Tool.define(cap.name, {
    description: cap.description,
    parameters: cap.input,
    async execute(args, ctx) {
      const sessionID = Session.root(ctx.sessionID)
      const result = await cap.run(vortexApi(sessionID), args)
      return { title: cap.name, metadata: {}, output: typeof result === "string" ? result : JSON.stringify(result, null, 2) }
    },
  }),
)
