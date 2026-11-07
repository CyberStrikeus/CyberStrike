import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { generateText } from "ai"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Api } from "@cyberstrike-io/api-v2"
import { Provider } from "../../provider/provider"
import { inInstance } from "../instance"

// One stateless generation with the base configuration's model. Failures come back as values so each one maps to
// a declared error in the handler, rather than a defect.
const generate = async (prompt: string, ref: { providerID: string; modelID: string } | undefined) => {
  const selected = ref ?? (await Provider.defaultModel().catch(() => undefined))
  if (!selected) return { failed: "default" as const }
  const model = await Provider.getModel(selected.providerID, selected.modelID).catch(() => undefined)
  if (!model) return { failed: "model" as const }
  const language = await Provider.getLanguage(model).catch(() => undefined)
  if (!language) return { failed: "model" as const }
  const result = await generateText({ model: language, prompt }).catch(() => undefined)
  if (!result) return { failed: "generation" as const }
  return { text: result.text ?? "" }
}

export const GenerateHandler = HttpApiBuilder.group(Api, "server.generate", (handlers) =>
  handlers.handle(
    "generate.text",
    Effect.fn(function* (ctx) {
      const model = ctx.payload.model
      if (model?.variant)
        return yield* new InvalidRequestError({ message: "Model variants are not supported by generate", field: "model" })
      const ref = model ? { providerID: model.providerID, modelID: model.id } : undefined
      // This endpoint takes no location, so the base configuration is the one for the server's working directory.
      const outcome = yield* inInstance(process.cwd(), () => generate(ctx.payload.prompt, ref))
      if ("failed" in outcome) {
        if (outcome.failed === "model")
          return yield* new InvalidRequestError({ message: "Model not found or not available", field: "model" })
        return yield* new ServiceUnavailableError({
          message: outcome.failed === "default" ? "No default model is configured" : "Text generation failed",
          service: "generate",
        })
      }
      return { data: { text: outcome.text } }
    }),
  ),
)
