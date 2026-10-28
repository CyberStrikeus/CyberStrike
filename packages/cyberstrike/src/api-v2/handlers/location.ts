import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Location } from "@opencode/schema/location"
import { Instance } from "../../project/instance"
import { inInstance } from "../instance"
import { unavailable } from "./stub"

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
    .handle("location.reload", () => unavailable)
)
