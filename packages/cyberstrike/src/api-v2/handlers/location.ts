import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Location } from "@opencode/schema/location"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { inInstance } from "../instance"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  handlers
    .handle(
      "location.get",
      Effect.fn(function* () {
        const directory = yield* Directory
        const current = yield* inInstance(directory, () => ({
          directory: Instance.directory,
          project: Instance.project,
          worktree: Instance.worktree,
        }))
        return yield* Schema.decodeUnknownEffect(Location.Info)({
          directory: current.directory,
          project: { id: current.project.id, directory: current.worktree, canonical: current.worktree },
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "location.reload",
      Effect.fn(function* () {
        // Same reset the v1 worker runs on reload: the global config is re-read and every loaded instance is rebuilt.
        yield* Effect.promise(async () => {
          Config.global.reset()
          await Instance.disposeAll()
        })
        return HttpServerResponse.empty({ status: 204 })
      }),
    ),
)
