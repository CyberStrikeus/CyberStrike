import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Network } from "../../src/network/network"
import { HttpMessage } from "../../src/replay/message"
import { BackendFetch } from "../../src/replay/backend-fetch"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

const REDACTED = "[redacted]"

// Loopback wire tests below must never be captured by an ambient HTTP_PROXY /
// ALL_PROXY in the host environment. Bun resolves proxy env at startup, so
// this happens at module load — before any fetch in the process.
const ambientProxy = new Map<string, string | undefined>()
for (const key of Object.keys(process.env)) {
  if (/^(https?|all)_proxy$/i.test(key)) {
    ambientProxy.set(key, process.env[key])
    delete process.env[key]
  }
}

async function writeConfig(dir: string, config: object) {
  await Bun.write(path.join(dir, "cyberstrike.json"), JSON.stringify({ $schema: "https://cyberstrike.io/config.json", ...config }))
}

function info(network: Config.Network): Config.Info {
  return { network } as Config.Info
}

describe("Network pure functions", () => {
  describe("matchHost", () => {
    test("exact match", () => {
      expect(Network.matchHost("example.com", "example.com")).toBe(true)
      expect(Network.matchHost("example.com", "other.com")).toBe(false)
    })

    test("wildcard matches subdomains and the bare base", () => {
      expect(Network.matchHost("*.example.com", "sub.example.com")).toBe(true)
      expect(Network.matchHost("*.example.com", "a.b.example.com")).toBe(true)
      expect(Network.matchHost("*.example.com", "example.com")).toBe(true)
      expect(Network.matchHost("*.example.com", "notexample.com")).toBe(false)
    })

    test("a '*' outside leading '*.' position is refused", () => {
      expect(Network.matchHost("*example.com", "sub.example.com")).toBe(false)
      expect(Network.matchHost("*example.com", "example.com")).toBe(false)
    })

    test("case-insensitive", () => {
      expect(Network.matchHost("EXAMPLE.com", "example.COM")).toBe(true)
      expect(Network.matchHost("*.Example.com", "Sub.EXAMPLE.COM")).toBe(true)
    })

    test("trailing dot is normalized", () => {
      expect(Network.matchHost("localhost.", "localhost")).toBe(true)
      expect(Network.matchHost("localhost", "localhost.")).toBe(true)
      expect(Network.matchHost("*.example.com.", "example.com")).toBe(true)
    })
  })

  describe("isBypassed", () => {
    test("loopback is always bypassed regardless of the bypass list", () => {
      for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]", "0.0.0.0", "foo.localhost"]) {
        expect(Network.isBypassed(host, [])).toBe(true)
        expect(Network.isBypassed(host, ["internal.example.com"])).toBe(true)
      }
    })

    test("wildcard bypass patterns match subdomains and the base", () => {
      expect(Network.isBypassed("a.internal.example.com", ["*.internal.example.com"])).toBe(true)
      expect(Network.isBypassed("internal.example.com", ["*.internal.example.com"])).toBe(true)
      expect(Network.isBypassed("external.example.com", ["*.internal.example.com"])).toBe(false)
    })

    test("non-listed host is not bypassed", () => {
      expect(Network.isBypassed("example.com", [])).toBe(false)
      expect(Network.isBypassed("example.com", ["*.internal.example.com", "other.com"])).toBe(false)
    })
  })

  describe("toChromiumBypass", () => {
    test("bare host becomes exact + subdomain rules", () => {
      expect(Network.toChromiumBypass(["example.com"])).toEqual(["example.com", ".example.com"])
    })

    test("wildcard becomes the same pair on its base", () => {
      expect(Network.toChromiumBypass(["*.example.com"])).toEqual(["example.com", ".example.com"])
    })

    test("malformed wildcard is dropped", () => {
      expect(Network.toChromiumBypass(["*example.com"])).toEqual([])
    })

    test("empty input yields empty list", () => {
      expect(Network.toChromiumBypass([])).toEqual([])
    })
  })

  describe("matchCertificate", () => {
    const entries: Config.ClientCertificate[] = [
      { host: "app.example.com" },
      { host: "app.example.com:8443" },
      { host: "*.example.com" },
    ]

    test("exact host + port beats exact host beats wildcard", () => {
      expect(Network.matchCertificate(entries, "app.example.com", 8443)?.host).toBe("app.example.com:8443")
      expect(Network.matchCertificate(entries, "app.example.com", 9000)?.host).toBe("app.example.com")
      expect(Network.matchCertificate(entries, "other.example.com", 80)?.host).toBe("*.example.com")
    })

    test("a port-pinned entry does not match the same host on another port", () => {
      const pinned: Config.ClientCertificate[] = [{ host: "app.example.com:8443" }]
      expect(Network.matchCertificate(pinned, "app.example.com", 9000)).toBeUndefined()
      expect(Network.matchCertificate(pinned, "app.example.com")).toBeUndefined()
      expect(Network.matchCertificate(pinned, "app.example.com", 8443)).toBeDefined()
    })

    test("scheme prefix and path in the entry host are tolerated", () => {
      const withScheme: Config.ClientCertificate[] = [{ host: "https://app.example.com/x" }]
      expect(Network.matchCertificate(withScheme, "app.example.com", 443)).toBeDefined()
    })

    test("equal-specificity entries: the first one wins", () => {
      const tied: Config.ClientCertificate[] = [
        { host: "app.example.com", certPath: "/first.pem" },
        { host: "app.example.com", certPath: "/second.pem" },
      ]
      expect(Network.matchCertificate(tied, "app.example.com", 443)?.certPath).toBe("/first.pem")
    })
  })

  describe("toProxyUrl", () => {
    test("embeds URL-encoded credentials", () => {
      const url = Network.toProxyUrl("http://127.0.0.1:8080", "us er", "p@ss:word")
      const u = new URL(url)
      expect(u.username).toBe("us%20er")
      expect(decodeURIComponent(u.password)).toBe("p@ss:word")
      expect(u.host).toBe("127.0.0.1:8080")
    })

    test("no auth leaves the url unchanged", () => {
      expect(Network.toProxyUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080")
    })

    test("unparseable url is returned as-is", () => {
      expect(Network.toProxyUrl("::: not a url", "u", "p")).toBe("::: not a url")
    })
  })

  describe("tlsRejectUnauthorized", () => {
    test("per-call insecure_tls=true rejects nothing (returns false)", () => {
      expect(Network.tlsRejectUnauthorized(true, { rejectUnauthorized: true })).toBe(false)
      expect(Network.tlsRejectUnauthorized(true, {})).toBe(false)
    })

    test("per-call insecure_tls=false enforces verification (returns true)", () => {
      expect(Network.tlsRejectUnauthorized(false, {})).toBe(true)
      expect(Network.tlsRejectUnauthorized(false, { rejectUnauthorized: false })).toBe(true)
    })

    test("undefined falls back to config's rejectUnauthorized, defaulting to false", () => {
      expect(Network.tlsRejectUnauthorized(undefined, {})).toBe(false)
      expect(Network.tlsRejectUnauthorized(undefined, { rejectUnauthorized: false })).toBe(false)
      expect(Network.tlsRejectUnauthorized(undefined, { rejectUnauthorized: true })).toBe(true)
    })
  })

  describe("toFetchInit", () => {
    test("proxy lands in init.proxy", () => {
      expect(Network.toFetchInit({ proxy: "http://u:p@127.0.0.1:8080" })).toEqual({ proxy: "http://u:p@127.0.0.1:8080" })
    })

    test("ca/rejectUnauthorized/clientCertificate land in init.tls", () => {
      expect(
        Network.toFetchInit({
          ca: "CA-PEM",
          rejectUnauthorized: true,
          clientCertificate: { cert: "CERT", key: "KEY", passphrase: "PP" },
        }),
      ).toEqual({
        tls: { rejectUnauthorized: true, ca: "CA-PEM", cert: "CERT", key: "KEY", passphrase: "PP" },
      })
    })

    test("empty Outbound produces {} with no tls key", () => {
      const init = Network.toFetchInit({})
      expect(init).toEqual({})
      expect(init).not.toHaveProperty("tls")
    })
  })

  describe("proxyAuthority", () => {
    test("strips credentials, keeps host:port", () => {
      expect(Network.proxyAuthority("http://user:pass@proxy.example.com:8080")).toBe("proxy.example.com:8080")
      expect(Network.proxyAuthority("http://proxy.example.com")).toBe("proxy.example.com")
    })

    test("unparseable url yields a placeholder", () => {
      expect(Network.proxyAuthority("::: not a url")).toBe("(unparseable proxy url)")
    })
  })
})

