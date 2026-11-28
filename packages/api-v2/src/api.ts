import { makeDefaultApi } from "@opencode/protocol/api"
import { FormLocationMiddleware, LocationMiddleware, SessionLocationMiddleware } from "./middleware/location"

// Upstream's makeApiFromGroup is private, but makeDefaultApi is the same chain with the middleware keys injected.
// Phase 1 adds no groups, so this Api is upstream's group set exactly.
export const Api = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  formLocationMiddleware: FormLocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})
