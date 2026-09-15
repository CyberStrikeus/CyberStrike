// TLS handshake classification (WSTG-CRYP-01). Pure — the network handshake lives in handshake.ts; these
// functions judge its results (negotiated protocol/cipher, accepted legacy protocols, peer certificate).
// Deterministic + unit-tested with fabricated inputs.

export interface TlsFinding {
  kind: string
  severity: "high" | "medium" | "low"
  note: string
}

// Deprecated/insecure protocol versions. TLSv1.2+ is the floor; anything below is a downgrade lever.
export const LEGACY_PROTOCOLS = ["SSLv3", "TLSv1", "TLSv1.1"]

// Weak cipher families in the negotiated suite name (OpenSSL or IANA spelling).
const WEAK_CIPHER = /(^|[_-])(RC4|3DES|DES|IDEA|NULL|EXPORT|EXP|ANON|MD5)([_-]|$)/i

export function classifyCipher(name: string | undefined): TlsFinding | undefined {
  if (!name) return undefined
  if (WEAK_CIPHER.test(name)) return { kind: "weak-cipher", severity: "high", note: `negotiated cipher "${name}" is weak/deprecated (broken or export-grade)` }
  return undefined
}

// Judge the negotiated protocol + which forced-legacy handshakes the server accepted.
export function classifyProtocol(negotiated: string | null | undefined, legacyAccepted: string[]): TlsFinding[] {
  const out: TlsFinding[] = []
  if (negotiated && LEGACY_PROTOCOLS.includes(negotiated))
    out.push({ kind: "weak-protocol-negotiated", severity: "high", note: `server negotiated ${negotiated} by default — deprecated (want TLSv1.2+)` })
  for (const p of legacyAccepted)
    out.push({ kind: "legacy-protocol-accepted", severity: "high", note: `server accepts a forced ${p} handshake — deprecated protocol enabled, allows downgrade` })
  return out
}

export interface PeerCert {
  subject?: Record<string, string>
  issuer?: Record<string, string>
  valid_from?: string // e.g. "Jan  1 00:00:00 2024 GMT"
  valid_to?: string
  subjectaltname?: string // "DNS:example.com, DNS:*.example.com"
}

// Wildcard-aware hostname match (one label for a leading "*").
function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "")
  const p = pattern.toLowerCase().replace(/\.$/, "")
  if (p === h) return true
  if (p.startsWith("*.")) {
    const suffix = p.slice(1) // ".example.com"
    const idx = h.indexOf(".")
    return idx > 0 && h.slice(idx) === suffix
  }
  return false
}

function certNames(cert: PeerCert): string[] {
  const names: string[] = []
  if (cert.subject?.CN) names.push(cert.subject.CN)
  if (cert.subjectaltname)
    for (const part of cert.subjectaltname.split(",")) {
      const m = part.trim().match(/^DNS:(.+)$/i)
      if (m) names.push(m[1])
    }
  return names
}

export function classifyCert(cert: PeerCert, host: string, now: number = Date.now()): TlsFinding[] {
  const out: TlsFinding[] = []
  const to = cert.valid_to ? Date.parse(cert.valid_to) : NaN
  const from = cert.valid_from ? Date.parse(cert.valid_from) : NaN
  if (!Number.isNaN(to) && to < now) out.push({ kind: "cert-expired", severity: "high", note: `certificate expired (${cert.valid_to})` })
  if (!Number.isNaN(from) && from > now) out.push({ kind: "cert-not-yet-valid", severity: "high", note: `certificate not yet valid (starts ${cert.valid_from})` })
  if (cert.subject && cert.issuer && JSON.stringify(cert.subject) === JSON.stringify(cert.issuer))
    out.push({ kind: "cert-self-signed", severity: "medium", note: "certificate is self-signed (issuer == subject) — not chained to a trusted CA" })
  const names = certNames(cert)
  if (names.length && !names.some((n) => hostMatches(host, n)))
    out.push({ kind: "cert-hostname-mismatch", severity: "high", note: `certificate names [${names.join(", ")}] do not match host "${host}"` })
  return out
}