describe("Config.Network schema", () => {
  test("accepts the documented shape", () => {
    const parsed = Config.Network.safeParse({
      proxy: {
        url: "http://127.0.0.1:8080",
        enabled: true,
        auth: { username: "u", password: "p" },
        bypass: ["*.internal.example.com"],
        includeProviders: false,
      },
      tls: {
        caPath: "/ca.pem",
        rejectUnauthorized: true,
        clientCertificates: [{ host: "app.example.com:8443", certPath: "/c.pem", keyPath: "/k.pem", passphrase: "p" }],
      },
    })
    expect(parsed.success).toBe(true)
  })

  test("rejects unknown keys (strict)", () => {
    expect(Config.Network.safeParse({ bogus: true }).success).toBe(false)
    expect(Config.Network.safeParse({ proxy: { url: "http://127.0.0.1:8080", bogus: 1 } }).success).toBe(false)
    expect(
      Config.Network.safeParse({ tls: { rejectUnauthorized: true, bogus: 1 } }).success,
    ).toBe(false)
  })
})

describe("Config.redactSecrets", () => {
  test("masks the proxy auth password", () => {
    const input = info({ proxy: { url: "http://127.0.0.1:8080", auth: { username: "u", password: "secret" } } })
    const out = Config.redactSecrets(input)
    expect(out.network!.proxy!.auth!.password).toBe(REDACTED)
    expect(out.network!.proxy!.auth!.username).toBe("u")
    expect(out.network!.proxy!.url).toBe("http://127.0.0.1:8080")
  })

  test("masks a password embedded in proxy.url", () => {
    const input = info({ proxy: { url: "http://user:secretpw@proxy.example.com:8080" } })
    const out = Config.redactSecrets(input)
    expect(out.network!.proxy!.url).not.toContain("secretpw")
    expect(out.network!.proxy!.url).toContain("redacted")
    expect(new URL(out.network!.proxy!.url!).username).toBe("user")
    expect(out.network!.proxy!.url!.includes(":8080")).toBe(true)
  })

  test("masks client certificate passphrases", () => {
    const input = info({
      tls: {
        clientCertificates: [
          { host: "a.com", passphrase: "k3y" },
          { host: "b.com", passphrase: "other" },
          { host: "c.com" },
        ],
      },
    })
    const out = Config.redactSecrets(input)
    const certs = out.network!.tls!.clientCertificates!
    expect(certs[0].passphrase).toBe(REDACTED)
    expect(certs[1].passphrase).toBe(REDACTED)
    expect(certs[2].passphrase).toBeUndefined()
    expect(certs.map((c) => c.host)).toEqual(["a.com", "b.com", "c.com"])
  })

  test("returns the same reference when there is nothing to mask", () => {
    const bare = info({})
    expect(Config.redactSecrets(bare)).toBe(bare)
    const noNetwork = {} as Config.Info
    expect(Config.redactSecrets(noNetwork)).toBe(noNetwork)
  })

  test("does not mutate the original", () => {
    const input = info({ proxy: { url: "http://user:secretpw@proxy.example.com", auth: { username: "u", password: "pw" } } })
    const before = JSON.parse(JSON.stringify(input))
    Config.redactSecrets(input)
    expect(input).toEqual(before)
    expect(input.network!.proxy!.auth!.password).toBe("pw")
  })
})

