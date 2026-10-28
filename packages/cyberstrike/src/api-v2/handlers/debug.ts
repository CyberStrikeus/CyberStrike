import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const DebugHandler = HttpApiBuilder.group(Api, "server.debug", (handlers) =>
  handlers
    .handle("debug.heapDump", () => unavailable)
    .handle("debug.location", () => unavailable)
    .handle("debug.location.evict", () => unavailable)
)
