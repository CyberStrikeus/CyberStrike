import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { PersistentPty } from "@opencode/schema/persistent-pty"
import { PtyTicket } from "@opencode/schema/pty-ticket"
import {
  ForbiddenError,
  InvalidRequestError,
  PtyNotFoundError,
  ServiceUnavailableError,
} from "@opencode/protocol/errors"
import { Persistent } from "../../pty/persistent"
import { sessionDirectory } from "../lookup"
import { Tickets } from "../tickets"

// Encodes a domain value through the upstream schema, so the wire shape is the declared one or a defect.
const wire = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
  Schema.encodeUnknownEffect(schema)(value).pipe(Effect.orDie)

const missing = (ptyID: string) => new PtyNotFoundError({ ptyID, message: `PTY not found: ${ptyID}` })

// Persistent terminals are scoped by what they were created in (the session's directory), so no location middleware
// applies. Every call that touches a terminal resolves its directory from the terminal's own record.
export const ExperimentalHandler = HttpApiBuilder.group(Api, "server.experimental", (handlers) =>
  handlers
    .handle(
      "persistentPty.read",
      Effect.fn(function* (ctx) {
        const found = yield* Effect.promise(() => Persistent.read(ctx.params.sessionID, ctx.query.lines))
        return HttpServerResponse.jsonUnsafe({ data: found ? yield* wire(PersistentPty.ReadResult, found) : null })
      }),
    )
    .handle(
      "persistentPty.list",
      Effect.fn(function* (ctx) {
        const found = yield* Effect.promise(() => Persistent.list(ctx.params.sessionID))
        return HttpServerResponse.jsonUnsafe({ data: yield* wire(Schema.Array(PersistentPty.Info), found) })
      }),
    )
    .handle(
      "persistentPty.create",
      Effect.fn(function* (ctx) {
        const directory = yield* sessionDirectory(ctx.params.sessionID)
        if (!directory)
          return yield* new InvalidRequestError({
            message: `Session not found: ${ctx.params.sessionID}`,
            field: "sessionID",
          })
        const created = yield* Effect.promise(() => Persistent.create(ctx.params.sessionID, directory, ctx.payload))
        if (!created)
          return yield* new ServiceUnavailableError({
            message: "Terminal exited before it was registered",
            service: "pty",
          })
        return HttpServerResponse.jsonUnsafe({ data: yield* wire(PersistentPty.Info, created) })
      }),
    )
    .handle(
      "persistentPty.shutdown",
      Effect.fn(function* () {
        yield* Effect.promise(() => Persistent.shutdown())
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "persistentPty.handoff",
      Effect.fn(function* () {
        const entry = yield* Effect.promise(() => Persistent.handoff())
        if (!entry) return HttpServerResponse.jsonUnsafe({ handoff: null })
        const token = (yield* Tickets).issue(entry.id, entry.directory)
        const handoff = {
          directory: entry.directory,
          instanceID: Persistent.instanceID,
          ticket: token.ticket,
          expiresAt: Date.now() + token.expires_in * 1000,
        }
        return HttpServerResponse.jsonUnsafe({ handoff: yield* wire(PersistentPty.Handoff, handoff) })
      }),
    )
    .handle(
      "persistentPty.get",
      Effect.fn(function* (ctx) {
        const found = yield* Effect.promise(() => Persistent.get(ctx.params.ptyID))
        if (!found) return yield* missing(ctx.params.ptyID)
        return HttpServerResponse.jsonUnsafe({ data: yield* wire(PersistentPty.Info, found) })
      }),
    )
    .handle(
      "persistentPty.update",
      Effect.fn(function* (ctx) {
        // The payload's attachmentID is not modelled: a resize is the only update the terminal accepts.
        const found = yield* Effect.promise(() => Persistent.update(ctx.params.ptyID, ctx.payload.size))
        if (!found) return yield* missing(ctx.params.ptyID)
        return HttpServerResponse.jsonUnsafe({ data: yield* wire(PersistentPty.Info, found) })
      }),
    )
    .handle(
      "persistentPty.snapshot",
      Effect.fn(function* (ctx) {
        const found = yield* Effect.promise(() => Persistent.snapshot(ctx.params.ptyID))
        if (!found) return yield* missing(ctx.params.ptyID)
        return HttpServerResponse.jsonUnsafe({ data: yield* wire(PersistentPty.Snapshot, found) })
      }),
    )
    .handle(
      "persistentPty.remove",
      Effect.fn(function* (ctx) {
        const removed = yield* Effect.promise(() => Persistent.remove(ctx.params.ptyID))
        if (!removed) return yield* missing(ctx.params.ptyID)
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "persistentPty.connectToken",
      Effect.fn(function* (ctx) {
        if (ctx.headers["x-opencode-ticket"] !== "1")
          return yield* new ForbiddenError({ message: "Ticket header required" })
        const entry = Persistent.record(ctx.params.ptyID)
        const live = entry && (yield* Effect.promise(() => Persistent.exists(ctx.params.ptyID)))
        if (!entry || !live) return yield* missing(ctx.params.ptyID)
        const token = (yield* Tickets).issue(entry.id, entry.directory)
        return HttpServerResponse.jsonUnsafe({ data: yield* wire(PtyTicket.ConnectToken, token) })
      }),
    )
    .handle(
      "persistentPty.connect",
      Effect.fn(function* (ctx) {
        const live = yield* Effect.promise(() => Persistent.exists(ctx.params.ptyID))
        if (!live) return yield* missing(ctx.params.ptyID)
        // Upgrades are answered by server.ts before routing, so only a plain request reaches this handler.
        return HttpServerResponse.text("WebSocket upgrade required", { status: 426 })
      }),
    ),
)
