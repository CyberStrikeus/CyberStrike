import { describe, expect, test } from "bun:test"
import { WorkflowSkip, type WorkflowStep, type SkipStrategy } from "../../src/tool/webhook/business/workflow"
import type { ProbeRequest } from "../../src/tool/webhook/transport"

function step(name: string, order: number, path: string): WorkflowStep {
  return {
    name,
    order,
    request: { method: "POST", url: `https://shop.example.com${path}`, headers: {} },
  }
}

const CHECKOUT_FLOW: WorkflowStep[] = [
  step("add-to-cart", 1, "/cart/add"),
  step("shipping", 2, "/checkout/shipping"),
  step("payment", 3, "/checkout/payment"),
  step("confirm", 4, "/checkout/confirm"),
]

describe("WorkflowSkip.generate", () => {
  test("generates skip-to-end for a multi-step flow", () => {
    const candidates = WorkflowSkip.generate(CHECKOUT_FLOW)
    const skipToEnd = candidates.find((c) => c.strategy === "skip_to_end")

    expect(skipToEnd).toBeDefined()
    expect(skipToEnd!.request.url).toContain("/checkout/confirm")
    expect(skipToEnd!.skippedSteps).toEqual(["add-to-cart", "shipping", "payment"])
  })

  test("generates individual skip-one candidates for middle steps", () => {
    const candidates = WorkflowSkip.generate(CHECKOUT_FLOW)
    const skipOnes = candidates.filter((c) => c.strategy === "skip_one")

    // 4 steps, 2 middle steps (shipping, payment) → 2 skip-one candidates
    expect(skipOnes).toHaveLength(2)
    expect(skipOnes[0].skippedSteps).toEqual(["shipping"])
    expect(skipOnes[1].skippedSteps).toEqual(["payment"])
  })

  test("generates skip-middle (first→last bypassing middle)", () => {
    const candidates = WorkflowSkip.generate(CHECKOUT_FLOW)
    const skipMiddle = candidates.find((c) => c.strategy === "skip_middle")

    expect(skipMiddle).toBeDefined()
    expect(skipMiddle!.skippedSteps).toEqual(["shipping", "payment"])
    expect(skipMiddle!.request.url).toContain("/checkout/confirm")
  })

  test("generates repeat-step (double-spend / re-apply)", () => {
    const candidates = WorkflowSkip.generate(CHECKOUT_FLOW)
    const repeat = candidates.find((c) => c.strategy === "repeat_step")

    expect(repeat).toBeDefined()
    expect(repeat!.request.url).toContain("/cart/add")
    expect(repeat!.skippedSteps).toEqual([])
  })

  test("generates reverse-order candidates", () => {
    const candidates = WorkflowSkip.generate(CHECKOUT_FLOW)
    const reverse = candidates.filter((c) => c.strategy === "reverse_order")

    expect(reverse.length).toBeGreaterThanOrEqual(2)
    // First reversed candidate should be the last step (confirm)
    expect(reverse[0].request.url).toContain("/checkout/confirm")
  })

  test("sorts steps by order regardless of input order", () => {
    const shuffled = [CHECKOUT_FLOW[3], CHECKOUT_FLOW[0], CHECKOUT_FLOW[2], CHECKOUT_FLOW[1]]
    const candidates = WorkflowSkip.generate(shuffled)
    const skipToEnd = candidates.find((c) => c.strategy === "skip_to_end")

    expect(skipToEnd!.request.url).toContain("/checkout/confirm")
    expect(skipToEnd!.skippedSteps).toEqual(["add-to-cart", "shipping", "payment"])
  })

  test("two-step flow: only skip-to-end + repeat", () => {
    const twoSteps = [step("login", 1, "/login"), step("reset", 2, "/password-reset")]
    const candidates = WorkflowSkip.generate(twoSteps)

    const strategies = new Set(candidates.map((c) => c.strategy))
    expect(strategies.has("skip_to_end")).toBe(true)
    expect(strategies.has("repeat_step")).toBe(true)
    // No skip_one or skip_middle for 2-step flow
    expect(strategies.has("skip_one")).toBe(false)
    expect(strategies.has("skip_middle")).toBe(false)
  })

  test("single-step flow returns empty — nothing to skip", () => {
    const one = [step("action", 1, "/action")]
    expect(WorkflowSkip.generate(one)).toEqual([])
  })

  test("empty input returns empty", () => {
    expect(WorkflowSkip.generate([])).toEqual([])
  })

  test("every candidate has a non-empty name and description", () => {
    for (const c of WorkflowSkip.generate(CHECKOUT_FLOW)) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.description.length).toBeGreaterThan(0)
      expect(c.request.url.length).toBeGreaterThan(0)
    }
  })
})
