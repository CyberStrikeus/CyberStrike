// Per-session WebSocket control channel to the browser extension. /web/action relays an
// allowed command here; the extension executes it (click/type/navigate) in the real
// browser and acks by id. Ported from codriving.ts (standalone :4097 → CyberStrike,
// keyed by session). In-memory, server-lifetime.
export namespace WebControl {
  export interface Socket {
    send: (data: string) => void
  }

  export interface Ack {
    ok: boolean
    error?: string
    body?: string // response text for a `fetch` op (extension-side, auth-context fetch)
  }
  const bySession = new Map<string, Socket>()
  const pending = new Map<string, { resolve: (v: Ack) => void; timer: ReturnType<typeof setTimeout> }>()
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

  // Extension → server ack, `{ id, ok, error?, body? }`. Resolves the matching pending command.
  export function onAck(raw: string): void {
    let msg: { id?: string; ok?: boolean; error?: string; body?: string }
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
    p.resolve({ ok: !!msg.ok, error: msg.error, body: typeof msg.body === "string" ? msg.body : undefined })
  }

  // Send a command to this session's extension and await its ack. Resolves (never rejects)
  // with { ok:false, error } when no extension is connected or the ack times out, so the
  // route can map it to a status without try/catch.
  export function send(sessionID: string, cmd: Record<string, unknown>, timeoutMs = 5000): Promise<Ack> {
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

  // Ask the connected extension to fetch a URL IN-PAGE (credentials included → inherits the
  // browser's session cookies + proxy/TLS), returning the body text or null. This is how mining
  // reaches auth-gated JS bundles / API specs that a server-side fetch would 401 on (design: the
  // extension is already inside the authenticated page). Generous timeout: bundle + relay round-trip.
  export async function fetchText(sessionID: string, url: string, timeoutMs = 12000): Promise<string | null> {
    const r = await send(sessionID, { op: "fetch", url }, timeoutMs)
    return r.ok && typeof r.body === "string" ? r.body : null
  }

  // A url→text fetcher for mining that prefers the extension's in-page (authed) fetch when one is
  // connected, and falls back to `fallback` (a server-side fetch) when there's no extension OR the
  // in-page fetch returned nothing (old extension / genuine failure). Single source for both
  // JsMiner and WellKnown so auth-gated bundles/specs are reachable.
  export function fetcher(sessionID: string, fallback: (url: string) => Promise<string | null>): (url: string) => Promise<string | null> {
    return async (url) => {
      if (connected(sessionID)) {
        const t = await fetchText(sessionID, url)
        if (t !== null) return t
      }
      return fallback(url)
    }
  }

  export function _reset(): void {
    for (const p of pending.values()) clearTimeout(p.timer)
    pending.clear()
    bySession.clear()
  }
}
