import { chromium, type Page, type BrowserContext } from "playwright"
import { Log } from "cyberstrike/util/log"
import type { AgentConfig, CapturedRequest, UIContext, PageTask, FormTask, ClickTask, ActionResult, QueueEntry, PageDiffContext, CredentialConfig } from "./types.ts"
import { buildRawRequest, correlateWithUI, parseRequestParams } from "./capture.ts"
import { sendIngest, initSession, sendPageDiff, registerCredential, syncCredentialHeaders, extractAuthHeaders, headersChanged } from "./ingest.ts"
import { loadSession, autoLogin, handle2FA, waitForManualLogin } from "./auth.ts"
import { resolveModel, planPage, planUnexploredElements } from "./navigator.ts"
import { scrollAndCollect, collectElements, isViewportCenterBlocked, filterVisitedLinks } from "./scanner.ts"
import { createGlobalState, buildPlannerSnapshot, normalizeUrl, generateFingerprint, generateFullFingerprint, computeElementAvailability, availabilityToRecord, classifyAuthUrl, INPUT_ROLES, markPageEmpty, drainEmptyStateQueue, drainOnMutation, hasSuccessfulMutation } from "./state.ts"
import { execute } from "./executor.ts"
import type { LanguageModel } from "ai"
import type { RawElement } from "./types.ts"

const log = Log.create({ service: "browser-agent:agent" })

// ============================================================
// Constants
// ============================================================

const MAX_STEPS_PER_PAGE = 30     // Max tasks executed per page (loop guard)
const MAX_TASK_QUEUE_SIZE = 30    // TaskQueue growth cap
const MAX_UNPLANNED_ITERATIONS = 2 // Max additional LLM calls for unexplored elements
const OVERLAY_ESCAPE_WAIT = 400
const SPA_RENDER_RETRY_WAIT = 600
const POST_GOTO_WAIT = 400
const LOGIN_SUCCESS_PATTERN = /POST\s+.*\/(login|signin|authenticate)\S*\s+\[200\]/i
const SKIP_AUTO_DISCOVERY = /\b(logout|sign.?out|log.?out|delete.?account|reset.?data|revoke)\b/i

// ============================================================
// Post-Login Re-Discovery
// ============================================================

/**
 * After login is detected, re-queue all visited pages for fingerprint-based re-exploration.
 * Pages with unchanged fingerprint are skipped (no LLM calls).
 * Pages with changed fingerprint get full AI exploration.
 */
/**
 * Mark that login was detected. The actual re-queue happens in the BFS loop
 * AFTER the current page finishes exploration (so new discoveries from
 * collectDOMLinks are enqueued first, before re-visit URLs).
 */
function triggerReDiscovery(globalState: ReturnType<typeof createGlobalState>): void {
  if (globalState.authPhase === "authenticated") return
  globalState.authPhase = "authenticated"
  globalState.pendingReDiscovery = true
  log.info("login detected, re-discovery pending")
}

/** Flush pending re-discovery: append re-visit URLs after any new discoveries already in queue. */
function flushReDiscovery(globalState: ReturnType<typeof createGlobalState>): void {
  if (!globalState.pendingReDiscovery) return
  globalState.pendingReDiscovery = false

  const pagesToRevisit = [...globalState.visitedPages]
  for (const url of pagesToRevisit) {
    if (!globalState.pageQueue.includes(url)) {
      globalState.pageQueue.push(url)
    }
  }
  log.info("post-login re-discovery flushed", { pagesToRevisit: pagesToRevisit.length, queueSize: globalState.pageQueue.length })
}

// ============================================================
// Phase-Based Exploration — Auth Phase Transition (Aşama 7)
// ============================================================

/**
 * Process deferred auth pages in pentester order: register → login → logout.
 * Called when BFS queue is empty and deferred auth pages exist.
 *
 * Phase flow:
 *  1. Anonymous BFS complete → queue register page (if found)
 *  2. Register explored → queue login page (if found)
 *  3. Login explored → triggerReDiscovery (re-queue all visited pages)
 *  4. Authenticated BFS complete → queue logout page (if found)
 */
function processAuthPhase(
  globalState: ReturnType<typeof createGlobalState>,
  targetHost: string,
): void {
  const deferred = globalState.deferredAuthPages

  if (globalState.authPhase === "anonymous") {
    // Try register first
    const registerPage = deferred.find((d) => d.type === "register")
    if (registerPage) {
      log.info("phase transition: anonymous → register", { url: registerPage.url })
      globalState.authPhase = "registered"
      globalState.visitedPages.add(normalizeUrl(registerPage.url))
      globalState.pageQueue.push(registerPage.url)
      globalState.deferredAuthPages = deferred.filter((d) => d.type !== "register")
      return
    }

    // No register found yet — explore login page to discover register link
    // Keep login in deferred so it can be re-queued after register
    const loginPage = deferred.find((d) => d.type === "login")
    if (loginPage) {
      const loginNormalized = normalizeUrl(loginPage.url)
      const alreadyExplored = globalState.visitedPages.has(loginNormalized)
      if (!alreadyExplored) {
        log.info("exploring login page to discover register link", { url: loginPage.url })
        globalState.visitedPages.add(loginNormalized)
        globalState.pageQueue.push(loginPage.url)
        // Keep login in deferred — will be re-queued after register or on second pass
        return
      }
      // Login already explored, register still not found → proceed without register
      log.info("phase transition: anonymous → login (no register found)", { url: loginPage.url })
      globalState.pageQueue.push(loginPage.url)
      globalState.deferredAuthPages = deferred.filter((d) => d.type !== "login")
      return
    }
  }

  if (globalState.authPhase === "registered") {
    // After register, go to login
    const loginPage = deferred.find((d) => d.type === "login")
    if (loginPage) {
      log.info("phase transition: registered → login", { url: loginPage.url })
      // Clear fingerprint — login needs full re-exploration after register
      globalState.pageFingerprints.delete(normalizeUrl(loginPage.url))
      globalState.pageQueue.push(loginPage.url)
      globalState.deferredAuthPages = deferred.filter((d) => d.type !== "login")
      return
    }
  }

  if (globalState.authPhase === "authenticated") {
    // After authenticated BFS, process logout
    const logoutPage = deferred.find((d) => d.type === "logout")
    if (logoutPage) {
      log.info("phase transition: authenticated → logout", { url: logoutPage.url })
      globalState.visitedPages.add(normalizeUrl(logoutPage.url))
      globalState.pageQueue.push(logoutPage.url)
      globalState.deferredAuthPages = deferred.filter((d) => d.type !== "logout")
      return
    }
  }

  // No more deferred pages to process — clear remaining
  if (globalState.deferredAuthPages.length > 0) {
    log.debug("clearing remaining deferred auth pages", {
      remaining: globalState.deferredAuthPages.map((d) => `${d.type}:${d.url}`),
    })
    globalState.deferredAuthPages = []
  }
}

// ============================================================
// Capture handler types
// ============================================================

type CaptureFn = (captured: CapturedRequest) => Promise<void>

function createIngestHandler(
  serverUrl: string,
  sessionID: string,
  credentialId: string | undefined,
): CaptureFn {
  return (captured) => sendIngest(captured, serverUrl, sessionID, credentialId).then(() => {})
}

