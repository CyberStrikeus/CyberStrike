import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const VoiceHandler = HttpApiBuilder.group(Api, "server.voice", (handlers) =>
  handlers
    .handle("voice.models", () => unavailable)
    .handle("voice.session", () => unavailable)
    .handle("voice.instructions", () => unavailable)
)
