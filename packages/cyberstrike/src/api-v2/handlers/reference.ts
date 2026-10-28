import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Location } from "@opencode/schema/location"
import { Reference } from "@opencode/schema/reference"
import path from "node:path"
import { Config } from "../../config/config"
import { inInstance } from "../instance"

export const ReferenceHandler = HttpApiBuilder.group(Api, "server.reference", (handlers) =>
  handlers.handle(
    "reference.list",
    Effect.fn(function* () {
      const directory = yield* Directory
      const config = yield* inInstance(directory, () => Config.get())
      // Local references only: the v1 config has no git source, and this server does not clone repositories.
      const data = Object.entries(config.references ?? {}).map(([name, reference]) => {
        const target = path.resolve(directory, reference.path)
        return compact({
          name,
          path: target,
          description: reference.description,
          hidden: reference.hidden,
          source: { type: "local" as const, path: target },
        })
      })
      return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(Reference.Info)))({
        location: { directory },
        data,
      }).pipe(Effect.orDie)
    }),
  ),
)
