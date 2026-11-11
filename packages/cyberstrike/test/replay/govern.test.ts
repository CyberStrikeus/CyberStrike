import { describe, test, expect } from "bun:test"
import { governorsFor, releaseGovernors } from "../../src/replay/govern"
import { Governor } from "../../src/replay/governor"

// Issue #91: governors must be shared per ROOT session (every parallel sub-agent of
// one run) and per host, so the budget / circuit breaker / rate limiter actually
// accumulate across sends instead of resetting every call.
describe("governor registry", () => {
  test("same run + host reuses ONE budget/breaker/limiter/bucket", () => {
    const s = "ses_reuse"
    const a = governorsFor(s, "https://target.test")
    const b = governorsFor(s, "https://target.test")
    expect(b.budget).toBe(a.budget)
    expect(b.breaker).toBe(a.breaker)
    expect(b.limiter).toBe(a.limiter)
    expect(b.bucket).toBe(a.bucket)
    releaseGovernors(s)
  })

  test("the shared budget accumulates across calls (never resets) — the core #91 bug", () => {
    const s = "ses_budget"
    // Two sub-agents resolving to the same root get the same budget instance, so
    // consumption by one is visible to the other. Pre-fix each call got a fresh
    // GlobalBudget and the 5000 cap was never approached.
    governorsFor(s, "https://target.test").budget.tryConsume(10)
    const remaining = governorsFor(s, "https://target.test").budget.remaining
    expect(remaining).toBe(Governor.DEFAULTS.globalRequestBudget - 10)
    releaseGovernors(s)
  })

  test("different hosts in one run share the budget but get independent breakers", () => {
    const s = "ses_hosts"
    const a = governorsFor(s, "https://a.test")
    const b = governorsFor(s, "https://b.test")
    expect(b.budget).toBe(a.budget) // run-wide total cap
    expect(b.breaker).not.toBe(a.breaker) // a dead host must not stall another
    expect(b.limiter).not.toBe(a.limiter)
    expect(b.bucket).not.toBe(a.bucket)
    releaseGovernors(s)
  })

  test("different runs are fully isolated", () => {
    const a = governorsFor("ses_one", "https://target.test")
    const b = governorsFor("ses_two", "https://target.test")
    expect(b.budget).not.toBe(a.budget)
    releaseGovernors("ses_one")
    releaseGovernors("ses_two")
  })

  test("releaseGovernors drops the run so a later send starts fresh", () => {
    const s = "ses_release"
    const before = governorsFor(s, "https://target.test")
    before.budget.tryConsume(5)
    releaseGovernors(s)
    const after = governorsFor(s, "https://target.test")
    expect(after.budget).not.toBe(before.budget)
    expect(after.budget.remaining).toBe(Governor.DEFAULTS.globalRequestBudget)
    releaseGovernors(s)
  })
})
