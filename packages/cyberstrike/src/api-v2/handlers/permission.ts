import { Effect, Schema } from "effect"
import { Permission } from "@opencode/schema/permission"
import { Location } from "@opencode/schema/location"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { projectPermission } from "@cyberstrike-io/api-v2/projection/permission"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { PermissionNext } from "../../permission/next"
import { inInstance } from "../instance"
import { notFound, sessionDirectory } from "../lookup"
import { unavailable } from "./stub"

const pending = () => PermissionNext.list()

// Pending requests of one session. An unknown session has none, which matches upstream's empty answer.
const ofSession = (sessionID: string) =>
  Effect.gen(function* () {
    const directory = yield* sessionDirectory(sessionID)
    if (!directory) return []
    const rows = yield* inInstance(directory, pending)
    return rows.filter((row) => row.sessionID === sessionID)
  })

export const PermissionHandler = HttpApiBuilder.group(Api, "server.permission", (handlers) =>
  handlers
    .handle(
      "permission.request.list",
      Effect.fn(function* () {
        const directory = yield* Directory
        const rows = yield* inInstance(directory, pending)
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(Permission.Request)))({
          location: { directory },
          data: rows.map(projectPermission),
        }).pipe(Effect.orDie)
      }),
    )
    .handle("permission.saved.list", () => unavailable)
    .handle("permission.saved.update", () => unavailable)
    .handle("permission.saved.remove", () => unavailable)
    .handle("session.permission.create", () => unavailable)
    .handle(
      "session.permission.list",
      Effect.fn(function* (ctx) {
        const rows = yield* ofSession(ctx.params.sessionID)
        return {
          data: yield* Schema.decodeUnknownEffect(Schema.Array(Permission.Request))(rows.map(projectPermission)).pipe(
            Effect.orDie,
          ),
        }
      }),
    )
    .handle(
      "session.permission.get",
      Effect.fn(function* (ctx) {
        const rows = yield* ofSession(ctx.params.sessionID)
        const found = rows.find((row) => row.id === ctx.params.requestID)
        if (!found) return notFound("PermissionNotFoundError", `Permission request not found: ${ctx.params.requestID}`)
        return {
          data: yield* Schema.decodeUnknownEffect(Permission.Request)(projectPermission(found)).pipe(Effect.orDie),
        }
      }),
    )
    .handle(
      "session.permission.reply",
      Effect.fn(function* (ctx) {
        const requestID = ctx.params.requestID
        const rows = yield* ofSession(ctx.params.sessionID)
        const found = rows.find((row) => row.id === requestID)
        if (!found) return notFound("PermissionNotFoundError", `Permission request not found: ${requestID}`)
        const directory = yield* sessionDirectory(ctx.params.sessionID)
        yield* inInstance(directory ?? process.cwd(), () =>
          PermissionNext.reply({ requestID, reply: ctx.payload.decision, message: ctx.payload.message }),
        )
        return HttpServerResponse.empty({ status: 204 })
      }),
    ),
)
