// Deterministic page-state store (co-driving §3.3) — the get_page_state substrate.
//
// The extension posts what it observes on each page (clickables, forms, links); this
// store keeps the latest per (session, url), annotates every clickable with its semantic
// kind (classify.ts) and surfaces its action policy (guard.ts). The AI reads this instead
// of re-parsing the DOM, and /web/action enforces the same policy on the element it acts
// on. In-memory, server-lifetime (mirrors ui-observation.ts / role-queue.ts).
import { annotateClickables, type Clickable, type ElementKind } from "./classify"
import { actionPolicy } from "./guard"

export namespace PageState {
  export interface Form {
    action: string
    method: string
    fields: { name: string; type: string; required: boolean }[]
  }
  // The page's structural map — landmarks/frames/description give the AI orientation
  // ("what page am I on, where in the app") without re-reading the DOM.
  export interface Landmark {
    role: string // banner|navigation|main|complementary|contentinfo|search|form|dialog|region
    label: string
  }
  export interface Frame {
    src: string
    same_origin: boolean
    title: string
  }
  export interface Observation {
    url: string
    title: string
    clickables: Clickable[]
    forms: Form[]
    links: string[]
    driver?: "ai" | "human"
    // --- rich page context (extension 2.0; all optional) ---
    credential?: string // which identity observed this page — the access-control tag
    description?: string // short human description of the page (h1 / meta / main sample)
    location?: string[] // logical app-location trail: breadcrumb / active nav / path segments
    landmarks?: Landmark[] // ARIA landmark map of the page
    frames?: Frame[] // iframes present (same-origin ones are traversed into clickables)
    canvas?: number // count of <canvas> — UIs we can flag but not introspect
    dynamic?: boolean // page mutates after load (SPA / async content)
    observed_at?: number // epoch ms of this observation
  }

  // session → (url → latest observation)
  const bySession = new Map<string, Map<string, Observation>>()
  function pages(sessionID: string): Map<string, Observation> {
    let m = bySession.get(sessionID)
    if (!m) {
      m = new Map()
      bySession.set(sessionID, m)
    }
    return m
  }

  // Store the latest observation for its URL; annotate clickables in place. Returns the
  // kind-count summary (for logging / a quick "3 destructive, 45 nav" read).
  export function set(sessionID: string, obs: Observation): Record<ElementKind, number> {
    const counts = annotateClickables(obs.clickables)
    pages(sessionID).set(obs.url, obs)
    return counts
  }

  export interface ClickableWithPolicy extends Clickable {
    policy: "allow" | "confirm" | "deny"
  }
  export interface StatePayload {
    url: string
    title: string
    driver?: "ai" | "human"
    clickables: ClickableWithPolicy[]
    forms: Form[]
    links: string[]
    // rich page context — passed straight through from the observation
    credential?: string
    description?: string
    location?: string[]
    landmarks?: Landmark[]
    frames?: Frame[]
    canvas?: number
    dynamic?: boolean
    observed_at?: number
  }

  // get_page_state: the observation for a URL, each clickable carrying its action policy.
  // `view` filters to one semantic kind (e.g. only "nav"). null when the page is unknown.
  export function get(sessionID: string, url: string, view?: ElementKind): StatePayload | null {
    const obs = pages(sessionID).get(url)
    if (!obs) return null
    const chosen = view ? obs.clickables.filter((c) => c.kind === view) : obs.clickables
    return {
      url: obs.url,
      title: obs.title,
      driver: obs.driver,
      clickables: chosen.map((c) => ({ ...c, policy: actionPolicy(c.kind) })),
      forms: obs.forms,
      links: obs.links,
      credential: obs.credential,
      description: obs.description,
      location: obs.location,
      landmarks: obs.landmarks,
      frames: obs.frames,
      canvas: obs.canvas,
      dynamic: obs.dynamic,
      observed_at: obs.observed_at,
    }
  }

  // The full clickable for an id on a url — the single lookup both the guard check and the
  // crawl action-key derivation build on. null when the page or element is unknown.
  export function element(sessionID: string, url: string, elementId: string): Clickable | null {
    const obs = pages(sessionID).get(url)
    if (!obs) return null
    return obs.clickables.find((c) => c.id === elementId) ?? null
  }

  // One clickable's kind/policy/label — used by /web/action to enforce guard on the exact
  // element the AI is about to act on. null when the page or element is unknown.
  export function elementPolicy(
    sessionID: string,
    url: string,
    elementId: string,
  ): { kind?: ElementKind; policy: "allow" | "confirm" | "deny"; label: string } | null {
    const el = element(sessionID, url, elementId)
    if (!el) return null
    return { kind: el.kind, policy: actionPolicy(el.kind), label: el.label }
  }

  export function urls(sessionID: string): string[] {
    return [...pages(sessionID).keys()]
  }
  // The most-recently-observed page — "where the browser is right now" for co-driving,
  // so the AI can call get_page_state with no url and get the current view.
  export function current(sessionID: string): StatePayload | null {
    const m = bySession.get(sessionID)
    if (!m || m.size === 0) return null
    let best: Observation | undefined
    for (const o of m.values()) if (!best || (o.observed_at ?? 0) >= (best.observed_at ?? 0)) best = o
    if (!best) return null
    return get(sessionID, best.url)
  }
  export function clearSession(sessionID: string): void {
    bySession.delete(sessionID)
  }
  export function _reset(): void {
    bySession.clear()
  }
}
