// Issue #22 — first-party JS bodies are persisted into Vortex as OBSERVED transactions, so the DSL
// rule engine (and, when registered, the jsmine extractor) runs over the actual script. Before this,
// JS was URL-only in the discovered inventory and no rule ever saw a script body. These prove the
// full chain end-to-end through the real bridge + JsMiner (writes the real per-session vortex.db,
// isolated per test via Instance.provide → a tmpdir data root).
import { beforeEach, describe, expect, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import { Session } from "../../../src/session"
import { tmpdir } from "../../fixture/fixture"
import { ingestJsBody, vortexSignals, vortexReport } from "../../../src/session/web/vortex-bridge"
import { JsMiner } from "../../../src/session/web/js-miner"
import { DataCollector } from "../../../src/session/web/data-collector"
import { WebScope } from "../../../src/session/web/scope"

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
const ruleIds = (sid: string) => vortexSignals(sid).signals.map((s) => s.ruleId)

beforeEach(() => {
  JsMiner._reset()
  DataCollector._reset()
  WebScope._reset()
})

describe("Vortex JS-body ingest (issue #22)", () => {
  test("ingestJsBody stores the script as an OBSERVED tx and the DSL rules fire over its body", async () => {
    await withSession(async (sid) => {
      const url = "https://app.test/static/main.abc123.js"
      const body = `var cfg={region:"us-east-1",key:"${AWS_KEY}"};fetch("/api/x")`
      const res = ingestJsBody(sid, url, body)
      expect(res.signals).toBeGreaterThan(0)
      // the hardcoded key in the JS BODY was caught by the core secret-in-response rule — proving the
      // rule engine now runs over JavaScript, which it never did when JS was URL-only.
      expect(ruleIds(sid)).toContain("secret-in-response")
      // and the transaction is actually stored (a signal can only exist off a stored tx).
      expect(vortexReport(sid).transactions).toBe(1)
    })
  })

  test("idempotent: re-ingesting the same bundle URL replaces its row, never duplicates", async () => {
    await withSession(async (sid) => {
      const url = "https://app.test/app.js"
      const body = `fetch("/api/y")`
      ingestJsBody(sid, url, body)
      const first = vortexReport(sid).transactions
      ingestJsBody(sid, url, body)
      expect(vortexReport(sid).transactions).toBe(first) // URL-stable id → INSERT OR REPLACE
    })
  })

  test("a non-absolute URL or empty body is ignored (never becomes a transaction)", async () => {
    await withSession(async (sid) => {
      expect(ingestJsBody(sid, "/relative/app.js", "fetch('/api/x')").signals).toBe(0)
      expect(ingestJsBody(sid, "https://app.test/empty.js", "").signals).toBe(0)
      expect(vortexReport(sid).transactions).toBe(0)
    })
  })

  test("end-to-end: JsMiner.mineNew persists the fetched first-party bundle body → DSL rules run", async () => {
    await withSession(async (sid) => {
      WebScope.ensure(sid, "https://app.test/")
      // mirror how ingest registers a captured JS asset (content-type js → jsUrls)
      DataCollector.record(sid, { method: "GET", origin: "https://app.test", path: "/bundle.js", contentType: "application/javascript" })
      await JsMiner.mineNew(sid, async (u) => (u.endsWith("bundle.js") ? `var k="${AWS_KEY}";fetch("/api/z")` : null))
      // the miner fetched the bundle, handed its body to Vortex, and the secret-in-response rule fired
      // over the stored JS body — the whole point of #22.
      expect(ruleIds(sid)).toContain("secret-in-response")
      expect(vortexReport(sid).transactions).toBe(1)
    })
  })
})
