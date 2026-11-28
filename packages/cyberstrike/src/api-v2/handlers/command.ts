import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Command as WireCommand } from "@opencode/schema/command"
import { Location } from "@opencode/schema/location"
import { Command } from "../../command"
import { inInstance } from "../instance"

export const CommandHandler = HttpApiBuilder.group(Api, "server.command", (handlers) =>
  handlers.handle(
    "command.list",
    Effect.fn(function* () {
      const directory = yield* Directory
      const commands = yield* inInstance(directory, () => Command.list())
      // The v1 template and hints are internal; the wire shape carries only the name and description.
      const data = commands.map((command) => compact({ name: command.name, description: command.description }))
      return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(WireCommand.Info)))({
        location: { directory },
        data,
      }).pipe(Effect.orDie)
    }),
  ),
)
