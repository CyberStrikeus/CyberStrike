import { describe, expect, test } from "bun:test"
import { McpCatalog } from "../../src/mcp/catalog"

describe("MCP catalog", () => {
  test("pins every runnable package", () => {
    for (const entry of McpCatalog.list()) {
      if (!entry.command) continue
      expect(entry.package).toBeDefined()
      expect(entry.command).toEqual(["npx", "-y", `${entry.package}@${entry.version}`])
    }
  })

  test("only injects runnable defaults", () => {
    const defaults = McpCatalog.defaults()
    expect(defaults["cloud-audit"]).toBeUndefined()
    expect(defaults.hackbrowser).toBeUndefined()
    expect(defaults.cve).toEqual({
      type: "local",
      command: ["npx", "-y", "cve-mcp@0.2.0"],
      enabled: false,
    })
  })

  test("keeps manual and optional servers discoverable", () => {
    const entries = McpCatalog.list()
    expect(entries.find((entry) => entry.id === "cloud-audit")?.command).toBeUndefined()
    expect(entries.find((entry) => entry.id === "hackbrowser")?.command).toBeUndefined()
    expect(entries.find((entry) => entry.id === "wifi-security")?.default).toBe(false)
  })
})
