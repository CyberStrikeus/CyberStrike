import { test, expect, beforeAll, afterAll } from "bun:test"
import { chromium, type Browser, type Page } from "playwright"
import { readFileSync } from "fs"
import { snapshotPageUI } from "../src/capture.ts"

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
  // SPA fixtures render after DOMContentLoaded — wait for a real form field to appear
  await p.waitForFunction(
    () => document.querySelectorAll("input, textarea, select, [role=radiogroup], [role=combobox]").length > 0,
    { timeout: 2000 },
  ).catch(() => {})
  return p
}

// ============================================================
// BUG-15 — radio group collapses to a single field
// ============================================================

test("BUG-15: radio group with 3 options collapses to 1 field with checked value", async () => {
  const page = await loadFixture("bug-15-radio.html")
  const ui = await snapshotPageUI(page, null)

  const genderFields = ui.fields.filter(f => f.name === "gender")
  expect(genderFields.length).toBe(1)
  expect(genderFields[0]!.type).toBe("radio")
  expect(genderFields[0]!.value).toBe("Female")

  await page.close()
})

test("BUG-15: radio group with >3 options lists first 3 + ellipsis", async () => {
  const page = await loadFixture("bug-15-radio.html")
  const ui = await snapshotPageUI(page, null)

  const priority = ui.fields.find(f => f.name === "priority")
  expect(priority).toBeDefined()
  expect(priority!.type).toBe("radio")
  expect(priority!.value).toBe("Medium")
  // New shape: options field on UIField — first 3 comma-separated + ", ..."
  expect((priority as any).options).toBe("Low, Medium, High, ...")

  await page.close()
})

test("BUG-15: radio group with no pre-selection has empty value but keeps options", async () => {
  const page = await loadFixture("bug-15-radio.html")
  const ui = await snapshotPageUI(page, null)

  const sub = ui.fields.find(f => f.name === "subscription")
  expect(sub).toBeDefined()
  expect(sub!.value).toBe("")
  expect((sub as any).options).toBe("Free, Pro, Enterprise")

  await page.close()
})

// ============================================================
// BUG-6 — listbox/menu option children must not leak as display-only fields
// ============================================================

test("BUG-6: [role=option] descendants of [role=listbox] are NOT display-only fields", async () => {
  const page = await loadFixture("bug-6-listbox.html")
  const ui = await snapshotPageUI(page, null)

  const optionValues = ["Electronics", "Clothing", "Books", "Food", "Sports"]
  const leaked = ui.fields.filter(
    f => f.isDisplayOnly && optionValues.includes(f.value)
  )
  expect(leaked.length).toBe(0)

  await page.close()
})

test("BUG-6: [role=menuitem] children must not leak as display-only fields", async () => {
  const page = await loadFixture("bug-6-listbox.html")
  const ui = await snapshotPageUI(page, null)

  const menuValues = ["Price ↑", "Price ↓", "Newest"]
  const leaked = ui.fields.filter(
    f => f.isDisplayOnly && menuValues.includes(f.value)
  )
  expect(leaked.length).toBe(0)

  await page.close()
})

test("BUG-6: genuine [data-field] display value is still captured (regression guard)", async () => {
  const page = await loadFixture("bug-6-listbox.html")
  const ui = await snapshotPageUI(page, null)

  const priceField = ui.fields.find(f => f.name === "priceBand")
  expect(priceField).toBeDefined()
  expect(priceField!.isDisplayOnly).toBe(true)
  expect(priceField!.value).toBe("99.99")

  await page.close()
})

test("BUG-6: real form inputs (text, hidden) still captured", async () => {
  const page = await loadFixture("bug-6-listbox.html")
  const ui = await snapshotPageUI(page, null)

  const query = ui.fields.find(f => f.name === "query")
  expect(query).toBeDefined()
  expect(query!.value).toBe("test")

  const category = ui.fields.find(f => f.name === "category")
  expect(category).toBeDefined()
  expect(category!.type).toBe("hidden")

  await page.close()
})

// ============================================================
// BUG-19 — Scope resolution: trigger's enclosing form / dialog / empty
// ============================================================

test("BUG-19: contact form submit → scope isolated to contact form only", async () => {
  const page = await loadFixture("bug-19-scope.html")
  const trigger = page.locator('[data-test="contact-submit"]')
  const ui = await snapshotPageUI(page, trigger)

  const names = ui.fields.map(f => f.name).sort()
  expect(names).toEqual(["email", "message", "name"])

  await page.close()
})

