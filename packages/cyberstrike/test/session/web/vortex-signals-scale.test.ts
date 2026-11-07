// P0 of the Vortex scaling work (issue #40): corpus analysis must NOT re-scan the whole corpus on
// every 2s-polled read. These prove the read-path guards: a short-TTL view cache collapses idle polls,
// and new traffic invalidates it so a read still reflects the latest signals.
import { describe, expect, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import { Session } from "../../../src/session"
import { tmpdir } from "../../fixture/fixture"
import { ingestJsBody, vortexSignals, flushCorpusAnalysis } from "../../../src/session/web/vortex-bridge"
import { JsMiner } from "../../../src/session/web/js-miner"
import { DataCollector } from "../../../src/session/web/data-collector"
import { WebScope } from "../../../src/session/web/scope"

async function withSession(fn: (sid: string) => Promise<void>) {
  JsMiner._reset()
  DataCollector._reset()
  WebScope._reset()
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const session = await Session.create({})
      await fn(session.id)
    },
  })
}

// synthetic, format-only AWS keys — each matches the secret-in-response rule and, being distinct
// values, produces a distinct (non-deduped) signal.
const KEY_A = "AKIA" + "A".repeat(16)
const KEY_B = "AKIA" + "B".repeat(16)

describe("vortexSignals read-path scaling (#40)", () => {
  test("repeated reads with no new traffic serve the cached view (idle-poll collapse)", () =>
    withSession(async (sid) => {
      ingestJsBody(sid, "https://app.test/a.js", `var k="${KEY_A}";`)
      const a = vortexSignals(sid)
      const b = vortexSignals(sid)
      expect(a.signals.length).toBeGreaterThan(0)
      // Same object reference ⇒ served from the TTL cache, i.e. NOT rebuilt / not re-scanned. This is
      // the guard that stops the 2s poll from re-running corpus analysis every tick.
      expect(b).toBe(a)
    }))

  test("new traffic invalidates the cache so the next read reflects it", () =>
    withSession(async (sid) => {
      ingestJsBody(sid, "https://app.test/a.js", `var k="${KEY_A}";`)
      const first = vortexSignals(sid)
      const firstCount = first.signals.length
      expect(firstCount).toBeGreaterThan(0)

      ingestJsBody(sid, "https://app.test/b.js", `var j="${KEY_B}";`)
      const second = vortexSignals(sid)
      // Cache was invalidated by the new ingest → a fresh view object, and the new secret is included.
      expect(second).not.toBe(first)
      expect(second.signals.length).toBeGreaterThan(firstCount)
    }))

  test("flushCorpusAnalysis materializes without error and the read stays consistent", () =>
    withSession(async (sid) => {
      ingestJsBody(sid, "https://app.test/a.js", `var k="${KEY_A}";`)
      flushCorpusAnalysis(sid)
      const after = vortexSignals(sid)
      expect(after.signals.some((s) => s.ruleId === "secret-in-response")).toBe(true)
    }))
})
