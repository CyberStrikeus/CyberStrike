// Outbound network policy — the single answer to "how do I reach this host?".
//
// Everything CyberStrike sends outward (the replay backends, webfetch, the
// crawler's browser) asks this module instead of growing its own proxy flag.
// It reads `network` from the config and resolves it PER DESTINATION, because
// two of the rules are destination-dependent: the bypass list, and per-host
// client certificates.
//
// Deliberate non-goals:
//   - No env vars, no global agent, no process-wide side effects. Callers pass
//     what they get from here explicitly, so anything that does NOT ask stays
//     unproxied — which is how loopback ingest keeps working for free.
//   - The replay backends stay pure: they accept these options, they never read
//     config themselves (they are unit-tested with no network and no Instance).

import { readFileSync } from "fs"
import { Config } from "../config/config"
import { Log } from "../util/log"

export namespace Network {
  const log = Log.create({ service: "network" })

  /** What a sender needs to reach one destination, in the shape fetch/tls take:
   *  a ready-to-use proxy URL and certificate CONTENTS, not paths. All fields
   *  optional — an empty object means "behave exactly as before this existed". */
  export interface Outbound {
    /** Proxy URL with credentials already embedded, e.g. "http://u:p@127.0.0.1:8080". */
    proxy?: string
    /** Extra CA to trust (PEM contents), e.g. an intercepting proxy's root. */
    ca?: string
    /** Only set when config explicitly turns verification off. */
    rejectUnauthorized?: boolean
    /** Client certificate material for a mutual-TLS target. */
    clientCertificate?: { cert?: string; key?: string; pfx?: Buffer; passphrase?: string }
  }

  // Certificates are read once per path. A changed file needs a restart, which
  // is the same contract as the rest of the config.
  const fileCache = new Map<string, string | Buffer | undefined>()

  function readCert(path: string | undefined, binary = false): any {
    if (!path) return undefined
    const key = `${binary ? "b:" : "t:"}${path}`
    if (fileCache.has(key)) return fileCache.get(key)
    let value: string | Buffer | undefined
    try {
      value = binary ? readFileSync(path) : readFileSync(path, "utf8")
    } catch (err) {
      // A bad path must be loud: silently dropping it would look like the proxy
      // simply "doesn't work" and send the user hunting in the wrong place.
      log.error("cannot read certificate file, ignoring it", { path, err: String(err) })
      value = undefined
    }
    fileCache.set(key, value)
    return value
  }

  /** Render a proxy URL with credentials embedded, the form fetch expects. */
  export function toProxyUrl(url: string, username?: string, password?: string): string {
    if (!username && !password) return url
    try {
      const u = new URL(url)
      if (username) u.username = encodeURIComponent(username)
      if (password) u.password = encodeURIComponent(password)
      return u.toString()
    } catch {
      return url
    }
  }

  // Loopback is bypassed unconditionally: the crawler posts captured traffic to
  // the local server, and routing that through an external proxy would break
  // ingest and mirror every capture into the proxy's history.
  const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"])

  function isLoopback(host: string): boolean {
    const h = host.toLowerCase().replace(/^\[|\]$/g, "")
    if (LOOPBACK.has(h) || LOOPBACK.has(host.toLowerCase())) return true
    if (h.endsWith(".localhost")) return true
    return /^127\./.test(h)
  }

  /**
   * Host-pattern match: exact, or a "*.example.com" wildcard that also matches
   * the bare base. Same semantics the crawler already uses for network scope,
   * so one mental model covers both settings.
   */
  export function matchHost(pattern: string, host: string): boolean {
    const p = pattern.trim().toLowerCase().replace(/\.+$/, "")
    const h = host.trim().toLowerCase().replace(/\.+$/, "")
    if (!p) return false
    const base = p.startsWith("*.") ? p.slice(2) : p
    return h === base || h.endsWith("." + base)
  }

  /** Should this host skip the proxy? Loopback always does. */
  export function isBypassed(host: string, bypass: readonly string[] = []): boolean {
    if (isLoopback(host)) return true
    return bypass.some((p) => matchHost(p, host))
  }

  /**
   * Pick the client certificate for a destination. An entry may pin a port
   * ("app.example.com:8443"); a portless entry matches any port on that host.
   * Port-pinned entries win so a specific rule beats a general one.
   */
  export function matchCertificate(
    entries: readonly Config.ClientCertificate[],
    host: string,
    port?: number,
  ): Config.ClientCertificate | undefined {
    let fallback: Config.ClientCertificate | undefined
    for (const entry of entries) {
      const idx = entry.host.lastIndexOf(":")
      const hasPort = idx > 0 && /^\d+$/.test(entry.host.slice(idx + 1))
      const entryHost = hasPort ? entry.host.slice(0, idx) : entry.host
      if (!matchHost(entryHost, host)) continue
      if (hasPort) {
        if (port !== undefined && Number(entry.host.slice(idx + 1)) === port) return entry
        continue
      }
      fallback ??= entry
    }
    return fallback
  }