test("BUG-19: feedback form submit → scope excludes sibling contact form", async () => {
  const page = await loadFixture("bug-19-scope.html")
  const trigger = page.locator('[data-test="feedback-submit"]')
  const ui = await snapshotPageUI(page, trigger)

  const names = ui.fields.map(f => f.name).sort()
  expect(names).toEqual(["comment", "rating"])

  await page.close()
})

test("BUG-19: modal confirm (dialog without <form>) → dialog scope", async () => {
  const page = await loadFixture("bug-19-scope.html")
  const trigger = page.locator('[data-test="modal-confirm"]')
  const ui = await snapshotPageUI(page, trigger)

  const names = ui.fields.map(f => f.name).sort()
  expect(names).toEqual(["reason"])

  await page.close()
})

test("BUG-19: table-row delete button (no form ancestor) → fields=[]", async () => {
  const page = await loadFixture("bug-19-scope.html")
  const trigger = page.locator('[data-test="delete-bob"]')
  const ui = await snapshotPageUI(page, trigger)

  expect(ui.fields.length).toBe(0)

  await page.close()
})

test("BUG-19: form-less SPA card (known limitation) → fields=[]", async () => {
  const page = await loadFixture("bug-19-scope.html")
  const trigger = page.locator('[data-test="formless-login"]')
  const ui = await snapshotPageUI(page, trigger)

  // Kural 3 known limitation: no <form>, no dialog → empty fields.
  // Raw HTTP body and trigger_element still carry signal at the integration layer.
  expect(ui.fields.length).toBe(0)

  await page.close()
})

test("BUG-19: null trigger → legacy body scan (regression guard)", async () => {
  const page = await loadFixture("bug-19-scope.html")
  const ui = await snapshotPageUI(page, null)

  // All fields across all scopes should appear when no trigger is provided
  const names = new Set(ui.fields.map(f => f.name))
  expect(names.has("name")).toBe(true)
  expect(names.has("email")).toBe(true)
  expect(names.has("rating")).toBe(true)
  expect(names.has("comment")).toBe(true)
  expect(names.has("reason")).toBe(true)
  expect(names.has("username")).toBe(true)

  await page.close()
})

// ============================================================
// BUG-17 — hiddenReason enrichment: distinguish WHY a field is hidden
// ============================================================

test("BUG-17: type=hidden input carries hiddenReason='type=hidden'", async () => {
  const page = await loadFixture("bug-17-hidden-reason.html")
  const ui = await snapshotPageUI(page, null)

  const csrf = ui.fields.find(f => f.name === "csrf_token")
  expect(csrf).toBeDefined()
  expect(csrf!.isHidden).toBe(true)
  expect((csrf as any).hiddenReason).toBe("type=hidden")

  await page.close()
})

test("BUG-17: display:none input carries hiddenReason='display:none'", async () => {
  const page = await loadFixture("bug-17-hidden-reason.html")
  const ui = await snapshotPageUI(page, null)

  const company = ui.fields.find(f => f.name === "companyName")
  expect(company).toBeDefined()
  expect(company!.isHidden).toBe(true)
  expect((company as any).hiddenReason).toBe("display:none")

  await page.close()
})

test("BUG-17: visibility:hidden input carries hiddenReason='visibility:hidden'", async () => {
  const page = await loadFixture("bug-17-hidden-reason.html")
  const ui = await snapshotPageUI(page, null)

  const tax = ui.fields.find(f => f.name === "taxId")
  expect(tax).toBeDefined()
  expect(tax!.isHidden).toBe(true)
  expect((tax as any).hiddenReason).toBe("visibility:hidden")

  await page.close()
})

test("BUG-17: opacity:0 input carries hiddenReason='opacity:0'", async () => {
  const page = await loadFixture("bug-17-hidden-reason.html")
  const ui = await snapshotPageUI(page, null)

  const referral = ui.fields.find(f => f.name === "referralCode")
  expect(referral).toBeDefined()
  expect(referral!.isHidden).toBe(true)
  expect((referral as any).hiddenReason).toBe("opacity:0")

  await page.close()
})

test("BUG-17: visible fields have undefined hiddenReason (regression guard)", async () => {
  const page = await loadFixture("bug-17-hidden-reason.html")
  const ui = await snapshotPageUI(page, null)

  const email = ui.fields.find(f => f.name === "email")
  expect(email).toBeDefined()
  expect(email!.isHidden).toBe(false)
  expect((email as any).hiddenReason).toBeUndefined()

  const fullName = ui.fields.find(f => f.name === "fullName")
  expect(fullName).toBeDefined()
  expect(fullName!.isHidden).toBe(false)
  expect((fullName as any).hiddenReason).toBeUndefined()

  await page.close()
})
