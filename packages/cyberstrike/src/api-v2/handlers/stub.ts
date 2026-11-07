import { Effect } from "effect"
import { HttpServerResponse } from "effect/http"

// Not-implemented endpoints answer 503 directly. Upstream groups mostly do not declare ServiceUnavailableError,
// so failing through the error channel would not typecheck against the handler's declared errors.
export const unavailable = Effect.succeed(HttpServerResponse.text("not implemented", { status: 503 }))
