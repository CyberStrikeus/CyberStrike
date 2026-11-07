import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import path from "node:path"
import { Global } from "../../global"

// The CLI runs the v1 JSON to SQLite migration before it starts the server, and skips it once cyberstrike.db exists.
// Its progress is not kept anywhere this handler can read, so only "required" or "completed" can be reported.
const marker = path.join(Global.Path.data, "cyberstrike.db")

export const MigrationHandler = HttpApiBuilder.group(Api, "server.migration", (handlers) =>
  handlers.handle(
    "migration.v1.status",
    Effect.fn(function* () {
      const exists = yield* Effect.promise(() => Bun.file(marker).exists())
      return { status: exists ? ("completed" as const) : ("required" as const) }
    }),
  ),
)
