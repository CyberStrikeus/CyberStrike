import type { Page, BrowserContext } from "playwright"
import { Log } from "./log.ts"
import fs from "fs"
import readline from "readline"

const log = Log.create({ service: "hackbrowser:auth" })

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
 *
 * Injects a tactical-HUD styled button (matches the live telemetry panel's
 * aesthetic — JetBrains Mono, #0b0f14 bg, cyan accent, corner brackets, pulse
 * indicator) at the bottom-left of the page and resolves when it is clicked.
 *
 * @param page — Playwright page to inject button into
 * @param label — Optional credential label for multi-credential mode (e.g. "admin", "user")
 */
export async function waitForManualLogin(page: Page, label?: string): Promise<void> {
  let resolveReady: () => void
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  const callbackName = label ? `__cyberstrikeReady_${label}` : "__cyberstrikeReady"
  await page.exposeFunction(callbackName, () => {
    resolveReady()
  })

  // Two-line label: top tells the user what to do (log in first), bottom is
  // the action they confirm by clicking. Uppercase throughout.
  const topLine = label ? `// ${label.toUpperCase()} · LOGIN MANUALLY ⟶ CLICK` : `// LOGIN MANUALLY ⟶ CLICK`
  const buttonText = "START SCAN"
  const buttonId = label ? `__cyberstrike-ready-btn-${label}` : "__cyberstrike-ready-btn"
  const styleId = "__cyberstrike-ready-btn-style"

  const injectButton = async () => {
    await page
      .evaluate(
        ({ btnId, btnText, topText, cbName, styleElId }) => {
          if (document.getElementById(btnId)) return

          // Inject keyframes + hover styles once per page.
          if (!document.getElementById(styleElId)) {
            const style = document.createElement("style")
            style.id = styleElId
            style.textContent = `
          @keyframes __cs-btn-pulse { 0%, 100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.15); } }
          #${btnId}:hover { box-shadow: 0 0 0 1px rgba(34,211,238,0.35), 0 0 28px rgba(34,211,238,0.45), 0 8px 24px rgba(0,0,0,0.6) !important; background: #0e141c !important; }
          #${btnId}:active { transform: translateY(1px); }
          #${btnId} .__cs-br { position: absolute; width: 8px; height: 8px; pointer-events: none; }
          #${btnId} .__cs-br::before, #${btnId} .__cs-br::after { content: ""; position: absolute; background: #22d3ee; }
          #${btnId} .__cs-br.tl::before { top: 0; left: 0; width: 8px; height: 1px; }
          #${btnId} .__cs-br.tl::after  { top: 0; left: 0; width: 1px; height: 8px; }
          #${btnId} .__cs-br.tr::before { top: 0; right: 0; width: 8px; height: 1px; }
          #${btnId} .__cs-br.tr::after  { top: 0; right: 0; width: 1px; height: 8px; }
          #${btnId} .__cs-br.bl::before { bottom: 0; left: 0; width: 8px; height: 1px; }
          #${btnId} .__cs-br.bl::after  { bottom: 0; left: 0; width: 1px; height: 8px; }
          #${btnId} .__cs-br.br::before { bottom: 0; right: 0; width: 8px; height: 1px; }
          #${btnId} .__cs-br.br::after  { bottom: 0; right: 0; width: 1px; height: 8px; }
          #${btnId} .__cs-br.tl { top: -1px; left: -1px; }
          #${btnId} .__cs-br.tr { top: -1px; right: -1px; }
          #${btnId} .__cs-br.bl { bottom: -1px; left: -1px; }
          #${btnId} .__cs-br.br { bottom: -1px; right: -1px; }
        `
            document.head.appendChild(style)
          }

          const btn = document.createElement("button")
          btn.id = btnId
          btn.type = "button"
          btn.style.cssText = [
            "all: initial",
            "position: fixed",
            "bottom: 16px",
            "left: 16px",
            "z-index: 2147483647",
            "display: flex",
            "flex-direction: column",
            "align-items: flex-start",
            "gap: 4px",
            "padding: 10px 16px 10px 14px",
            "background: #0b0f14",
            "border: 1px solid #1f2937",
            "color: #e5e7eb",
            "font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, ui-monospace, monospace",
            "cursor: pointer",
            "user-select: none",
            "box-shadow: 0 0 0 1px rgba(34,211,238,0.15), 0 0 20px rgba(34,211,238,0.25), 0 8px 24px rgba(0,0,0,0.5)",
            "transition: box-shadow 180ms ease-out, background 180ms ease-out",
            "-webkit-font-smoothing: antialiased",
          ].join(";")

          // Corner brackets — tactical HUD signature (same as panel card).
          for (const corner of ["tl", "tr", "bl", "br"]) {
            const b = document.createElement("span")
            b.className = `__cs-br ${corner}`
            btn.appendChild(b)
          }

          // Top meta line: "// LABEL · STATUS" in muted cyan.
          const meta = document.createElement("span")
          meta.textContent = topText
          meta.style.cssText = [
            "font-size: 9px",
            "letter-spacing: 0.12em",
            "color: #22d3ee",
            "opacity: 0.75",
            "text-transform: uppercase",
          ].join(";")
          btn.appendChild(meta)

          // Primary row: pulse dot + "START SCAN" in bright cyan.
          const row = document.createElement("span")
          row.style.cssText = "display: flex; align-items: center; gap: 8px;"
          const dot = document.createElement("span")
          dot.style.cssText = [
            "display: inline-block",
            "width: 7px",
            "height: 7px",
            "border-radius: 50%",
            "background: #22d3ee",
            "box-shadow: 0 0 0 1px rgba(34,211,238,0.35), 0 0 8px rgba(34,211,238,0.8)",
            "animation: __cs-btn-pulse 1.4s ease-in-out infinite",
          ].join(";")
          const txt = document.createElement("span")
          txt.textContent = btnText
          txt.style.cssText = [
            "font-size: 12px",
            "font-weight: 600",
            "letter-spacing: 0.14em",
            "color: #22d3ee",
            "text-transform: uppercase",
          ].join(";")
          row.appendChild(dot)
          row.appendChild(txt)
          btn.appendChild(row)

          btn.addEventListener("click", () => {
            ;(window as unknown as Record<string, () => void>)[cbName]()
            meta.textContent = "// SCANNING…"
            txt.textContent = "INITIATED"
            dot.style.animation = "none"
            dot.style.background = "#6b7280"
            dot.style.boxShadow = "none"
            txt.style.color = "#9ca3af"
            meta.style.color = "#6b7280"
            btn.style.cursor = "default"
            btn.style.opacity = "0.7"
          })
          document.body.appendChild(btn)
        },
        { btnId: buttonId, btnText: buttonText, topText: topLine, cbName: callbackName, styleElId: styleId },
      )
      .catch(() => {})
  }

  // Inject on current page + re-inject on every navigation
  await injectButton()
  page.on("load", injectButton)

  log.info("waiting for manual login", { label: label ?? "default" })
  await readyPromise

  // Done — stop re-injecting, remove button
  page.removeListener("load", injectButton)
  await page
    .evaluate((btnId) => {
      document.getElementById(btnId)?.remove()
    }, buttonId)
    .catch(() => {})

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
  credentials: { username: string; password: string; usernameSelector?: string; passwordSelector?: string },
): Promise<void> {
  const userSel =
    credentials.usernameSelector ??
    'input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]'
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
