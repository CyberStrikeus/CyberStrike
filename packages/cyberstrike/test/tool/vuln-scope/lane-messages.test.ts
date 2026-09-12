import { describe, test, expect } from "bun:test"
import { offLaneMessage, dispatchOffLaneMessage, TESTER_VRT_SCOPE } from "../../../src/tool/vuln-scope"

describe("offLaneMessage", () => {
  test("includes the tester class in message", () => {
    const msg = offLaneMessage("input-validation", TESTER_VRT_SCOPE["input-validation"], "idor")
    expect(msg).toContain("wstg-input-validation")
  })

  test("includes the offending category", () => {
    const msg = offLaneMessage("input-validation", TESTER_VRT_SCOPE["input-validation"], "idor")
    expect(msg).toContain('"idor"')
  })

  test("includes allowed categories as comma-separated list", () => {
    const allowed = TESTER_VRT_SCOPE["authorization"]
    const msg = offLaneMessage("authorization", allowed, "sqli")
    for (const a of allowed) expect(msg).toContain(a)
  })

  test("mentions add_intel hand-off mechanism", () => {
    const msg = offLaneMessage("input-validation", TESTER_VRT_SCOPE["input-validation"], "idor")
    expect(msg).toContain("add_intel")
    expect(msg).toContain("vulnerability_hint")
  })

  test("instructs not to test or record", () => {
    const msg = offLaneMessage("authorization", TESTER_VRT_SCOPE["authorization"], "xss")
    expect(msg).toContain("do NOT test or record")
  })
})

describe("dispatchOffLaneMessage", () => {
  test("includes the wrong tester class", () => {
    const msg = dispatchOffLaneMessage("input-validation", "authorization")
    expect(msg).toContain("wstg-input-validation")
  })

  test("includes the correct target tester class", () => {
    const msg = dispatchOffLaneMessage("input-validation", "authorization")
    expect(msg).toContain("wstg-authorization")
  })

  test("mentions re-dispatch instruction", () => {
    const msg = dispatchOffLaneMessage("authentication", "input-validation")
    expect(msg).toContain("Re-dispatch")
    expect(msg).toContain("wstg-input-validation")
  })

  test("identifies the objective as wrong lane", () => {
    const msg = dispatchOffLaneMessage("business-logic", "input-validation")
    expect(msg).toContain("wstg-input-validation's lane")
    expect(msg).toContain("not wstg-business-logic's")
  })
})
