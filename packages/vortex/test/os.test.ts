import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, osRules } from "../src/index"

const rules = compileRules(osRules)
function tx(over: { body?: string; respHeaders?: [string, string][] }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/", headers: [] },
    response: { status: 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
  }
}
const fired = (t: Transaction) => rules.flatMap((r) => r.evaluate(t)).map((s) => s.ruleId)
const S = (v: string): { respHeaders: [string, string][] } => ({ respHeaders: [["server", v]] })

describe("operating system fingerprint rules", () => {
  test("Ubuntu via Apache server token", () => {
    expect(fired(tx(S("Apache/2.4.52 (Ubuntu)")))).toContain("tech-os-ubuntu")
  })
  test("Windows Server via IIS", () => {
    expect(fired(tx(S("Microsoft-IIS/10.0")))).toContain("tech-os-windows-server")
  })
  test("Windows Server via ASP.NET x-powered-by", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "ASP.NET"]] }))).toContain("tech-os-windows-server")
  })
  test("Windows Server via Win64 token", () => {
    expect(fired(tx(S("Apache/2.4.57 (Win64) OpenSSL/3.1.0 PHP/8.2")))).toContain("tech-os-windows-server")
  })
  test("UNIX via server token", () => {
    expect(fired(tx(S("Apache/2.4.6 (Unix)")))).toContain("tech-os-unix")
  })
  test("Debian via server token", () => {
    expect(fired(tx(S("Apache/2.4.57 (Debian)")))).toContain("tech-os-debian")
  })
  test("CentOS via server token", () => {
    expect(fired(tx(S("Apache/2.4.6 (CentOS) PHP/7.4")))).toContain("tech-os-centos")
  })
  test("AlmaLinux via server token", () => {
    expect(fired(tx(S("Apache/2.4.57 (AlmaLinux)")))).toContain("tech-os-almalinux")
  })
  test("Red Hat via server token", () => {
    expect(fired(tx(S("Apache/2.4.57 (Red Hat Enterprise Linux)")))).toContain("tech-os-redhat")
  })
  test("FreeBSD via server token", () => {
    expect(fired(tx(S("Apache/2.4.57 (FreeBSD)")))).toContain("tech-os-freebsd")
  })
  test("Oracle Linux via server token", () => {
    expect(fired(tx(S("Apache/2.4.6 (Oracle Linux)")))).toContain("tech-os-oracle-linux")
  })
  test("Fedora via server token", () => {
    expect(fired(tx(S("Apache/2.4.57 (Fedora Linux)")))).toContain("tech-os-fedora")
  })
  test("Gentoo via server token", () => {
    expect(fired(tx(S("Apache/2.4.57 (Gentoo)")))).toContain("tech-os-gentoo")
  })
  test("SUSE via server token", () => {
    expect(fired(tx(S("Apache/2.4.51 (SUSE Linux)")))).toContain("tech-os-suse")
  })
  test("Raspbian via server token", () => {
    expect(fired(tx(S("Apache/2.4.38 (Raspbian)")))).toContain("tech-os-raspbian")
  })
  test("Scientific Linux via server token", () => {
    expect(fired(tx(S("Apache/2.2.15 (Scientific Linux)")))).toContain("tech-os-scientific-linux")
  })
  test("UniFi OS via server header", () => {
    expect(fired(tx(S("UniFi OS")))).toContain("tech-os-unifi")
  })
  test("Windows CE via server token", () => {
    expect(fired(tx(S("Windows CE")))).toContain("tech-os-windows-ce")
  })
  test("YunoHost via server header", () => {
    expect(fired(tx(S("nginx (YunoHost)")))).toContain("tech-os-yunohost")
  })
  test("Darwin via server token", () => {
    expect(fired(tx(S("Apache/2.4.57 (Darwin)")))).toContain("tech-os-darwin")
  })
  test("SunOS via server token", () => {
    expect(fired(tx(S("Apache/2.2.3 (SunOS)")))).toContain("tech-os-sunos")
  })

  // --- Structural ---
  test("a hardened server with no OS token triggers no OS rules", () => {
    expect(fired(tx(S("Apache")))).toHaveLength(0)
  })
  test("a plain page with no server header triggers no OS rules", () => {
    expect(fired(tx({ body: "<html><body>Hello</body></html>" }))).toHaveLength(0)
  })
  test("all rule IDs start with tech-os-", () => {
    for (const r of osRules) expect(r.id).toMatch(/^tech-os-/)
  })
  test("all rules have os tag", () => {
    for (const r of osRules) expect(r.tags).toContain("os")
  })
  test("rule count is 19", () => {
    expect(osRules.length).toBe(19)
  })
})
