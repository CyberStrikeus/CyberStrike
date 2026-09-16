import { createMemo, type Accessor } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useNotification } from "@/context/notification"
import type { ServerConnection } from "@/context/server"

// Single-server mapping of upstream's multi-server session-status store. Upstream
// reads per-session unread/working state through `global.ensureServerCtx(conn).sync`
// (a per-connection dir-sync engine) plus notification/permission contexts. This
// fork has a single connection, so the `server` key is unused; the same signals
// come from the global-sync child store for the session's directory
// (`session_status`, `permission`, `question`) and the notification context
// (`unseenCount`). Semantics match upstream: unread = needs-attention or unseen;
// loading = working-and-not-needing-attention.
export function useSessionTabAvatarState(
  _server: Accessor<ServerConnection.Key>,
  directory: Accessor<string>,
  sessionId: Accessor<string>,
): { unread: Accessor<boolean>; loading: Accessor<boolean> } {
  const sync = useGlobalSync()
  const notification = useNotification()
  const store = createMemo(() => sync.child(directory(), { bootstrap: false })[0])
  const hasPermissions = createMemo(() => (store().permission?.[sessionId()]?.length ?? 0) > 0)
  const hasQuestions = createMemo(() => (store().question?.[sessionId()]?.length ?? 0) > 0)
  const needsAttention = createMemo(() => hasPermissions() || hasQuestions())
  const unread = createMemo(() => needsAttention() || notification.session.unseenCount(sessionId()) > 0)
  const loading = createMemo(() => {
    if (needsAttention()) return false
    const status = store().session_status[sessionId()]
    return status?.type === "busy" || status?.type === "retry"
  })
  return { unread, loading }
}
