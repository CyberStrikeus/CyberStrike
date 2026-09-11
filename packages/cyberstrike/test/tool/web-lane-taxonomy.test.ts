import { describe, test, expect } from "bun:test"
import { WebProvider } from "@cyberstrike-io/web"
import { TESTER_VRT_SCOPE, testerClass } from "../../src/tool/vuln-scope"

// Host-side drift guard: the web roster now lives in @cyberstrike-io/web, but the LANE taxonomy
// (report_vulnerability scoping) is a host concern (src/tool/vuln-scope). This asserts the two stay
// in sync — a renamed/removed specialist, or a new lane-less one, fails here.
describe("web lane taxonomy (TESTER_VRT_SCOPE) ↔ agent roster drift guard", () => {
  test("every lane key maps to an existing hunt-<key> specialist agent", () => {
    // TESTER_VRT_SCOPE is keyed by the hunt-<suffix>. A stale key (agent renamed or removed) silently
    // disables lane enforcement — this catches it.
    const names = new Set(new WebProvider().agentSpecs().map((s) => s.name))
    for (const key of Object.keys(TESTER_VRT_SCOPE)) {
      expect(names.has(`hunt-${key}`), `lane key "${key}" must have agent "hunt-${key}"`).toBe(true)
    }
  })

  test("specialists with NO lane enforcement are exactly the known allowlist", () => {
    // hunt-llm, hunt-misconfig currently have no lane entry, so their report_vulnerability calls are
    // NOT lane-scoped (testerClass→undefined). This is left as-is (they legitimately report a wide
    // range), but a NEW lane-less specialist must be a conscious choice — adding one fails this test
    // until the author either gives it a lane or adds it here.
    const specialists = new WebProvider().agentSpecs().filter((s) => s.role === "specialist")
    const laneless = specialists.filter((s) => testerClass(s.name) === undefined).map((s) => s.name).sort()
    expect(laneless).toEqual(["hunt-llm", "hunt-misconfig"])
  })
})
