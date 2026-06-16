import { describe, expect, test } from "bun:test"
import { Truncate } from "../../src/tool/truncation"

// Characterization test for the tool-error truncation (defensive layer).
// The processor's "tool-error" branch used to store (value.error).toString()
// verbatim. A single multi-MB error (a serialized permission ruleset, a curl
// dump surfaced as an error, a giant stack) then got fed back into the model
// context. Truncate.error() caps it.
describe("Truncate.error", () => {
  test("caps a multi-MB error and keeps the head", () => {
    const huge = "DeniedError: " + "x".repeat(2 * 1024 * 1024) // ~2 MB
    const before = String(huge).length // what the old code stored verbatim
    const after = Buffer.byteLength(Truncate.error(huge), "utf-8")
    console.log(`[Truncate.error] before = ${before} bytes → after = ${after} bytes`)

    expect(before).toBeGreaterThan(2_000_000)
    expect(after).toBeLessThanOrEqual(Truncate.MAX_ERROR_BYTES + 200) // cap + the note
    expect(Truncate.error(huge).startsWith("DeniedError: x")).toBe(true) // head preserved
    expect(Truncate.error(huge)).toContain("error truncated")
  })

  test("leaves a normal-sized error untouched", () => {
    const small = "Error: connection refused (ECONNREFUSED 127.0.0.1:8080)"
    expect(Truncate.error(small)).toBe(small)
  })
})
