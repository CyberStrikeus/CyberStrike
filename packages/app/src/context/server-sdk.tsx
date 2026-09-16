// Single-server thin map over the GLOBAL adapter.
//
// Upstream scopes the SDK per active server via a ServerSDKProvider keyed on
// ServerConnection.Key. CyberStrike has one server, so its SDK lives in the
// GLOBAL adapter's single ServerCtx. This presents that ctx's `sdk` under the
// v2 contract name for any consumer that reaches for `useServerSDK()`.
import { useGlobal, type ServerCtx } from "./global"
import { useServer } from "./server"

export function useServerSDK(): ServerCtx["sdk"] {
  const global = useGlobal()
  const server = useServer()
  const conn = server.current
  if (!conn) throw new Error("No server available")
  return global.ensureServerCtx(conn).sdk
}
