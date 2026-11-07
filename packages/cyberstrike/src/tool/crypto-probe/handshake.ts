// TLS handshake network layer (WSTG-CRYP-01). The ONE part of crypto_probe that opens a connection — a
// read-only TLS handshake (no HTTP request, no data), gated by scope + a tight timeout. Results are judged
// by the pure classifiers in tls.ts. Not unit-tested (network); kept thin + defensive.
import tls from "node:tls"
import type { PeerCert } from "./tls"
import { LEGACY_PROTOCOLS } from "./tls"

export interface HandshakeResult {
  ok: boolean
  protocol?: string | null
  cipher?: string
  cert?: PeerCert
  error?: string
  clientUnsupported?: boolean // the LOCAL TLS lib can't offer this version — can't conclude about the server
}

function once(host: string, port: number, opts: { minVersion?: tls.SecureVersion; maxVersion?: tls.SecureVersion; timeoutMs: number }): Promise<HandshakeResult> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: HandshakeResult) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      resolve(r)
    }
    let socket: tls.TLSSocket
    try {
      socket = tls.connect({
        host,
        port,
        servername: host,
        rejectUnauthorized: false, // we INSPECT the cert; we don't want the connection to abort on a bad one
        minVersion: opts.minVersion,
        maxVersion: opts.maxVersion,
        ALPNProtocols: ["http/1.1"],
      })
    } catch (e) {
      // Synchronous throw = the local lib rejected the requested version range.
      return resolve({ ok: false, error: String(e), clientUnsupported: /protocol|version/i.test(String(e)) })
    }
    socket.setTimeout(opts.timeoutMs, () => done({ ok: false, error: "handshake timeout" }))
    socket.on("secureConnect", () => {
      const c = socket.getCipher()
      done({ ok: true, protocol: socket.getProtocol(), cipher: c?.name, cert: socket.getPeerCertificate() as unknown as PeerCert })
    })
    socket.on("error", (e) => {
      const msg = String((e as Error).message ?? e)
      done({ ok: false, error: msg, clientUnsupported: /no protocols available|unsupported protocol|version/i.test(msg) })
    })
  })
}

// Default handshake (negotiated protocol/cipher/cert) + a forced attempt per legacy protocol to see which
// the server still accepts. Legacy attempts the local lib can't offer are reported as unknown, not "safe".
export async function probeTls(
  host: string,
  port: number,
  timeoutMs = 8000,
): Promise<{ negotiated: HandshakeResult; legacyAccepted: string[]; legacyUntestable: string[] }> {
  const negotiated = await once(host, port, { timeoutMs })
  const legacyAccepted: string[] = []
  const legacyUntestable: string[] = []
  if (negotiated.ok) {
    for (const p of LEGACY_PROTOCOLS) {
      const r = await once(host, port, { minVersion: p as tls.SecureVersion, maxVersion: p as tls.SecureVersion, timeoutMs })
      if (r.ok) legacyAccepted.push(p)
      else if (r.clientUnsupported) legacyUntestable.push(p)
    }
  }
  return { negotiated, legacyAccepted, legacyUntestable }
}
