import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Credential } from "@opencode/schema/credential"
import { Api } from "@cyberstrike-io/api-v2"
import { Credentials } from "../../auth/credentials"
import { notFound } from "../lookup"

const missing = (id: string) => notFound("CredentialNotFoundError", `Credential not found: ${id}`)

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle(
      "credential.list",
      Effect.fn(function* () {
        const rows = yield* Effect.promise(() => Credentials.list())
        return { data: yield* Schema.decodeUnknownEffect(Schema.Array(Credential.Entry))(rows).pipe(Effect.orDie) }
      }),
    )
    .handle(
      "credential.create",
      Effect.fn(function* (ctx) {
        const entry = yield* Effect.promise(() => Credentials.create(ctx.payload))
        if (!entry)
          return HttpServerResponse.jsonUnsafe(
            { _tag: "ConflictError", message: `Credential already exists: ${ctx.payload.id}`, resource: "credential" },
            { status: 409 },
          )
        return { data: yield* Schema.decodeUnknownEffect(Credential.Entry)(entry).pipe(Effect.orDie) }
      }),
    )
    .handle(
      "credential.update",
      Effect.fn(function* (ctx) {
        const found = yield* Effect.promise(() => Credentials.update(ctx.params.credentialID, ctx.payload.label))
        if (!found) return missing(ctx.params.credentialID)
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "credential.activate",
      Effect.fn(function* (ctx) {
        const found = yield* Effect.promise(() => Credentials.activate(ctx.params.credentialID))
        if (!found) return missing(ctx.params.credentialID)
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "credential.remove",
      Effect.fn(function* (ctx) {
        // Removing an unknown credential is a no-op, so the endpoint stays idempotent like its 204 contract.
        yield* Effect.promise(() => Credentials.remove(ctx.params.credentialID))
        return HttpServerResponse.empty({ status: 204 })
      }),
    ),
)