function createDryRunHandler(): CaptureFn {
  return async (captured) => {
    const requestLine = captured.raw.split("\n")[0]?.trim() ?? ""
    const status = captured.response?.status ?? "---"
    const uiFields = captured.uiContext?.fields.length ?? 0
    const hiddenParams = captured.uiContext?.hiddenParams ?? []
    const trigger = captured.triggerElement

    const roles = captured.elementRoles
    const page = captured.pageUrl
    const visitedBy = captured.pageVisitedBy
    log.info(`→ ${requestLine}  [${status}]${uiFields > 0 ? `  ui_fields:${uiFields}` : ""}${trigger ? `  trigger:${trigger}` : ""}${roles ? `  roles:[${roles.join(",")}]` : ""}${page ? `  page:${page}` : ""}${visitedBy ? `  visited_by:[${visitedBy.join(",")}]` : ""}`)

    if (captured.uiContext) {
      for (const f of captured.uiContext.fields) {
        const flags = [
          f.isReadOnly ? "readonly" : "",
          f.isHidden ? "hidden" : "",
          f.isDisabled ? "disabled" : "",
          f.isDisplayOnly ? "display-only" : "",
        ].filter(Boolean).join(",")
        log.debug(`field: ${f.name || f.label || "(unnamed)"}  type:${f.type}  value:${JSON.stringify(f.value)}${flags ? `  [${flags}]` : ""}`)
      }
      if (hiddenParams.length > 0) {
        log.debug(`hidden params (not in UI): ${hiddenParams.join(", ")}`)
      }
    }
  }
}

// ============================================================
// URL filtering — skip static assets
// ============================================================

const SKIP_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".css", ".js", ".mjs", ".woff", ".woff2", ".ttf", ".eot",
  ".map", ".mp4", ".mp3", ".pdf", ".zip", ".gz",
]

function shouldSkipUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const path = u.pathname.toLowerCase()
    if (SKIP_EXTENSIONS.some((ext) => path.endsWith(ext))) return true
    if (path.startsWith("/socket.io/")) return true
    return false
  } catch {
    return true
  }
}

// ============================================================
// Request interceptor
// ============================================================

interface Interceptor {
  setPendingUI: (promise: Promise<UIContext>) => void
  /** Set trigger element for action window — all requests during window get this trigger */
  setPendingTrigger: (trigger: string) => void
  /** Clear trigger element — ends action window */
  clearPendingTrigger: () => void
  /** Drain recent captures since last call — returns "METHOD /path [status]" strings */
  drainRecentCaptures: () => string[]
}

/** Local CrawlContext — used by multi-credential mode (Aşama 12) */
interface LocalCrawlContext {
  id: string
  page: Page
  interceptor: Interceptor
  credentialId: string
  sessionId: string
}

function setupRequestInterceptor(
  page: Page,
  targetHost: string,
  onCapture: (req: CapturedRequest) => void,
): Interceptor {
  let pendingUIContext: Promise<UIContext> | null = null
  let pendingTrigger: string | null = null
  const recentCaptures: string[] = []

  page.on("request", async (request) => {
    const url = request.url()
    if (shouldSkipUrl(url)) return

    try {
      const urlObj = new URL(url)
      if (!urlObj.hostname.includes(targetHost) && !targetHost.includes(urlObj.hostname)) return
    } catch {
      return
    }

    const method = request.method()
    const headers = await request.allHeaders()
    const postData = request.postData() ?? null
    const raw = buildRawRequest(method, url, headers, postData)

    // UI context — consume-once, only for mutating requests (existing behavior)
    let uiContext = null
    const isMutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS"
    if (pendingUIContext && isMutating) {
      try {
        const ctx = await pendingUIContext
        const params = parseRequestParams(postData, url)
        uiContext = correlateWithUI(ctx, params)
      } catch {}
      pendingUIContext = null
    }

    // Trigger element — persists for entire action window (GET included)
    const triggerElement = pendingTrigger

    let response = null
    try {
      const pwResponse = await request.response()
      if (pwResponse) {
        const status = pwResponse.status()
        const respHeaders = await pwResponse.allHeaders()
        let body = ""
        try {
          body = await pwResponse.text()
          if (body.length > 500 * 1024) body = body.slice(0, 500 * 1024) + "\n[TRUNCATED]"
        } catch {}
        response = { status, headers: respHeaders, body }
      }
    } catch {}

    onCapture({ raw, response, uiContext, triggerElement, elementRoles: null, pageUrl: null, pageVisitedBy: null, timestamp: Date.now() })

    // Track for action feedback — "METHOD /path [status]"
    const status = response?.status ?? 0
    try {
      const u = new URL(url)
      recentCaptures.push(`${method} ${u.pathname} [${status}]`)
    } catch {
      recentCaptures.push(`${method} ${url} [${status}]`)
    }
  })

  return {
    setPendingUI: (promise) => {
      pendingUIContext = promise
    },
    setPendingTrigger: (trigger) => {
      pendingTrigger = trigger
    },
    clearPendingTrigger: () => {
      pendingTrigger = null
    },
    drainRecentCaptures: () => {
      const result = [...recentCaptures]
      recentCaptures.length = 0
      return result
    },
  }
}

// ============================================================
// Host checking
// ============================================================

function isOnHost(url: string, targetHost: string): boolean {
  try {
    const h = new URL(url).hostname
    return h.includes(targetHost) || targetHost.includes(h)
  } catch {
    return false
  }
}

// ============================================================
// Phase-aware URL enqueue (Aşama 7)
// ============================================================

/**
 * Enqueue a URL for BFS exploration. During anonymous phase, auth URLs
 * (login/register/logout) are deferred instead of queued immediately.
 * Returns true if enqueued, false if deferred or already visited.
 */
const MAX_PER_PATH_PATTERN = 5

function enqueueUrl(
  url: string,
  globalState: ReturnType<typeof createGlobalState>,
  targetHost: string,
): boolean {
  const normalized = normalizeUrl(url)
  if (!isOnHost(url, targetHost)) return false
  if (globalState.visitedPages.has(normalized)) return false
  // Skip URLs that are external redirectors (e.g. /redirect?to=https://external.com)
  try {
    const u = new URL(url)
    if (/^\/redirect\b/i.test(u.pathname) && u.search) return false
  } catch {}

  // Logout URLs are always skipped — system handles logout via processAuthPhase
  if (classifyAuthUrl(normalized) === "logout") return false

  // Path pattern limiting: same pathname + same param keys = same template
  // e.g. /product?productId=1 and /product?productId=2 share key "/product[productId]"
  const patternKey = getPathPatternKey(normalized)
  if (patternKey) {
    const count = globalState.pathPatternCounts.get(patternKey) ?? 0
    if (count >= MAX_PER_PATH_PATTERN) {
      log.debug("path pattern limit reached, skipping", { url: normalized, patternKey, count })
      return false
    }
    globalState.pathPatternCounts.set(patternKey, count + 1)
  }

  // During anonymous phase, defer auth URLs (register/login) for later processing
  if (globalState.authPhase === "anonymous") {
    const authType = classifyAuthUrl(normalized)
    if (authType) {
      const alreadyDeferred = globalState.deferredAuthPages.some(
        (d) => d.url === normalized,
      )
      if (!alreadyDeferred) {
        globalState.deferredAuthPages.push({ url: normalized, type: authType })
        log.debug("deferred auth URL", { url: normalized, type: authType })
      }
      return false
    }
  }

  globalState.visitedPages.add(normalized)
  globalState.pageQueue.push(url)
  log.debug("enqueued URL", { url: normalized, queueSize: globalState.pageQueue.length })
  return true
}

/**
 * Extract path pattern key: pathname + sorted param names (values stripped).
 * Returns null for URLs without query params (no limiting needed).
 * e.g. "/product?productId=1" → "/product[productId]"
 *      "/search?q=test&page=2" → "/search[page,q]"
 */
