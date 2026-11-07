import { afterEach, expect, setSystemTime, test } from "bun:test"
import { tickets } from "../../src/api-v2/tickets"

afterEach(() => setSystemTime())

test("tickets expire and cannot cross listeners", () => {
  setSystemTime(new Date("2026-01-01T00:00:00Z"))
  const store = tickets()
  const token = store.issue("pty_1", "/work")
  expect(tickets().consume(token.ticket, "pty_1", "/work")).toBe(false)
  setSystemTime(new Date("2026-01-01T00:00:30Z"))
  expect(store.consume(token.ticket, "pty_1", "/work")).toBe(false)
})
