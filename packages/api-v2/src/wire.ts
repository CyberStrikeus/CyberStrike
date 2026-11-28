import { Schema, Struct } from "effect"
import { Location } from "@opencode/schema/location"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"

// Same shape upstream's session group builds for its success schema, derived from the schema package so the
// handler decodes through an identical definition. Upstream does not export it, so it is repeated here.
export const PublicSessionInfo = Schema.Struct({
  ...Struct.omit(Session.Info.fields, ["location"]),
  location: Location.PublicRef,
}).annotate({ identifier: "Session.Info" })

export const PublicSessionMessage = SessionMessage.Info
