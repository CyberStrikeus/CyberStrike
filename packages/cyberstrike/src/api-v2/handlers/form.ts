import { Effect, Schema } from "effect"
import { Form } from "@opencode/schema/form"
import { HttpApiBuilder } from "effect/http-api"
import { Location } from "@opencode/schema/location"
import { Api } from "@cyberstrike-io/api-v2"
import { projectForm } from "@cyberstrike-io/api-v2/projection/form"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Question } from "../../question"
import { inInstance } from "../instance"

export const FormHandler = HttpApiBuilder.group(Api, "server.form", (handlers) =>
  handlers.handle(
    "form.list",
    Effect.fn(function* () {
      const directory = yield* Directory
      const rows = yield* inInstance(directory, () => Question.list())
      return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(Form.Info)))({
        location: { directory },
        data: rows.map(projectForm),
      }).pipe(Effect.orDie)
    }),
  ),
)
