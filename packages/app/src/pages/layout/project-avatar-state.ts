import type { Accessor } from "solid-js"
import type { ServerConnection } from "@/context/server"

// Single-server deviation: upstream backs this with a multi-server session-status
// store that tracks per-session unread/working state across servers. This fork
// does not adopt that layer (see the SessionTabAvatar note), so the home session
// rows render without live progress/unread state. The accessors are constant.
export function useSessionTabAvatarState(
  _server: Accessor<ServerConnection.Key>,
  _directory: Accessor<string>,
  _sessionID: Accessor<string>,
): { unread: Accessor<boolean>; loading: Accessor<boolean> } {
  return {
    unread: () => false,
    loading: () => false,
  }
}
