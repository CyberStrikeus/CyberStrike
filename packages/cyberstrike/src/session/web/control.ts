// Per-session WebSocket control channel to the browser extension. /web/action relays an
// allowed command here; the extension executes it (click/type/navigate) in the real
// browser and acks by id. Ported from codriving.ts (standalone :4097 → CyberStrike,
// keyed by session). In-memory, server-lifetime.
export namespace WebControl {
  export interface Socket {
    send: (data: string) => void
  }

  const bySession = new Map<string, Socket>()
  const pending = new Map<string, { resolve: (v: { ok: boolean; error?: string }) => void; timer: ReturnType<typeof setTimeout> }>()
  let seq = 0

  export function connect(sessionID: string, ws: Socket): void {
    bySession.set(sessionID, ws)
  }
  export function disconnect(sessionID: string): void {
    if (bySession.get(sessionID)) bySession.delete(sessionID)
  }
  export function connected(sessionID: string): boolean {
    return bySession.has(sessionID)
  }

  // Extension → server ack, `{ id, ok, error? }`. Resolves the matching pending command.
  export function onAck(raw: string): void {
    let msg: { id?: string; ok?: boolean; error?: string }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg.id) return
    const p = pending.get(msg.id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(msg.id)
    p.resolve({ ok: !!msg.ok, error: msg.error })
  }

  // Send a command to this session's extension and await its ack. Resolves (never rejects)
  // with { ok:false, error } when no extension is connected or the ack times out, so the
  // route can map it to a status without try/catch.
  export function send(sessionID: string, cmd: Record<string, unknown>, timeoutMs = 5000): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const ws = bySession.get(sessionID)
      if (!ws) {
        resolve({ ok: false, error: "no-extension" })
        return
      }
      const id = `cmd${++seq}`
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, error: "timeout" })
      }, timeoutMs)
      pending.set(id, { resolve, timer })
      ws.send(JSON.stringify({ id, ...cmd }))
    })
  }

  export function _reset(): void {
    for (const p of pending.values()) clearTimeout(p.timer)
    pending.clear()
    bySession.clear()
  }
}