function getPathPatternKey(url: string): string | null {
  try {
    const u = new URL(url)
    const paramKeys = [...u.searchParams.keys()].sort()
    if (paramKeys.length === 0) return null
    return u.pathname + "[" + paramKeys.join(",") + "]"
  } catch {
    return null
  }
}

// ============================================================
// AI-driven page exploration (Aşama 9: Planner + TaskQueue)
// ============================================================

async function explorePageWithAI(
  page: Page,
  pageUrl: string,
  interceptor: Interceptor,
  model: LanguageModel,
  globalState: ReturnType<typeof createGlobalState>,
  targetHost: string,
): Promise<string[]> {
  const linksToEnqueue: string[] = []
  const semanticActionsDone = new Set<string>()

  // 1. Initial element collection (SPA retry on empty)
  let elements = await scrollAndCollect(page)
  if (elements.length === 0) {
    log.debug("no elements on first collection, waiting for render")
    await page.waitForTimeout(SPA_RENDER_RETRY_WAIT)
    elements = await scrollAndCollect(page)
  }
  elements = filterVisitedLinks(elements, pageUrl, globalState.visitedPages)
  log.debug("initial scan", { elements: elements.length })

  // 2. Ask LLM once — get the full exploration plan for this page
  const vcBlocked = await isViewportCenterBlocked(page)
  const snapshot = buildPlannerSnapshot(pageUrl, elements, globalState, vcBlocked)
  const plan = await planPage(snapshot, model)
  log.info("page plan received", {
    tasks: plan.tasks.length,
    pageState: plan.pageState ?? "unknown",
    revisitAfter: plan.revisitAfter ?? null,
  })

  // Aşama 13 §3.5.1 — Journey Awareness on initial page plan
  applyPlanIntelligence(plan, pageUrl, globalState)

  // 3. TaskQueue — system drives execution, no LLM per step
  const taskQueue: PageTask[] = [...plan.tasks]
  // Track all seen element semantic keys to detect new elements after clicks
  const seenKeys = new Set(elements.map(e => `${e.role}::${e.label}`))
  let steps = 0

  while (taskQueue.length > 0 && steps < MAX_STEPS_PER_PAGE) {
    steps++
    const task = taskQueue.shift()!

    // Re-collect before each task (DOM may have changed from previous action)
    elements = filterVisitedLinks(
      await collectElements(page),
      pageUrl,
      globalState.visitedPages,
    )

    // If the task target is blocked by an overlay (e.g. sidenav opened by a prior click),
    // close the overlay first so the element becomes reachable again.
    {
      const lookupRole = task.type === "form" ? (task.fields[0]?.role ?? task.submit.role) : task.role
      const lookupLabel = task.type === "form" ? (task.fields[0]?.label ?? task.submit.label) : task.label
      if (!resolveElement(elements, lookupRole, lookupLabel) && await isViewportCenterBlocked(page)) {
        log.debug("task target blocked by overlay, closing overlay first", { role: lookupRole, label: lookupLabel })
        await closeOverlay(page)
        elements = filterVisitedLinks(await collectElements(page), pageUrl, globalState.visitedPages)
      }
    }

    log.info("executing task", {
      step: `${steps}/${MAX_STEPS_PER_PAGE}`,
      type: task.type,
      label: task.type === "form" ? `form(${task.fields.length} fields → ${task.submit.label.slice(0, 30)})` : task.label,
      remaining: taskQueue.length,
    })

    if (task.type === "form") {
      await executeFormTask(task, page, elements, interceptor, semanticActionsDone, globalState, linksToEnqueue, pageUrl, targetHost)
    } else {
      await executeClickTask(task, page, elements, interceptor, semanticActionsDone, globalState, linksToEnqueue, pageUrl, targetHost)
    }

    // Unified post-action discovery: find new elements after any action (form submit or click)
    const postActionElements = filterVisitedLinks(await collectElements(page), pageUrl, globalState.visitedPages)

    // Combobox → option: mechanical pattern, system handles directly (no LLM needed)
    // When a combobox was just clicked, queue its options for selection
    if (task.type === "click" && task.role === "combobox") {
      const optionTasks = collectOptionTasks(postActionElements, seenKeys)
      if (optionTasks.length > 0) {
        taskQueue.unshift(...optionTasks)
      }
    }

    const hasNewElements = discoverNewElements(postActionElements, seenKeys)

    // Any new element appeared (input or button) → re-plan with LLM
    // System only detects change; LLM decides what to do (Architecture 2.1)
    if (hasNewElements) {
      const freshElements = filterVisitedLinks(await collectElements(page), pageUrl, globalState.visitedPages)
      const snapshot = buildPlannerSnapshot(pageUrl, freshElements, globalState, await isViewportCenterBlocked(page))
      const newPlan = await planPage(snapshot, model)
      applyPlanIntelligence(newPlan, pageUrl, globalState)  // Aşama 13
      if (newPlan.tasks.length > 0) {
        log.debug("re-plan after new elements", { tasks: newPlan.tasks.length })
        taskQueue.unshift(...newPlan.tasks)
      }
    }

    // If queue empty but overlay still open, close it and discover post-overlay elements
    if (taskQueue.length === 0 && await isViewportCenterBlocked(page)) {
      log.debug("queue empty, overlay open — closing overlay")
      await closeOverlay(page)
      if (!await isViewportCenterBlocked(page)) {
        elements = filterVisitedLinks(await scrollAndCollect(page), pageUrl, globalState.visitedPages)
        for (const el of elements) {
          const k = `${el.role}::${el.label}`
          if (!seenKeys.has(k) && el.label && el.role !== "link" && !INPUT_ROLES.has(el.role)) {
            seenKeys.add(k)
            taskQueue.push({ type: "click", role: el.role, label: el.label })
          }
        }
      }
    }
  }

  // 4. Unplanned element check — find actions LLM missed (Aşama 10)
  // After all tasks complete, detect unexplored interactive elements
  // and ask LLM for additional plans. Max 2 iterations (loop guard).
  for (let iteration = 0; iteration < MAX_UNPLANNED_ITERATIONS && steps < MAX_STEPS_PER_PAGE; iteration++) {
    const currentElements = filterVisitedLinks(await scrollAndCollect(page), pageUrl, globalState.visitedPages)
    const unexplored = findUnexploredElements(currentElements, semanticActionsDone, seenKeys)
    if (unexplored.length === 0) break

    log.info("unexplored elements found", { count: unexplored.length, iteration: iteration + 1, labels: unexplored.slice(0, 5) })

    const vcBlocked = await isViewportCenterBlocked(page)
    const snap = buildPlannerSnapshot(pageUrl, currentElements, globalState, vcBlocked)
    const additionalPlan = await planUnexploredElements(snap, unexplored, model)
    applyPlanIntelligence(additionalPlan, pageUrl, globalState)  // Aşama 13

    if (additionalPlan.tasks.length === 0) break

    log.info("additional plan for unexplored elements", { tasks: additionalPlan.tasks.length })

    // Execute additional tasks
    const additionalQueue: PageTask[] = [...additionalPlan.tasks]
    while (additionalQueue.length > 0 && steps < MAX_STEPS_PER_PAGE) {
      steps++
      const task = additionalQueue.shift()!

      elements = filterVisitedLinks(await collectElements(page), pageUrl, globalState.visitedPages)

      // Close overlay if task target is blocked
      {
        const lookupRole = task.type === "form" ? (task.fields[0]?.role ?? task.submit.role) : task.role
        const lookupLabel = task.type === "form" ? (task.fields[0]?.label ?? task.submit.label) : task.label
        if (!resolveElement(elements, lookupRole, lookupLabel) && await isViewportCenterBlocked(page)) {
          await closeOverlay(page)
          elements = filterVisitedLinks(await collectElements(page), pageUrl, globalState.visitedPages)
        }
      }

      log.info("executing additional task", {
        step: `${steps}/${MAX_STEPS_PER_PAGE}`,
        type: task.type,
        label: task.type === "form" ? `form(${task.fields.length} fields → ${task.submit.label.slice(0, 30)})` : task.label,
        remaining: additionalQueue.length,
      })

      if (task.type === "form") {
        await executeFormTask(task, page, elements, interceptor, semanticActionsDone, globalState, linksToEnqueue, pageUrl, targetHost)
      } else {
        await executeClickTask(task, page, elements, interceptor, semanticActionsDone, globalState, linksToEnqueue, pageUrl, targetHost)
      }

      // Post-action discovery (same as main loop)
      const postActionElements = filterVisitedLinks(await collectElements(page), pageUrl, globalState.visitedPages)
      if (task.type === "click" && task.role === "combobox") {
        const optionTasks = collectOptionTasks(postActionElements, seenKeys)
        if (optionTasks.length > 0) additionalQueue.unshift(...optionTasks)
      }
      const hasNewElements = discoverNewElements(postActionElements, seenKeys)
      if (hasNewElements) {
        const freshElements = filterVisitedLinks(await collectElements(page), pageUrl, globalState.visitedPages)
        const freshSnap = buildPlannerSnapshot(pageUrl, freshElements, globalState, await isViewportCenterBlocked(page))
        const newPlan = await planPage(freshSnap, model)
        applyPlanIntelligence(newPlan, pageUrl, globalState)  // Aşama 13
        if (newPlan.tasks.length > 0) {
          additionalQueue.unshift(...newPlan.tasks)
        }
      }
    }
  }

  // 5. Store fingerprint for post-login re-visit comparison
  const finalElements = await collectElements(page)
  globalState.pageFingerprints.set(pageUrl, generateFingerprint(finalElements))
  log.debug("fingerprint stored", { url: pageUrl })

  // 6. Collect same-host links from DOM (BFS supplement)
  try {
    const domLinks = await collectDOMLinks(page, pageUrl, targetHost)
    for (const url of domLinks) {
      if (!linksToEnqueue.includes(url)) linksToEnqueue.push(url)
    }
  } catch {
    log.debug("collectDOMLinks failed (page may have navigated)")
  }

  return linksToEnqueue
}

