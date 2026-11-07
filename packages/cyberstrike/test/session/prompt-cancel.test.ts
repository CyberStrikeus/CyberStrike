import { expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"

test("identifies prompt cancellation by error type", () => {
  expect(SessionPrompt.cancelled(new DOMException("Session prompt cancelled", "AbortError"))).toBe(true)
  expect(SessionPrompt.cancelled(new Error("session prompt cancelled"))).toBe(false)
})
