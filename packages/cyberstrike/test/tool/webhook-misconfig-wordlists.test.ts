import { describe, expect, test } from "bun:test"
import { Wordlists, type WordlistCategory } from "../../src/tool/webhook/misconfig/wordlists"

describe("Wordlists.select", () => {
  test("returns all categories by default", () => {
    const all = Wordlists.select()
    const cats = new Set(all.map((e) => e.category))
    expect(cats.has("backup")).toBe(true)
    expect(cats.has("admin")).toBe(true)
    expect(cats.has("sensitive_file")).toBe(true)
    expect(cats.has("http_method")).toBe(true)
    expect(all.length).toBeGreaterThan(50)
  })

  test("filters by category", () => {
    const admins = Wordlists.select({ categories: ["admin"] })
    expect(admins.every((e) => e.category === "admin")).toBe(true)
    expect(admins.length).toBeGreaterThan(10)
  })

  test("respects limit", () => {
    const limited = Wordlists.select({ limit: 5 })
    expect(limited).toHaveLength(5)
  })

  test("backup entries include suffixes and named patterns", () => {
    const backups = Wordlists.select({ categories: ["backup"] })
    const values = backups.map((e) => e.value)
    expect(values.some((v) => v === ".bak")).toBe(true)
    expect(values.some((v) => v.includes("web.config"))).toBe(true)
    expect(values.some((v) => v.includes("wp-config"))).toBe(true)
  })

  test("sensitive_file entries include dotfiles and framework paths", () => {
    const files = Wordlists.select({ categories: ["sensitive_file"] })
    const values = files.map((e) => e.value)
    expect(values).toContain("/.env")
    expect(values).toContain("/.git/HEAD")
    expect(values).toContain("/robots.txt")
    expect(values).toContain("/actuator")
    expect(values).toContain("/swagger.json")
  })

  test("http_method entries cover TRACE and WebDAV", () => {
    const methods = Wordlists.select({ categories: ["http_method"] })
    const values = methods.map((e) => e.value)
    expect(values).toContain("TRACE")
    expect(values).toContain("PUT")
    expect(values).toContain("DELETE")
    expect(values).toContain("PROPFIND")
  })

  test("every entry has a non-empty note", () => {
    for (const e of Wordlists.select()) {
      expect(e.note.length).toBeGreaterThan(0)
      expect(e.value.length).toBeGreaterThan(0)
    }
  })
})

describe("Wordlists individual accessors", () => {
  test("backupSuffixes returns at least 10 entries", () => {
    expect(Wordlists.backupSuffixes().length).toBeGreaterThanOrEqual(10)
  })

  test("adminPaths returns at least 15 entries", () => {
    expect(Wordlists.adminPaths().length).toBeGreaterThanOrEqual(15)
  })

  test("sensitiveFiles returns at least 20 entries", () => {
    expect(Wordlists.sensitiveFiles().length).toBeGreaterThanOrEqual(20)
  })

  test("httpMethods returns at least 8 entries", () => {
    expect(Wordlists.httpMethods().length).toBeGreaterThanOrEqual(8)
  })
})