// ============================================================
// Task executors
// ============================================================

/**
 * Execute a form task: fill all fields in order, then click submit.
 * Handles textbox, combobox, checkbox, radio, slider fields.
 */
async function executeFormTask(
  task: FormTask,
  page: Page,
  elements: RawElement[],
  interceptor: Interceptor,
  semanticActionsDone: Set<string>,
  globalState: ReturnType<typeof createGlobalState>,
  linksToEnqueue: string[],
  pageUrl: string,
  targetHost: string,
): Promise<void> {
  for (const field of task.fields) {
    const el = resolveElement(elements, field.role, field.label)
    if (!el) {
      log.debug("form field not found", { role: field.role, label: field.label })
      continue
    }

    const action = fieldAction(field.role)
    const value = action === "click" ? undefined : field.value
    const key = `${el.role}::${el.label}::${action}::${value ?? ""}`
    if (semanticActionsDone.has(key)) continue

    interceptor.drainRecentCaptures()
    const result = await execute(page, el, action, value, interceptor.setPendingUI, elements.length)
    trackResult(result, interceptor, globalState)

    semanticActionsDone.add(key)
    globalState.totalSteps++

    if (field.role === "combobox") await page.waitForTimeout(300)
  }

  // Re-collect before submit — fields may have enabled a previously disabled button
  elements = await collectElements(page)

  // Submit
  const submitEl = resolveElement(elements, task.submit.role, task.submit.label)
  if (!submitEl) {
    log.debug("submit button not found", task.submit)
    return
  }

  const submitKey = `${submitEl.role}::${submitEl.label}::${submitEl.selector}::click::`
  if (semanticActionsDone.has(submitKey)) return

  interceptor.drainRecentCaptures()
  interceptor.setPendingTrigger(`${submitEl.role}:${submitEl.label}`)
  const result = await execute(page, submitEl, "click", undefined, interceptor.setPendingUI, elements.length)
  interceptor.clearPendingTrigger()
  trackResult(result, interceptor, globalState, task.triggersMutation)

  semanticActionsDone.add(submitKey)
  globalState.totalSteps++

  if (result.navigated) {
    const cur = page.url()
    if (cur !== pageUrl && isOnHost(cur, targetHost)) linksToEnqueue.push(cur)
    log.debug("reloading after form submit", { pageUrl })
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(POST_GOTO_WAIT)
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {})
  }
}

/**
 * Execute a click task.
 * Discovery of new elements is handled by the unified post-action flow in the caller.
 */
async function executeClickTask(
  task: ClickTask,
  page: Page,
  elements: RawElement[],
  interceptor: Interceptor,
  semanticActionsDone: Set<string>,
  globalState: ReturnType<typeof createGlobalState>,
  linksToEnqueue: string[],
  pageUrl: string,
  targetHost: string,
): Promise<void> {
  const el = resolveElement(elements, task.role, task.label)
  if (!el) {
    log.debug("click target not found", { role: task.role, label: task.label })
    return
  }

  const key = `${el.role}::${el.label}::click::`
  if (isSemanticDone(semanticActionsDone, key)) return

  interceptor.drainRecentCaptures()
  interceptor.setPendingTrigger(`${el.role}:${el.label}`)
  const result = await execute(page, el, "click", undefined, interceptor.setPendingUI, elements.length)
  interceptor.clearPendingTrigger()
  trackResult(result, interceptor, globalState, task.triggersMutation)

  semanticActionsDone.add(key)
  globalState.totalSteps++

  // Option click → mark parent combobox as done (Architecture 6.6)
  if (el.role === "option") {
    const parentCombobox = elements.find(e => e.role === "combobox")
    if (parentCombobox) {
      semanticActionsDone.add(`${parentCombobox.role}::${parentCombobox.label}::click::`)
    }
  }

  if (result.navigated) {
    const cur = page.url()
    if (cur !== pageUrl && isOnHost(cur, targetHost)) linksToEnqueue.push(cur)
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(POST_GOTO_WAIT)
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {})
    return
  }

  if (el.role === "combobox") await page.waitForTimeout(500)
}

// ============================================================
// Helpers
// ============================================================

/**
 * Collect option elements as click tasks after a combobox opens.
 * Mechanical pattern: combobox click → options appear → first option gets clicked.
 * Only the first option is queued (one selection per combobox).
 */
function collectOptionTasks(elements: RawElement[], seenKeys: Set<string>): PageTask[] {
  const tasks: PageTask[] = []
  for (const el of elements) {
    if (el.role !== "option") continue
    const k = `${el.role}::${el.label}`
    if (seenKeys.has(k)) continue
    seenKeys.add(k)
    if (!el.label || !el.selector) continue
    tasks.push({ type: "click", role: el.role, label: el.label })
  }
  // Only select the first option — one selection per combobox interaction
  return tasks.slice(0, 1)
}

/**
 * Check if new interactive elements appeared after an action.
 * Only detects change — does NOT decide what to do (that's LLM's job via re-plan).
 * Registers seen keys to avoid redundant re-plans on subsequent actions.
 */
