// Regression guard for issue #100 gap #2 — search-gated dialog comboboxes.
// collectComboboxOptions must (A) drive type→reveal→collect for a combobox whose options
// only appear after a query is typed, (B) short-circuit to the inline result for a plain
// listbox combobox without probing, and (C) degrade gracefully when the popup doesn't
// focus a typeable field — no options, no throw, and NO stray typing. LLM-free.
//
// Run: bun test test/combobox.test.ts

import { test, expect, beforeAll, afterAll } from "bun:test"
import { chromium, type Browser, type Page } from "playwright"
import { readFileSync } from "fs"
import { collectElements } from "../src/scanner.ts"
import { collectComboboxOptions } from "../src/agent.ts"

const PAGE_URL = "http://localhost/"

let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch()
}, 30000)
afterAll(async () => {
  await browser.close()
}, 15000)

async function load(): Promise<Page> {
  const html = readFileSync(`${import.meta.dir}/fixtures/combobox-search-dialog.html`, "utf-8")
  const p = await browser.newPage()
  await p.setContent(html, { waitUntil: "networkidle" })
  await p.waitForTimeout(100)
  return p
}

// Mirrors the caller: click the combobox, collect the immediate post-click elements, then
// hand them to collectComboboxOptions (which probes + re-collects internally if needed).
async function optionsAfterClick(page: Page, comboSelector: string) {
  await page.locator(comboSelector).click()
  await page.waitForTimeout(150)
  const postClick = await collectElements(page)
  return collectComboboxOptions(page, postClick, new Set<string>(), PAGE_URL, new Set<string>())
}

test("A: search-gated dialog combobox → options revealed by probing and collected", async () => {
  const page = await load()
  const tasks = await optionsAfterClick(page, "#owner-combo")
  // One selection per combobox interaction (collectOptionTasks slices to 1).
  expect(tasks.length).toBe(1)
  expect(tasks[0].role).toBe("option")
  expect(tasks[0].label).toContain("Owner")
  // The probe went into the combobox's own search input (never a stray field).
  expect(await page.locator("#owner-search").inputValue()).not.toBe("")
  await page.close()
})

test("B: inline listbox combobox → short-circuits to inline options, no probing", async () => {
  const page = await load()
  const tasks = await optionsAfterClick(page, "#status-combo")
  expect(tasks.length).toBe(1) // first inline option
  expect(tasks[0].role).toBe("option")
  expect(tasks[0].label).toBe("Active")
  await page.close()
})

test("C: dialog opens without focusing a typeable field → graceful, no options, no stray typing", async () => {
  const page = await load()
  const tasks = await optionsAfterClick(page, "#region-combo")
  expect(tasks.length).toBe(0)
  // The guarantee: nothing was ever typed into the popup's search input.
  expect(await page.locator("#region-search").inputValue()).toBe("")
  await page.close()
})
