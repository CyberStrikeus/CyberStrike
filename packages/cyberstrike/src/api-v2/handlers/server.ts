import { Effect, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { UnauthorizedError } from "@opencode/protocol/errors"
import os from "node:os"
import { Installation } from "../../installation"
import { PeerAddress } from "../middleware"
import { Pairing } from "../pairing"

export const ServerHandler = HttpApiBuilder.group(Api, "server.server", (handlers) =>
  handlers
    .handle("server.info", () =>
      Effect.succeed({ version: Installation.VERSION, pid: process.pid, urls: [], paths: { tmp: os.tmpdir() } }),
    )
    .handle(
      "server.pair",
      Effect.fn(function* () {
        const pairs = yield* Pairing
        return pairs.issue()
      }),
    )
    .handle(
      "server.connect",
      Effect.fn(function* (ctx) {
        const pairs = yield* Pairing
        const peer = Option.getOrUndefined(yield* Effect.serviceOption(PeerAddress)) ?? "unknown"
        if (pairs.limited(peer)) return yield* new UnauthorizedError({ message: "Too many failed attempts" })
        const token = pairs.redeem(ctx.params.code, peer)
        if (token === undefined) return yield* new UnauthorizedError({ message: "Invalid or expired pairing code" })
        return { token }
      }),
    ),
)
