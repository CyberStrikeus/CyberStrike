import { Effect, Schema } from "effect"
import { Permission } from "@opencode/schema/permission"
import { PermissionSaved as PermissionSavedSchema } from "@opencode/schema/permission-saved"
import { Location } from "@opencode/schema/location"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { projectPermission } from "@cyberstrike-io/api-v2/projection/permission"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Agent } from "../../agent/agent"
import { Identifier } from "../../id/id"
import { PermissionNext } from "../../permission/next"
import { PermissionSaved } from "../../permission/saved"
import { inInstance } from "../instance"
import { getSession, notFound, sessionDirectory } from "../lookup"

const pending = () => PermissionNext.list()

// Storage row to the encoded wire shape; timestamps stay epoch milliseconds until the schema decodes them.
const savedWire = (row: PermissionSaved.Row) => ({
  id: row.id,
  projectID: row.project_id,
  action: row.action,
  resource: row.resource,
  time: { created: row.time_created, updated: row.time_updated },
})

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
    .handle(
      "permission.saved.list",
      Effect.fn(function* (ctx) {
        const rows = PermissionSaved.list(ctx.query.projectID)
        return {
          data: yield* Schema.decodeUnknownEffect(Schema.Array(PermissionSavedSchema.Info))(rows.map(savedWire)).pipe(
            Effect.orDie,
          ),
        }
      }),
    )
    .handle(
      "permission.saved.update",
      Effect.fn(function* (ctx) {
        const id = ctx.params.id
        const result = PermissionSaved.update(id, ctx.payload)
        if (result === "missing")
          return HttpServerResponse.jsonUnsafe(
            { _tag: "PermissionSavedNotFoundError", id, message: `Saved permission not found: ${id}` },
            { status: 404 },
          )
        if (result === "conflict")
          return HttpServerResponse.jsonUnsafe(
            {
              _tag: "ConflictError",
              message: `Saved permission already exists for this action and resource: ${id}`,
              resource: "permission.saved",
            },
            { status: 409 },
          )
        return {
          data: yield* Schema.decodeUnknownEffect(PermissionSavedSchema.Info)(savedWire(result)).pipe(Effect.orDie),
        }
      }),
    )
    .handle(
      "permission.saved.remove",
      Effect.fn(function* (ctx) {
        PermissionSaved.remove(ctx.params.id)
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "session.permission.create",
      Effect.fn(function* (ctx) {
        const sessionID = ctx.params.sessionID
        const session = yield* getSession(sessionID)
        const body = ctx.payload
        const id = body.id ?? Identifier.ascending("permission")
        const result = yield* inInstance(session.directory, async () => {
          const agent = body.agent ? await Agent.get(body.agent) : undefined
          const ruleset = PermissionNext.merge(agent?.permission ?? [], session.permission ?? [])
          const actions = body.resources.map(
            (resource) => PermissionNext.evaluate(body.action, resource, ruleset).action,
          )
          const effect = actions.includes("deny")
            ? "deny"
            : body.resources.length > 0 && actions.every((action) => action === "allow")
              ? "allow"
              : "ask"
          if (effect !== "ask") return effect
          // The request stays pending until session.permission.reply resolves it, so the create call does not wait on it.
          PermissionNext.ask({
            id,
            sessionID,
            permission: body.action,
            patterns: [...body.resources],
            metadata: body.metadata ?? {},
            always: [...(body.save ?? [])],
            tool: body.source ? { messageID: body.source.messageID, callID: body.source.id } : undefined,
            ruleset,
          }).catch(() => undefined)
          // state is shared with ask, so this resolves only after the request is registered.
          await PermissionNext.list()
          return effect
        })
        return HttpServerResponse.jsonUnsafe({ data: { id, effect: result } })
      }),
    )
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
