import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Location } from "@opencode/schema/location"
import { Shell } from "@opencode/schema/shell"
import { ShellNotFoundError } from "@opencode/protocol/errors"
import { Registry } from "../../shell/registry"
import { inInstance } from "../instance"

const wire = (entry: Registry.Entry) => ({
  id: entry.id,
  status: entry.status,
  command: entry.command,
  cwd: entry.cwd,
  shell: entry.shell,
  file: entry.file,
  ...(entry.pid === undefined ? {} : { pid: entry.pid }),
  ...(entry.exit === undefined ? {} : { exit: entry.exit }),
  ...(entry.signal === undefined ? {} : { signal: entry.signal }),
  metadata: entry.metadata,
  time: {
    started: entry.started,
    ...(entry.completed === undefined ? {} : { completed: entry.completed }),
  },
})

export const ShellHandler = HttpApiBuilder.group(Api, "server.shell", (handlers) =>
  handlers
    .handle(
      "shell.list",
      Effect.fn(function* () {
        const directory = yield* Directory
        const entries = yield* inInstance(directory, () => Registry.list())
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(Shell.Info)))({
          location: { directory },
          data: entries.map(wire),
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "shell.create",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const entry = yield* inInstance(directory, () =>
          Registry.start({
            argv: Registry.shell(ctx.payload.command),
            cwd: ctx.payload.cwd,
            timeout: ctx.payload.timeout,
            metadata: ctx.payload.metadata,
          }),
        )
        return yield* Schema.decodeUnknownEffect(Location.response(Shell.Info))({
          location: { directory },
          data: wire(entry),
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "shell.get",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const id = ctx.params.id
        const entry = yield* inInstance(directory, () => Registry.get(id))
        if (!entry) return yield* new ShellNotFoundError({ id, message: `Shell command not found: ${id}` })
        return yield* Schema.decodeUnknownEffect(Location.response(Shell.Info))({
          location: { directory },
          data: wire(entry),
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "shell.output",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const id = ctx.params.id
        const page = yield* inInstance(directory, () =>
          Registry.output(id, ctx.query.cursor, ctx.query.limit),
        )
        if (!page) return yield* new ShellNotFoundError({ id, message: `Shell command not found: ${id}` })
        return yield* Schema.decodeUnknownEffect(Location.response(Shell.Output))({
          location: { directory },
          data: { ...page, truncated: page.cursor < page.size },
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "shell.remove",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        // The protocol declares no not-found error for remove, so an unknown id is the same as a removed one.
        yield* inInstance(directory, () => Registry.remove(ctx.params.id))
        return HttpServerResponse.empty({ status: 204 })
      }),
    ),
)
