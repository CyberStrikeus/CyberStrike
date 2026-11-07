import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Plugin as WirePlugin } from "@opencode/schema/plugin"
import { Location } from "@opencode/schema/location"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { Config } from "../../config/config"
import { Plugin } from "../../plugin"
import { BunProc } from "../../bun"
import { PackageRegistry } from "../../bun/registry"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { inInstance } from "../instance"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// A v1 plugin entry is a file:// URL, or an npm specifier with an optional @version suffix.
const source = (entry: string) => {
  if (entry.startsWith("file://")) return { type: "local" as const, path: fileURLToPath(entry) }
  const at = entry.lastIndexOf("@")
  if (at <= 0) return { type: "package" as const, target: entry }
  return { type: "package" as const, target: entry.slice(0, at), version: entry.slice(at + 1) }
}

const entries = (directory: string) => inInstance(directory, async () => (await Config.get()).plugin ?? [])

// The v1 loader initialises every plugin at once, so one failure marks every entry failed with the same error.
const loadError = (directory: string) =>
  inInstance(directory, () =>
    Plugin.list().then(
      () => undefined,
      (error: unknown) => message(error),
    ),
  )

const packages = (list: string[]) =>
  list.flatMap((entry) => {
    const parsed = source(entry)
    return parsed.type === "package" ? [parsed] : []
  })

// Versions the cache has installed for each package, read from the cache manifest the v1 installer writes.
const cached = () =>
  Bun.file(path.join(Global.Path.cache, "package.json"))
    .json()
    .then((manifest: { dependencies?: Record<string, string> }) => manifest.dependencies ?? {})
    .catch(() => ({}) as Record<string, string>)

const info = (entry: ReturnType<typeof source>, failure: string | undefined, outdated = false) =>
  compact({
    source: entry.type === "package" ? compact({ ...entry, outdated: outdated ? (true as const) : undefined }) : entry,
    features: failure ? {} : { server: true as const },
    state: failure ? { status: "failed" as const, error: failure } : { status: "active" as const },
  })

export const PluginHandler = HttpApiBuilder.group(Api, "server.plugin", (handlers) =>
  handlers
    .handle(
      "plugin.list",
      Effect.fn(function* () {
        const directory = yield* Directory
        const list = yield* entries(directory)
        const failure = yield* loadError(directory)
        const data = list.map((entry) => info(source(entry), failure))
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(WirePlugin.Info)))({
          location: { directory },
          data,
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "plugin.check",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const target = ctx.payload.target
        const selected = packages(yield* entries(directory)).filter((item) => !target || item.target === target)
        if (target && selected.length === 0)
          return yield* new InvalidRequestError({ message: `Plugin not found: ${target}`, field: "target" })
        const versions = yield* Effect.promise(cached)
        const outdated = yield* Effect.promise(() =>
          Promise.all(
            selected.map(async (item) => {
              const version = versions[item.target]
              return version ? PackageRegistry.isOutdated(item.target, version, Global.Path.cache) : false
            }),
          ),
        )
        const failure = yield* loadError(directory)
        const data = selected.map((item, index) => info(item, failure, outdated[index]))
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(WirePlugin.Info)))({
          location: { directory },
          data,
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "plugin.update",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const configured = packages(yield* entries(directory)).map((item) => item.target)
        const unknown = ctx.payload.targets.filter((target) => !configured.includes(target))
        if (unknown.length > 0)
          return yield* new InvalidRequestError({
            message: `Plugin not found: ${unknown.join(", ")}`,
            field: "targets",
          })
        const results = yield* Effect.promise(() =>
          Promise.allSettled(ctx.payload.targets.map((target) => BunProc.install(target, "latest"))),
        )
        const failed = results.flatMap((result, index) =>
          result.status === "rejected" ? [`${ctx.payload.targets[index]}: ${message(result.reason)}`] : [],
        )
        if (failed.length > 0)
          return yield* new ServiceUnavailableError({
            message: `Plugin update failed: ${failed.join("; ")}`,
            service: "plugin",
          })
        // Plugins are initialised per instance, so disposing them makes the next request load the updated packages.
        yield* Effect.promise(() => Instance.disposeAll())
        return HttpServerResponse.empty({ status: 204 })
      }),
    ),
)
