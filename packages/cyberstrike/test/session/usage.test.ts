import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"

// Characterization test for the usage aggregation. sumUsage is the pure core of
// Session.usage: it sums per-message cost (never re-priced) and cumulative
// processed tokens (input+output+reasoning+cache.read+cache.write) over assistant
// messages only.
describe("Session.sumUsage", () => {
  test("sums cost + processed tokens over assistant messages only", () => {
    const infos = [
      { role: "user" }, // ignored
      {
        role: "assistant",
        cost: 0.5,
        tokens: { input: 1000, output: 200, reasoning: 50, cache: { read: 300, write: 100 } },
      },
      {
        role: "assistant",
        cost: 1.25,
        tokens: { input: 2000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      // an errored/aborted assistant turn: cost 0, tokens 0 → adds nothing
      { role: "assistant", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    ] as any

    const { totalCost, totalTokens } = Session.sumUsage(infos)
    console.log(`[sumUsage] totalCost=${totalCost} totalTokens=${totalTokens}`)

    expect(totalCost).toBeCloseTo(1.75) // 0.5 + 1.25 + 0
    expect(totalTokens).toBe(1650 + 2100) // (1000+200+50+300+100) + (2000+100)
  })

  test("tolerates missing tokens/cost fields", () => {
    const infos = [{ role: "assistant" }, { role: "assistant", cost: 2 }] as any
    const { totalCost, totalTokens } = Session.sumUsage(infos)
    expect(totalCost).toBe(2)
    expect(totalTokens).toBe(0)
  })
})
