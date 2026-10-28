import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Vcs } from "../../project/vcs"
import { inInstance } from "../instance"
import { unavailable } from "./stub"

export const VcsHandler = HttpApiBuilder.group(Api, "server.vcs", (handlers) =>
  handlers
    .handle("vcs.init", () => unavailable)
    .handle("vcs.get", () => unavailable)
    .handle("vcs.base", () => unavailable)
    .handle(
      "vcs.status",
      Effect.fn(function* () {
        const directory = yield* Directory
        const branch = yield* inInstance(directory, () => Vcs.branch())
        // Answered as plain JSON until the status projection lands; the contract only needs a JSON body.
        return HttpServerResponse.jsonUnsafe({ branch: branch ?? null })
      }),
    )
    .handle("vcs.branch.list", () => unavailable)
    .handle("vcs.diff", () => unavailable),
)
