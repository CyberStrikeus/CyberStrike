import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { InvalidRequestError, UnknownError } from "@opencode/protocol/errors"
import { Location } from "@opencode/schema/location"
import { writeHeapSnapshot } from "node:v8"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { directoryOf } from "../directory"
import { inInstance } from "../instance"

export const DebugHandler = HttpApiBuilder.group(Api, "server.debug", (handlers) =>
  handlers
    .handle(
      "debug.heapDump",
      Effect.fn(function* (ctx) {
        const directory = ctx.query.directory ?? Global.Path.log
        if (!path.isAbsolute(directory))
          return yield* new InvalidRequestError({ message: "directory must be an absolute path" })
        const file = yield* Effect.tryPromise({
          try: async () => {
            await mkdir(directory, { recursive: true })
            return writeHeapSnapshot(path.join(directory, `heap-${Date.now()}.heapsnapshot`))
          },
          catch: (error) => new UnknownError({ message: error instanceof Error ? error.message : String(error) }),
        })
        return { path: file, pid: process.pid, memory: process.memoryUsage() }
      }),
    )
    .handle(
      "debug.location",
      Effect.fn(function* () {
        // Only absolute directories can be locations, so a relative cache key (from a direct evict) is left out.
        const directories = Instance.directories().filter((directory) => path.isAbsolute(directory))
        return yield* Schema.decodeUnknownEffect(Schema.Array(Location.PublicRef))(
          directories.map((directory) => ({ directory })),
        ).pipe(Effect.orDie)
      }),
    )
    .handle(
      "debug.location.evict",
      Effect.fn(function* () {
        // This group does not carry the location middleware, so the directory is resolved from the request here.
        const request = yield* HttpServerRequest.HttpServerRequest
        const directory = directoryOf(request)
        const isDirectory = yield* Effect.promise(() => stat(directory).then((s) => s.isDirectory(), () => false))
        // A location that does not exist has no cached services, so there is nothing to evict.
        if (isDirectory) yield* inInstance(directory, () => Instance.dispose())
        return HttpServerResponse.empty({ status: 204 })
      }),
    ),
)
