import { describe, test, expect } from "bun:test"
import { readManifest, hasManifest, DomainManifest } from "../../src/cloud/domain-manifest"

describe("domain manifest (package.json `cyberstrike` field)", () => {
  test("absent field is not an error — the package just isn't a domain", () => {
    const r = readManifest({ name: "left-pad", version: "1.0.0" })
    expect(r.manifest).toBeUndefined()
    expect(r.error).toBeUndefined()
    expect(hasManifest({ name: "left-pad" })).toBe(false)
  })

  test("a valid manifest parses with all fields", () => {
    const r = readManifest({
      name: "@foo/aws-pro",
      cyberstrike: { coreApi: "1.2.0", domains: ["aws"], tools: ["aws_iam_probe"], tier: "pro" },
    })
    expect(r.error).toBeUndefined()
    expect(r.manifest).toEqual({ coreApi: "1.2.0", domains: ["aws"], tools: ["aws_iam_probe"], tier: "pro" })
    expect(hasManifest({ cyberstrike: { coreApi: "1.2.0" } })).toBe(true)
  })

  test("an empty manifest object is valid (all fields optional)", () => {
    const r = readManifest({ cyberstrike: {} })
    expect(r.error).toBeUndefined()
    expect(r.manifest).toEqual({})
  })

  test("a malformed manifest reports an error (not a silent skip)", () => {
    const badVersion = readManifest({ cyberstrike: { coreApi: "latest" } })
    expect(badVersion.manifest).toBeUndefined()
    expect(badVersion.error).toContain("coreApi")

    const badTier = readManifest({ cyberstrike: { tier: "enterprise" } })
    expect(badTier.error).toBeDefined()

    const unknownKey = readManifest({ cyberstrike: { coreApi: "1.2.0", bogus: true } })
    expect(unknownKey.error).toBeDefined() // strict() rejects unknown keys
  })

  test("non-object input is handled safely", () => {
    expect(readManifest(undefined)).toEqual({})
    expect(readManifest("nope")).toEqual({})
    expect(readManifest(null)).toEqual({})
  })

  test("the schema is exported for reuse", () => {
    expect(DomainManifest.safeParse({ coreApi: "1.2.0" }).success).toBe(true)
  })
})
