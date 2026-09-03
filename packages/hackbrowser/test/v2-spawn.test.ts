import { describe, expect, test } from "bun:test"
import { buildProfileArgs, defaultExtensionPath } from "../src/v2/spawn.ts"

// Real extension dir (has manifest.json); a fake browser path so we never depend on an
// installed browser and never actually spawn.
const EXT = defaultExtensionPath()
const BROWSER = "/fake/Chrome"
const base = (over: Partial<Parameters<typeof buildProfileArgs>[0]> = {}) =>
  buildProfileArgs({ url: "https://target.example.com", extPath: EXT, browser: BROWSER, ...over })

describe("buildProfileArgs", () => {
  test("injects cred + session into the URL hash", () => {
    const b = base({ cred: "admin", session: "ses_1" })
    expect(b.args[b.args.length - 1]).toBe("https://target.example.com#__cs_cred=admin&__cs_sess=ses_1")
  })
  test("anonymous (no cred) with session → session-only hash", () => {
    const b = base({ session: "ses_1" })
    expect(b.args[b.args.length - 1]).toBe("https://target.example.com#__cs_sess=ses_1")
  })
  test("csUrl is injected so the extension calls back to THIS server", () => {
    const b = base({ session: "ses_1", csUrl: "http://localhost:5173" })
    expect(b.args[b.args.length - 1]).toBe(
      "https://target.example.com#__cs_sess=ses_1&__cs_url=http%3A%2F%2Flocalhost%3A5173",
    )
  })
  test("no cred, no session → bare url", () => {
    const b = base()
    expect(b.args[b.args.length - 1]).toBe("https://target.example.com")
  })
  test("profileDir derives from cred, default otherwise", () => {
    expect(base({ cred: "admin" }).profileDir).toEndWith("hb2-profile-admin")
    expect(base().profileDir).toEndWith("hb2-profile-default")
  })
  test("distinct creds → distinct profile dirs (separate cookie jars)", () => {
    expect(base({ cred: "admin" }).profileDir).not.toBe(base({ cred: "user" }).profileDir)
  })
  test("carries the managed-mode flags + extension", () => {
    const b = base({ cred: "x" })
    expect(b.args).toContain("--silent-debugger-extension-api")
    expect(b.args).toContain("--new-window")
    expect(b.args.some((a) => a.startsWith("--load-extension="))).toBe(true)
    expect(b.args.some((a) => a.startsWith("--user-data-dir="))).toBe(true)
  })
  test("disables Local/Private Network Access so the extension can reach localhost CS", () => {
    const f = base({ cred: "x" }).args.find((a) => a.startsWith("--disable-features="))
    expect(f).toBeDefined()
    expect(f).toContain("LocalNetworkAccessChecks")
  })
  test("target url is still the last arg (flags precede it)", () => {
    const b = base({ cred: "x", session: "s1" })
    expect(b.args[b.args.length - 1]).toBe("https://target.example.com#__cs_cred=x&__cs_sess=s1")
  })
  test("headless adds --headless=new", () => {
    expect(base({ headless: true }).args).toContain("--headless=new")
    expect(base().args).not.toContain("--headless=new")
  })
  test("encodes special chars in the role label", () => {
    const b = base({ cred: "role with space" })
    expect(b.args[b.args.length - 1]).toContain("__cs_cred=role%20with%20space")
  })
  test("throws when the extension dir has no manifest", () => {
    expect(() => buildProfileArgs({ url: "https://x", extPath: "/no/such/dir", browser: BROWSER })).toThrow(
      /extension not found/,
    )
  })
  test("throws when no browser is available", () => {
    expect(() => buildProfileArgs({ url: "https://x", extPath: EXT, browser: "" })).toThrow(
      /no extension-capable browser/,
    )
  })
})
