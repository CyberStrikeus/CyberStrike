import { Effect, Schema } from "effect"
import { HttpServerResponse } from "effect/http"
import { PublicSessionInfo } from "@cyberstrike-io/api-v2/wire"
import { projectSession } from "@cyberstrike-io/api-v2/projection/session"
import { SessionNotFoundError } from "@opencode/protocol/errors"
import { Session } from "../session"

// Shared by every session-scoped handler. A missing session is a typed 404, never a 500.
export const getSession = (sessionID: string) =>
  Effect.tryPromise({
    try: () => Session.get(sessionID),
    catch: () => new SessionNotFoundError({ sessionID, message: `Session not found: ${sessionID}` }),
  })

// For endpoints that do not declare SessionNotFoundError (upstream answers an unknown session with an empty list).
export const sessionDirectory = (sessionID: string) =>
  getSession(sessionID).pipe(
    Effect.map((session) => session.directory),
    Effect.catch(() => Effect.succeed(undefined)),
  )

// Tagged-error body with the same `_tag` and message fields the upstream TaggedError encodes to.
export const notFound = (tag: string, message: string) =>
  HttpServerResponse.jsonUnsafe({ _tag: tag, message }, { status: 404 })

// Encoded projection decoded through upstream's schema, so a projection bug is a defect at the boundary.
export const publicSession = (info: Parameters<typeof projectSession>[0]) =>
  Schema.decodeUnknownEffect(PublicSessionInfo)(projectSession(info)).pipe(Effect.orDie)
