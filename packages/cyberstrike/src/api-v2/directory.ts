import { stat } from "node:fs/promises"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/http"
import { LocationNotFoundError } from "@opencode/protocol/errors"
import type { Location } from "@opencode/schema/location"

type PublicRef = typeof Location.PublicRef.Type
import {
  Directory,
  FormLocationMiddleware,
  LocationMiddleware,
  SessionLocationMiddleware,
} from "@cyberstrike-io/api-v2/middleware/location"

// Same precedence the v1 server uses, plus the query forms the v2 surface accepts.
const HEADERS = ["x-opencode-directory", "x-cyberstrike-directory"] as const

const decode = (raw: string) => {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export const directoryOf = (request: HttpServerRequest.HttpServerRequest) => {
  const url = new URL(request.url, "http://localhost")
  const header = HEADERS.map((name) => request.headers[name]).find((value) => value !== undefined)
  const raw =
    url.searchParams.get("location[directory]") ?? url.searchParams.get("directory") ?? header ?? process.cwd()
  return decode(raw)
}

const resolve = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const directory = directoryOf(request)
  const isDirectory = yield* Effect.promise(() => stat(directory).then((s) => s.isDirectory(), () => false))
  if (!isDirectory)
    return yield* new LocationNotFoundError({
      location: { directory: directory as PublicRef["directory"] },
      message: `Directory not found: ${directory}`,
    })
  return directory
})

// Resolves the directory once per request and provides it to the handler as the Directory service.
const scope = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const directory = yield* resolve
    return yield* Effect.provideService(effect, Directory, directory)
  })

export const locationLayers = Layer.mergeAll(
  Layer.succeed(LocationMiddleware, LocationMiddleware.of(scope)),
  Layer.succeed(FormLocationMiddleware, FormLocationMiddleware.of(scope)),
  Layer.succeed(SessionLocationMiddleware, SessionLocationMiddleware.of(scope)),
)
