import { Effect, Schema } from "effect"
import { Provider as WireProvider } from "@opencode/schema/provider"
import { HttpApiBuilder } from "effect/http-api"
import { Location } from "@opencode/schema/location"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Provider } from "../../provider/provider"
import { inInstance } from "../instance"
import { unavailable } from "./stub"

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  handlers
    .handle(
      "provider.list",
      Effect.fn(function* () {
        const directory = yield* Directory
        const providers = yield* inInstance(directory, () => Provider.list())
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(WireProvider.Info)))({
          location: { directory },
          data: Object.values(providers).map((provider) => ({
            id: provider.id,
            name: provider.name,
            activation: "enabled",
            package: Object.values(provider.models)[0]?.api.npm ?? "",
          })),
        }).pipe(Effect.orDie)
      }),
    )
    .handle("provider.get", () => unavailable),
)
