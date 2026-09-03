import { describe, expect, test, beforeEach } from "bun:test"
import { WebControl } from "../../../src/session/web/control"

beforeEach(() => WebControl._reset())

describe("WebControl", () => {
  test("send with no connected extension resolves no-extension", async () => {
    expect(await WebControl.send("s1", { op: "click", elementId: "e1" })).toEqual({ ok: false, error: "no-extension" })
  })

  test("send delivers the command with an id, and onAck resolves it", async () => {
    let sent = ""
    WebControl.connect("s1", { send: (d) => (sent = d) })
    const p = WebControl.send("s1", { op: "click", elementId: "e1" })
    const msg = JSON.parse(sent)
    expect(msg.op).toBe("click")
    expect(typeof msg.id).toBe("string")
    WebControl.onAck(JSON.stringify({ id: msg.id, ok: true }))
    expect(await p).toEqual({ ok: true, error: undefined })
  })

  test("onAck carries an error through", async () => {
    let sent = ""
    WebControl.connect("s1", { send: (d) => (sent = d) })
    const p = WebControl.send("s1", { op: "navigate", url: "https://x" })
    WebControl.onAck(JSON.stringify({ id: JSON.parse(sent).id, ok: false, error: "element not found" }))
    expect(await p).toEqual({ ok: false, error: "element not found" })
  })

  test("onAck for an unknown/garbage id is a no-op (no throw)", () => {
    WebControl.onAck(JSON.stringify({ id: "cmd999", ok: true }))
    WebControl.onAck("not json")
    // reaching here without throwing is the assertion
    expect(true).toBe(true)
  })

  test("connect/disconnect/connected", () => {
    expect(WebControl.connected("s1")).toBe(false)
    WebControl.connect("s1", { send: () => {} })
    expect(WebControl.connected("s1")).toBe(true)
    WebControl.disconnect("s1")
    expect(WebControl.connected("s1")).toBe(false)
  })
})
