// Shared gated executor for browser actions — the ONE place the click/type/navigate
// gate chain lives, used by BOTH the web_action tool (AI's hands, one call) and the
// co-driving loop (autonomous driver). Keeping it here means the guard/interlock/budget
// order can never drift between the two callers.
//
// Gate order (a blocked action must consume nothing downstream):
//   no-extension → human-driving interlock → (navigate | element lookup → guard → budget) → relay → record
import { PageState } from "./page-state"
import { WebControl } from "./control"
import { WebDriver } from "./driver"
import { Crawl } from "./crawl"
import { actionPolicy } from "./guard"
import type { ElementKind } from "./classify"

export namespace WebAct {
  export interface Input {
    op: "click" | "type" | "navigate"
    url?: string
    elementId?: string
    text?: string
  }
  export type Status =
    | "ok"
    | "no-extension"
    | "human-driving"
    | "bad-input"
    | "no-page"
    | "unknown-element"
    | "denied"
    | "confirm"
    | "budget"
    | "relay-failed"
  export interface Result {
    ok: boolean
    status: Status
    message: string
    kind?: ElementKind
    label?: string
    policy?: "allow" | "confirm" | "deny"
    repeat?: boolean
    error?: string
    url?: string
  }

  function relayMessage(error?: string): string {
    if (error === "no-extension") return "no browser attached"
    if (error === "timeout") return "timed out waiting for the browser"
    if (error === "element not found")
      return "the browser could not find that element (the page may have changed — re-read the page state)"
    return error || "relay failed"
  }

  // Perform a fully-gated browser action. Never throws — every failure is a Result.
  export async function perform(sessionID: string, input: Input): Promise<Result> {
    if (!WebControl.connected(sessionID))
      return { ok: false, status: "no-extension", message: "No extension is connected on this session.", error: "no-extension" }

    // Interlock: only an EXPLICIT human driver blocks (unset/ai pass through).
    if (WebDriver.isHuman(sessionID))
      return { ok: false, status: "human-driving", message: "The browser panel is in Human-driver mode — the AI must not act." }

    if (input.op === "navigate") {
      if (!input.url) return { ok: false, status: "bad-input", message: "navigate needs a url." }
      if (Crawl.overBudget(sessionID)) return budget(sessionID)
      const ack = await WebControl.send(sessionID, { op: "navigate", url: input.url })
      if (!ack.ok) return { ok: false, status: "relay-failed", message: relayMessage(ack.error), error: ack.error }
      Crawl.record(sessionID, Crawl.navKey(input.url))
      Crawl.markPage(sessionID, input.url)
      return { ok: true, status: "ok", message: `navigate → ${input.url}`, url: input.url }
    }

    if (!input.elementId) return { ok: false, status: "bad-input", message: `${input.op} needs an element_id.` }
    const url = input.url ?? PageState.current(sessionID)?.url
    if (!url) return { ok: false, status: "no-page", message: "No current page and no url given." }

    const el = PageState.element(sessionID, url, input.elementId)
    if (!el)
      return {
        ok: false,
        status: "unknown-element",
        message: `No element "${input.elementId}" in page-state for ${url} — the page may have changed.`,
        error: "unknown-element",
      }

    // Guard first — a blocked action never happened, so it must NOT consume budget.
    const policy = actionPolicy(el.kind)
    if (policy === "deny")
      return { ok: false, status: "denied", policy, kind: el.kind, label: el.label, message: `guard denied ${el.kind} "${el.label}"` }
    if (policy === "confirm")
      return { ok: false, status: "confirm", policy, kind: el.kind, label: el.label, message: `${el.kind} "${el.label}" needs human confirmation` }

    if (Crawl.overBudget(sessionID)) return budget(sessionID)

    const key = Crawl.actionKey(url, el)
    const repeat = Crawl.isActed(sessionID, key)
    const cmd =
      input.op === "type"
        ? { op: "type", elementId: input.elementId, text: input.text ?? "" }
        : { op: "click", elementId: input.elementId }
    // Human-like typing runs a keystroke-per-char sequence in the extension, which can take
    // well over the default 5s for long values — give type a generous ceiling so a completed
    // fill is never mis-reported as a timeout.
    const ack = await WebControl.send(sessionID, cmd, input.op === "type" ? 30000 : 5000)
    if (!ack.ok) return { ok: false, status: "relay-failed", message: relayMessage(ack.error), error: ack.error, label: el.label }
    Crawl.record(sessionID, key)
    const label = el.label || input.elementId
    return {
      ok: true,
      status: "ok",
      policy: "allow",
      label: el.label,
      repeat,
      message: `${input.op === "type" ? "type into" : "click"} ${label}${repeat ? " (repeat)" : ""}`,
      url,
    }
  }

  function budget(sessionID: string): Result {
    const s = Crawl.summary(sessionID)
    return { ok: false, status: "budget", message: `Action budget reached (${s.actions}/${s.budget}).`, error: "budget-exhausted" }
  }
}
