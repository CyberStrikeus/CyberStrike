import { describe, expect, test } from "bun:test"
import { PermissionNext } from "../../src/permission/next"

// Characterization test for the DeniedError context-overflow bug.
// Real incident: a bash command touched an out-of-scope dir → external_directory
// denied → DeniedError serialized ALL ~15k matching permission rules (mostly from
// the CIS_benchmarks skill tree) into its message via JSON.stringify, producing a
// ~3.6MB error string that blew the model context window (1.93M tokens).
describe("PermissionNext.DeniedError", () => {
  function hugeRuleset(): PermissionNext.Ruleset {
    const ruleset: PermissionNext.Ruleset = []
    for (let i = 0; i < 15000; i++) {
      ruleset.push({
        permission: "external_directory",
        pattern: `/Users/x/.local/share/cyberstrike/skill/CIS_benchmarks/dir${i}/sub${i}/*`,
        action: "allow",
      })
    }
    // the one rule that actually causes the denial
    ruleset.push({ permission: "external_directory", pattern: "/tmp/*", action: "deny" })
    return ruleset
  }

  test("message stays bounded even with a 15k-rule ruleset", () => {
    const ruleset = hugeRuleset()
    const err = new PermissionNext.DeniedError(ruleset)
    console.log(`[DeniedError] ruleset=${ruleset.length} rules → message = ${err.message.length} bytes`)

    // BEFORE fix: ~3.6 MB (this assertion fails, surfacing the bloat).
    // AFTER fix: a few hundred bytes.
    expect(err.message.length).toBeLessThan(5000)
  })

  test("ruleset is still accessible for programmatic use", () => {
    const ruleset = hugeRuleset()
    const err = new PermissionNext.DeniedError(ruleset)
    // the cap is on the human/model-facing message only, not the data
    expect(err.ruleset.length).toBe(15001)
  })
})
