import { Effect, Schema } from "effect"
import { Config as WireConfig } from "@opencode/schema/config"
import { ConfigShell } from "@opencode/schema/config/shell"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import path from "node:path"
import { Config } from "../../config/config"
import { Shell } from "../../shell/shell"
import { inInstance } from "../instance"

export const ConfigHandler = HttpApiBuilder.group(Api, "server.config", (handlers) =>
  handlers
    .handle(
      "config.get",
      Effect.fn(function* () {
        const directory = yield* Directory
        const config = yield* inInstance(directory, () => Config.get())
        // Expose the effective document, not provider credentials or CyberStrike-only settings.
        return yield* Schema.decodeUnknownEffect(Schema.Array(WireConfig.Entry))([
          {
            type: "document",
            info: compact({
              model: config.model,
              default_agent: config.default_agent,
              username: config.username,
              share: config.share,
              snapshots: config.snapshot,
            }),
          },
        ]).pipe(Effect.orDie)
      }),
    )
    .handle(
      "config.shells",
      Effect.fn(function* () {
        // v1 has no shell catalogue; the shell the agent's bash tool uses is the only one it can vouch for.
        const shell = Shell.acceptable()
        return yield* Schema.decodeUnknownEffect(Schema.Array(ConfigShell.Option))([
          { path: shell, name: path.basename(shell), acceptable: true },
        ]).pipe(Effect.orDie)
      }),
    )
    .handle(
      "config.update",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        // The v1 config has no unset marker, so a null shell removes the key.
        const shell = ctx.payload.shell ?? undefined
        yield* inInstance(directory, () => Config.updateGlobal({ shell }))
        return HttpServerResponse.empty({ status: 204 })
      }),
    ),
)
