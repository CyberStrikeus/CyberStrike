import { Effect, Schema } from "effect"
import { Config as WireConfig } from "@opencode/schema/config"
import { HttpApiBuilder } from "effect/http-api"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Config } from "../../config/config"
import { inInstance } from "../instance"
import { unavailable } from "./stub"

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
    .handle("config.shells", () => unavailable)
    .handle("config.update", () => unavailable),
)
