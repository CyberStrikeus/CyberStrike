// Issue #22 sub-task 4 — referenced-vs-loaded / runtime execution evidence. Proves the whole chain:
// runtime libraries become high-confidence (and, when outdated, runtime-CONFIRMED vulnerable) findings;
// performance-timing loads stamp a loadState on discovered JS; and JS-origin findings inherit that
// state so a "referenced but never loaded" finding is flagged + down-ranked below a confirmed-loaded
// one. This is the deterministic answer to "we ship that library but don't load it".
import { beforeEach, describe, expect, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import { Session } from "../../../src/session"
import { tmpdir } from "../../fixture/fixture"
import { ingestJsBody, vortexSignals, vortexRecordLoads, vortexRecordRuntimeLibs, vortexDiscoverJs } from "../../../src/session/web/vortex-bridge"

async function withSession(fn: (sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({ directory: dir.path, fn: async () => {
    const session = await Session.create({})
    await fn(session.id)
  } })
}

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
const sig = (sid: string, ruleId: string) => vortexSignals(sid).signals.find((s) => s.ruleId === ruleId)

describe("runtime execution evidence → confirmed vulnerable-component (#22)", () => {
  test("an outdated runtime library becomes a runtime-confirmed vulnerable-component finding", async () => {
    await withSession(async (sid) => {
      vortexRecordRuntimeLibs(sid, ["jquery@3.4.1", "react@18.2.0"], "https://app.test/")
      // jQuery 3.4.1 < 3.5.0 → confirmed-loaded vuln; both libs also produce a technology signal
      const vuln = sig(sid, "runtime-vuln-jquery")
      expect(vuln).toBeDefined()
      expect(vuln?.category).toBe("vulnerable-component")
      expect(vuln?.severity).toBe("medium")
      expect(vuln?.loadState).toBe("executed") // a live global provably ran — the FP-killer
      expect(vuln?.title).toContain("runtime-confirmed")
      expect(sig(sid, "runtime-library")).toBeDefined() // react@18.2.0 (current) still recorded as tech
    })
  })

  test("a current runtime library version produces NO vuln finding", async () => {
    await withSession(async (sid) => {
      vortexRecordRuntimeLibs(sid, ["jquery@3.7.1"], "https://app.test/")
      expect(vortexSignals(sid).signals.some((s) => s.ruleId.startsWith("runtime-vuln-"))).toBe(false)
    })
  })
})

describe("performance-load evidence → loadState on discovered JS (#22)", () => {
  test("a script load marks executed; a JS preload link marks preloaded; strongest wins, no downgrade", async () => {
    await withSession(async (sid) => {
      const url = "https://cdn.test/lib.js"
      vortexDiscoverJs(sid, url, "referenced") // first only referenced in the DOM
      vortexRecordLoads(sid, [{ url, type: "script", size: 1200 }]) // then actually executed
      vortexRecordLoads(sid, [{ url, type: "link", size: 0 }]) // a later weaker signal must NOT downgrade
      // (assert via a finding that inherits it, below — loadState is internal to discovered)
      ingestJsBody(sid, url, `var k="${AWS_KEY}"`)
      expect(sig(sid, "secret-in-response")?.loadState).toBe("executed")
    })
  })
})

describe("reconciliation: JS findings inherit load state + referenced-only is down-ranked (#22)", () => {
  test("a finding on loaded JS is 'loaded'; on referenced-only JS is 'referenced' and sorts lower", async () => {
    await withSession(async (sid) => {
      const loadedUrl = "https://app.test/loaded.js"
      const refUrl = "https://app.test/referenced.js"
      // loaded.js: the app actually executed it (perf timing, initiatorType script)
      vortexRecordLoads(sid, [{ url: loadedUrl, type: "script", size: 900 }])
      ingestJsBody(sid, loadedUrl, `var a="${AWS_KEY}"`)
      // referenced.js: only named in the DOM, never observed loading
      vortexDiscoverJs(sid, refUrl, "referenced")
      ingestJsBody(sid, refUrl, `var b="${AWS_KEY}"`)

      const secrets = vortexSignals(sid).signals.filter((s) => s.ruleId === "secret-in-response")
      const byUrl = (u: string) => secrets.find((s) => s.requestId === `jsbody:${u}`)
      expect(byUrl(loadedUrl)?.loadState).toBe("executed")
      expect(byUrl(refUrl)?.loadState).toBe("referenced")
      // same severity → the confirmed-loaded finding sorts before the referenced-only one
      const idxLoaded = secrets.findIndex((s) => s.requestId === `jsbody:${loadedUrl}`)
      const idxRef = secrets.findIndex((s) => s.requestId === `jsbody:${refUrl}`)
      expect(idxLoaded).toBeLessThan(idxRef)
    })
  })
})
