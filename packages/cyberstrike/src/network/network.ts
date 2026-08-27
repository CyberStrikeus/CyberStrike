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

import { Config } from "../config/config"

export namespace Network {
  /** Proxy endpoint, already resolved for one destination. */
  export interface Proxy {
    /** Full proxy URL including scheme, e.g. "http://127.0.0.1:8080". */
    url: string
    username?: string
    password?: string
  }

  /** Client certificate material for a mutual-TLS target. */
  export interface ClientCertificate {
    certPath?: string
    keyPath?: string
    pfxPath?: string
    passphrase?: string
  }

  /** What a sender needs to reach one destination. All fields optional — an
   *  empty object means "behave exactly as before this feature existed". */
  export interface Outbound {
    proxy?: Proxy
    /** Extra CA to trust (PEM path), e.g. an intercepting proxy's root. */
    caPath?: string
    /** Only set when config explicitly turns verification off. */
    rejectUnauthorized?: boolean
    clientCertificate?: ClientCertificate
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
      out.proxy = {
        url: cfg.proxy!.url!,
        username: cfg.proxy!.auth?.username,
        password: cfg.proxy!.auth?.password,
      }
    }

    if (cfg.tls?.caPath) out.caPath = cfg.tls.caPath
    if (cfg.tls?.rejectUnauthorized === false) out.rejectUnauthorized = false

    const cert = matchCertificate(cfg.tls?.clientCertificates ?? [], host, port)
    if (cert) {
      out.clientCertificate = {
        certPath: cert.certPath,
        keyPath: cert.keyPath,
        pfxPath: cert.pfxPath,
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

    const certs = cfg.tls?.clientCertificates ?? []
    if (certs.length > 0) {
      out.clientCertificates = certs.map((c) => ({
        // Playwright keys client certs by origin; a portless entry defaults to https.
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
