import { test, expect, beforeAll, afterAll } from "bun:test"
import { chromium, type Browser, type Page } from "playwright"
import { readFileSync } from "fs"
import { collectElements } from "../src/scanner.ts"

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser.close()
})

async function loadFixture(name: string): Promise<Page> {
  const html = readFileSync(`${import.meta.dir}/fixtures/${name}`, "utf-8")
  const p = await browser.newPage()
  await p.setContent(html, { waitUntil: "networkidle" })
  await p.waitForFunction(
    () => document.querySelectorAll("input, textarea, select, [role=radiogroup], [role=combobox]").length > 0,
    { timeout: 2000 },
  ).catch(() => {})
  return p
}

// ============================================================
// BUG-4 — checkbox/radio labels wrapped in parent <label>
// ============================================================

test("BUG-4: checkbox wrapped in <label>text</label> resolves parent label text", async () => {
  const page = await loadFixture("bug-4-checkbox-label.html")
  const elements = await collectElements(page)

  const notifications = elements.find(e => e.tag === "input" && e.type === "checkbox" &&
                                           (e.value === "on" || e.value === "" || e.value === "true") &&
                                           e.selector.includes("notifications"))
  expect(notifications).toBeDefined()
  expect(notifications!.label.toLowerCase()).toContain("enable notifications")

  await page.close()
})

test("BUG-4: checkbox with <span> wrapped label resolves via parent", async () => {
  const page = await loadFixture("bug-4-checkbox-label.html")
  const elements = await collectElements(page)

  const marketing = elements.find(e => e.tag === "input" && e.type === "checkbox" &&
                                       e.selector.includes("marketing"))
  expect(marketing).toBeDefined()
  expect(marketing!.label.toLowerCase()).toContain("marketing emails")

  await page.close()
})

test("BUG-4: radio buttons wrapped in <label> resolve parent label text", async () => {
  const page = await loadFixture("bug-4-checkbox-label.html")
  const elements = await collectElements(page)

  const radios = elements.filter(e => e.tag === "input" && e.type === "radio")
  expect(radios.length).toBeGreaterThanOrEqual(3)
  const labels = radios.map(r => r.label.toLowerCase())
  // At least one radio must have resolved "light", "dark", or "auto" label
  const hasResolvedLabels = labels.some(l => ["light", "dark", "auto"].some(t => l.includes(t)))
  expect(hasResolvedLabels).toBe(true)

  await page.close()
})

test("BUG-4: aria-label on checkbox still wins over parent label (regression guard)", async () => {
  const page = await loadFixture("bug-4-checkbox-label.html")
  const elements = await collectElements(page)

  const priority = elements.find(e => e.tag === "input" && e.type === "checkbox" &&
                                      e.selector.toLowerCase().includes("priority"))
  expect(priority).toBeDefined()
  // Must use the aria-label "Priority User", not the parent's "(beta feature)"
  expect(priority!.label).toContain("Priority User")

  await page.close()
})

test("BUG-4: label[for=id] lookup still works (regression guard)", async () => {
  const page = await loadFixture("bug-4-checkbox-label.html")
  const elements = await collectElements(page)

  const newsletter = elements.find(e => e.tag === "input" && e.type === "checkbox" &&
                                        e.selector.includes("newsletter-cb"))
  expect(newsletter).toBeDefined()
  expect(newsletter!.label.toLowerCase()).toContain("newsletter")

  await page.close()
})
