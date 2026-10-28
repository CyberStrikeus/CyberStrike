import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const CommandHandler = HttpApiBuilder.group(Api, "server.command", (handlers) =>
  handlers
    .handle("command.list", () => unavailable)
)