function discoverNewElements(
  elements: RawElement[],
  seenKeys: Set<string>,
): boolean {
  let found = false
  for (const el of elements) {
    const k = `${el.role}::${el.label}`
    if (seenKeys.has(k)) continue
    seenKeys.add(k)
    if (!el.label || !el.selector) continue
    if (el.role === "link") continue
    found = true
  }
  if (found) log.debug("new elements discovered after action")
  return found
}

/**
 * Find interactive elements that were NOT explored during task execution.
 * Filters out: links (BFS handles), already-actioned elements, duplicate roles.
 * Duplicate role filter: 3x "Edit ..." → keeps only the first "Edit ..." (Aşama 10.4)
 * Returns label strings for LLM prompt.
 */
function findUnexploredElements(
  elements: RawElement[],
  semanticActionsDone: Set<string>,
  seenKeys: Set<string>,
): string[] {
  const unexplored: string[] = []
  const rolesSeen = new Set<string>()  // for duplicate role filter

  for (const el of elements) {
    if (!el.label || !el.selector) continue
    if (el.role === "link") continue
    if (INPUT_ROLES.has(el.role)) continue // input fields are part of forms, not standalone actions

    // Check if this element was already actioned
    const actionKey = `${el.role}::${el.label}::click::`
    if (isSemanticDone(semanticActionsDone, actionKey)) continue

    // Duplicate role filter: extract base action name (e.g. "Edit" from "Edit Alice Johnson")
    // Same base role+action means same endpoint pattern — only need one
    const baseLabel = el.label.split(" ").slice(0, 1).join(" ")  // first word
    const roleKey = `${el.role}::${baseLabel}`
    if (rolesSeen.has(roleKey)) continue
    rolesSeen.add(roleKey)

    unexplored.push(`[${el.role}] ${el.label}`)
  }

  return unexplored
}

/** Map form field role to executor action */
function fieldAction(role: string): "fill" | "select" | "click" {
  if (role === "combobox") return "select"
  if (role === "checkbox" || role === "radio") return "click"
  return "fill"
}

/**
 * Enrichment-aware semantic dedup check (Architecture 6.6).
 * Labels change after interaction: "Country — Select your country" → "Country — United States".
 * Check both exact key and base label (before " — ") to catch post-interaction variants.
 */
function isSemanticDone(done: Set<string>, key: string): boolean {
  if (done.has(key)) return true
  const baseLabel = key.split(" — ")[0]
  if (baseLabel !== key) {
    for (const existing of done) {
      if (existing.startsWith(baseLabel)) return true
    }
  }
  return false
}

/** Find an element by role+label. Falls back to prefix match for enriched labels. */
function resolveElement(elements: RawElement[], role: string, label: string): RawElement | undefined {
  return elements.find(e => e.role === role && e.label === label)
    ?? elements.find(e => e.role === role && e.label.startsWith(label))
}

/**
 * Apply Intelligence signals from a PagePlan (Aşama 13 §3.3.1 + §3.5.1).
 * Called wherever the agent receives a plan from the LLM — initial plan,
 * re-plan after DOM changes, unexplored-elements plan, multi-credential plan.
 * Currently handles only Journey Awareness (empty-state revisit marking).
 */
function applyPlanIntelligence(
  plan: { pageState?: string; revisitAfter?: string | null; revisitReason?: string; revisitOn?: string },
  pageUrl: string,
  globalState: ReturnType<typeof createGlobalState>,
): void {
  if (plan.pageState !== "empty" || plan.revisitAfter !== "any-mutation") return
  const queued = markPageEmpty(globalState, pageUrl, plan.revisitOn)
  if (queued) {
    log.info("page marked empty for mutation-triggered revisit", {
      url: pageUrl,
      reason: plan.revisitReason,
      revisitOn: plan.revisitOn ?? "*",
    })
  } else {
    log.debug("empty-state revisit rejected by hard limit", { url: pageUrl })
  }
}

/** Drain HTTP captures and attach to result, update globalState.capturedEndpoints.
 *  Also triggers empty-state revisit drain when the action caused a successful
 *  mutation (Aşama 13 §3.5.1).
 *  @param taskMutation  LLM-predicted keyword from the triggering task (if any).
 *                       Matched against empty pages' revisitOn for targeted drain. */
function trackResult(
  result: ActionResult,
  interceptor: Interceptor,
  globalState: ReturnType<typeof createGlobalState>,
  taskMutation?: string,
): void {
  const reqs = interceptor.drainRecentCaptures()
  result.httpRequests = reqs.length > 0 ? reqs : undefined
  if (result.httpRequests) {
    for (const req of result.httpRequests) globalState.capturedEndpoints.add(req)
    // Journey Awareness: successful mutation drains matching empty-state URLs.
    // Uses drainOnMutation so keyword-tagged URLs only drain on match; ANY_MUTATION
    // URLs drain on any mutation (backward-compat).
    if (hasSuccessfulMutation(result.httpRequests) && globalState.emptyStateQueue.size > 0) {
      const drained = drainOnMutation(globalState, taskMutation)
      if (drained.length > 0) {
        log.info("mutation triggered empty-state revisit drain", {
          drained: drained.length,
          urls: drained,
          taskMutation: taskMutation ?? "(none)",
        })
      }
    }
  }
}

/** Close overlay via Escape, fall back to backdrop click */
async function closeOverlay(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {})
  await page.waitForTimeout(OVERLAY_ESCAPE_WAIT)
  if (await isViewportCenterBlocked(page)) {
    log.debug("Escape failed, clicking backdrop")
    const dims = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    await page.mouse.click(dims.w / 2, dims.h / 2).catch(() => {})
    await page.waitForTimeout(OVERLAY_ESCAPE_WAIT)
  }
}

// ============================================================
// Helpers
// ============================================================

const COOKIE_SELECTORS = [
  'button[class*="cookie" i]',
  'button[id*="cookie" i]',
  'a[class*="cookie" i]',
  '[class*="cookie-banner" i] button',
  '[class*="cookie-consent" i] button',
  '[id*="cookie-banner" i] button',
  '[id*="cookie-consent" i] button',
  '[class*="gdpr" i] button',
  '[aria-label*="cookie" i]',
  '[aria-label*="dismiss" i]',
]

async function dismissCookieBanner(page: Page): Promise<void> {
  for (const selector of COOKIE_SELECTORS) {
    const btn = await page.$(selector)
    if (btn) {
      await btn.click().catch(() => {})
      await page.waitForTimeout(300)
      log.debug("cookie banner dismissed", { selector })
      return
    }
  }
}

function resolveUrl(href: string, baseUrl: string, targetHost: string): string | null {
  try {
    const resolved = new URL(href, baseUrl).href
    if (isOnHost(resolved, targetHost)) return normalizeUrl(resolved)
  } catch {}
  return null
}

/** Collect <a href> links from DOM as BFS supplement. */
async function collectDOMLinks(page: Page, pageUrl: string, targetHost: string): Promise<string[]> {
  const hrefs: string[] = await page.$$eval("a[href]", (els) =>
    els.map((el) => (el as HTMLAnchorElement).href).filter(Boolean),
  )

  const results: string[] = []
  const seen = new Set<string>()

  for (const href of hrefs) {
    try {
      const u = new URL(href)
      if (!u.hostname.includes(targetHost) && !targetHost.includes(u.hostname)) continue
      const normalized = u.origin + u.pathname + u.search + u.hash
      if (!seen.has(normalized)) {
        seen.add(normalized)
        results.push(normalized)
      }
    } catch {}
  }

  return results
}

