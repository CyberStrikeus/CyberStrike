import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { RpcError, RpcInternalError } from "@opencode/protocol/errors"
import { PluginRpc } from "../../plugin/rpc"

export const RpcHandler = HttpApiBuilder.group(Api, "server.rpc", (handlers) =>
  handlers.handle(
    "rpc.call",
    Effect.fn(function* (ctx) {
      const directory = yield* Directory
      const { rpcID, method } = ctx.params
      const target = PluginRpc.lookup(directory, rpcID, method)
      if (!target)
        return yield* new RpcError({
          type: "rpc.method_not_found",
          message: `RPC method not found: ${rpcID}.${method}`,
        })
      // A method that throws or rejects is the plugin's failure, reported as a typed internal error, not a defect.
      const output = yield* Effect.tryPromise({
        try: async () => target(ctx.payload.input),
        catch: (error) =>
          new RpcInternalError({
            type: "rpc.internal",
            message: error instanceof Error ? error.message : String(error),
          }),
      })
      return { output }
    }),
  ),
)
