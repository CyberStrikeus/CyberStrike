import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import os from "node:os"
import { Installation } from "../../installation"
import { unavailable } from "./stub"

export const ServerHandler = HttpApiBuilder.group(Api, "server.server", (handlers) =>
  handlers
    .handle("server.info", () =>
      Effect.succeed({ version: Installation.VERSION, pid: process.pid, urls: [], paths: { tmp: os.tmpdir() } }),
    )
    .handle("server.pair", () => unavailable)
    .handle("server.connect", () => unavailable)
)
