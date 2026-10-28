import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const GenerateHandler = HttpApiBuilder.group(Api, "server.generate", (handlers) =>
  handlers
    .handle("generate.text", () => unavailable)
)
