import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const ExperimentalHandler = HttpApiBuilder.group(Api, "server.experimental", (handlers) =>
  handlers
    .handle("persistentPty.read", () => unavailable)
    .handle("persistentPty.list", () => unavailable)
    .handle("persistentPty.create", () => unavailable)
    .handle("persistentPty.shutdown", () => unavailable)
    .handle("persistentPty.handoff", () => unavailable)
    .handle("persistentPty.get", () => unavailable)
    .handle("persistentPty.update", () => unavailable)
    .handle("persistentPty.snapshot", () => unavailable)
    .handle("persistentPty.remove", () => unavailable)
    .handle("persistentPty.connectToken", () => unavailable)
    .handle("persistentPty.connect", () => unavailable)
)
