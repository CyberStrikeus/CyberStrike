import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { PageState } from "../session/web/page-state"

const description = `Read the current browser page as a structured, AI-ready map — the co-driving "eyes".

The extension continuously observes the live DOM (including open shadow roots and same-origin
iframes) and pushes it here. You get, WITHOUT re-parsing HTML:
- every interactive element with a stable id, its visible label, semantic kind (nav / auth /
  logout / mutating / destructive / query), action policy (allow / confirm / deny), and WHY it
  is interactive (semantic tag, role, cursor:pointer, onclick, tabindex, contenteditable,
  or a framework listener) — so dynamically-clickable elements are not missed;
- aria state (expanded / haspopup / checked / selected / current / disabled), a stable testid,
  and where the element sits (nearest landmark/heading), whether it is in the viewport, and
  whether it lives in a shadow root or iframe;
- page orientation: a short description, the logical app-location trail (breadcrumb / active
  nav / path), the ARIA landmark map, iframes, canvas count, and whether the page is dynamic
  (SPA / still mutating);
- which identity (credential) observed the page — the access-control tag.

Pass no url to get the page the browser is on right now. Use view to focus on one kind (e.g.
view:"mutating" to see only state-changing actions). Feed element ids straight to web_action.`

const KINDS = ["destructive", "logout", "auth", "mutating", "query", "nav", "other"] as const

// Drop empty/absent fields so the AI reads a tight object, not a wall of nulls.
function tidy(c: PageState.ClickableWithPolicy) {
  const out: Record<string, unknown> = { id: c.id, label: c.label, kind: c.kind, policy: c.policy, role: c.role }
  if (c.why) out.why = c.why
  if (c.section) out.section = c.section
  if (c.testid) out.testid = c.testid
  if (c.href) out.href = c.href
  if (c.disabled) out.disabled = true
  if (c.in_viewport === false) out.offscreen = true
  if (c.shadow) out.shadow = true
  if (c.frame) out.frame = c.frame
  if (c.aria && Object.keys(c.aria).length > 0) out.aria = c.aria
  return out
}

export const WebGetPageStateTool = Tool.define("web_get_page_state", {
  description,
  parameters: z.object({
    url: z.string().optional().describe("Page URL to read. Omit for the page the browser is on now."),
    view: z
      .enum(KINDS)
      .optional()
      .describe("Filter interactive elements to one semantic kind (e.g. 'mutating', 'nav')."),
  }),
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, unknown> }> {
    const sessionID = Session.root(ctx.sessionID)
    const state = params.url
      ? PageState.get(sessionID, params.url, params.view as PageState.ClickableWithPolicy["kind"])
      : PageState.current(sessionID)

    if (!state) {
      const seen = PageState.urls(sessionID)
      const hint = seen.length
        ? `No observation for that url. Observed pages:\n${seen.map((u) => `  - ${u}`).join("\n")}`
        : "No page has been observed yet. Attach a browser (Start capture) and navigate so the extension can observe the DOM."
      return { title: "No page state", output: hint, metadata: {} }
    }

    // view filters at get() when a url is passed; apply it to current() too.
    const chosen =
      params.url || !params.view ? state.clickables : state.clickables.filter((c) => c.kind === params.view)

    const byKind: Record<string, number> = {}
    const byPolicy: Record<string, number> = {}
    for (const c of chosen) {
      byKind[c.kind ?? "other"] = (byKind[c.kind ?? "other"] ?? 0) + 1
      byPolicy[c.policy] = (byPolicy[c.policy] ?? 0) + 1
    }

    const payload: Record<string, unknown> = {
      url: state.url,
      title: state.title,
      driver: state.driver ?? "human",
      credential: state.credential ?? "anonymous",
    }
    if (state.description) payload.description = state.description
    if (state.location && state.location.length) payload.location = state.location
    if (state.dynamic) payload.dynamic = true
    if (state.landmarks && state.landmarks.length) payload.landmarks = state.landmarks
    if (state.frames && state.frames.length) payload.frames = state.frames
    if (state.canvas) payload.canvas = state.canvas
    payload.summary = { interactive: chosen.length, by_kind: byKind, by_policy: byPolicy }
    payload.clickables = chosen.map(tidy)
    if (state.forms && state.forms.length) payload.forms = state.forms
    if (state.links && state.links.length) payload.links = state.links.slice(0, 60)

    const drv = state.driver === "ai" ? "AI" : "human"
    return {
      title: `Page State: ${state.title || state.url} (${chosen.length} interactive, driven by ${drv})`,
      output: JSON.stringify(payload, null, 2),
      metadata: { url: state.url, interactive: chosen.length },
    }
  },
})
