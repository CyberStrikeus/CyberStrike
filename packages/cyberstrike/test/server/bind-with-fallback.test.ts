import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"

// #91: a port conflict must be surfaced, not silently swallowed. bindWithFallback is the pure decision
// the listener uses; the loud warning is driven by its `fellBack` flag.
describe("Server.bindWithFallback (#91)", () => {
  test("requested port is free → binds it, no fallback", () => {
    const r = Server.bindWithFallback(4096, (p) => ({ port: p }))
    expect(r.fellBack).toBe(false)
    expect(r.server).toEqual({ port: 4096 })
  })

  test("requested port taken → falls back to the ephemeral port AND flags it (the stale-server surprise is surfaced)", () => {
    // binder fails on the requested port (taken), succeeds on 0 (ephemeral → resolves to a real port)
    const bind = (p: number) => (p === 4096 ? undefined : { port: 54123 })
    const r = Server.bindWithFallback(4096, bind)
    expect(r.fellBack).toBe(true)
    expect(r.server).toEqual({ port: 54123 })
  })

  test("both the requested port and the fallback fail → no server (caller throws)", () => {
    const r = Server.bindWithFallback(4096, () => undefined)
    expect(r.server).toBeUndefined()
    expect(r.fellBack).toBe(false)
  })
})