// ============================================================
// Multi-Credential Parallel Crawl (Aşama 12)
// ============================================================

/**
 * Drain all capture queues with page-level enrichment.
 * Called at page boundary (all contexts done) — availability and page info are correct.
 * For final drain, pass empty availability and null page info (credential_id fallback).
 */
async function drainPageCaptures(
  captureQueues: Map<string, CapturedRequest[]>,
  captureHandlers: Map<string, CaptureFn>,
  availability: Map<string, string[]>,
  pageUrl: string | null,
  pageVisitedBy: string[] | null,
): Promise<void> {
  for (const [ctxId, queue] of captureQueues) {
    const handler = captureHandlers.get(ctxId)
    if (!handler) continue
    while (queue.length > 0) {
      const captured = queue.shift()!
      // Enrich: trigger_element → availability Map lookup → element_roles
      if (captured.triggerElement && availability.size > 0) {
        const mapKey = captured.triggerElement.replace(":", "::")
        const roles = availability.get(mapKey)
        captured.elementRoles = roles ? [...new Set(roles)] : null
      }
      // Enrich: page context
      if (pageUrl) captured.pageUrl = pageUrl
      if (pageVisitedBy) captured.pageVisitedBy = pageVisitedBy
      await handler(captured)
    }
  }
}

/**
 * Enqueue a URL with context tracking for multi-credential mode.
 * If URL already in queue, merge the context into its context list.
 */
function enqueueWithContext(
  url: string,
  contextId: string,
  queue: QueueEntry[],
  visitedPages: Set<string>,
  targetHost: string,
  pathPatternCounts: Map<string, number>,
): boolean {
  const normalized = normalizeUrl(url)

  // Skip external URLs
  try {
    const u = new URL(normalized)
    if (!u.hostname.includes(targetHost) && !targetHost.includes(u.hostname)) return false
  } catch { return false }

  // Skip already visited
  if (visitedPages.has(normalized)) return false

  // Skip logout URLs
  const authType = classifyAuthUrl(normalized)
  if (authType === "logout") return false

  // Skip redirect paths
  try {
    if (new URL(normalized).pathname.startsWith("/redirect")) return false
  } catch {}

  // Path pattern limiting (same as single-credential)
  const patternKey = getPathPatternKey(normalized)
  if (patternKey) {
    const count = pathPatternCounts.get(patternKey) ?? 0
    if (count >= 5) return false
    pathPatternCounts.set(patternKey, count + 1)
  }

  // Check if already in queue — merge context
  const existing = queue.find(e => normalizeUrl(e.url) === normalized)
  if (existing) {
    if (!existing.contexts.includes(contextId)) {
      existing.contexts.push(contextId)
    }
    return false
  }

  queue.push({ url: normalized, contexts: [contextId] })
  return true
}

/**
 * Run multi-credential parallel crawl.
 * Strategy: single BFS loop, CrawlContext[] for N contexts.
 * Navigate in parallel, explore sequentially per context.
 */
