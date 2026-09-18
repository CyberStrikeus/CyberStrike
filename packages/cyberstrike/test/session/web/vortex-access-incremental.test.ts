// #40 P1c — end-to-end proof that access-control corpus findings still surface through the bridge now
// that they are driven by the incremental AccessMatcher (fed at ingest) instead of the batch access
// CorpusRules. Ingest a cross-identity + an authed/anon corpus, flush, and read the signals.
import { describe, expect, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import { Session } from "../../../src/session"
import { tmpdir } from "../../fixture/fixture"
import { ingestBrowserTransaction, flushCorpusAnalysis, vortexSignals } from "../../../src/session/web/vortex-bridge"

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

let r = 0
function ingest(sid: string, url: string, identity?: string) {
  ingestBrowserTransaction({
    sessionID: sid,
    requestID: `req-${r++}`,
    method: "GET",
    url: `https://app.test${url}`,
    host: "app.test",
    identity,
    normalizedPath: url,
    response: { status: 200, headers: { "content-type": "application/json" }, body: "{}" },
  })
}

describe("incremental access matcher surfaces access-control findings via the bridge (#40 P1c)", () => {
  test("cross-identity-access and unauthenticated-reach both surface", () =>
    withSession(async (sid) => {
      ingest(sid, "/api/data", "org1")
      ingest(sid, "/api/data", "org2") // same endpoint, two identities → cross-identity-access
      ingest(sid, "/api/profile", "org1")
      ingest(sid, "/api/profile") // authed + anonymous → unauthenticated-reach
      flushCorpusAnalysis(sid)
      const ids = new Set(vortexSignals(sid).signals.map((s) => s.ruleId))
      expect(ids.has("cross-identity-access")).toBe(true)
      expect(ids.has("unauthenticated-reach")).toBe(true)
    }))

  test("no access finding for a single identity on an endpoint", () =>
    withSession(async (sid) => {
      ingest(sid, "/api/solo", "org1")
      ingest(sid, "/api/solo", "org1")
      flushCorpusAnalysis(sid)
      const ids = new Set(vortexSignals(sid).signals.map((s) => s.ruleId))
      expect(ids.has("cross-identity-access")).toBe(false)
      expect(ids.has("unauthenticated-reach")).toBe(false)
    }))
})
