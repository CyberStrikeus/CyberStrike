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
    /** Set whenever config states it, in either direction. */
    rejectUnauthorized?: boolean
    /** Client certificate material for a mutual-TLS target. */
    clientCertificate?: { cert?: string; key?: string; passphrase?: string }
  }

  // Successful reads are cached per path; FAILURES are not. Caching a failure
  // would make a fixed permission or a newly created file invisible until the
  // process restarts, and the user would keep seeing the same handshake error
  // after apparently fixing it. Config itself hot-reloads, so the cache must not
  // be the one thing that needs a restart.
  const fileCache = new Map<string, string>()

  function readCert(path: string | undefined): string | undefined {
    if (!path) return undefined
    const hit = fileCache.get(path)
    if (hit !== undefined) return hit
    try {
      const value = readFileSync(path, "utf8")
      fileCache.set(path, value)
      return value
    } catch (err) {
      // Loud every time: a silently dropped certificate looks like "the proxy
      // just doesn't work" and sends the user hunting in the wrong place.
      log.error("cannot read certificate file, ignoring it", { path, err: String(err) })
      return undefined
    }
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

  // Warn-once bookkeeping: the resolver runs per request, so an unconditional
  // log would drown the output on a busy replay loop.
  const warned = new Set<string>()
  function warnOnce(key: string, message: string, extra: Record<string, unknown>) {
    if (warned.has(key)) return
    warned.add(key)
    log.error(message, extra)
  }

  /**
   * Parse a configured proxy URL, or throw something the operator can act on.
   * Failing closed is deliberate: a misconfigured proxy must stop the request,
   * never quietly downgrade it to a direct connection.
   */
  function parseProxyUrl(raw: string): URL {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      throw new Error(
        `network.proxy.url is not a valid URL: ${JSON.stringify(raw)}. Include the scheme, e.g. "http://127.0.0.1:8080".`,
      )
    }
    const scheme = u.protocol.replace(":", "")
    if (!["http", "https", "socks4", "socks5", "socks5h"].includes(scheme)) {
      throw new Error(`network.proxy.url has an unsupported scheme "${scheme}". Use http, https, socks4 or socks5.`)
    }
    return u
  }

  const isSocks = (u: URL) => u.protocol.startsWith("socks")

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
      const parsed = parseProxyUrl(cfg.proxy!.url!)
      // Measured: the fetch runtime rejects SOCKS outright (UnsupportedProxyProtocol),
      // so replayed requests cannot use one — only the crawler's browser can. The
      // proxy is still returned so the send FAILS rather than silently going direct;
      // this line is what turns "my proxy is broken" into an answerable question.
      if (isSocks(parsed)) {
        warnOnce(
          "socks-replay",
          "SOCKS proxies are only usable by the crawler's browser — replayed requests will fail. Use an HTTP proxy to cover both.",
          { proxy: `${parsed.protocol}//${parsed.host}` },
        )
      }
      out.proxy = toProxyUrl(cfg.proxy!.url!, cfg.proxy!.auth?.username, cfg.proxy!.auth?.password)
    }

    const ca = readCert(cfg.tls?.caPath)
    if (ca) out.ca = ca
    if (cfg.tls?.rejectUnauthorized !== undefined) out.rejectUnauthorized = cfg.tls.rejectUnauthorized

    const cert = matchCertificate(cfg.tls?.clientCertificates ?? [], host, port)
    if (cert) {
      // pfx is deliberately NOT forwarded here. Measured on the pinned runtime:
      // neither the fetch backend nor node:tls applies it (both modern and
      // legacy PKCS#12), while cert+key works in both. Passing it anyway would
      // connect with NO client certificate and surface as an opaque handshake
      // failure from the server, pointing the user nowhere.
      if (cert.pfxPath && !(cert.certPath && cert.keyPath)) {
        log.error("pfxPath is not supported for replayed requests — supply certPath + keyPath instead", {
          host: cert.host,
          pfxPath: cert.pfxPath,
        })
      }
      out.clientCertificate = {
        cert: readCert(cert.certPath),
        key: readCert(cert.keyPath),
        passphrase: cert.passphrase,
      }
    }

    return out
  }

  /**
   * Same as forHost, but takes a URL or origin string.
   *
   * ONLY the URL parse is tolerated — a resolution failure propagates. Catching
   * it would return "no proxy, no CA", i.e. send the request DIRECTLY while the
   * operator believes it is being intercepted. For a tool whose purpose is
   * controlling where traffic goes, failing loudly is the safe direction.
   */
  export async function forUrl(url: string): Promise<Outbound> {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return {}
    }
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80
    return forHost(u.hostname, port)
  }

  /** Proxy host:port with any credentials stripped — safe to log or show a user. */
  export function proxyAuthority(proxyUrl: string): string {
    try {
      const u = new URL(proxyUrl)
      return u.host
    } catch {
      return "(unparseable proxy url)"
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
      const parsed = parseProxyUrl(cfg.proxy!.url!)
      // Chromium rejects SOCKS proxy authentication at LAUNCH, killing the whole
      // crawl with a message that never mentions the config. Refuse it here,
      // where the fix can be spelled out.
      if (isSocks(parsed) && (cfg.proxy!.auth?.username || cfg.proxy!.auth?.password)) {
        throw new Error(
          "network.proxy: the browser cannot authenticate to a SOCKS proxy. Remove network.proxy.auth, or use an http:// proxy, which supports credentials.",
        )
      }
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

    // The crawler ignores certificate errors by default, so an intercepting
    // proxy works without any TLS config at all. Only an explicit
    // rejectUnauthorized=true asks for strict checking — and that is the one
    // combination worth warning about, because caPath cannot back it up:
    // Chromium trusts the OS store and has no CA option, so strict checking
    // will reject the proxy's certificate no matter what caPath says.
    if (cfg.tls?.rejectUnauthorized === true) {
      out.ignoreHTTPSErrors = false
      if (cfg.tls?.caPath) {
        warnOnce(
          "browser-ca",
          "network.tls.caPath cannot be applied to the crawler's browser — Chromium trusts the OS certificate store, not this file. With rejectUnauthorized:true the browser will reject an intercepting proxy's certificate; install the CA in the OS store, or drop rejectUnauthorized to let the crawler ignore certificate errors.",
          { caPath: cfg.tls.caPath },
        )
      }
    }

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
