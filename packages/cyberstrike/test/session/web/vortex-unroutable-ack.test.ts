// Issue #102 — structurally un-routable Vortex signals (no owning specialist, or a tx with no keyHash
// anchor to examine, e.g. a synthetic jsbody tx) can never be flagged into the inspection queue, so the
// new->reviewed examination hook never fires and they would pin the completion gate (sig.new > 0) open
// forever. routeAllSignals (the last-resort force-route pass the supervisor runs) now ACKNOWLEDGES them
// as "reviewed" so the scan can complete. These prove that end-to-end through the real bridge + store.
import { describe, expect, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import { Session } from "../../../src/session"
import { tmpdir } from "../../fixture/fixture"
import { ingestJsBody, routeAllSignals, vortexSignals, vortexSignalSummary } from "../../../src/session/web/vortex-bridge"

async function withSession(fn: (sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const session = await Session.create({})
      await fn(session.id)
    },
  })
}

const AWS_KEY = "AKIA" + "A".repeat(16) // synthetic, format-only — matches the secret-in-response rule

describe("routeAllSignals acknowledges un-routable signals (#102)", () => {
  test("a jsbody signal (no keyHash anchor) is advanced new -> reviewed so it stops pinning the gate", async () => {
    await withSession(async (sid) => {
      // a synthetic jsbody tx carries NO keyHash → its signals can never be routed/examined.
      const res = ingestJsBody(sid, "https://app.test/static/main.js", `var k="${AWS_KEY}";fetch("/api/x")`)
      expect(res.signals).toBeGreaterThan(0)

      const before = vortexSignals(sid).signals
      expect(before.length).toBeGreaterThan(0)
      expect(before.every((s) => !s.keyHash)).toBe(true) // no anchor to examine
      expect(before.every((s) => s.triage === "new")).toBe(true) // stuck "new" before the fix
      expect(vortexSignalSummary(sid).triage.new).toBe(before.length)

      const out = routeAllSignals(sid)
      expect(out.flagged).toBe(0) // nothing routable
      expect(out.acknowledged).toBe(before.length) // every un-routable signal acknowledged

      // the gate source (sig.new) is drained; the signals remain visible, now as "reviewed".
      expect(vortexSignals(sid).signals.every((s) => s.triage === "reviewed")).toBe(true)
      expect(vortexSignalSummary(sid).triage.new).toBe(0)
    })
  })
})
