import { describe, expect, test } from "bun:test"
import { NmapScanParameters } from "../../src/tool/nmap-scan"

describe("nmap_scan parameters", () => {
  test("accepts domains, IPs, ranges, and CIDRs", () => {
    for (const target of ["example.test", "192.0.2.10", "192.0.2.0/24", "192.0.2.10-20", "2001:db8::1"]) {
      expect(NmapScanParameters.Target.parse(target)).toBe(target)
    }
  })

  test("rejects option injection and shell syntax", () => {
    for (const target of ["-iL targets.txt", "example.test;id", "example.test --script vuln"]) {
      expect(NmapScanParameters.Target.safeParse(target).success).toBe(false)
    }
  })

  test("limits ports to numeric Nmap syntax", () => {
    expect(NmapScanParameters.Ports.parse("22,80,443,8000-8100")).toBe("22,80,443,8000-8100")
    expect(NmapScanParameters.Ports.safeParse("http,https").success).toBe(false)
  })
})
