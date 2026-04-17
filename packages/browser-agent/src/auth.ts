import type { Page, BrowserContext } from "playwright"
import { Log } from "cyberstrike/util/log"
import fs from "fs"
import readline from "readline"

const log = Log.create({ service: "browser-agent:auth" })

// ============================================================
// Session management
// ============================================================

export async function saveSession(context: BrowserContext, filePath: string): Promise<void> {
  const cookies = await context.cookies()
  const storage = await context.storageState()
  fs.writeFileSync(filePath, JSON.stringify({ cookies, storage }, null, 2))
  log.info("session saved", { file: filePath })
}

export async function loadSession(context: BrowserContext, filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    log.info("no session file found", { file: filePath })
    return false
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    if (data.cookies) {
      await context.addCookies(data.cookies)
    }
    log.info("session loaded", { file: filePath })
    return true
  } catch (err) {
    log.error("failed to load session", { file: filePath, err: String(err) })
    return false
  }
}

// ============================================================
// Human-in-the-loop: pause and wait for user input
// ============================================================

export async function waitForHuman(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`\n[human] ${prompt} `, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/**
 * Detect if a 2FA / MFA / OTP page is shown and pause for user input.
 */
export async function handle2FA(page: Page): Promise<boolean> {
  const mfaSelectors = [
    'input[name*="otp"]',
    'input[name*="mfa"]',
    'input[name*="totp"]',
    'input[name*="2fa"]',
    'input[name*="verification"]',
    'input[placeholder*="verification code" i]',
    'input[placeholder*="auth code" i]',
    'input[placeholder*="one-time" i]',
    'input[placeholder*="otp" i]',
    'input[autocomplete="one-time-code"]',
  ]

  for (const sel of mfaSelectors) {
    const el = await page.$(sel)
    if (el) {
      log.info("2FA detected", { selector: sel })
      const code = await waitForHuman("Enter your 2FA code and press Enter:")
      await el.fill(code)
      const form = await page.$("form")
      if (form) {
        const submitBtn = await form.$('button[type="submit"], input[type="submit"], button:not([type])')
        if (submitBtn) await submitBtn.click()
      }
      await page.waitForLoadState("domcontentloaded").catch(() => {})
      return true
    }
  }

  return false
}

// ============================================================
// Manual login via browser button (Aşama 11)
// ============================================================

/**
 * Inject a floating button into the browser. Button re-appears on every navigation
 * so the user can click it after login redirects. Once clicked, listener is removed.
 */
/**
 * Wait for manual login via browser button.
 * @param page — Playwright page to inject button into
 * @param label — Optional credential label for multi-credential mode (e.g. "admin", "user")
 *                Shows as "✓ admin Login Complete — Start Scan"
 */
export async function waitForManualLogin(page: Page, label?: string): Promise<void> {
  let resolveReady: () => void
  const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve })

  const callbackName = label ? `__cyberstrikeReady_${label}` : "__cyberstrikeReady"
  await page.exposeFunction(callbackName, () => { resolveReady() })

  const buttonText = label
    ? `✓ ${label} Login Complete — Start Scan`
    : "✓ Start Scan"
  const buttonId = label ? `__cyberstrike-ready-btn-${label}` : "__cyberstrike-ready-btn"

  const injectButton = async () => {
    await page.evaluate(({ btnId, btnText, cbName }) => {
      if (document.getElementById(btnId)) return
      const btn = document.createElement("button")
      btn.id = btnId
      btn.textContent = btnText
      btn.style.cssText = "position:fixed;bottom:12px;left:12px;z-index:2147483647;padding:6px 14px;background:#2271b1;color:#fff;border:1px solid #fff;border-radius:4px;font-size:12px;font-weight:bold;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-family:sans-serif;opacity:0.9"
      btn.addEventListener("click", () => {
        ;(window as any)[cbName]()
        btn.textContent = "Starting scan..."
        btn.style.background = "#666"
        btn.style.cursor = "default"
      })
      document.body.appendChild(btn)
    }, { btnId: buttonId, btnText: buttonText, cbName: callbackName }).catch(() => {})
  }

  // Inject on current page + re-inject on every navigation
  await injectButton()
  page.on("load", injectButton)

  log.info("waiting for manual login", { label: label ?? "default" })
  await readyPromise

  // Done — stop re-injecting, remove button
  page.removeListener("load", injectButton)
  await page.evaluate((btnId) => {
    document.getElementById(btnId)?.remove()
  }, buttonId).catch(() => {})

  log.info("manual login confirmed", { label: label ?? "default" })
}

// ============================================================
// Auto-login
// ============================================================

/**
 * Auto-login with username/password credentials.
 * Falls back to manual login via browser button if form not found.
 */
export async function autoLogin(
  page: Page,
  credentials: { username: string; password: string; usernameSelector?: string; passwordSelector?: string }
): Promise<void> {
  const userSel = credentials.usernameSelector ?? 'input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]'
  const passSel = credentials.passwordSelector ?? 'input[type="password"]'

  try {
    await page.waitForSelector(userSel, { timeout: 5000 })
    await page.fill(userSel, credentials.username)
    await page.fill(passSel, credentials.password)

    const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:not([type])')
    if (submitBtn) {
      await submitBtn.click()
    } else {
      await page.keyboard.press("Enter")
    }

    await page.waitForLoadState("domcontentloaded").catch(() => {})
    log.info("auto-login attempted", { username: credentials.username })

    await handle2FA(page)
  } catch (err) {
    log.warn("auto-login failed, falling back to manual login", { err: String(err) })
    await waitForManualLogin(page)
  }
}