  /** Is the proxy configured and switched on? `enabled` defaults to true when a url is set. */
  function proxyActive(cfg: Config.Network | undefined): cfg is Config.Network & { proxy: { url: string } } {
    const p = cfg?.proxy
    return !!p?.url && p.enabled !== false
  }

  /**
   * Resolve outbound options for one destination. Callers spread the result into
   * their own send options; an empty object is the "nothing configured" case and
   * must leave behavior unchanged.
   */
  export async function forHost(host: string, port?: number): Promise<Outbound> {
    const cfg = (await Config.get()).network
    if (!cfg) return {}

    const out: Outbound = {}

    if (proxyActive(cfg) && !isBypassed(host, cfg.proxy!.bypass ?? [])) {
      out.proxy = toProxyUrl(cfg.proxy!.url!, cfg.proxy!.auth?.username, cfg.proxy!.auth?.password)
    }

    const ca = readCert(cfg.tls?.caPath)
    if (ca) out.ca = ca
    if (cfg.tls?.rejectUnauthorized === false) out.rejectUnauthorized = false

    const cert = matchCertificate(cfg.tls?.clientCertificates ?? [], host, port)
    if (cert) {
      out.clientCertificate = {
        cert: readCert(cert.certPath),
        key: readCert(cert.keyPath),
        pfx: readCert(cert.pfxPath, true),
        passphrase: cert.passphrase,
      }
    }

    return out
  }

  /** Same as forHost, but takes a URL or origin string. Returns {} if unparseable. */
  export async function forUrl(url: string): Promise<Outbound> {
    try {
      const u = new URL(url)
      const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80
      return await forHost(u.hostname, port)
    } catch {
      return {}
    }
  }

  /**
   * Whether provider/LLM API traffic may go through the proxy. Off unless the
   * user opts in — when on, the proxy operator can read the API key.
   */
  export async function includeProviders(): Promise<boolean> {
    const cfg = (await Config.get()).network
    return proxyActive(cfg) && cfg!.proxy!.includeProviders === true
  }

  /**
   * Serializable, Playwright-shaped browser options. Lives here so the mapping
   * exists once; the hackbrowser launcher forwards this to the worker as plain
   * data (the worker cannot import cyberstrike's Config).
   *
   * `caPath` is deliberately NOT mapped: Playwright has no CA option — Chromium
   * trusts the OS store. To use an intercepting proxy in the browser, either
   * install its CA at the OS level or set tls.rejectUnauthorized=false, which
   * maps to ignoreHTTPSErrors below.
   */
  export interface BrowserOptions {
    proxy?: { server: string; username?: string; password?: string; bypass?: string }
    ignoreHTTPSErrors?: boolean
    clientCertificates?: Array<{
      origin: string
      certPath?: string
      keyPath?: string
      pfxPath?: string
      passphrase?: string
    }>
  }

  export async function forBrowser(): Promise<BrowserOptions> {
    const cfg = (await Config.get()).network
    if (!cfg) return {}
    const out: BrowserOptions = {}

    if (proxyActive(cfg)) {
      // Chromium takes the bypass list as a comma-separated string. Loopback is
      // added explicitly because the browser has no notion of our always-bypass rule.
      const bypass = ["localhost", "127.0.0.1", "::1", ...(cfg.proxy!.bypass ?? [])]
      out.proxy = {
        server: cfg.proxy!.url!,
        username: cfg.proxy!.auth?.username,
        password: cfg.proxy!.auth?.password,
        bypass: bypass.join(","),
      }
    }

    if (cfg.tls?.rejectUnauthorized === false) out.ignoreHTTPSErrors = true

    // Playwright keys client certs by EXACT origin — it has no wildcard matching
    // of its own, so a "*.example.com" entry cannot be expressed here. Those
    // entries still work for replayed requests (forHost does its own matching);
    // dropping them silently would leave the browser mysteriously unauthenticated.
    const certs = cfg.tls?.clientCertificates ?? []
    const exact = certs.filter((c) => !c.host.includes("*"))
    for (const c of certs) {
      if (c.host.includes("*")) {
        log.warn("wildcard client certificate cannot be applied to the browser", {
          host: c.host,
          hint: "Playwright matches client certificates by exact origin — list the concrete host(s) to cover the crawl",
        })
      }
    }
    if (exact.length > 0) {
      out.clientCertificates = exact.map((c) => ({
        // A portless entry defaults to https, the only scheme mTLS applies to.
        origin: /^https?:\/\//.test(c.host) ? c.host : `https://${c.host}`,
        certPath: c.certPath,
        keyPath: c.keyPath,
        pfxPath: c.pfxPath,
        passphrase: c.passphrase,
      }))
    }

    return out
  }
}
