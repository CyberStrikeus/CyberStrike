import type { Session } from "@cyberstrike-io/sdk/v2/client"

// Upstream converts a promise-client `SessionInfo` into the v2 `Session` shape.
// CyberStrike's single-server data layer already yields our `Session` directly,
// so this is an identity adapter — no promise-client dependency is pulled in.
export function normalizeSessionInfo(input: Session): Session {
  return input
}