describe("Network config-driven resolution", () => {
  afterEach(async () => {
    await fs.rm(process.env.CYBERSTRIKE_TEST_MANAGED_CONFIG_DIR!, { force: true, recursive: true }).catch(() => {})
  })

  test("no network config resolves to {}", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Network.forHost("example.com")).toEqual({})
        expect(await Network.childEnv()).toEqual({})
      },
    })
  })

  test("enabled proxy is returned with credentials embedded", async () => {
    await using tmp = await tmpdir({
      init: (dir) =>
        writeConfig(dir, {
          network: { proxy: { url: "http://127.0.0.1:8080", auth: { username: "u", password: "p" } } },
        }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = await Network.forHost("example.com")
        expect(out.proxy).toBe("http://u:p@127.0.0.1:8080/")
      },
    })
  })

  test("enabled:false means no proxy", async () => {
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, { network: { proxy: { url: "http://127.0.0.1:8080", enabled: false } } }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await Network.forHost("example.com")).proxy).toBeUndefined()
        expect(await Network.childEnv()).toEqual({})
      },
    })
  })

  test("bypassed host skips the proxy, listed host does not", async () => {
    await using tmp = await tmpdir({
      init: (dir) =>
        writeConfig(dir, {
          network: { proxy: { url: "http://127.0.0.1:8080", bypass: ["*.internal.example.com"] } },
        }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await Network.forHost("a.internal.example.com")).proxy).toBeUndefined()
        expect((await Network.forHost("external.example.com")).proxy).toBe("http://127.0.0.1:8080")
      },
    })
  })

  test("loopback hosts skip the proxy even with an empty bypass list", async () => {
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, { network: { proxy: { url: "http://127.0.0.1:8080" } } }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await Network.forHost("127.0.0.1")).proxy).toBeUndefined()
        expect((await Network.forHost("localhost")).proxy).toBeUndefined()
      },
    })
  })

  test("tls.caPath resolves to the file contents and rejectUnauthorized is carried", async () => {
    await using tmp = await tmpdir<string>({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ca.pem"), "FAKE-CA-PEM")
        await writeConfig(dir, {
          network: { tls: { caPath: path.join(dir, "ca.pem"), rejectUnauthorized: true } },
        })
        return path.join(dir, "ca.pem")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = await Network.forHost("example.com")
        expect(out.ca).toBe("FAKE-CA-PEM")
        expect(out.rejectUnauthorized).toBe(true)
      },
    })
  })

  test("client certificate matched by host loads cert/key contents and passphrase", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "cert.pem"), "CERT-PEM")
        await Bun.write(path.join(dir, "key.pem"), "KEY-PEM")
        await writeConfig(dir, {
          network: {
            tls: {
              clientCertificates: [
                { host: "app.example.com", certPath: path.join(dir, "cert.pem"), keyPath: path.join(dir, "key.pem"), passphrase: "pp" },
              ],
            },
          },
        })
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = await Network.forHost("app.example.com", 443)
        expect(out.clientCertificate).toEqual({ cert: "CERT-PEM", key: "KEY-PEM", passphrase: "pp" })
        expect((await Network.forHost("other.example.com", 443)).clientCertificate).toBeUndefined()
      },
    })
  })

  test("port-pinned certificate only chosen when the port matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "cert.pem"), "CERT-PEM")
        await Bun.write(path.join(dir, "key.pem"), "KEY-PEM")
        await writeConfig(dir, {
          network: {
            tls: {
              clientCertificates: [
                { host: "app.example.com:8443", certPath: path.join(dir, "cert.pem"), keyPath: path.join(dir, "key.pem") },
              ],
            },
          },
        })
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await Network.forHost("app.example.com", 9000)).clientCertificate).toBeUndefined()
        const out = await Network.forHost("app.example.com", 8443)
        expect(out.clientCertificate).toEqual({ cert: "CERT-PEM", key: "KEY-PEM", passphrase: undefined })
      },
    })
  })

  test("forBrowser: proxy with loopback + chromium bypass list", async () => {
    await using tmp = await tmpdir({
      init: (dir) =>
        writeConfig(dir, {
          network: { proxy: { url: "http://127.0.0.1:8080", bypass: ["*.internal.example.com"] } },
        }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const browser = await Network.forBrowser()
        expect(browser.proxy?.server).toBe("http://127.0.0.1:8080")
        const bypass = browser.proxy!.bypass!.split(",")
        for (const entry of ["localhost", ".localhost", "127.0.0.1", "::1", "internal.example.com", ".internal.example.com"]) {
          expect(bypass).toContain(entry)
        }
      },
    })
  })

  test("forBrowser: socks proxy with auth throws", async () => {
    await using tmp = await tmpdir({
      init: (dir) =>
        writeConfig(dir, {
          network: { proxy: { url: "socks5://127.0.0.1:1080", auth: { username: "u", password: "p" } } },
        }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Network.forBrowser()).rejects.toThrow()
      },
    })
  })

  test("forBrowser: rejectUnauthorized:true maps to ignoreHTTPSErrors false", async () => {
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, { network: { tls: { rejectUnauthorized: true } } }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await Network.forBrowser()).ignoreHTTPSErrors).toBe(false)
      },
    })
  })

  test("childEnv sets proxy env vars and a loopback NO_PROXY", async () => {
    await using tmp = await tmpdir({
      init: (dir) =>
        writeConfig(dir, {
          network: { proxy: { url: "http://127.0.0.1:8080", bypass: ["*.internal.example.com"] } },
        }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const env = await Network.childEnv()
        for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]) {
          expect(env[key]).toBe("http://127.0.0.1:8080")
        }
        const noProxy = env.NO_PROXY!.split(",")
        for (const entry of ["localhost", ".localhost", "127.0.0.1", "::1", "internal.example.com", ".internal.example.com"]) {
          expect(noProxy).toContain(entry)
        }
        expect(env.no_proxy).toBe(env.NO_PROXY)
      },
    })
  })

  test("childEnv throws on a socks proxy", async () => {
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, { network: { proxy: { url: "socks5://127.0.0.1:1080" } } }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Network.childEnv()).rejects.toThrow()
      },
    })
  })

  test("forUrl derives the port from the https scheme and matches a port-pinned certificate", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "cert.pem"), "CERT-PEM")
        await Bun.write(path.join(dir, "key.pem"), "KEY-PEM")
        await writeConfig(dir, {
          network: {
            proxy: { url: "http://127.0.0.1:8080" },
            tls: {
              clientCertificates: [
                { host: "app.example.com:443", certPath: path.join(dir, "cert.pem"), keyPath: path.join(dir, "key.pem"), passphrase: "pp" },
              ],
            },
          },
        })
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = await Network.forUrl("https://app.example.com/x")
        expect(out.proxy).toBe("http://127.0.0.1:8080")
        expect(out.clientCertificate).toEqual({ cert: "CERT-PEM", key: "KEY-PEM", passphrase: "pp" })
      },
    })
  })

  test("forUrl on a bypassed or loopback host skips the proxy", async () => {
    await using tmp = await tmpdir({
      init: (dir) =>
        writeConfig(dir, {
          network: { proxy: { url: "http://127.0.0.1:8080", bypass: ["*.internal.example.com"] } },
        }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await Network.forUrl("https://a.internal.example.com/")).proxy).toBeUndefined()
        expect((await Network.forUrl("http://localhost:3000/")).proxy).toBeUndefined()
      },
    })
  })

  test("forUrl returns {} for an unparseable url", async () => {
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, { network: { proxy: { url: "http://127.0.0.1:8080" } } }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Network.forUrl("not a url")).toEqual({})
      },
    })
  })
})

