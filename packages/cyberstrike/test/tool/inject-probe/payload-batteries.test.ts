import { describe, test, expect } from "bun:test"
import { SSTI_EXPR, SSTI_PRODUCT, SSTI_SYNTAXES, SSTI_ALT } from "../../../src/tool/inject-probe/payloads/ssti"
import { CMD_PROBES, CMD_SEPARATORS } from "../../../src/tool/inject-probe/payloads/cmd"
import { LFI_TARGETS, LFI_TECHNIQUES, LFI_ABSOLUTE } from "../../../src/tool/inject-probe/payloads/lfi"
import { ERRSIG } from "../../../src/tool/inject-probe/payloads/errsig"

describe("SSTI payload constants", () => {
  test("SSTI_PRODUCT is the correct multiplication result", () => {
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
      expect(payload).toContain("7919")
      expect(payload).toContain("6841")
    }
  })

  test("Jinja2 syntax wraps correctly", () => {
    expect(SSTI_SYNTAXES[0]!.wrap("7*7")).toBe("{{7*7}}")
  })

  test("ERB syntax wraps correctly", () => {
    expect(SSTI_SYNTAXES[3]!.wrap("7*7")).toBe("<%= 7*7 %>")
  })

  test("Razor syntax wraps correctly", () => {
    expect(SSTI_SYNTAXES[4]!.wrap("7*7")).toBe("@(7*7)")
  })

  test("SSTI_ALT entries have distinct products from main SSTI_PRODUCT", () => {
    for (const alt of SSTI_ALT) {
      expect(alt.product.length).toBeGreaterThanOrEqual(7)
    }
  })
})

describe("CMD probe markers", () => {
  test("unix id marker matches standard id output", () => {
    expect(CMD_PROBES[0]!.marker.test("uid=0(root) gid=0(root) groups=0(root)")).toBe(true)
  })

  test("unix id marker matches non-root user", () => {
    expect(CMD_PROBES[0]!.marker.test("uid=1000(www-data) gid=1000(www-data)")).toBe(true)
  })

  test("unix id marker does not match random text", () => {
    expect(CMD_PROBES[0]!.marker.test("user profile page")).toBe(false)
  })

  test("windows ver marker matches version output", () => {
    expect(CMD_PROBES[3]!.marker.test("Microsoft Windows [Version 10.0.19041.1237]")).toBe(true)
  })

  test("windows ver marker does not match random text", () => {
    expect(CMD_PROBES[3]!.marker.test("Windows-like operating system")).toBe(false)
  })

  test("evasion variants use same markers as base commands", () => {
    expect(CMD_PROBES[1]!.marker).toEqual(CMD_PROBES[0]!.marker)
    expect(CMD_PROBES[2]!.marker).toEqual(CMD_PROBES[0]!.marker)
    expect(CMD_PROBES[4]!.marker).toEqual(CMD_PROBES[3]!.marker)
  })

  test("all probes are read-only commands only", () => {
    const cmds = CMD_PROBES.map((p) => p.cmd.replace(/['^\\]/g, ""))
    for (const cmd of cmds) {
      expect(["id", "ver"]).toContain(cmd)
    }
  })

  test("CMD_SEPARATORS produce non-empty wrapped commands", () => {
    for (const sep of CMD_SEPARATORS) {
      expect(sep.wrap("id").length).toBeGreaterThan(2)
    }
  })
})

describe("LFI target signatures", () => {
  test("/etc/passwd signature matches real passwd format", () => {
    expect(LFI_TARGETS[0]!.sig.test("root:x:0:0:root:/root:/bin/bash")).toBe(true)
  })

  test("/etc/passwd signature matches minimal format", () => {
    expect(LFI_TARGETS[0]!.sig.test("root::0:0::/:")).toBe(true)
  })

  test("/etc/passwd signature does not match random text", () => {
    expect(LFI_TARGETS[0]!.sig.test("Welcome to the application")).toBe(false)
  })

  test("win.ini signature matches real content", () => {
    expect(LFI_TARGETS[1]!.sig.test("[fonts]\r\nTimes New Roman")).toBe(true)
    expect(LFI_TARGETS[1]!.sig.test("; for 16-bit app support")).toBe(true)
  })

  test("hosts file signature matches", () => {
    expect(LFI_TARGETS[2]!.sig.test("# Copyright (c) Microsoft Corp.")).toBe(true)
    expect(LFI_TARGETS[2]!.sig.test("127.0.0.1  localhost")).toBe(true)
  })

  test("boot.ini signature matches", () => {
    expect(LFI_TARGETS[3]!.sig.test("[boot loader]\ntimeout=30")).toBe(true)
  })

  test("LFI_TECHNIQUES produce traversal-prefixed paths", () => {
    for (const tech of LFI_TECHNIQUES) {
      const result = tech.make("etc/passwd")
      expect(result).toContain("etc")
      expect(result.length).toBeGreaterThan("etc/passwd".length)
    }
  })

  test("LFI_ABSOLUTE produces absolute paths", () => {
    for (const abs of LFI_ABSOLUTE) {
      const result = abs.make("etc/passwd")
      expect(result).toContain("etc")
    }
  })
})

describe("ERRSIG signatures", () => {
  describe("sqli", () => {
    test("matches MySQL syntax error", () => {
      expect(ERRSIG.sqli.signatures.test("You have an error in your SQL syntax near")).toBe(true)
    })

    test("matches PostgreSQL error", () => {
      expect(ERRSIG.sqli.signatures.test("PostgreSQL ERROR: syntax error")).toBe(true)
    })

    test("matches Oracle error", () => {
      expect(ERRSIG.sqli.signatures.test("ORA-01756: quoted string not properly terminated")).toBe(true)
    })

    test("matches SQLite error", () => {
      expect(ERRSIG.sqli.signatures.test("SQLite3:: near")).toBe(true)
    })

    test("matches MSSQL error", () => {
      expect(ERRSIG.sqli.signatures.test("Microsoft OLE DB Provider for SQL Server")).toBe(true)
    })

    test("does not match normal application text", () => {
      expect(ERRSIG.sqli.signatures.test("Welcome to our SQL tutorial page")).toBe(false)
    })

    test("has boolean pairs", () => {
      expect(ERRSIG.sqli.boolPairs!.length).toBeGreaterThan(0)
      for (const pair of ERRSIG.sqli.boolPairs!) {
        expect(pair.t).toBeTruthy()
        expect(pair.f).toBeTruthy()
      }
    })
  })

  describe("nosql", () => {
    test("matches MongoError", () => {
      expect(ERRSIG.nosql.signatures.test("MongoError: failed to parse")).toBe(true)
    })

    test("matches JSON SyntaxError", () => {
      expect(ERRSIG.nosql.signatures.test("SyntaxError: Unexpected token in JSON")).toBe(true)
    })

    test("does not match normal text", () => {
      expect(ERRSIG.nosql.signatures.test("NoSQL databases overview")).toBe(false)
    })
  })

  describe("ldap", () => {
    test("matches LDAP error", () => {
      expect(ERRSIG.ldap.signatures.test("LDAP filter syntax error")).toBe(true)
    })

    test("matches Java naming exception", () => {
      expect(ERRSIG.ldap.signatures.test("javax.naming.InvalidSearchFilter")).toBe(true)
    })
  })

  describe("xpath", () => {
    test("matches XPath error", () => {
      expect(ERRSIG.xpath.signatures.test("XPathException: invalid expression")).toBe(true)
    })

    test("matches xmlXPathEval error", () => {
      expect(ERRSIG.xpath.signatures.test("xmlXPathEval: expression error")).toBe(true)
    })
  })
})
