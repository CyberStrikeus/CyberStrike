import type { Page } from "playwright"
import { Log } from "./log.ts"
import type { RawElement, ActionResult, UIContext } from "./types.ts"
import { snapshotPageUI } from "./capture.ts"

const log = Log.create({ service: "hackbrowser:executor" })

// ============================================================
// Constants
// ============================================================

const CLICK_TIMEOUT = 2000
const FILL_TIMEOUT = 3000
const STABILIZE_TIMEOUT = 3000
const STABILIZE_WAIT = 200

// ============================================================
// Main execute function
// ============================================================

/**
 * Execute an action on a given element.
 * Uses the element's system-generated selector (LLM never sees it).
 * Returns ActionResult for the feedback loop.
 */
export async function execute(
  page: Page,
  element: RawElement,
  action: string,
  value: string | undefined,
  setPendingUI: (promise: Promise<UIContext>) => void,
  elementsBefore: number,
): Promise<ActionResult> {
  const urlBefore = page.url()

  log.info("executing", { action, elementId: element.id, label: element.label, selector: element.selector })

  let error: string | undefined

  switch (action) {
    case "fill":
      error = await executeFill(page, element, value ?? "")
      break
    case "click":
      // Snapshot UI before click — interceptor pairs it with resulting HTTP request.
      // Passing the trigger locator lets snapshotPageUI scope to the enclosing form/dialog (Kural 3).
      setPendingUI(snapshotPageUI(page, page.locator(element.selector).first()))
      error = await executeClick(page, element)
      break
    case "select":
      error = await executeSelect(page, element, value ?? "")
      break
    case "navigate":
      error = await executeNavigate(page, element)
      break
    default:
      error = `Unknown action: ${action}`
  }

  // Wait for page to stabilize after action
  if (!error) {
    await stabilize(page)
  }

  const urlAfter = page.url()
  const navigated = urlAfter !== urlBefore

  return {
    success: !error,
    error,
    navigated,
    newUrl: navigated ? urlAfter : undefined,
    domChanged: undefined, // set by caller after re-collecting elements
  }
}

// ============================================================
// Action executors
// ============================================================

async function executeFill(page: Page, element: RawElement, value: string): Promise<string | undefined> {
  const selector = element.selector

  // Slider: set via underlying range input (Angular Material compatible)
  if (element.role === "slider" || element.type === "range") {
    // For slider, always try direct input[type=range] manipulation first (works even with empty selector)
    return executeSliderFill(page, selector || "role=slider", value)
  }

  // Standard fill
  const fillErr = await page
    .fill(selector, value, { timeout: FILL_TIMEOUT })
    .then(() => null)
    .catch((e: Error) => e.message.split("\n")[0]!)

  if (!fillErr) return undefined

  // Fallback: pressSequentially (works for inputs that reject programmatic fill)
  const typeErr = await page.locator(selector)
    .pressSequentially(value, { delay: 30, timeout: FILL_TIMEOUT })
    .then(() => null)
    .catch((e: Error) => e.message.split("\n")[0]!)

  if (!typeErr) return undefined

  log.warn("fill failed", { selector, error: fillErr })
  return fillErr
}

async function executeSliderFill(page: Page, selector: string, value: string): Promise<string | undefined> {
  const numericValue = parseInt(value)
  if (isNaN(numericValue) || numericValue <= 0) {
    return `Invalid slider value: ${value}`
  }

  // Target the specific slider element — scanner produces an element-unique
  // selector per slider. The actual range input may be the element itself
  // (native <input type=range>) or a descendant (Angular Material mat-slider
  // wraps one). Setting value + dispatching events updates FormControl
  // bindings in both cases.
  const root = page.locator(selector).first()
  const evalSuccess = await root.evaluate((el: Element, val: number) => {
    const input = el.matches("input[type=range]")
      ? (el as HTMLInputElement)
      : el.querySelector<HTMLInputElement>("input[type=range]")
    if (!input) return false
    input.value = String(val)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }, numericValue).catch(() => false)

  if (evalSuccess) return undefined

  // Fallback: keyboard interaction via the slider wrapper
  const clickErr = await root
    .click({ timeout: CLICK_TIMEOUT })
    .then(() => null)
    .catch((e: Error) => e)

  if (!clickErr) {
    await page.keyboard.press("Home")
    for (let i = 0; i < numericValue; i++) {
      await page.keyboard.press("ArrowRight")
    }
    return undefined
  }

  return `Slider interaction failed: ${selector}`
}

async function executeClick(page: Page, element: RawElement): Promise<string | undefined> {
  const err = await page
    .click(element.selector, { timeout: CLICK_TIMEOUT })
    .then(() => null)
    .catch((e: Error) => e.message.split("\n")[0]!)

  if (err) {
    log.warn("click failed", { selector: element.selector, error: err })
    return err
  }

  return undefined
}

async function executeSelect(page: Page, element: RawElement, value: string): Promise<string | undefined> {
  // 1. Native <select>: page.selectOption
  const nativeErr = await page
    .selectOption(element.selector, value, { timeout: FILL_TIMEOUT })
    .then(() => null)
    .catch((e: Error) => e.message.split("\n")[0]!)

  if (!nativeErr) return undefined

  // 2. Custom dropdown (mat-select, etc.): click to open → click option by text
  const clickErr = await page
    .click(element.selector, { timeout: CLICK_TIMEOUT })
    .then(() => null)
    .catch((e: Error) => e.message.split("\n")[0]!)

  if (clickErr) {
    log.warn("select failed", { selector: element.selector, error: nativeErr })
    return nativeErr
  }

  // Wait for dropdown overlay to appear
  await page.waitForTimeout(300)

  // Try to click an option matching the value text
  const optionErr = await page
    .click(`role=option[name="${value}"]`, { timeout: CLICK_TIMEOUT })
    .then(() => null)
    .catch(() =>
      page.click(`text="${value}"`, { timeout: CLICK_TIMEOUT })
        .then(() => null)
        .catch((e: Error) => e.message.split("\n")[0]!)
    )

  if (optionErr) {
    log.warn("select option failed", { value, error: optionErr })
    return optionErr
  }

  return undefined
}

async function executeNavigate(page: Page, element: RawElement): Promise<string | undefined> {
  if (!element.href) return "Navigate element has no href"

  const err = await page
    .goto(element.href, { waitUntil: "domcontentloaded", timeout: 15000 })
    .then(() => null)
    .catch((e: Error) => e.message.split("\n")[0]!)

  if (err) {
    log.warn("navigate failed", { url: element.href, error: err })
    return err
  }

  // SPA stabilization: wait for component-level async rendering
  await page.waitForTimeout(400)
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {})

  return undefined
}

// ============================================================
// Helpers
// ============================================================

async function stabilize(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: STABILIZE_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(STABILIZE_WAIT)
}
