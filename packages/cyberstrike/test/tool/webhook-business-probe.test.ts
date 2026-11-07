import { describe, expect, test } from "bun:test"
import { BusinessProbe } from "../../src/tool/webhook/business/probe"
import { BusinessTest } from "../../src/tool/webhook/business/business-test"
import type { HttpSender, ProbeRequest } from "../../src/tool/webhook/transport"

const baseReq = (): ProbeRequest => ({
  method: "POST",
  url: "https://shop.example.com/api/order?price=100&quantity=1",
  headers: { "Content-Type": "application/json" },
  body: '{"item":"widget"}',
})

// A server that accepts negative prices (vulnerable to price tamper).
// Zero/negative → 200 but with a long refund body; huge → 500 error.
// Both differ materially from the normal-price baseline (status or body-length).
function priceServer(): HttpSender {
  return {
    async send(req) {
      const url = new URL(req.url)
      const price = parseFloat(url.searchParams.get("price") ?? "100")
      if (price <= 0) return { status: 200, headers: {}, body: `{"total":${price},"status":"accepted","refund_issued":true,"refund_amount":${Math.abs(price)},"note":"${"negative price accepted — refund generated ".repeat(3)}"}` }
      if (price > 99999) return { status: 500, headers: {}, body: '{"error":"integer overflow in payment processing pipeline"}' }
      return { status: 200, headers: {}, body: `{"total":${price},"status":"ok"}` }
    },
  }
}

// A checkout flow: step 1 always ok, steps 2-4 require prior step cookie.
function workflowServer(): HttpSender {
  return {
    async send(req) {
      const path = new URL(req.url).pathname
      if (path === "/cart/add") return { status: 200, headers: {}, body: '{"cart":"ok"}' }
      // Steps 2+ require a session cookie the skip candidates won't have
      if (req.headers["Cookie"]?.includes("session=valid")) {
        return { status: 200, headers: {}, body: `{"step":"${path}","ok":true}` }
      }
      return { status: 403, headers: {}, body: '{"error":"complete prior step first"}' }
    },
  }
}

// Workflow server with no step enforcement (vulnerable).
function weakWorkflowServer(): HttpSender {
  return {
    async send() {
      return { status: 200, headers: {}, body: '{"ok":true}' }
    },
  }
}

describe("BusinessProbe.boundary", () => {
  test("detects anomalies when negative/zero price is accepted", async () => {
    const probe = new BusinessProbe(priceServer())
    const report = await probe.boundary({
      request: baseReq(),
      field: "price",
      categories: ["price"],
      limit: 5,
      injectFn: (req, field, value) => {
        const u = new URL(req.url)
        u.searchParams.set(field, value)
        return { ...req, url: u.toString() }
      },
    })

    expect(report.fieldClass).toBe("price")
    expect(report.baselineStatus).toBe(200)
    // Zero and negative prices differ from baseline (different body)
    expect(report.anomalies.length).toBeGreaterThan(0)
    expect(report.results.length).toBe(5)
  })

  test("marks transport errors as anomalies", async () => {
    const failing: HttpSender = {
      async send(req) {
        const price = new URL(req.url).searchParams.get("price")
        if (price === "0") return { error: "timeout" }
        return { status: 200, headers: {}, body: "ok" }
      },
    }
    const probe = new BusinessProbe(failing)
    const report = await probe.boundary({
      request: baseReq(),
      field: "price",
      categories: ["price"],
      limit: 3,
      injectFn: (req, field, value) => {
        const u = new URL(req.url)
        u.searchParams.set(field, value)
        return { ...req, url: u.toString() }
      },
    })

    const errResult = report.results.find((r) => r.error === "timeout")
    expect(errResult).toBeDefined()
    expect(errResult!.differsFromBaseline).toBe(true)
    expect(report.anomalies.some((a) => a.includes("transport error"))).toBe(true)
  })
})

describe("BusinessTest.run — race mode", () => {
  test("dispatches to race engine correctly", async () => {
    const server: HttpSender = { async send() { return { status: 200, headers: {}, body: "ok" } } }
    const result = await BusinessTest.run({ mode: "race", request: baseReq(), count: 5, concurrency: 5 }, server)
    if ("error" in result) throw new Error(result.error)
    if (result.mode !== "race") throw new Error("expected race mode")

    expect(result.report.count).toBe(5)
    expect(result.report.results).toHaveLength(5)
  })
})

describe("BusinessTest.run — boundary mode", () => {
  test("auto-detects field class and sweeps", async () => {
    const result = await BusinessTest.run(
      { mode: "boundary", request: baseReq(), field: "price" },
      priceServer(),
    )
    if ("error" in result) throw new Error(result.error)
    if (result.mode !== "boundary") throw new Error("expected boundary mode")

    expect(result.report.fieldClass).toBe("price")
    expect(result.report.results.length).toBeGreaterThan(5)
  })
})

describe("BusinessTest.run — workflow mode", () => {
  function step(name: string, order: number, path: string): { name: string; order: number; request: ProbeRequest } {
    return {
      name,
      order,
      request: { method: "POST", url: `https://shop.example.com${path}`, headers: {} },
    }
  }

  test("probes all skip candidates against a guarded flow", async () => {
    const steps = [
      step("cart", 1, "/cart/add"),
      step("shipping", 2, "/checkout/shipping"),
      step("payment", 3, "/checkout/payment"),
      step("confirm", 4, "/checkout/confirm"),
    ]
    const result = await BusinessTest.run({ mode: "workflow", steps }, workflowServer())
    if ("error" in result) throw new Error(result.error)
    if (result.mode !== "workflow") throw new Error("expected workflow mode")

    expect(result.candidates.length).toBeGreaterThan(3)
    expect(result.probeResults).toHaveLength(result.candidates.length)

    // The cart endpoint succeeds without auth (it's the first step); skip/repeat
    // to guarded endpoints should return 403.
    const guarded = result.probeResults.filter((r: { name: string }) => !r.name.includes("cart"))
    for (const r of guarded) {
      expect(r.status).toBe(403)
    }
  })

  test("detects vulnerable flow where all skips succeed", async () => {
    const steps = [
      step("cart", 1, "/cart/add"),
      step("confirm", 2, "/checkout/confirm"),
    ]
    const result = await BusinessTest.run({ mode: "workflow", steps }, weakWorkflowServer())
    if ("error" in result) throw new Error(result.error)
    if (result.mode !== "workflow") throw new Error("expected workflow mode")

    // All candidates should get 2xx — the flow has no step enforcement.
    const successes = result.probeResults.filter((r: { status: number | null }) => r.status !== null && r.status >= 200 && r.status < 300)
    expect(successes.length).toBe(result.probeResults.length)
  })

  test("errors on fewer than 2 steps", async () => {
    const result = await BusinessTest.run(
      { mode: "workflow", steps: [step("only", 1, "/only")] },
      weakWorkflowServer(),
    )
    expect("error" in result).toBe(true)
  })
})
