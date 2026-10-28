import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const ShellHandler = HttpApiBuilder.group(Api, "server.shell", (handlers) =>
  handlers
    .handle("shell.list", () => unavailable)
    .handle("shell.create", () => unavailable)
    .handle("shell.get", () => unavailable)
    .handle("shell.output", () => unavailable)
    .handle("shell.remove", () => unavailable)
)
