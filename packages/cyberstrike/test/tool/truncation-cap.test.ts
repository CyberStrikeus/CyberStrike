import { describe, expect, test } from "bun:test"
import { Truncate } from "../../src/tool/truncation"

// Characterization test for the request/response prepend cap (task.ts).
// task.ts prepends current.raw_request + current.processed_response into every
// dispatched subagent's prompt. These can be ~100KB each and this path bypasses
// the tool-output truncation (web_get_request_detail goes through Truncate.output,
// the prompt-prepend did not). Truncate.cap() bounds it; the full content stays
// retrievable via web_get_request_detail.
describe("Truncate.cap (prepend request/response)", () => {
  const MAX = 16 * 1024
  const hint = (shown: number, total: number) =>
    `...[truncated: showing ${shown} of ${total} bytes — call web_get_request_detail for the full request/response]`

  test("caps a ~100KB response and keeps the head + hint", () => {
    const bigResponse = "HTTP/1.1 200 OK\n\n" + "A".repeat(100 * 1024) // ~100 KB
    const before = bigResponse.length
    const after = Buffer.byteLength(Truncate.cap(bigResponse, MAX, hint), "utf-8")
    console.log(`[Truncate.cap] before = ${before} bytes → after = ${after} bytes`)

    expect(before).toBeGreaterThan(100_000)
    expect(after).toBeLessThanOrEqual(MAX + 200) // cap + hint
    expect(Truncate.cap(bigResponse, MAX, hint).startsWith("HTTP/1.1 200 OK")).toBe(true)
    expect(Truncate.cap(bigResponse, MAX, hint)).toContain("web_get_request_detail")
  })

  test("leaves a small request untouched", () => {
    const small = "GET /my-account HTTP/1.1\nHost: example.com\n"
    expect(Truncate.cap(small, MAX, hint)).toBe(small)
  })
})
