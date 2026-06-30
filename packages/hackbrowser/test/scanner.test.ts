import { test, expect, beforeAll, afterAll } from "bun:test"
import { chromium, type Browser, type Page } from "playwright"
import { readFileSync } from "fs"
import { collectElements } from "../src/scanner.ts"

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch()
}, 30000)

afterAll(async () => {
  await browser.close()
}, 15000)

async function loadFixture(name: string): Promise<Page> {
  const html = readFileSync(`${import.meta.dir}/fixtures/${name}`, "utf-8")
  const p = await browser.newPage()
  await p.setContent(html, { waitUntil: "networkidle" })
  await p
    .waitForFunction(
      () => document.querySelectorAll("input, textarea, select, [role=radiogroup], [role=combobox]").length > 0,
      undefined,
      { timeout: 2000 }, // options is the 3rd arg — `{timeout}` here was being read as `arg`, leaving the default 30s wait
    )
    .catch(() => {})
  return p
}

// ============================================================
// BUG-4 — checkbox/radio labels wrapped in parent <label>
// ============================================================

test("BUG-4: checkbox wrapped in <label>text</label> resolves parent label text", async () => {
  const page = await loadFixture("bug-4-checkbox-label.html")
  const elements = await collectElements(page)

  const notifications = elements.find(
    (e) =>
      e.tag === "input" &&
      e.type === "checkbox" &&
      (e.value === "on" || e.value === "" || e.value === "true") &&
      e.selector.includes("notifications"),
  )
  expect(notifications).toBeDefined()
  expect(notifications!.label.toLowerCase()).toContain("enable notifications")

  await page.close()
})

test("BUG-4: checkbox with <span> wrapped label resolves via parent", async () => {
  const page = await loadFixture("bug-4-checkbox-label.html")
  const elements = await collectElements(page)

  const marketing = elements.find((e) => e.tag === "input" && e.type === "checkbox" && e.selector.includes("marketing"))
  expect(marketing).toBeDefined()
  expect(marketing!.label.toLowerCase()).toContain("marketing emails")

  await page.close()
})

test("BUG-4: radio buttons wrapped in <label> resolve parent label text", async () => {
  const page = await loadFixture("bug-4-checkbox-label.html")
  const elements = await collectElements(page)

  const radios = elements.filter((e) => e.tag === "input" && e.type === "radio")
  expect(radios.length).toBeGreaterThanOrEqual(3)
  const labels = radios.map((r) => r.label.toLowerCase())
  // At least one radio must have resolved "light", "dark", or "auto" label
  const hasResolvedLabels = labels.some((l) => ["light", "dark", "auto"].some((t) => l.includes(t)))
  expect(hasResolvedLabels).toBe(true)

  await page.close()
})

test("BUG-4: aria-label on checkbox still wins over parent label (regression guard)", async () => {
  const page = await loadFixture("bug-4-checkbox-label.html")
  const elements = await collectElements(page)

  const priority = elements.find(
    (e) => e.tag === "input" && e.type === "checkbox" && e.selector.toLowerCase().includes("priority"),
  )
  expect(priority).toBeDefined()
  // Must use the aria-label "Priority User", not the parent's "(beta feature)"
  expect(priority!.label).toContain("Priority User")

  await page.close()
})

test("BUG-4: label[for=id] lookup still works (regression guard)", async () => {
  const page = await loadFixture("bug-4-checkbox-label.html")
  const elements = await collectElements(page)

  const newsletter = elements.find(
    (e) => e.tag === "input" && e.type === "checkbox" && e.selector.includes("newsletter-cb"),
  )
  expect(newsletter).toBeDefined()
  expect(newsletter!.label.toLowerCase()).toContain("newsletter")

  await page.close()
})

// ============================================================
// BUG-12 — Same-label siblings disambiguation via index suffix
// ============================================================

test("BUG-12: two buttons with same label both collected, second gets (2) suffix", async () => {
  const page = await loadFixture("bug-12-sibling-labels.html")
  const elements = await collectElements(page)

  const addUserButtons = elements.filter((e) => e.role === "button" && e.label.startsWith("Add User"))
  expect(addUserButtons.length).toBe(2)

  const labels = addUserButtons.map((e) => e.label).sort()
  expect(labels).toEqual(["Add User", "Add User (2)"])

  await page.close()
}, 15000)

test("BUG-12: three identical buttons produce labels with (2) and (3) suffixes", async () => {
  const page = await loadFixture("bug-12-sibling-labels.html")
  const elements = await collectElements(page)

  const exportButtons = elements.filter((e) => e.role === "button" && e.label.startsWith("Export"))
  expect(exportButtons.length).toBe(3)

  const labels = exportButtons.map((e) => e.label).sort()
  expect(labels).toEqual(["Export", "Export (2)", "Export (3)"])

  await page.close()
}, 15000)

test("BUG-12: suffixed elements have distinct selectors", async () => {
  const page = await loadFixture("bug-12-sibling-labels.html")
  const elements = await collectElements(page)

  const addUserButtons = elements.filter((e) => e.role === "button" && e.label.startsWith("Add User"))
  // Each element should have a unique selector (so executor resolves to the right DOM node)
  const selectors = new Set(addUserButtons.map((e) => e.selector))
  expect(selectors.size).toBe(addUserButtons.length)

  await page.close()
}, 15000)

