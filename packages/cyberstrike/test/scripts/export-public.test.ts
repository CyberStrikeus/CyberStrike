import { describe, test, expect } from "bun:test"
import path from "node:path"
// The tier-driven public-mirror strip-list generator lives at repo-root scripts/.
// Its test lives here because the repo routes `bun test` through package suites
// (root bunfig disables root discovery). repoRoot is four levels up from this file:
// test/scripts -> test -> cyberstrike -> packages -> <root>.
import { computeStripPlan, computeStripDirs, isPaid, scanPackages } from "../../../../scripts/export-public"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

describe("tier-driven public-mirror strip list", () => {
  test("isPaid recognizes pro and enterprise, not free/undefined", () => {
    expect(isPaid("pro")).toBe(true)
    expect(isPaid("enterprise")).toBe(true)
    expect(isPaid("free")).toBe(false)
    expect(isPaid(undefined)).toBe(false)
  })

  test("the 3 newly-extracted pro packages are in the strip list", async () => {
    const strip = await computeStripDirs(repoRoot)
    expect(strip).toContain("packages/internal-network")
    expect(strip).toContain("packages/mobile")
    expect(strip).toContain("packages/cloud")
  })

  test("existing pro domains are stripped too", async () => {
    const strip = await computeStripDirs(repoRoot)
    for (const d of ["packages/azure", "packages/aws", "packages/gcp", "packages/oracle", "packages/enterprise-vortex"]) {
      expect(strip).toContain(d)
    }
  })

  test("open-core is NEVER stripped: web and cyberstrike stay out of the list", async () => {
    const strip = await computeStripDirs(repoRoot)
    expect(strip).not.toContain("packages/web")
    expect(strip).not.toContain("packages/cyberstrike")
  })

  test("every stripped dir actually declares a paid tier (list is manifest-derived, not hardcoded)", async () => {
    const pkgs = await scanPackages(repoRoot)
    const plan = await computeStripPlan(repoRoot)
    const byDir = new Map(pkgs.map((p) => [p.dir, p.tier]))
    for (const d of plan.strip) expect(isPaid(byDir.get(d))).toBe(true)
    for (const d of plan.keep) expect(isPaid(byDir.get(d))).toBe(false)
  })
})
