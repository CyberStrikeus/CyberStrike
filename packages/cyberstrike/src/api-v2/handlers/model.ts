import { Effect, Schema } from "effect"
import { Model } from "@opencode/schema/model"
import { HttpApiBuilder } from "effect/http-api"
import { Location } from "@opencode/schema/location"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Provider } from "../../provider/provider"
import { inInstance } from "../instance"

// Every model across the known providers, flattened. Upstream names the field `id` on the model and `providerID`
// on the owning provider; the v1 catalog uses the same two keys.
const models = (providers: Record<string, Provider.Info>) =>
  Object.values(providers).flatMap((provider) =>
    Object.values(provider.models).map((model) =>
      compact({
        id: model.id,
        modelID: model.api.id,
        providerID: provider.id,
        name: model.name,
        family: model.family,
        package: model.api.npm,
        capabilities: {
          tools: model.capabilities.toolcall,
          temperature: model.capabilities.temperature,
          input: Object.entries(model.capabilities.input)
            .filter(([, enabled]) => enabled)
            .map(([type]) => type),
          output: Object.entries(model.capabilities.output)
            .filter(([, enabled]) => enabled)
            .map(([type]) => type),
        },
        variants: Object.keys(model.variants ?? {}).map((id) => ({ id })),
        time: { released: Date.parse(model.release_date) || 0 },
        cost: [{ input: model.cost.input, output: model.cost.output, cache: model.cost.cache }],
        status: model.status,
        enabled: true,
        limit: compact(model.limit),
      }),
    ),
  )

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  handlers
    .handle(
      "model.list",
      Effect.fn(function* () {
        const directory = yield* Directory
        const providers = yield* inInstance(directory, () => Provider.list())
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(Model.Info)))({
          location: { directory },
          data: models(providers),
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "model.default",
      Effect.fn(function* () {
        const directory = yield* Directory
        const providers = yield* inInstance(directory, () => Provider.list())
        const selected = yield* inInstance(directory, () => Provider.defaultModel())
        const model = models(providers).find(
          (model) => model.id === selected.modelID && model.providerID === selected.providerID,
        )
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.UndefinedOr(Model.Info)))({
          location: { directory },
          data: model,
        }).pipe(Effect.orDie)
      }),
    ),
)
