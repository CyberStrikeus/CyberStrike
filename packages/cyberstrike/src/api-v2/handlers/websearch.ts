import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const WebsearchHandler = HttpApiBuilder.group(Api, "server.websearch", (handlers) =>
  handlers
    .handle("websearch.providers", () => unavailable)
    .handle("websearch.query", () => unavailable)
)
