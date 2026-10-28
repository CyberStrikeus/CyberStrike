import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Location } from "@opencode/schema/location"
import { Mcp } from "@opencode/schema/mcp"
import { McpServerNotFoundError } from "@opencode/protocol/errors"
import { MCP } from "../../mcp"
import { Config } from "../../config/config"
import { inInstance } from "../instance"
import { unavailable } from "./stub"

type Server = typeof Mcp.ServerConfig.Type
type Status = Awaited<ReturnType<typeof MCP.status>>[string]

// The v1 config has no cwd, codemode, protocol, or split timeouts, and no OAuth callback settings. Those are refused
// instead of dropped, so a saved config never differs from the one the client sent.
const unsupported = (config: Server) => {
  const shared = {
    protocol: config.protocol,
    codemode: config.codemode,
    "timeout.startup": config.timeout?.startup,
    "timeout.catalog": config.timeout?.catalog,
  }
  const specific =
    config.type === "local"
      ? { cwd: config.cwd }
      : config.oauth
        ? {
            "oauth.callback_port": config.oauth.callback_port,
            "oauth.redirect_uri": config.oauth.redirect_uri,
            "oauth.auth_server_metadata_url": config.oauth.auth_server_metadata_url,
          }
        : {}
  return Object.entries({ ...shared, ...specific })
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field)
}

const toConfig = (config: Server): Config.Mcp => {
  const timeout = config.timeout?.execution
  if (config.type === "local")
    return {
      type: "local",
      command: [...config.command],
      environment: config.environment,
      enabled: config.disabled === undefined ? undefined : !config.disabled,
      timeout,
    }
  const oauth = config.oauth
  return {
    type: "remote",
    url: config.url,
    headers: config.headers,
    enabled: config.disabled === undefined ? undefined : !config.disabled,
    timeout,
    oauth:
      oauth === undefined || oauth === false
        ? oauth
        : { clientId: oauth.client_id, clientSecret: oauth.client_secret, scope: oauth.scope },
  }
}

// The v1 status has no pending state, and needs_auth carries no message. needs_client_registration needs the same
// user action as needs_auth, so it reports as needs_auth with the v1 error text.
const toStatus = (status: Status) => {
  if (status.status === "failed") return { status: "failed" as const, error: status.error }
  if (status.status === "needs_auth") return { status: "needs_auth" as const, error: "Authentication required" }
  if (status.status === "needs_client_registration") return { status: "needs_auth" as const, error: status.error }
  return { status: status.status }
}

const configured = (directory: string, server: string) =>
  inInstance(directory, async () => Object.hasOwn(await MCP.status(), server))

export const McpHandler = HttpApiBuilder.group(Api, "server.mcp", (handlers) =>
  handlers
    .handle(
      "mcp.list",
      Effect.fn(function* () {
        const directory = yield* Directory
        const statuses = yield* inInstance(directory, () => MCP.status())
        const data = Object.entries(statuses).map(([name, status]) => ({ name, status: toStatus(status) }))
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(Mcp.Server)))({
          location: { directory },
          data,
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "mcp.add",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const server = ctx.params.server
        const fields = unsupported(ctx.payload.config)
        if (fields.length > 0)
          return HttpServerResponse.jsonUnsafe(
            { _tag: "InvalidRequestError", message: `Unsupported MCP config fields: ${fields.join(", ")}` },
            { status: 400 },
          )
        const config = toConfig(ctx.payload.config)
        yield* inInstance(directory, async () => {
          await MCP.add(server, config)
          await Config.updateGlobal({ mcp: { [server]: config } })
        })
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "mcp.remove",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const server = ctx.params.server
        if (!(yield* configured(directory, server)))
          return yield* new McpServerNotFoundError({ server, message: `MCP server not found: ${server}` })
        yield* inInstance(directory, async () => {
          await MCP.remove(server)
          // MCP.remove edits the config files but not the global config cache, so the server would reconnect on the
          // next boot. Refreshing the cache with the file as it now is reloads the config the way add does.
          await Config.updateGlobal({})
        })
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "mcp.connect",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const server = ctx.params.server
        if (!(yield* configured(directory, server)))
          return yield* new McpServerNotFoundError({ server, message: `MCP server not found: ${server}` })
        yield* inInstance(directory, () => MCP.connect(server))
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "mcp.disconnect",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const server = ctx.params.server
        if (!(yield* configured(directory, server)))
          return yield* new McpServerNotFoundError({ server, message: `MCP server not found: ${server}` })
        yield* inInstance(directory, () => MCP.disconnect(server))
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "mcp.resource.catalog",
      Effect.fn(function* () {
        const directory = yield* Directory
        const resources = yield* inInstance(directory, () => MCP.resources())
        // The v1 domain lists resources only; it has no resource-template listing, so templates are always empty.
        const data = {
          resources: Object.values(resources).map((resource) =>
            compact({
              server: resource.client,
              name: resource.name,
              uri: resource.uri,
              description: resource.description,
              mimeType: resource.mimeType,
            }),
          ),
          templates: [],
        }
        return yield* Schema.decodeUnknownEffect(Location.response(Mcp.ResourceCatalog))({
          location: { directory },
          data,
        }).pipe(Effect.orDie)
      }),
    )
    // No v1 backing: the v1 server has no client-hosted MCP token or socket.
    .handle("mcp.clientToken", () => unavailable)
    .handle("mcp.client", () => unavailable),
)