test("BUG-12: product card innerText differentiation unaffected (regression guard)", async () => {
  // Product cards pattern: same aria-label but different innerText — scanner's
  // enrichment should still distinguish by innerText, no numeric suffix needed.
  const html = `<!DOCTYPE html>
    <html><body>
      <a href="/p/1" aria-label="Click for product info"><span>Apple Juice — 1.99</span></a>
      <a href="/p/2" aria-label="Click for product info"><span>Banana Juice — 2.49</span></a>
      <a href="/p/3" aria-label="Click for product info"><span>Orange Juice — 2.99</span></a>
    </body></html>`
  const p = await browser.newPage()
  await p.setContent(html, { waitUntil: "networkidle" })
  const elements = await collectElements(p)
  const linkLabels = elements.filter((e) => e.role === "link").map((e) => e.label)
  // innerText enrichment differentiates — NO numeric suffix on any
  expect(linkLabels.some((l) => l.includes("Apple Juice"))).toBe(true)
  expect(linkLabels.some((l) => l.includes("Banana Juice"))).toBe(true)
  expect(linkLabels.every((l) => !l.match(/\(\d+\)$/))).toBe(true)
  await p.close()
}, 15000)

// ============================================================
// HTML5 constraints serialization — BUG-7 generic fix
// ============================================================

test("constraints: range input emits min/max/step", async () => {
  const page = await loadFixture("constraints.html")
  const elements = await collectElements(page)
  const price = elements.find((e) => e.role === "slider")
  expect(price).toBeDefined()
  expect(price!.constraints).toBe("min:0 max:1000 step:10")
  await page.close()
}, 15000)

test("constraints: number input emits min/max without step when unset", async () => {
  const page = await loadFixture("constraints.html")
  const elements = await collectElements(page)
  const age = elements.find((e) => e.tag === "input" && e.type === "number")
  expect(age).toBeDefined()
  expect(age!.constraints).toBe("min:18 max:120")
  await page.close()
}, 15000)

test("constraints: textarea emits maxlength", async () => {
  const page = await loadFixture("constraints.html")
  const elements = await collectElements(page)
  const about = elements.find((e) => e.tag === "textarea")
  expect(about).toBeDefined()
  expect(about!.constraints).toBe("maxlength:160")
  await page.close()
}, 15000)

test("constraints: email input emits maxlength + type hint", async () => {
  const page = await loadFixture("constraints.html")
  const elements = await collectElements(page)
  const email = elements.find((e) => e.type === "email")
  expect(email).toBeDefined()
  expect(email!.constraints).toContain("maxlength:80")
  expect(email!.constraints).toContain("type:email")
  await page.close()
}, 15000)

test("constraints: tel input emits maxlength + type hint", async () => {
  const page = await loadFixture("constraints.html")
  const elements = await collectElements(page)
  const mobile = elements.find((e) => e.type === "tel")
  expect(mobile).toBeDefined()
  expect(mobile!.constraints).toContain("maxlength:10")
  expect(mobile!.constraints).toContain("type:tel")
  await page.close()
}, 15000)

test("constraints: plain text input with no attributes emits empty string", async () => {
  const page = await loadFixture("constraints.html")
  const elements = await collectElements(page)
  const title = elements.find((e) => e.tag === "input" && e.type === "text")
  expect(title).toBeDefined()
  expect(title!.constraints).toBe("")
  await page.close()
}, 15000)

// ============================================================
// EPHEMERAL-IDS — framework-generated ids must never become selectors
//
// React/MUI `useId` ids (`:r21:`, `:R2lH1:`) and older generated ids (`mui-7`)
// look like stable `id` selectors but regenerate on every render, so a captured
// `div#:r21:` is detached by click time → "click: Timeout exceeded" (the prod
// failure reproduced by test-cases/mui-spa-trap). buildCSSSelector must reject
// them and fall to a render-stable selector. Authored mid-colon ids (JSF
// `form:saveBtn`) must be KEPT — the rule only targets the framework-id shape.
// ============================================================

test("ephemeral-ids: useId/generated ids rejected, authored ids kept", async () => {
  const page = await loadFixture("ephemeral-ids.html")
  const elements = await collectElements(page)
  const sel = (labelSubstr: string) =>
    elements.find((e) => e.label.toLowerCase().includes(labelSubstr.toLowerCase()))?.selector ?? ""

  // Authored ids — used as-is.
  expect(sel("Checkout Item")).toContain("checkout-button")
  expect(sel("Pharmacy Locator Item")).toContain("pharmacy-locator")
  // JSF mid-colon authored id — kept (no false positive).
  expect(sel("Jsf Save Item")).toContain("saveBtn")

  // Ephemeral framework ids — rejected, never embedded in the selector.
  const react = sel("React UseId Item")
  expect(react.length).toBeGreaterThan(0) // still discovered
  expect(react).not.toContain(":r21") // but NOT via the ephemeral id
  expect(await page.locator(react).count()).toBe(1) // fallback selector resolves uniquely
  expect(sel("React Ssr Item")).not.toContain(":R2lH1")
  expect(sel("Mui Generated Item")).not.toContain("mui-7")

  await page.close()
}, 15000)