describe("BackendFetch.send proxy routing (wire)", () => {
  const CRLF = "\r\n"
  let origin: ReturnType<typeof Bun.serve>
  let proxy: ReturnType<typeof Bun.serve>
  let proxySaw = ""

  beforeAll(() => {
    origin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("origin-direct", { headers: { "x-who": "origin" } }),
    })
    proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        proxySaw = req.url
        return new Response("via-proxy", { headers: { "x-who": "proxy" } })
      },
    })
  })

  afterAll(() => {
    origin.stop(true)
    proxy.stop(true)
    for (const [key, value] of ambientProxy) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  function probeRequest(): HttpMessage.Request {
    // Host must match the real origin authority: Bun's fetch honors an explicit
    // Host header (unlike spec-compliant engines) and Bun.serve answers 502
    // when it names a different host:port than the server.
    return HttpMessage.parse(["GET /probe HTTP/1.1", `Host: 127.0.0.1:${origin.port}`, "", ""].join(CRLF))
  }

  test("with opts.proxy the request is answered by the proxy, not the origin", async () => {
    proxySaw = ""
    const r = await BackendFetch.send(probeRequest(), {
      origin: `http://127.0.0.1:${origin.port}`,
      proxy: `http://127.0.0.1:${proxy.port}`,
      totalTimeoutMs: 5000,
    })
    expect(r.error).toBeUndefined()
    expect(r.response?.status).toBe(200)
    expect(new TextDecoder().decode(r.response!.body)).toBe("via-proxy")
    expect(proxySaw).toContain(`/probe`)
  })

  test("without opts.proxy the request reaches the origin directly (unchanged behavior)", async () => {
    proxySaw = ""
    const r = await BackendFetch.send(probeRequest(), {
      origin: `http://127.0.0.1:${origin.port}`,
      totalTimeoutMs: 5000,
    })
    expect(r.error).toBeUndefined()
    expect(r.response?.status).toBe(200)
    expect(new TextDecoder().decode(r.response!.body)).toBe("origin-direct")
    expect(proxySaw).toBe("")
  })
})
