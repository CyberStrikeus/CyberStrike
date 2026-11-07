import { describe, test, expect } from "bun:test"
import { WebProvider } from "@cyberstrike-io/web"
import { TESTER_VRT_SCOPE, testerClass } from "../../src/tool/vuln-scope"

// Host-side drift guard: the web roster now lives in @cyberstrike-io/web, but the LANE taxonomy
// (report_vulnerability scoping) is a host concern (src/tool/vuln-scope). This asserts the two stay
// in sync — a renamed/removed specialist, or a new lane-less one, fails here.
describe("web lane taxonomy (TESTER_VRT_SCOPE) ↔ agent roster drift guard", () => {
  test("every lane key maps to an existing wstg-<key> specialist agent", () => {
    // TESTER_VRT_SCOPE is keyed by the wstg-<suffix>. A stale key (agent renamed or removed) silently
    // disables lane enforcement — this catches it.
    const names = new Set(new WebProvider().agentSpecs().map((s) => s.name))
    for (const key of Object.keys(TESTER_VRT_SCOPE)) {
      expect(names.has(`wstg-${key}`), `lane key "${key}" must have agent "wstg-${key}"`).toBe(true)
    }
  })

  test("specialists with NO lane enforcement are exactly the known allowlist", () => {
    // These agents have no TESTER_VRT_SCOPE entry, so their report_vulnerability calls are NOT
    // lane-scoped (testerClass→undefined). They legitimately cover wide or cross-cutting categories.
    // A NEW lane-less specialist must be a conscious choice — adding one fails this test until the
    // author either gives it a lane or adds it here.
    const specialists = new WebProvider().agentSpecs().filter((s) => s.role === "specialist")
    const laneless = specialists.filter((s) => testerClass(s.name) === undefined).map((s) => s.name).sort()
    expect(laneless).toEqual(["wstg-client-side", "wstg-cryptography", "wstg-error-handling", "wstg-identity-mgmt", "wstg-info-gathering"])
  })
})
