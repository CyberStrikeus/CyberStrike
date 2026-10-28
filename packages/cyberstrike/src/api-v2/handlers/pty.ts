import { Effect, Schema } from "effect"
import { Location } from "@opencode/schema/location"
import { PtyTicket } from "@opencode/schema/pty-ticket"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Pty } from "../../pty"
import { inInstance } from "../instance"
import { notFound } from "../lookup"
import { ForbiddenError } from "@opencode/protocol/errors"
import { Tickets } from "../tickets"
import { unavailable } from "./stub"

// The terminal itself is served by the native WebSocket upgrade in server.ts, ahead of Effect routing.
export const PtyHandler = HttpApiBuilder.group(Api, "server.pty", (handlers) =>
  handlers
    .handle(
      "pty.list",
      Effect.fn(function* () {
        const directory = yield* Directory
        return HttpServerResponse.jsonUnsafe({ data: yield* inInstance(directory, () => Pty.list()) })
      }),
    )
    .handle(
      "pty.create",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const input = { ...ctx.payload, args: ctx.payload.args && [...ctx.payload.args] }
        const info = yield* inInstance(directory, () => Pty.create(input))
        return HttpServerResponse.jsonUnsafe({ data: info })
      }),
    )
    .handle(
      "pty.get",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const info = yield* inInstance(directory, () => Pty.get(ctx.params.ptyID))
        if (!info) return notFound("PtyNotFoundError", `PTY not found: ${ctx.params.ptyID}`)
        return HttpServerResponse.jsonUnsafe({ data: info })
      }),
    )
    .handle(
      "pty.update",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const info = yield* inInstance(directory, () => Pty.update(ctx.params.ptyID, ctx.payload))
        if (!info) return notFound("PtyNotFoundError", `PTY not found: ${ctx.params.ptyID}`)
        return HttpServerResponse.jsonUnsafe({ data: info })
      }),
    )
    .handle(
      "pty.remove",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        yield* inInstance(directory, () => Pty.remove(ctx.params.ptyID))
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "pty.connectToken",
      Effect.fn(function* (ctx) {
        if (ctx.headers["x-opencode-ticket"] !== "1")
          return yield* new ForbiddenError({ message: "Ticket header required" })
        const directory = yield* Directory
        const info = yield* inInstance(directory, () => Pty.get(ctx.params.ptyID))
        if (!info) return notFound("PtyNotFoundError", `PTY not found: ${ctx.params.ptyID}`)
        return yield* Schema.decodeUnknownEffect(Location.response(PtyTicket.ConnectToken))({
          location: { directory },
          data: (yield* Tickets).issue(info.id, directory),
        }).pipe(Effect.orDie)
      }),
    )
    .handle("pty.connect", () => unavailable),
)
