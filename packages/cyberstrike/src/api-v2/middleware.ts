import { Context, Effect, Layer, Option, Result } from "effect"
import { HttpApiMiddleware } from "effect/http-api"
import { HttpServerRequest } from "effect/http"
import { Base64 } from "effect/encoding"
import { InvalidRequestError, UnauthorizedError } from "@opencode/protocol/errors"
import { Authorization } from "@opencode/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode/protocol/middleware/schema-error"
import { isPairingConnectURL } from "@opencode/protocol/groups/server"
import { pairing } from "./pairing"

// The Bun listener provides the TCP peer per request, so loopback can be told apart from tunnelled traffic.
export class PeerAddress extends Context.Service<PeerAddress, string | undefined>()("@cyberstrike/api-v2/PeerAddress") {}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])

const basicMatches = (header: string | undefined, username: string, password: string) => {
  const match = /^Basic\s+(.+)$/i.exec(header ?? "")
  if (!match) return false
  const decoded = Base64.decodeString(match[1])
  return Result.isSuccess(decoded) && decoded.success === `${username}:${password}`
}

// The same rules as the Effect middleware below, for the WebSocket upgrade that runs before Effect routing.
export const webAuthorized = (request: Request, address: string | undefined, username: string, password: string | undefined) => {
  if (!password) return true
  const proxied = request.headers.has("x-forwarded-for") || request.headers.has("cf-connecting-ip")
  if (address && LOOPBACK.has(address) && !proxied) return true
  return basicMatches(request.headers.get("authorization") ?? undefined, username, password)
}

const bearerMatches = (header: string | undefined, pairs: ReturnType<typeof pairing>) => {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "")
  return !!match && pairs.valid(match[1])
}

// The pairing redeem route is how a client without credentials gets one, so its code is the only check it needs.
export const authorizationLayer = (username: string, password: string | undefined, pairs: ReturnType<typeof pairing>) =>
  Layer.succeed(
    Authorization,
    Authorization.of((effect) =>
      Effect.gen(function* () {
        if (!password) return yield* effect
        const address = Option.getOrUndefined(yield* Effect.serviceOption(PeerAddress))
        const request = yield* HttpServerRequest.HttpServerRequest
        if (isPairingConnectURL(new URL(request.url, "http://localhost"))) return yield* effect
        const proxied = !!request.headers["x-forwarded-for"] || !!request.headers["cf-connecting-ip"]
        if (address && LOOPBACK.has(address) && !proxied) return yield* effect
        if (basicMatches(request.headers.authorization, username, password)) return yield* effect
        if (bearerMatches(request.headers.authorization, pairs)) return yield* effect
        return yield* new UnauthorizedError({ message: "Authentication required" })
      }),
    ),
  )

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(SchemaErrorMiddleware, (error) =>
  Effect.fail(new InvalidRequestError({ message: error.cause.message.slice(0, 1024), kind: error.kind })),
)
