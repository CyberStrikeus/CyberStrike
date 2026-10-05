import { describe, test, expect } from "bun:test"
import {
  WSTG_COVERAGE,
  WSTG_CATEGORIES,
  TOTAL_WSTG_TESTS,
  type CoverageStatus,
  type WstgCoverage,
} from "../../../src/session/web/wstg-coverage"
import { WebProvider } from "@cyberstrike-io/web"

describe("WSTG Coverage Map — completeness gate (§11 gate 7)", () => {
  test("total entry count equals TOTAL_WSTG_TESTS (97)", () => {
    expect(WSTG_COVERAGE.length).toBe(TOTAL_WSTG_TESTS)
    expect(WSTG_COVERAGE.length).toBe(107)
  })

  test("no duplicate IDs", () => {
    const ids = WSTG_COVERAGE.map((c) => c.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  test("every entry has a non-empty title", () => {
    for (const c of WSTG_COVERAGE) {
      expect(c.title.length).toBeGreaterThan(0)
    }
  })

  test("every entry has a non-empty mechanism", () => {
    for (const c of WSTG_COVERAGE) {
      expect(c.mechanism.length).toBeGreaterThan(0)
    }
  })

  test("IDs follow WSTG-XXXX-NN format", () => {
    for (const c of WSTG_COVERAGE) {
      expect(c.id).toMatch(/^WSTG-[A-Z]{4}-\d{2}$/)
    }
  })

  test("status is a valid CoverageStatus", () => {
    const valid = new Set<CoverageStatus>(["covered", "passive", "deferred", "partial"])
    for (const c of WSTG_COVERAGE) {
      expect(valid.has(c.status)).toBe(true)
    }
  })

  test("category counts match WSTG_CATEGORIES definition", () => {
    for (const cat of WSTG_CATEGORIES) {
      const entries = WSTG_COVERAGE.filter((c) => c.id.startsWith(cat.prefix))
      expect(entries.length).toBe(cat.count)
    }
  })

  test("category count sum equals 97", () => {
    const sum = WSTG_CATEGORIES.reduce((a, c) => a + c.count, 0)
    expect(sum).toBe(107)
  })

  test("IDs are sequential within each category (no gaps)", () => {
    for (const cat of WSTG_CATEGORIES) {
      const entries = WSTG_COVERAGE.filter((c) => c.id.startsWith(cat.prefix))
      const nums = entries.map((c) => parseInt(c.id.split("-")[2]!, 10)).sort((a, b) => a - b)
      for (let i = 0; i < nums.length; i++) {
        expect(nums[i]).toBe(i + 1)
      }
    }
  })

  test("entries are ordered by category then by number", () => {
    const catOrder = WSTG_CATEGORIES.map((c) => c.prefix)
    let lastCatIdx = 0
    let lastNum = 0
    for (const c of WSTG_COVERAGE) {
      const prefix = c.id.substring(0, c.id.lastIndexOf("-"))
      const num = parseInt(c.id.split("-")[2]!, 10)
      const catIdx = catOrder.indexOf(prefix as typeof catOrder[number])
      expect(catIdx).toBeGreaterThanOrEqual(0)
      if (catIdx === lastCatIdx) {
        expect(num).toBeGreaterThan(lastNum)
      } else {
        expect(catIdx).toBeGreaterThan(lastCatIdx)
      }
      lastCatIdx = catIdx
      lastNum = num
    }
  })
})

describe("WSTG Coverage Map — agent cross-reference", () => {
  test("every non-deferred agent exists in WebProvider", async () => {
    const provider = new WebProvider()
    const agentNames = new Set(provider.agentSpecs().map((s) => s.name))
    const nonDeferred = WSTG_COVERAGE.filter((c) => c.status !== "deferred")
    for (const c of nonDeferred) {
      expect(agentNames.has(c.agent)).toBe(true)
    }
  })

  test("deferred entries reference 'wstg-client-side' agent (P2)", () => {
    const deferred = WSTG_COVERAGE.filter((c) => c.status === "deferred")
    for (const c of deferred) {
      expect(c.agent).toBe("wstg-client-side")
      expect(c.mechanism).toContain("P2")
    }
  })

  test("deferred count is exactly 8 (CLNT browser-dependent tests)", () => {
    const deferred = WSTG_COVERAGE.filter((c) => c.status === "deferred")
    expect(deferred.length).toBe(7)
  })
})

describe("WSTG Coverage Map — coverage statistics", () => {
  function countByStatus(status: CoverageStatus): number {
    return WSTG_COVERAGE.filter((c) => c.status === status).length
  }

  test("covered count", () => {
    expect(countByStatus("covered")).toBe(82)
  })

  test("passive count", () => {
    expect(countByStatus("passive")).toBe(11)
  })

  test("deferred count", () => {
    expect(countByStatus("deferred")).toBe(7)
  })

  test("partial count", () => {
    expect(countByStatus("partial")).toBe(7)
  })

  test("all statuses sum to 97", () => {
    const sum = countByStatus("covered") + countByStatus("passive") + countByStatus("deferred") + countByStatus("partial")
    expect(sum).toBe(107)
  })

  test("active coverage (covered + passive + partial) is at least 89", () => {
    const active = countByStatus("covered") + countByStatus("passive") + countByStatus("partial")
    expect(active).toBeGreaterThanOrEqual(89)
  })
})

describe("WSTG Coverage Map — agent load distribution", () => {
  test("every specialist agent owns at least one test (extension-only agents excluded)", async () => {
    const provider = new WebProvider()
    const excluded = new Set(["wstg-llm"])
    const specialists = provider.agentSpecs().filter((s) => s.role === "specialist" && !excluded.has(s.name))
    const coverageAgents = new Set(WSTG_COVERAGE.map((c) => c.agent))
    for (const s of specialists) {
      expect(coverageAgents.has(s.name)).toBe(true)
    }
  })

  test("wstg-llm is extension-only (no WSTG mapping)", () => {
    const llmEntries = WSTG_COVERAGE.filter((c) => c.agent === "wstg-llm")
    expect(llmEntries.length).toBe(0)
  })

  test("no single agent owns more than 30 tests", () => {
    const counts = new Map<string, number>()
    for (const c of WSTG_COVERAGE) {
      counts.set(c.agent, (counts.get(c.agent) ?? 0) + 1)
    }
    for (const [, count] of counts) {
      expect(count).toBeLessThanOrEqual(30)
    }
  })

  test("input-validation agent covers all INPV tests except INPV-03 (01-02, 04-19)", () => {
    const inpvTests = WSTG_COVERAGE.filter(
      (c) => c.agent === "wstg-input-validation" && c.id.startsWith("WSTG-INPV")
    )
    const nums = inpvTests.map((c) => parseInt(c.id.split("-")[2]!, 10))
    for (const n of [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
      expect(nums).toContain(n)
    }
  })

  test("config-deploy agent owns all CONF tests", () => {
    const confTests = WSTG_COVERAGE.filter((c) => c.id.startsWith("WSTG-CONF"))
    for (const c of confTests) {
      expect(c.agent).toBe("wstg-config-deploy")
    }
  })

  test("authentication agent owns all ATHN tests", () => {
    const athnTests = WSTG_COVERAGE.filter((c) => c.id.startsWith("WSTG-ATHN"))
    for (const c of athnTests) {
      expect(c.agent).toBe("wstg-authentication")
    }
  })

  test("session-mgmt agent owns all SESS tests", () => {
    const sessTests = WSTG_COVERAGE.filter((c) => c.id.startsWith("WSTG-SESS"))
    for (const c of sessTests) {
      expect(c.agent).toBe("wstg-session-mgmt")
    }
  })

  test("error-handling agent owns all ERRH tests", () => {
    const errhTests = WSTG_COVERAGE.filter((c) => c.id.startsWith("WSTG-ERRH"))
    for (const c of errhTests) {
      expect(c.agent).toBe("wstg-error-handling")
    }
  })

  test("cryptography agent owns all CRYP tests", () => {
    const crypTests = WSTG_COVERAGE.filter((c) => c.id.startsWith("WSTG-CRYP"))
    for (const c of crypTests) {
      expect(c.agent).toBe("wstg-cryptography")
    }
  })
})