async function runMultiCredential(
  config: AgentConfig,
  credentials: CredentialConfig[],
): Promise<void> {
  const targetUrl = config.targetUrl
  const targetHost = new URL(targetUrl).hostname
  const serverUrl = config.cyberstrike.serverUrl ?? "http://127.0.0.1:4096"
  const maxPages = config.maxSteps ?? 50
  const dryRun = config.dryRun ?? false

  log.info(`starting multi-credential crawl${dryRun ? " (DRY-RUN)" : ""}`, {
    target: targetUrl,
    credentials: credentials.map(c => c.id),
    maxPages,
  })

  // Resolve AI model
  let model: LanguageModel
  try {
    model = await resolveModel()
    log.info("AI navigation enabled")
  } catch (err) {
    log.error("AI model required", { err: String(err) })
    process.exit(1)
  }

  const browser = await chromium.launch({ headless: config.headless ?? false })

  // Single CyberStrike session for ALL credentials
  let sessionId = ""
  if (!dryRun) {
    const created = await initSession(serverUrl, targetUrl, undefined)
    if (!created) {
      log.error("failed to create session")
      process.exit(1)
    }
    sessionId = created
  }

  // Build CrawlContext for each credential — sequential manual login
  const contexts: LocalCrawlContext[] = []
  const captureQueues = new Map<string, CapturedRequest[]>()
  // Track auth headers per credential for sync (same pattern as Firefox extension)
  const lastAuthHeaders = new Map<string, Record<string, string>>()

  for (const cred of credentials) {
    const browserContext = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    })
    const page = await browserContext.newPage()

    // Navigate to target
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 })

    // Manual login for this credential
    await waitForManualLogin(page, cred.id)

    // Register credential with CyberStrike (same as Firefox extension pattern)
    let credentialId = cred.id
    if (!dryRun) {
      const registeredId = await registerCredential(serverUrl, sessionId, cred.id)
      if (registeredId) {
        credentialId = registeredId
      } else {
        log.warn("credential registration failed, using label as ID", { credential: cred.id })
      }
    }

    // Wire up capture pipeline with header sync
    const captureQueue: CapturedRequest[] = []
    captureQueues.set(cred.id, captureQueue)
    lastAuthHeaders.set(cred.id, {})

    const interceptor = setupRequestInterceptor(page, targetHost, (req) => {
      captureQueue.push(req)
      // Sync auth headers on every capture (same as Firefox extension)
      if (!dryRun) {
        const authHeaders = extractAuthHeaders(req.raw)
        if (Object.keys(authHeaders).length > 0) {
          const last = lastAuthHeaders.get(cred.id)!
          if (headersChanged(last, authHeaders)) {
            lastAuthHeaders.set(cred.id, authHeaders)
            syncCredentialHeaders(serverUrl, sessionId, credentialId, authHeaders)
          }
        }
      }
    })

    contexts.push({
      id: cred.id,
      page,
      interceptor,
      credentialId,
      sessionId,
    })

    log.info("credential context ready", { credential: cred.id, credentialId, sessionId: dryRun ? "dry-run" : sessionId })
  }

  // Build per-context capture handlers (used by page-end drain and final drain)
  const captureHandlers = new Map<string, CaptureFn>()
  for (const ctx of contexts) {
    captureHandlers.set(ctx.id, dryRun
      ? createDryRunHandler()
      : createIngestHandler(serverUrl, ctx.sessionId, ctx.credentialId))
  }

  // Initialize BFS queue — use each context's actual URL after login (may have redirected from targetUrl)
  // Collect unique post-login URLs and tag with their contexts
  const seedUrls = new Map<string, string[]>()
  for (const ctx of contexts) {
    const actualUrl = normalizeUrl(ctx.page.url())
    if (!seedUrls.has(actualUrl)) seedUrls.set(actualUrl, [])
    seedUrls.get(actualUrl)!.push(ctx.id)
  }
  const pageQueue: QueueEntry[] = [...seedUrls.entries()].map(([url, ctxIds]) => ({ url, contexts: ctxIds }))
  const visitedPages = new Set<string>()
  const pathPatternCounts = new Map<string, number>()
  const globalState = createGlobalState({ outOfScope: config.outOfScope })
  globalState.authPhase = "authenticated" // Multi-credential: skip anonymous phase
  let pagesExplored = 0

  // BFS Loop — single loop, N contexts
  while (pageQueue.length > 0 && pagesExplored < maxPages) {
    const entry = pageQueue.shift()!
    pagesExplored++

    log.info("processing URL", {
      page: `${pagesExplored}/${maxPages}`,
      url: entry.url,
      contexts: entry.contexts,
      queueSize: pageQueue.length,
    })

    // Determine active contexts (only those that should visit this URL)
    const activeContexts = contexts.filter(c => entry.contexts.includes(c.id))

    // Parallel navigate
    const navigateResults = await Promise.all(
      activeContexts.map(async (ctx) => {
        try {
          await ctx.page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 15000 })
          await ctx.page.waitForTimeout(POST_GOTO_WAIT)
          await ctx.page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {})
          return { ctx, success: true, redirected: normalizeUrl(ctx.page.url()) !== normalizeUrl(entry.url) }
        } catch (err) {
          log.warn("navigation failed", { credential: ctx.id, url: entry.url, err: String(err) })
          return { ctx, success: false, redirected: false }
        }
      })
    )

    // Filter: skip contexts that failed or got access-denied redirect
    // Normal redirects (e.g. / → /dashboard) are fine — only skip if redirected to login/unauthorized
    const ACCESS_DENIED_PATTERNS = /\/(login|signin|sign-in|unauthorized|forbidden|access-denied|auth)/i
    const visitableContexts: LocalCrawlContext[] = []

    for (const r of navigateResults) {
      if (!r.success) continue
      if (r.redirected) {
        const actualPath = new URL(r.ctx.page.url()).pathname
        if (ACCESS_DENIED_PATTERNS.test(actualPath)) {
          log.info("access denied redirect, skipping explore", {
            credential: r.ctx.id,
            intended: entry.url,
            redirectedTo: r.ctx.page.url(),
          })
          continue
        }
        // Normal redirect (e.g. / → /dashboard) — explore the actual page
        log.info("redirect to different page, will explore actual URL", {
          credential: r.ctx.id,
          intended: entry.url,
          actual: r.ctx.page.url(),
        })
      }
      visitableContexts.push(r.ctx)
    }

    if (visitableContexts.length === 0) {
      log.info("no contexts could access page, skipping", { url: entry.url })
      continue
    }

    // Mark URL as visited BEFORE exploration — prevents re-enqueue during explore/collectDOMLinks
    const normalizedEntryUrl = normalizeUrl(entry.url)
    visitedPages.add(normalizedEntryUrl)
    globalState.visitedPages.add(normalizedEntryUrl) // sync for explorePageWithAI's filterVisitedLinks

    // Close overlays + dismiss cookies on all visitable contexts
    for (const ctx of visitableContexts) {
      await ctx.page.keyboard.press("Escape").catch(() => {})
      await ctx.page.waitForTimeout(OVERLAY_ESCAPE_WAIT)
      await dismissCookieBanner(ctx.page)
    }

    // Collect elements from each context
    const elementsByContext = new Map<string, RawElement[]>()
    const fingerprintsByContext = new Map<string, string>()

    for (const ctx of visitableContexts) {
      const elements = await scrollAndCollect(ctx.page)
      elementsByContext.set(ctx.id, elements)
      fingerprintsByContext.set(ctx.id, generateFullFingerprint(elements))
    }

    // Compute element availability (N-role)
    const availability = computeElementAvailability(elementsByContext)

    // Check if all fingerprints are the same
    const fingerprints = [...fingerprintsByContext.values()]
    const allSameFingerprint = fingerprints.length > 0 && fingerprints.every(fp => fp === fingerprints[0])

    // Page-diff is intermediate data — element_roles + page_visited_by on each request
    // is the summarized form. Raw page-diff is NOT sent to CyberStrike (Decision 1).
    if (dryRun) {
      log.info("page-diff", {
        url: entry.url,
        fingerprintMatch: allSameFingerprint,
        elementCount: availability.size,
        visitedBy: visitableContexts.map(c => c.id),
      })
    }

    // Plan + Explore
    if (allSameFingerprint && visitableContexts.length > 1) {
      // All contexts see the same page — 1 LLM call, execute on all
      const firstCtx = visitableContexts[0]!
      const elements = elementsByContext.get(firstCtx.id)!
      const filtered = filterVisitedLinks(elements, entry.url, globalState.visitedPages)

      log.info("same fingerprint — single LLM plan for all contexts", {
        contexts: visitableContexts.map(c => c.id),
        elements: filtered.length,
      })

      // Get plan once
      const snapshot = buildPlannerSnapshot(entry.url, filtered, globalState, false)
      const plan = await planPage(snapshot, model)
      applyPlanIntelligence(plan, entry.url, globalState)  // Aşama 13

      // Execute on each context sequentially
      for (const ctx of visitableContexts) {
        log.info("exploring with shared plan", { credential: ctx.id, url: entry.url })
        const discovered = await explorePageWithAI(
          ctx.page, entry.url, ctx.interceptor, model, globalState, targetHost,
        )
        for (const url of discovered) {
          enqueueWithContext(url, ctx.id, pageQueue, visitedPages, targetHost, pathPatternCounts)
        }
      }
    } else {
      // Different fingerprints — each context gets its own LLM call
      for (const ctx of visitableContexts) {
        log.info("exploring independently", { credential: ctx.id, url: entry.url })
        const discovered = await explorePageWithAI(
          ctx.page, entry.url, ctx.interceptor, model, globalState, targetHost,
        )
        for (const url of discovered) {
          enqueueWithContext(url, ctx.id, pageQueue, visitedPages, targetHost, pathPatternCounts)
        }
      }
    }

    // Collect DOM links from each context — enqueue with context tag
    for (const ctx of visitableContexts) {
      const domLinks = await collectDOMLinks(ctx.page, entry.url, targetHost)
      for (const url of domLinks) {
        enqueueWithContext(url, ctx.id, pageQueue, visitedPages, targetHost, pathPatternCounts)
      }
    }

    // Page-end drain: send all captures with page-level enrichment
    // availability Map is correct for this page — all contexts have finished exploration
    const visitedBy = visitableContexts.map(c => c.id)
    await drainPageCaptures(captureQueues, captureHandlers, availability, entry.url, visitedBy)

    await visitableContexts[0]?.page.waitForTimeout(300)
  }

  // Final drain — late async requests, no enrichment (credential_id fallback)
  log.info("multi-credential exploration complete, draining remaining requests")
  await contexts[0]?.page.waitForTimeout(2000)

  await drainPageCaptures(captureQueues, captureHandlers, new Map(), null, null)

  log.info("multi-credential crawl done", {
    pagesExplored,
    credentials: contexts.map(c => c.id),
    totalSteps: globalState.totalSteps,
    capturedEndpoints: globalState.capturedEndpoints.size,
  })

  await browser.close()
}

// ============================================================
// Main entry point
// ============================================================

