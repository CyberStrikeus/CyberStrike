// Single-server ADAPTER (Phase B v2-shell spike).
//
// Upstream's v2 shell scopes sync state per active server via a
// `ServerSyncProvider` keyed on `ServerConnection.Key`, and exposes
// `useServerSync().session.lineage` to resolve a session's ancestry. CyberStrike
// is single-server: its sync state lives in the always-mounted
// `context/global-sync` singleton. This module re-presents that singleton under
// the v2 contract name so ported shell pieces can `useServerSync()`.
import { useGlobalSync } from "./global-sync"

export const useServerSync = useGlobalSync
export { GlobalSyncProvider as ServerSyncProvider } from "./global-sync"
