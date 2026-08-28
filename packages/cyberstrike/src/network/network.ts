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

  /**
   * One spelling for a host before any comparison: lowercased, trailing dots
   * dropped ("localhost." is localhost), IPv6 brackets removed, and unicode
   * folded to punycode — URL.hostname always hands us punycode, while a config
   * file is written by a human who types the unicode form.
   */
  function normalizeHost(host: string): string {
    let h = host.trim().toLowerCase().replace(/\.+$/, "")
    if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1)
    if (!/^[\x00-\x7f]*$/.test(h)) {
      try {
        h = new URL(`http://${h}`).hostname
      } catch {
        // not host-shaped; compare as written
      }
    }
    return h
  }

  function isLoopback(host: string): boolean {
    const h = normalizeHost(host)
    if (LOOPBACK.has(h)) return true
    if (h.endsWith(".localhost")) return true
    return /^127\./.test(h)
  }

  /**
   * Host-pattern match: exact, or a "*.example.com" wildcard that also matches
   * the bare base. Same semantics the crawler already uses for network scope,
   * so one mental model covers both settings.
   *
   * A `*` anywhere but a leading "*." is refused rather than silently matching
   * nothing: "*example.com" reads like a suffix rule, and Chromium's bypass
   * grammar really does treat it as one — matching notexample.com as well.
   * Failing loudly beats two subsystems disagreeing about what was excluded.
   */
  export function matchHost(pattern: string, host: string): boolean {
    const raw = pattern.trim().toLowerCase()
    if (!raw) return false
    if (raw.includes("*") && !raw.startsWith("*.")) {
      warnOnce(`badwildcard:${raw}`, "ignoring host pattern: '*' is only supported as a leading '*.' label", {
        pattern: raw,
      })
      return false
    }
    const p = normalizeHost(raw.startsWith("*.") ? raw.slice(2) : raw)
    const h = normalizeHost(host)
    if (!p) return false
    return h === p || h.endsWith("." + p)
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
  /** Split "host", "host:port", "[::1]:port" or "https://host:port" into parts. */
  function splitCertHost(raw: string): { host: string; port?: number; wildcard: boolean } {
    let s = raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "") // tolerate a scheme prefix
    s = s.replace(/\/.*$/, "")
    // Only a bracketed address or a colon-free name may carry a :port — a bare
    // IPv6 literal is all colons and must not be mis-read as host:port.
    const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(s)
    const host = m ? m[1]! : s
    const port = m ? Number(m[2]) : undefined
    return { host, port, wildcard: host.trim().startsWith("*.") }
  }

  /**
   * Pick the client certificate for a destination. Presenting the WRONG client
   * certificate is a credential-handling fault, so selection is by specificity,
   * never by the order entries happen to appear in the file:
   *   exact host + port  >  exact host  >  wildcard + port  >  wildcard
   */
  export function matchCertificate(
    entries: readonly Config.ClientCertificate[],
    host: string,
    port?: number,
  ): Config.ClientCertificate | undefined {
    let best: { score: number; entry: Config.ClientCertificate } | undefined
    for (const entry of entries) {
      const parsed = splitCertHost(entry.host)
      if (!matchHost(parsed.host, host)) continue
      if (parsed.port !== undefined && parsed.port !== port) continue
      const score = (parsed.wildcard ? 0 : 2) + (parsed.port !== undefined ? 1 : 0)
      if (!best || score > best.score) best = { score, entry }
    }
    return best?.entry
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

  /**
   * Translate our bypass patterns into Chromium's grammar. They are NOT the
   * same language, and the difference was measured rather than assumed:
   *
   *   pattern           example.test   sub.example.test   notexample.test
   *   example.test      bypassed       PROXIED            PROXIED
   *   .example.test     PROXIED        bypassed           PROXIED
   *   *example.test     bypassed       bypassed           bypassed  (!)
   *
   * So a bare host is EXACT there while it covers subdomains here, and a
   * dotless star is a broad suffix rule there while it matches nothing here.
   * Each of our patterns therefore becomes two Chromium rules — the exact host
   * and the subdomain form — and a malformed wildcard is dropped rather than
   * handed over to mean something far wider than it does on our side.
   */
  export function toChromiumBypass(patterns: readonly string[]): string[] {
    const out: string[] = []
    for (const raw of patterns) {
      const p = raw.trim().toLowerCase()
      if (!p) continue
      if (p.includes("*") && !p.startsWith("*.")) {
        warnOnce(`badwildcard:${p}`, "ignoring bypass pattern: '*' is only supported as a leading '*.' label", {
          pattern: p,
        })
        continue
      }
      const base = normalizeHost(p.startsWith("*.") ? p.slice(2) : p)
      if (!base) continue
      out.push(base, `.${base}`)
    }
    return out
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

  /**
   * The single source of truth for a send's TLS strictness. Precedence, most
   * specific first: an explicit per-call override (a tool's `insecure_tls`), then
   * config's `tls.rejectUnauthorized`, then the documented default of accepting
   * bad certs (pentest targets routinely have them). Writing `insecure === false`
   * unconditionally silently pins verification OFF whenever the override is unset,
   * which makes config's `tls.rejectUnauthorized` dead — every send site must use
   * this so that security rule cannot drift between them.
   */
  export function tlsRejectUnauthorized(insecureTls: boolean | undefined, out: Outbound): boolean {
    return insecureTls !== undefined ? insecureTls === false : (out.rejectUnauthorized ?? false)
  }

  /**
   * Render an Outbound as the fetch init fields it corresponds to. Every
   * in-process caller that hands options straight to `fetch` uses this, so the
   * mapping exists once — it had begun to drift when each site kept its own copy
   * (one read the resolved value, another the caller's override).
   *
   * The replay backends deliberately do NOT use it: they take primitive fields
   * so they stay pure and testable without this module.
   */
  export function toFetchInit(out: Outbound): { proxy?: string; tls?: Record<string, unknown> } {
    const init: { proxy?: string; tls?: Record<string, unknown> } = {}
    if (out.proxy) init.proxy = out.proxy
    const tls: Record<string, unknown> = {}
    if (out.rejectUnauthorized !== undefined) tls.rejectUnauthorized = out.rejectUnauthorized
    if (out.ca) tls.ca = out.ca
    if (out.clientCertificate?.cert) tls.cert = out.clientCertificate.cert
    if (out.clientCertificate?.key) tls.key = out.clientCertificate.key
    if (out.clientCertificate?.passphrase) tls.passphrase = out.clientCertificate.passphrase
    if (Object.keys(tls).length > 0) init.tls = tls
    return init
  }

  /**
   * Environment for a CHILD PROCESS we do not own the code of (the bundled
   * attack scripts). Returns {} when no proxy is configured, so the child's
   * environment is untouched by default.
   *
   * This is the one place env-var proxying is right, and the exception is worth
   * stating because the rest of this module deliberately avoids it: inside our
   * own process an ambient proxy variable would silently capture traffic we
   * never routed (including loopback ingest), so callers pass options
   * explicitly. A third-party script has no such seam — the variables ARE the
   * interface, and every HTTP library in those scripts honours them.
   *
   * Both cases of each name are set: tools disagree about which they read.
   * NO_PROXY entries are emitted in the same exact+suffix pair used for the
   * browser, since library implementations differ on whether a bare host also
   * covers its subdomains.
   */
  export async function childEnv(): Promise<Record<string, string>> {
    const cfg = (await Config.get()).network
    if (!proxyActive(cfg)) return {}
    const parsed = parseProxyUrl(cfg!.proxy!.url!)
    // SOCKS THROWS here, unlike forHost which warns and hands the proxy over.
    // The difference is what a caller can do with the answer: a replayed request
    // fails closed on its own, but a child script handed a socks:// URL in
    // HTTP_PROXY speaks HTTP at a SOCKS server and reports a parse error that
    // names neither the proxy nor the config. Refusing to start is the only
    // outcome here that is both safe and explicable. (Measured: it does not leak
    // — the traffic simply never arrives — but the error is unreadable.)
    if (isSocks(parsed)) {
      throw new Error(
        `Cannot run this with a SOCKS proxy configured (${parsed.protocol}//${parsed.host}). ` +
          `The bundled scripts' HTTP clients cannot use one: requests needs PySocks and aiohttp has no SOCKS support at all. ` +
          `Use an http:// proxy, or set network.proxy.enabled=false to run without one.`,
      )
    }
    const url = toProxyUrl(cfg!.proxy!.url!, cfg!.proxy!.auth?.username, cfg!.proxy!.auth?.password)
    const noProxy = ["localhost", ".localhost", "127.0.0.1", "::1"]
    for (const p of cfg!.proxy!.bypass ?? []) {
      const base = normalizeHost(p.startsWith("*.") ? p.slice(2) : p)
      if (base && !base.includes("*")) noProxy.push(base, `.${base}`)
    }
    const env: Record<string, string> = {
      HTTP_PROXY: url,
      http_proxy: url,
      HTTPS_PROXY: url,
      https_proxy: url,
      ALL_PROXY: url,
      all_proxy: url,
      NO_PROXY: noProxy.join(","),
      no_proxy: noProxy.join(","),
    }
    // Honoured by requests/gh when they verify at all; harmless otherwise.
    if (cfg!.tls?.caPath) {
      env.REQUESTS_CA_BUNDLE = cfg!.tls.caPath
      env.SSL_CERT_FILE = cfg!.tls.caPath
    }
    return env
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
   * Whether CyberStrike's OWN outbound traffic may go through the proxy. Off
   * unless the user opts in — when on, the proxy operator can read the API keys
   * and OAuth tokens those requests carry.
   *
   * Traffic aimed at the TARGET is not gated by this: those senders resolve the
   * transport themselves and a configured `url` is enough.
   */
  export async function includeInternal(): Promise<boolean> {
    const cfg = (await Config.get()).network
    return proxyActive(cfg) && cfg!.proxy!.includeInternal === true
  }

  /**
   * Route this process's own `fetch` through the configured proxy — ONE hook
   * instead of a policy every present and future call site has to remember.
   *
   * The alternative was a helper swapped in at each known provider/auth call
   * site. That was rejected because it makes coverage a matter of discipline: a
   * new provider plugin (or third-party plugin code we do not control) writes a
   * plain `fetch` and silently escapes the proxy. That exact failure already
   * happened once here — a new sender was added and went direct while the
   * operator believed everything was proxied. A hook cannot be forgotten.
   *
   * Install once, from the CLI entry point. Not on import: a global side effect
   * at import time would reach unit tests and anything embedding this package.
   */
  let installed = false
  let resolvingConfig = false

  export function installGlobalTransport(): void {
    if (installed) return
    installed = true
    const original = globalThis.fetch

    globalThis.fetch = (async (input: any, init?: any) => {
      // The caller already decided this request's transport (the replay backends
      // pass resolved proxy/TLS fields). Re-deriving it here would apply policy
      // twice and could overwrite deliberate per-call choices.
      if (init && ("proxy" in init || "tls" in init)) return original(input, init)

      // Reading the config can itself fetch (a remote well-known config), which
      // would re-enter this hook and await the very config load it is inside —
      // a deadlock. Going direct here is not a compromise: a proxy DERIVED from
      // the config cannot apply to the request that loads that config.
      if (resolvingConfig) return original(input, init)

      let transport: ReturnType<typeof toFetchInit> = {}
      resolvingConfig = true
      try {
        if (await includeInternal()) transport = toFetchInit(await forUrl(urlOf(input)))
      } catch {
        // No Instance context (early CLI paths), or an unreadable config. Behave
        // exactly as if this hook were not installed rather than failing a request.
      } finally {
        resolvingConfig = false
      }

      return original(input, Object.keys(transport).length > 0 ? { ...init, ...transport } : init)
    }) as typeof globalThis.fetch
  }

  /** The request's URL, whichever of fetch's three input shapes was used. */
  function urlOf(input: unknown): string {
    if (typeof input === "string") return input
    if (input instanceof URL) return input.href
    return String((input as { url?: string })?.url ?? input)
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
      // Loopback is added explicitly: the browser has no notion of our
      // always-bypass rule, and Chromium in fact FORCES loopback through the
      // proxy unless the list names it.
      const bypass = ["localhost", ".localhost", "127.0.0.1", "::1", ...toChromiumBypass(cfg.proxy!.bypass ?? [])]
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

    // Client certificates are deliberately NOT passed to the browser.
    //
    // Measured on the pinned Playwright: configuring clientCertificates makes
    // EVERY page load in that context hang until timeout — with or without the
    // server asking for a certificate, whether or not the server's own
    // certificate is trusted, and reproduced against bare chromium.launch()
    // with none of our launch arguments. Playwright inserts a local interceptor
    // whenever the option is present, and that interceptor never completes here.
    //
    // Passing it through would mean a plausible-looking config silently kills
    // the crawl — including on hosts the certificate has nothing to do with,
    // since one entry re-routes the whole context. Replayed requests DO honour
    // client certificates (verified on the wire), so the capability is not lost,
    // just not available to the crawler.
    if ((cfg.tls?.clientCertificates?.length ?? 0) > 0) {
      warnOnce(
        "browser-clientcerts",
        "client certificates are not applied to the crawler's browser — the browser hangs on every page when they are set. Replayed requests still use them; a crawl of a mutual-TLS host is not supported.",
        { count: cfg.tls!.clientCertificates!.length },
      )
    }

    return out
  }
}
