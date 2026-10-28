import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const IntegrationHandler = HttpApiBuilder.group(Api, "server.integration", (handlers) =>
  handlers
    .handle("integration.list", () => unavailable)
    .handle("integration.get", () => unavailable)
    .handle("integration.wellknown.add", () => unavailable)
    .handle("integration.connect.key", () => unavailable)
    .handle("integration.connect.external", () => unavailable)
    .handle("integration.oauth.connect", () => unavailable)
    .handle("integration.oauth.status", () => unavailable)
    .handle("integration.oauth.complete", () => unavailable)
    .handle("integration.oauth.cancel", () => unavailable)
    .handle("integration.command.connect", () => unavailable)
    .handle("integration.command.status", () => unavailable)
    .handle("integration.command.cancel", () => unavailable)
)
