import { stat } from "node:fs/promises"
import { Context, Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Etag, HttpRouter, HttpServerRequest } from "effect/http"
import { NodeHttpPlatform, NodeServices } from "@effect/platform-node"
import { Api } from "@cyberstrike-io/api-v2"
import { Flag } from "../flag/flag"
import { Pty } from "../pty"
import { Persistent } from "../pty/persistent"
import { handlers } from "./handlers"
import { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"
import { inInstance } from "./instance"
import { PeerAddress, authorizationLayer, schemaErrorLayer, webAuthorized } from "./middleware"
import { directoryOf, locationLayers } from "./directory"
import { Tickets, tickets } from "./tickets"

// The terminal socket: the Bun side keeps the v1 Pty handler and the scope it was opened in.
type Terminal = { onMessage(data: string): void; onClose(): void }
type Socket = { id: string; directory: string; cursor?: number; persistent: boolean; terminal?: Terminal }

const PTY_CONNECT = /^\/api\/pty\/([^/]+)\/connect$/
const PERSISTENT_CONNECT = /^\/api\/experimental\/persistent-pty\/([^/]+)\/connect$/

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

// Same parsing the v1 route uses: a safe integer no lower than -1, anything else is ignored.
const cursorOf = (value: string | null) => {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < -1) return undefined
  return parsed
}

// Mounts only the v2 Api, plus the terminal upgrade. Nothing from the v1 Hono app is reachable here.
export async function listen(opts: { hostname: string; port: number; password?: string }) {
  const password = opts.password ?? Flag.CYBERSTRIKE_SERVER_PASSWORD
  const username = Flag.CYBERSTRIKE_SERVER_USERNAME ?? "cyberstrike"
  const tokens = tickets()
  const routes = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers),
    Layer.provide(Layer.succeed(Tickets, tokens)),
    Layer.provide(authorizationLayer(username, password)),
    Layer.provide(schemaErrorLayer),
    Layer.provide(locationLayers),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeHttpPlatform.layer, Etag.layer)),
  )
  const app = HttpRouter.toWebHandler(routes, { disableLogger: true })
  // Boots the working directory's instance and loads the catalogs before the first request. On a cold start each of
  // these takes several seconds, which is longer than a client waits for its first answer.
  await Effect.runPromise(
    inInstance(process.cwd(), async () => {
      await Agent.list()
      await Provider.list()
      await Config.get()
    }),
  )

  // A persistent terminal is scoped by the directory it was created in, not by the request.
  const upgradeTerminal = async (request: Request, bun: Bun.Server<Socket>, id: string, persistent: boolean) => {
    const url = new URL(request.url)
    const directory =
      (persistent && Persistent.record(id)?.directory) || directoryOf(HttpServerRequest.fromWeb(request))
    const ticket = url.searchParams.get("ticket")
    if (ticket !== null && !tokens.consume(ticket, id, directory))
      return json(403, { _tag: "ForbiddenError", message: "Invalid or expired ticket" })
    if (ticket === null && !webAuthorized(request, bun.requestIP(request)?.address, username, password))
      return json(401, { _tag: "UnauthorizedError", message: "Authentication required" })
    const isDirectory = await stat(directory).then(
      (s) => s.isDirectory(),
      () => false,
    )
    if (!isDirectory)
      return json(404, {
        _tag: "LocationNotFoundError",
        location: { directory },
        message: `Directory not found: ${directory}`,
      })
    const found = persistent
      ? await Persistent.exists(id)
      : await Effect.runPromise(inInstance(directory, () => Pty.get(id)))
    if (!found) return json(404, { _tag: "PtyNotFoundError", message: `PTY not found: ${id}` })
    const cursor = cursorOf(new URL(request.url).searchParams.get("cursor"))
    if (bun.upgrade(request, { data: { id, directory, cursor, persistent } })) return undefined
    return json(400, { _tag: "InvalidRequestError", message: "websocket upgrade failed" })
  }

  const server = Bun.serve<Socket>({
    hostname: opts.hostname,
    port: opts.port,
    idleTimeout: 0,
    fetch: (request, bun) => {
      const pathname = new URL(request.url).pathname
      const match = PTY_CONNECT.exec(pathname) ?? PERSISTENT_CONNECT.exec(pathname)
      if (match && request.headers.get("upgrade")?.toLowerCase() === "websocket")
        return upgradeTerminal(request, bun, match[1], PERSISTENT_CONNECT.test(pathname))
      // The peer is optional per request; the auth middleware reads it with serviceOption, so the type stays open.
      return app.handler(
        request,
        Context.make(PeerAddress, bun.requestIP(request)?.address) as Context.Context<unknown>,
      )
    },
    websocket: {
      open: async (ws) => {
        const { id, directory, cursor, persistent } = ws.data
        ws.data.terminal = persistent
          ? await Persistent.connect(id, ws, cursor)
          : await Effect.runPromise(inInstance(directory, () => Pty.connect(id, ws, cursor)))
      },
      message: (ws, message) => {
        ws.data.terminal?.onMessage(String(message))
      },
      close: (ws) => {
        ws.data.terminal?.onClose()
      },
    },
  })
  return {
    url: server.url,
    stop: async () => {
      await server.stop(true)
      await app.dispose()
    },
  }
}
