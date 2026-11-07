import { randomBytes } from "node:crypto"

// Out-of-band interaction store (#85). The correlation layer for BLIND vulnerabilities: a subagent mints
// a unique token, injects `<token>.<domain>` into the target, then polls here for the DNS/HTTP callbacks
// the server captured. A hit = proof of blind SSRF / RCE / XXE / OOB SQLi / SSTI / DNS exfil.
//
// In-memory + bounded (an OOB server is long-lived but interactions are ephemeral evidence, read soon
// after injection). When the server and the agent backend are one process the tools read this directly;
// a separate deployment exposes it over an API (follow-up).
export namespace OobStore {
  export interface Interaction {
    protocol: "dns" | "http"
    remoteAddr: string // the source IP that hit us — often the target (or its resolver / SSRF egress)
    at: number
    detail: string // e.g. "A <fqdn>" for dns, "GET /path (Host: …)" for http
    raw?: string // full request line/headers for http evidence
  }

  const MAX_PER_TOKEN = 200
  const interactions = new Map<string, Interaction[]>()

  // Mint a unique, DNS-safe token (lowercase base36, no collisions in practice). Used as the subdomain
  // label a subagent injects: `<token>.<CYBERSTRIKE_OOB_DOMAIN>`.
  export function mint(): string {
    return randomBytes(12).toString("hex") // 24 hex chars, DNS-label-safe
  }

  // The token a captured host belongs to: the label IMMEDIATELY LEFT of the base domain, so both
  // `<token>.<base>` and `extra.<token>.<base>` (targets that prepend labels) correlate. Returns
  // undefined for anything not under the base domain.
  export function tokenOf(host: string, baseDomain: string): string | undefined {
    const h = host.toLowerCase().replace(/\.$/, "").trim()
    const base = baseDomain.toLowerCase().replace(/^\.+|\.+$/g, "").trim()
    if (!base) return undefined
    if (h === base) return undefined
    if (!h.endsWith("." + base)) return undefined
    const sub = h.slice(0, -(base.length + 1))
    const labels = sub.split(".").filter(Boolean)
    return labels[labels.length - 1] // the label adjacent to the base domain
  }

  // Record a captured interaction under its token (no-op if the host is not one of ours / has no token).
  export function capture(host: string, baseDomain: string, i: Interaction): string | undefined {
    const token = tokenOf(host, baseDomain)
    if (!token) return undefined
    const list = interactions.get(token) ?? []
    list.push(i)
    if (list.length > MAX_PER_TOKEN) list.splice(0, list.length - MAX_PER_TOKEN)
    interactions.set(token, list)
    return token
  }

  // All interactions captured for a token, oldest first. Empty array = no callback yet (not confirmed).
  export function poll(token: string): Interaction[] {
    return interactions.get(token) ?? []
  }

  // Release a token's interactions (a hunt/test ended). Keeps the map bounded.
  export function clear(token: string): void {
    interactions.delete(token)
  }

  export function tokenCount(): number {
    return interactions.size
  }
}
