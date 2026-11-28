import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { File } from "../../file"
import { Filesystem } from "../../util/filesystem"
import { inInstance } from "../instance"
import { notFound } from "../lookup"

// A request path may not leave the scoped directory. Anything outside is reported as not found, like a missing file.
const inside = (directory: string, path: string) => {
  const absolute = resolve(directory, path)
  if (!Filesystem.contains(directory, absolute)) return undefined
  return absolute
}

// `fs.read` is a wildcard route, so the file path is the URL remainder after /api/fs/read/.
const readPath = (url: string) => {
  const raw = new URL(url, "http://localhost").pathname.replace(/^\/api\/fs\/read\//, "")
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export const FsHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  handlers
    .handle(
      "fs.read",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const path = readPath(ctx.request.url)
        const absolute = inside(directory, path)
        const file = absolute ? Bun.file(absolute) : undefined
        const exists = file ? yield* Effect.promise(() => file.exists()) : false
        if (!file || !exists) return notFound("FileNotFoundError", `File not found: ${path}`)
        return HttpServerResponse.uint8Array(yield* Effect.promise(() => file.bytes()), {
          contentType: file.type,
        })
      }),
    )
    .handle(
      "fs.list",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const path = ctx.query.path ?? "."
        const absolute = inside(directory, path)
        if (!absolute) return notFound("FileNotFoundError", `Directory not found: ${path}`)
        // A file, or a path that is gone, is a typed not-found; listing it would otherwise fail as a server error.
        const isDirectory = yield* Effect.promise(() =>
          stat(absolute).then(
            (s) => s.isDirectory(),
            () => false,
          ),
        )
        if (!isDirectory) return notFound("FileNotFoundError", `Directory not found: ${path}`)
        // File.list resolves its argument against the instance directory, so it takes the request path, not the absolute one.
        const entries = yield* inInstance(directory, () => File.list(path))
        return HttpServerResponse.jsonUnsafe({ location: { directory }, data: entries })
      }),
    )
    .handle(
      "fs.find",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const results = yield* inInstance(directory, () =>
          File.search({ query: ctx.query.query, limit: ctx.query.limit, type: ctx.query.type }),
        )
        // File.search returns bare paths; directories carry a trailing slash. Wrap each as the v2 entry shape.
        const data = results.map((item) => ({
          path: item.replace(/\/+$/, ""),
          type: item.endsWith("/") ? "directory" : "file",
        }))
        return HttpServerResponse.jsonUnsafe({ location: { directory }, data })
      }),
    )
    .handle(
      "fs.write",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        // Unlike fs.read, the target is not confined to the location; relative paths resolve against it.
        const absolute = resolve(directory, ctx.query.path)
        // Bun.write creates missing parent directories.
        yield* Effect.promise(() => Bun.write(absolute, ctx.payload))
        return HttpServerResponse.jsonUnsafe({ location: { directory }, data: { path: absolute } })
      }),
    ),
)
