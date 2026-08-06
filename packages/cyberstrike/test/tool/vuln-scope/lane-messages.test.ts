import { describe, test, expect } from "bun:test"
import { offLaneMessage, dispatchOffLaneMessage, TESTER_VRT_SCOPE } from "../../../src/tool/vuln-scope"

describe("offLaneMessage", () => {
  test("includes the tester class in message", () => {
    const msg = offLaneMessage("injection", TESTER_VRT_SCOPE["injection"], "idor")
    expect(msg).toContain("proxy-tester-injection")
  })

  test("includes the offending category", () => {
    const msg = offLaneMessage("injection", TESTER_VRT_SCOPE["injection"], "idor")
    expect(msg).toContain('"idor"')
  })

  test("includes allowed categories as comma-separated list", () => {
    const allowed = TESTER_VRT_SCOPE["idor"]
    const msg = offLaneMessage("idor", allowed, "sqli")
    for (const a of allowed) expect(msg).toContain(a)
  })

  test("mentions add_intel hand-off mechanism", () => {
    const msg = offLaneMessage("injection", TESTER_VRT_SCOPE["injection"], "ssrf")
    expect(msg).toContain("add_intel")
    expect(msg).toContain("vulnerability_hint")
  })

  test("instructs not to test or record", () => {
    const msg = offLaneMessage("ssrf", TESTER_VRT_SCOPE["ssrf"], "xss")
    expect(msg).toContain("do NOT test or record")
  })
})

describe("dispatchOffLaneMessage", () => {
  test("includes the wrong tester class", () => {
    const msg = dispatchOffLaneMessage("injection", "idor")
    expect(msg).toContain("proxy-tester-injection")
  })

  test("includes the correct target tester class", () => {
    const msg = dispatchOffLaneMessage("injection", "idor")
    expect(msg).toContain("proxy-tester-idor")
  })

  test("mentions re-dispatch instruction", () => {
    const msg = dispatchOffLaneMessage("authn", "file-attacks")
    expect(msg).toContain("Re-dispatch")
    expect(msg).toContain("proxy-tester-file-attacks")
  })

  test("identifies the objective as wrong lane", () => {
    const msg = dispatchOffLaneMessage("ssrf", "injection")
    expect(msg).toContain("proxy-tester-injection's lane")
    expect(msg).toContain("not proxy-tester-ssrf's")
  })
})
