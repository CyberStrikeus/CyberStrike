import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle("credential.list", () => unavailable)
    .handle("credential.create", () => unavailable)
    .handle("credential.update", () => unavailable)
    .handle("credential.activate", () => unavailable)
    .handle("credential.remove", () => unavailable)
)
