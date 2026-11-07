import { Effect, Schema } from "effect"
import { Provider as WireProvider } from "@opencode/schema/provider"
import { HttpApiBuilder } from "effect/http-api"
import { Location } from "@opencode/schema/location"
import { ProviderNotFoundError } from "@opencode/protocol/errors"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Provider } from "../../provider/provider"
import { inInstance } from "../instance"

const wire = (provider: Provider.Info) => ({
  id: provider.id,
  name: provider.name,
  activation: "enabled" as const,
  package: Object.values(provider.models)[0]?.api.npm ?? "",
})

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  handlers
    .handle(
      "provider.list",
      Effect.fn(function* () {
        const directory = yield* Directory
        const providers = yield* inInstance(directory, () => Provider.list())
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(WireProvider.Info)))({
          location: { directory },
          data: Object.values(providers).map(wire),
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "provider.get",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const providerID = ctx.params.providerID
        const provider = yield* inInstance(directory, () => Provider.getProvider(providerID))
        if (!provider)
          return yield* new ProviderNotFoundError({ providerID, message: `Provider not found: ${providerID}` })
        return yield* Schema.decodeUnknownEffect(Location.response(WireProvider.Info))({
          location: { directory },
          data: wire(provider),
        }).pipe(Effect.orDie)
      }),
    ),
)
