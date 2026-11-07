import { describe, expect, test } from "bun:test"
import type { DeclarativeRule, Transaction } from "../src/index"
import { selectRules, parsePack, mergePacks, loadPackDir, contextFromCorpus, compileRules, RuleRegistry } from "../src/index"

const rules: DeclarativeRule[] = [
  { id: "a", category: "misconfig", severity: "low", when: "resp.status == 200", tags: ["hygiene"] },
  { id: "b", category: "injection", severity: "high", when: "resp.status == 500", tags: ["xss", "cve"] },
  { id: "c", category: "misconfig", severity: "critical", when: "resp.status == 500", tags: ["apache", "cve"], requires: { tech: ["apache"] } },
]

function tx(id: string, tech: string[]): Transaction {
  return { id, source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/x", headers: [] }, tech }
}

describe("selectRules — the scale filter (never compile-all)", () => {
  test("by tags: keep rules carrying at least one requested tag", () => {
    expect(selectRules(rules, { tags: ["cve"] }).map((r) => r.id)).toEqual(["b", "c"])
    expect(selectRules(rules, { tags: ["hygiene"] }).map((r) => r.id)).toEqual(["a"])
  })
  test("excludeTags drops any match", () => {
    expect(selectRules(rules, { excludeTags: ["apache"] }).map((r) => r.id)).toEqual(["a", "b"])
  })
  test("minSeverity threshold", () => {
    expect(selectRules(rules, { minSeverity: "high" }).map((r) => r.id)).toEqual(["b", "c"])
  })
  test("categories filter", () => {
    expect(selectRules(rules, { categories: ["injection"] }).map((r) => r.id)).toEqual(["b"])
  })
  test("requires.tech prunes ONLY when corpus tech is known and non-matching", () => {
    expect(selectRules(rules, {}, {}).map((r) => r.id)).toEqual(["a", "b", "c"]) // unknown tech → don't prune
    expect(selectRules(rules, {}, { tech: ["spring"] }).map((r) => r.id)).toEqual(["a", "b"]) // apache rule pruned
    expect(selectRules(rules, {}, { tech: ["Apache"] }).map((r) => r.id)).toEqual(["a", "b", "c"]) // matched (case-insensitive)
  })
  test("combined filters compose", () => {
    expect(selectRules(rules, { tags: ["cve"], minSeverity: "critical" }, { tech: ["apache"] }).map((r) => r.id)).toEqual(["c"])
  })
})

describe("rule packs — parse / merge / context / load", () => {
  test("parsePack validates all three shapes + metadata, rejects bad rules", () => {
    const p = parsePack({ name: "x", declarative: [{ id: "d", category: "c", severity: "low", when: "resp.status == 200", tags: ["t"] }], probes: [] })
    expect(p.declarative).toHaveLength(1)
    expect(p.name).toBe("x")
    expect(() => parsePack({ declarative: [{ id: "bad" }] })).toThrow() // missing category/severity/when
  })
  test("mergePacks concatenates each shape", () => {
    const m = mergePacks([{ declarative: [rules[0]!] }, { declarative: [rules[1]!], probes: [] }])
    expect(m.declarative).toHaveLength(2)
  })
  test("contextFromCorpus unions tech markers across the corpus", () => {
    expect(contextFromCorpus([tx("a", ["spring"]), tx("b", ["spring", "nginx"])]).tech!.sort()).toEqual(["nginx", "spring"])
  })
  test("pack → select → compile → FIRE (the whole point: selected rules actually run and signal)", () => {
    const pack = parsePack({
      declarative: [
        { id: "sqlerr", category: "injection", severity: "high", when: 'regex("SQL syntax", resp.body)', tags: ["injection"], dedupBy: "endpoint" },
        { id: "hygiene", category: "misconfig", severity: "low", when: "resp.status == 200", tags: ["hygiene"] },
      ],
    })
    const selected = selectRules(pack.declarative!, { tags: ["injection"] }) // pick ONLY the injection rule
    const reg = new RuleRegistry().registerAll(compileRules(selected))
    const t: Transaction = {
      id: "x",
      source: "browser",
      host: "app.test",
      request: { method: "GET", url: "https://app.test/q", headers: [] },
      response: { status: 500, headers: [], body: "You have an error in your SQL syntax" },
    }
    // the selected rule compiled + fired; the un-selected hygiene rule is not in the registry, so no signal
    expect(reg.analyze([t]).map((s) => s.ruleId)).toEqual(["sqlerr"])
  })
  test("loadPackDir reads + merges *.json from a directory (files = source of truth)", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises")
    const os = await import("node:os")
    const path = await import("node:path")
    const dir = await mkdtemp(path.join(os.tmpdir(), "vortex-pack-"))
    await writeFile(path.join(dir, "1.json"), JSON.stringify({ declarative: [rules[0]] }))
    await writeFile(path.join(dir, "2.json"), JSON.stringify({ declarative: [rules[1]], probes: [] }))
    await writeFile(path.join(dir, "ignore.txt"), "not a pack")
    const merged = await loadPackDir(dir)
    expect(merged.declarative).toHaveLength(2)
    // and the loaded rules feed straight into the selector
    expect(selectRules(merged.declarative!, { minSeverity: "high" }).map((r) => r.id)).toEqual(["b"])
  })
})
