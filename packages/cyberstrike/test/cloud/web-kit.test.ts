import { describe, test, expect } from "bun:test"
import { buildCoreRuntime } from "../../src/cloud/core-runtime"
import { buildWebKit } from "../../src/cloud/web-kit"

// The web building-block kit is the versioned "Lego" surface a domain plugin
// composes into its own web tools, injected via input.core.web. Dropping a member
// breaks installed packages — this test is the deliberate signal to bump the core
// compatibility version instead of silently removing one.
describe("web building-block kit (input.core.web)", () => {
  test("buildCoreRuntime exposes the web kit", () => {
    const core = buildCoreRuntime()
    expect(core.web).toBeDefined()
    // sanity: web appeared additively at core API 1.2.0
    expect(core.coreApiSatisfies("1.2.0")).toBe(true)
  })

  test("the full send/replay/capture/tool-shell member set is present", () => {
    const web = buildWebKit()
    expect(typeof web.governedSend).toBe("function")
    expect(typeof web.ReplaySender).toBe("function") // class
    // request model & pure transforms (namespaces)
    expect(typeof web.HttpMessage.parse).toBe("function")
    expect(typeof web.Mutate.setHeader).toBe("function")
    expect(typeof web.Apply.mutations).toBe("function")
    expect(typeof web.Observe.reflection).toBe("function")
    expect(typeof web.Encode.apply).toBe("function")
    // governed replay engine
    expect(typeof web.Send.governed).toBe("function")
    expect(typeof web.ReplayResponse.parse).toBe("function")
    expect(typeof web.Batch.run).toBe("function")
    expect(typeof web.Governor.CircuitBreaker).toBe("function")
    // captured-traffic store
    expect(typeof web.Request.findById).toBe("function")
    // webhook tool shells
    expect(typeof web.defineWebhookTool).toBe("function")
    expect(typeof web.webhookContext).toBe("function")
    expect(typeof web.toolResult).toBe("function")
    expect(typeof web.toolError).toBe("function")
  })

  test("the signal subsystem exposes the Vortex surface (single producer, #15)", () => {
    const signal = buildWebKit().signal
    expect(typeof signal.vortex.registerCanary).toBe("function")
    expect(typeof signal.vortex.recordSignal).toBe("function")
    expect(typeof signal.vortex.scanProbeResponse).toBe("function")
    expect(typeof signal.vortex.signals).toBe("function")
  })

  test("the injected members are live (not broken bindings)", () => {
    const web = buildWebKit()
    // HttpMessage.parse is pure — proves the reference is the real function.
    const req = web.HttpMessage.parse("GET /a HTTP/1.1\r\nHost: x\r\n\r\n")
    expect(req.method).toBe("GET")
    // vortex.signals on an unknown session degrades to an empty list (no throw).
    expect(web.signal.vortex.signals("no-such-session").signals).toEqual([])
  })
})
