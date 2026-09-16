// Single-server thin map over the GLOBAL adapter.
//
// Upstream scopes sync state per active server via a ServerSyncProvider keyed on
// ServerConnection.Key. CyberStrike has one server, so its sync state lives in
// the GLOBAL adapter's single ServerCtx. This presents that ctx's `sync` under
// the v2 contract name for any consumer that reaches for `useServerSync()`.
import { useGlobal, type ServerCtx } from "./global"
import { useServer } from "./server"

export function useServerSync(): ServerCtx["sync"] {
  const global = useGlobal()
  const server = useServer()
  const conn = server.current
  if (!conn) throw new Error("No server available")
  return global.ensureServerCtx(conn).sync
}