export async function run(config: AgentConfig): Promise<void> {
  // Multi-credential mode: separate code path, same BFS engine
  if (config.multiCredentials && config.multiCredentials.length >= 2) {
    return runMultiCredential(config, config.multiCredentials)
  }

  // Single-credential mode: existing flow, unchanged
  const targetUrl = config.targetUrl
  const targetHost = new URL(targetUrl).hostname
  const serverUrl = config.cyberstrike.serverUrl ?? "http://127.0.0.1:4096"
  const maxPages = config.maxSteps ?? 50
  const dryRun = config.dryRun ?? false
  const credentialId = config.cyberstrike.credentialId

  log.info(`starting browser agent v2${dryRun ? " (DRY-RUN)" : ""}`, {
    target: targetUrl,
    maxPages,
    server: dryRun ? undefined : serverUrl,
  })

  // Resolve AI model
  let model: LanguageModel | null = null
  try {
    model = await resolveModel()
    log.info("AI navigation enabled")
  } catch (err) {
    log.error("AI model required for v2 architecture", { err: String(err) })
    process.exit(1)
  }

  // Create CyberStrike session
  let sessionID = config.cyberstrike.sessionID
  if (!dryRun && !sessionID) {
    const created = await initSession(serverUrl, targetUrl, credentialId)
    if (!created) {
      log.error("failed to create session — is CyberStrike running?")
      process.exit(1)
    }
    sessionID = created
  }

  const browser = await chromium.launch({ headless: config.headless ?? false })
  const context: BrowserContext = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  })
  const page = await context.newPage()

  if (config.auth.sessionFile) {
    await loadSession(context, config.auth.sessionFile)
  }

  // Wire up capture pipeline
  const captureQueue: CapturedRequest[] = []
  const interceptor = setupRequestInterceptor(page, targetHost, (req) => captureQueue.push(req))

  const handleCapture: CaptureFn = dryRun
    ? createDryRunHandler()
    : createIngestHandler(serverUrl, sessionID!, credentialId)

  // Background drain every 500ms
  const drainInterval = setInterval(async () => {
    while (captureQueue.length > 0) {
      const captured = captureQueue.shift()!
      await handleCapture(captured)
    }
  }, 500)

  // Navigate to target and authenticate
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 })

  // Login flow: --authenticated → manual login, --user/--pass → auto-login, neither → anonymous
  const isAuthenticated = config.auth.authenticated || !!config.auth.credentials
  if (config.auth.authenticated) {
    await waitForManualLogin(page)
  } else if (config.auth.credentials) {
    await autoLogin(page, config.auth.credentials)
  } else {
    await handle2FA(page)
  }

  // Initialize global state (Aşama 13: outOfScope snapshotted from config)
  const globalState = createGlobalState({ outOfScope: config.outOfScope })
  if (config.outOfScope?.length) {
    log.info("out-of-scope labels", { count: config.outOfScope.length, labels: config.outOfScope })
  }

  // Manual or auto login → already authenticated, no re-discovery needed
  if (isAuthenticated) {
    globalState.authPhase = "authenticated"
  }
  // Seed URL always goes directly to queue (never deferred)
  globalState.visitedPages.add(normalizeUrl(page.url()))
  globalState.pageQueue.push(page.url())

  // Login detection via response event — fires immediately when response arrives,
  // before page navigation can cancel the interceptor's async handler
  page.on("response", (response) => {
    if (globalState.authPhase === "authenticated") return
    const req = response.request()
    const method = req.method()
    const status = response.status()
    try {
      const pathname = new URL(req.url()).pathname
      if (LOGIN_SUCCESS_PATTERN.test(`${method} ${pathname} [${status}]`)) {
        log.info("login success detected via HTTP response")
        triggerReDiscovery(globalState)
      }
    } catch {}
  })

  let pagesExplored = 0

  while (globalState.pageQueue.length > 0 && pagesExplored < maxPages) {
    const nextUrl = globalState.pageQueue.shift()!
    pagesExplored++

    if (page.url() !== nextUrl) {
      const navErr = await page
        .goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 15000 })
        .then(() => null)
        .catch((e: Error) => e)

      if (navErr) {
        log.warn("navigation failed", { url: nextUrl, err: navErr.message.split("\n")[0] })
        continue
      }

      // SPA stabilization: wait for component-level async rendering
      await page.waitForTimeout(POST_GOTO_WAIT)
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {})
    }

    if (!isOnHost(page.url(), targetHost)) {
      log.info("off-host redirect, skipping", { url: page.url() })
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {})
      continue
    }

    const currentUrl = normalizeUrl(page.url())
    globalState.visitedPages.add(currentUrl)
    log.info("exploring page", { page: `${pagesExplored}/${maxPages}`, url: currentUrl })
    log.debug("state", {
      phase: globalState.authPhase,
      queueSize: globalState.pageQueue.length,
      queue: globalState.pageQueue.slice(0, 5).map(u => { try { return new URL(u).pathname + new URL(u).hash } catch { return u } }),
      visited: globalState.visitedPages.size,
      deferred: globalState.deferredAuthPages.map(d => `${d.type}:${d.url.split('/').pop()}`),
      endpoints: globalState.capturedEndpoints.size,
      steps: globalState.totalSteps,
    })

    // Close any open overlays before starting exploration
    await page.keyboard.press("Escape").catch(() => {})
    await page.waitForTimeout(OVERLAY_ESCAPE_WAIT)
    if (await isViewportCenterBlocked(page)) {
      const dims = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
      await page.mouse.click(dims.w / 2, dims.h / 2).catch(() => {})
      await page.waitForTimeout(OVERLAY_ESCAPE_WAIT)
    }

    // Dismiss cookie banners — deterministic, no LLM needed
    await dismissCookieBanner(page)

    // Fingerprint comparison: skip unchanged pages on re-visit (no LLM calls)
    // Fingerprint only includes input roles (textbox/combobox/checkbox/radio/slider)
    // so navbar/toolbar button changes don't cause false positives
    const oldFingerprint = globalState.pageFingerprints.get(currentUrl)
    log.debug("fingerprint check", { url: currentUrl, hasOld: !!oldFingerprint })
    if (oldFingerprint !== undefined) {
      const currentElements = await scrollAndCollect(page)
      const newFingerprint = generateFingerprint(currentElements)
      log.debug("fingerprint compare", { url: currentUrl, match: newFingerprint === oldFingerprint, oldFp: oldFingerprint.slice(0, 80), newFp: newFingerprint.slice(0, 80) })
      if (newFingerprint === oldFingerprint) {
        log.info("page unchanged after auth, skipping exploration", { url: currentUrl })
        // Still collect DOM links — navbar may have new links after login
        const domLinks = await collectDOMLinks(page, currentUrl, targetHost)
        for (const url of domLinks) {
          enqueueUrl(url, globalState, targetHost)
        }
        globalState.pageFingerprints.set(currentUrl, newFingerprint)
        await page.waitForTimeout(300)
        continue
      }
      log.info("page changed after auth, re-exploring", { url: currentUrl })
    }

    // Explore the page with AI
    const discovered = await explorePageWithAI(
      page, currentUrl, interceptor, model, globalState, targetHost,
    )

    // Enqueue new same-host pages (auth URLs deferred during anonymous phase)
    let newEnqueued = 0
    for (const url of discovered) {
      if (enqueueUrl(url, globalState, targetHost)) newEnqueued++
    }
    if (discovered.length > 0) {
      log.debug("discovered links", { found: discovered.length, enqueued: newEnqueued, queueSize: globalState.pageQueue.length })
    }

    // Flush re-discovery AFTER new discoveries are enqueued — new pages come first, re-visits last
    flushReDiscovery(globalState)

    await page.waitForTimeout(300)

    // Phase transition: when queue is empty, process deferred auth pages
    if (globalState.pageQueue.length === 0 && globalState.deferredAuthPages.length > 0) {
      log.debug("queue empty, processing auth phase", { phase: globalState.authPhase, deferred: globalState.deferredAuthPages.map(d => d.type) })
      processAuthPhase(globalState, targetHost)
    }
  }

  // Final drain
  log.info("exploration complete, draining remaining requests")
  await page.waitForTimeout(2000)
  clearInterval(drainInterval)

  while (captureQueue.length > 0) {
    const captured = captureQueue.shift()!
    await handleCapture(captured)
  }

  log.info("done", {
    pagesExplored,
    totalSteps: globalState.totalSteps,
    capturedEndpoints: globalState.capturedEndpoints.size,
    sessionID: dryRun ? undefined : sessionID,
  })

  await browser.close()
}
