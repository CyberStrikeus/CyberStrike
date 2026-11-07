import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Tier } from "../../src/tier/tier"

const PRO_AGENTS = ["mobile-application", "cloud-security", "internal-network"]

const saved = process.env["CYBERSTRIKE_TIER"]
afterEach(() => {
  if (saved === undefined) delete process.env["CYBERSTRIKE_TIER"]
  if (saved !== undefined) process.env["CYBERSTRIKE_TIER"] = saved
})

// ── Tier helper (pure) ──────────────────────────────────────────────────────

test("Tier.active defaults to free when unset or invalid", () => {
  delete process.env["CYBERSTRIKE_TIER"]
  expect(Tier.active()).toBe("free")
  process.env["CYBERSTRIKE_TIER"] = "bogus"
  expect(Tier.active()).toBe("free")
  process.env["CYBERSTRIKE_TIER"] = ""
  expect(Tier.active()).toBe("free")
})

test("Tier.active reads pro/enterprise (case-insensitive)", () => {
  process.env["CYBERSTRIKE_TIER"] = "pro"
  expect(Tier.active()).toBe("pro")
  process.env["CYBERSTRIKE_TIER"] = "ENTERPRISE"
  expect(Tier.active()).toBe("enterprise")
})

test("Tier.allows ranks free < pro < enterprise", () => {
  process.env["CYBERSTRIKE_TIER"] = "free"
  expect(Tier.allows("free")).toBe(true)
  expect(Tier.allows("pro")).toBe(false)
  expect(Tier.allows("enterprise")).toBe(false)

  process.env["CYBERSTRIKE_TIER"] = "pro"
  expect(Tier.allows("free")).toBe(true)
  expect(Tier.allows("pro")).toBe(true)
  expect(Tier.allows("enterprise")).toBe(false)

  process.env["CYBERSTRIKE_TIER"] = "enterprise"
  expect(Tier.allows("free")).toBe(true)
  expect(Tier.allows("pro")).toBe(true)
  expect(Tier.allows("enterprise")).toBe(true)
})

// ── Registry gate (real state builder) ──────────────────────────────────────

test("free build hides pro domain specialist agents", async () => {
  delete process.env["CYBERSTRIKE_TIER"]
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const names = (await Agent.list()).map((a) => a.name)
      expect(names).toContain("cyberstrike")
      expect(names).toContain("general")
      for (const name of PRO_AGENTS) expect(names).not.toContain(name)
    },
  })
})

// After the open-core split (Step 2) the three specialists are no longer hardcoded
// in core — they ship as pro domain packages (@cyberstrike-io/mobile, /cloud,
// /internal-network) collected via domain discovery. A bare instance without those
// packages installed therefore does NOT expose them even under CYBERSTRIKE_TIER=pro;
// that they are provided when installed is covered by each package's own loader test,
// and the pro/free gate itself by the plugin discovery tier check.
test("pro domain specialists are no longer hardcoded in core", async () => {
  process.env["CYBERSTRIKE_TIER"] = "pro"
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const names = (await Agent.list()).map((a) => a.name)
      expect(names).toContain("cyberstrike")
      for (const name of PRO_AGENTS) expect(names).not.toContain(name)
    },
  })
})
