import { Context } from "effect"
import { HttpApiMiddleware } from "effect/http-api"
import { InvalidRequestError, LocationNotFoundError, SessionNotFoundError } from "@opencode/protocol/errors"

// The directory a request is scoped to, provided to handlers by the location middleware.
export class Directory extends Context.Service<Directory, string>()("@cyberstrike-io/api-v2/Directory") {}

// Keys only. The implementations are provided by packages/cyberstrike/src/api-v2 and resolve the
// directory from ?location[directory], ?directory=, x-opencode-directory or x-cyberstrike-directory.
export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware, { provides: Directory }>()(
  "@cyberstrike-io/api-v2/LocationMiddleware",
  { error: [LocationNotFoundError] },
) {}

export class SessionLocationMiddleware extends HttpApiMiddleware.Service<
  SessionLocationMiddleware,
  { provides: Directory }
>()("@cyberstrike-io/api-v2/SessionLocationMiddleware", {
  error: [InvalidRequestError, SessionNotFoundError, LocationNotFoundError],
}) {}

export class FormLocationMiddleware extends HttpApiMiddleware.Service<FormLocationMiddleware, { provides: Directory }>()(
  "@cyberstrike-io/api-v2/FormLocationMiddleware",
  { error: [LocationNotFoundError] },
) {}
