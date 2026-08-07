import { describe, test, expect } from "bun:test"

// Standalone copies of payload constants from inject-probe.ts (not exported)
const SSTI_A = 7919
const SSTI_B = 6841
const SSTI_EXPR = `${SSTI_A}*${SSTI_B}`
const SSTI_PRODUCT = String(SSTI_A * SSTI_B)
const SSTI_SYNTAXES: { name: string; wrap: (e: string) => string }[] = [
  { name: "{{ }}", wrap: (e) => `{{${e}}}` },
  { name: "${ }", wrap: (e) => `\${${e}}` },
  { name: "#{ }", wrap: (e) => `#{${e}}` },
  { name: "<%= %>", wrap: (e) => `<%= ${e} %>` },
  { name: "@( )", wrap: (e) => `@(${e})` },
  { name: "%{ }", wrap: (e) => `%{${e}}` },
  { name: "*{ }", wrap: (e) => `*{${e}}` },
  { name: "[[${ }]]", wrap: (e) => `[[\${${e}}]]` },
  { name: "{{= }}", wrap: (e) => `{{=${e}}}` },
]

const CMD_PROBES: { cmd: string; marker: RegExp; os: string }[] = [
  { cmd: "id", marker: /\buid=\d+\(/i, os: "unix" },
  { cmd: "i''d", marker: /\buid=\d+\(/i, os: "unix" },
  { cmd: "i\\d", marker: /\buid=\d+\(/i, os: "unix" },
  { cmd: "ver", marker: /windows \[version/i, os: "windows" },
  { cmd: "v^er", marker: /windows \[version/i, os: "windows" },
]

const LFI_TARGETS: { file: string; sig: RegExp; os: "unix" | "windows" }[] = [
  { file: "etc/passwd", sig: /root:[^:\r\n]*:0:0:/, os: "unix" },
  { file: "windows/win.ini", sig: /\[fonts\]|\[extensions\]|for 16-bit app support/i, os: "windows" },
  {
    file: "windows/system32/drivers/etc/hosts",
    sig: /# Copyright.{0,40}Microsoft|127\.0\.0\.1\s+localhost/i,
    os: "windows",
  },
  { file: "boot.ini", sig: /\[boot loader\]/i, os: "windows" },
]

const ERRSIG_SQLI =
  /SQL syntax|mysql_|ORA-\d{5}|PG::SyntaxError|sqlite3?\.|SQLSTATE|quoted string not properly terminated|unclosed quotation|near ".*": syntax error|syntax error at or near|Microsoft OLE DB|ODBC SQL Server|JET Database|SQLite3::/i

describe("SSTI payload constants", () => {
  test("SSTI_PRODUCT is the correct multiplication result", () => {
    expect(SSTI_A * SSTI_B).toBe(54173879)
    expect(SSTI_PRODUCT).toBe("54173879")
  })

  test("SSTI_PRODUCT is 8 digits — distinctive enough to avoid coincidence", () => {
    expect(SSTI_PRODUCT.length).toBe(8)
  })

  test("SSTI_EXPR does not appear in the product — prevents false evaluation match", () => {
    expect(SSTI_PRODUCT).not.toContain(SSTI_EXPR)
  })

  test("all SSTI syntaxes produce payloads containing the expression", () => {
    for (const s of SSTI_SYNTAXES) {
      const payload = s.wrap(SSTI_EXPR)
      expect(payload).toContain(String(SSTI_A))
      expect(payload).toContain(String(SSTI_B))
    }
  })

  test("Jinja2 syntax wraps correctly", () => {
    expect(SSTI_SYNTAXES[0].wrap("7*7")).toBe("{{7*7}}")
  })

  test("ERB syntax wraps correctly", () => {
    expect(SSTI_SYNTAXES[3].wrap("7*7")).toBe("<%= 7*7 %>")
  })

  test("Razor syntax wraps correctly", () => {
    expect(SSTI_SYNTAXES[4].wrap("7*7")).toBe("@(7*7)")
  })
})

describe("CMD probe markers", () => {
  test("unix id marker matches standard id output", () => {
    expect(CMD_PROBES[0].marker.test("uid=0(root) gid=0(root) groups=0(root)")).toBe(true)
  })

  test("unix id marker matches non-root user", () => {
    expect(CMD_PROBES[0].marker.test("uid=1000(www-data) gid=1000(www-data)")).toBe(true)
  })

  test("unix id marker does not match random text", () => {
    expect(CMD_PROBES[0].marker.test("user profile page")).toBe(false)
  })

  test("windows ver marker matches version output", () => {
    expect(CMD_PROBES[3].marker.test("Microsoft Windows [Version 10.0.19041.1237]")).toBe(true)
  })

  test("windows ver marker does not match random text", () => {
    expect(CMD_PROBES[3].marker.test("Windows-like operating system")).toBe(false)
  })

  test("evasion variants use same markers as base commands", () => {
    expect(CMD_PROBES[1].marker).toEqual(CMD_PROBES[0].marker)
    expect(CMD_PROBES[2].marker).toEqual(CMD_PROBES[0].marker)
    expect(CMD_PROBES[4].marker).toEqual(CMD_PROBES[3].marker)
  })

  test("all probes are read-only commands only", () => {
    const cmds = CMD_PROBES.map((p) => p.cmd.replace(/['^\\]/g, ""))
    for (const cmd of cmds) {
      expect(["id", "ver"]).toContain(cmd)
    }
  })
})

describe("LFI target signatures", () => {
  test("/etc/passwd signature matches real passwd format", () => {
    expect(LFI_TARGETS[0].sig.test("root:x:0:0:root:/root:/bin/bash")).toBe(true)
  })

  test("/etc/passwd signature matches minimal format", () => {
    expect(LFI_TARGETS[0].sig.test("root::0:0::/:")).toBe(true)
  })

  test("/etc/passwd signature does not match random text", () => {
    expect(LFI_TARGETS[0].sig.test("Welcome to the application")).toBe(false)
  })

  test("win.ini signature matches real content", () => {
    expect(LFI_TARGETS[1].sig.test("[fonts]\r\nTimes New Roman")).toBe(true)
    expect(LFI_TARGETS[1].sig.test("; for 16-bit app support")).toBe(true)
  })

  test("hosts file signature matches", () => {
    expect(LFI_TARGETS[2].sig.test("# Copyright (c) Microsoft Corp.")).toBe(true)
    expect(LFI_TARGETS[2].sig.test("127.0.0.1  localhost")).toBe(true)
  })

  test("boot.ini signature matches", () => {
    expect(LFI_TARGETS[3].sig.test("[boot loader]\ntimeout=30")).toBe(true)
  })
})

describe("SQLi error signatures", () => {
  test("matches MySQL syntax error", () => {
    expect(ERRSIG_SQLI.test("You have an error in your SQL syntax near")).toBe(true)
  })

  test("matches PostgreSQL error", () => {
    expect(ERRSIG_SQLI.test("PG::SyntaxError: ERROR: syntax error")).toBe(true)
  })

  test("matches Oracle error", () => {
    expect(ERRSIG_SQLI.test("ORA-01756: quoted string not properly terminated")).toBe(true)
  })

  test("matches SQLite error", () => {
    expect(ERRSIG_SQLI.test("sqlite3.OperationalError: near")).toBe(true)
  })

  test("matches MSSQL error", () => {
    expect(ERRSIG_SQLI.test("Microsoft OLE DB Provider for SQL Server")).toBe(true)
  })

  test("does not match normal application text", () => {
    expect(ERRSIG_SQLI.test("Welcome to our SQL tutorial page")).toBe(false)
  })
})
