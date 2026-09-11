// Canary registry + cross-response correlation (plan §06, closes B3).
//
// Every injection — from a smart tool, http_replay, or a captured form submit —
// registers a unique canary token. Every later response is scanned against ALL
// registered canaries. A token that was injected at request A and now appears in
// response B (B !== A) is a stored/second-order reflection — the single hardest
// coverage case in 1.x, which had no registry and no correlation at all.
//
// OO / package-ready: the registry depends on an injected CanaryStore (repository
// pattern). The in-memory store here backs tests and the pure core; a DB-backed
// store (next P0 slice) drops in without touching this logic.

import type { Signal } from "./types"

export type CanaryKind = "reflect" | "template" | "callback" | "file" | "log"

export interface Canary {
  // The literal string searched for in later response bodies. For a `template`
  // canary this is the EVALUATED marker (e.g. the "49" a `{{7*7}}` yields near a
  // unique tag), so a hit proves engine evaluation, not mere reflection.
  token: string
  kind: CanaryKind
  // The request the payload was injected at — a hit anywhere else is cross-page.
  originRequestId: string
  endpoint: string
  field: string
  agent: string
  vulnClass: string
  createdAt: number
}

// Repository seam. A hit-scan is O(canaries) per response, so a real store can
// index by session; the contract stays this small.
export interface CanaryStore {
  add(c: Canary): boolean // false if the token was already registered (dedup)
  all(): Canary[]
}

// Default in-memory store — deduped by token. Backs the pure core and tests.
export class MemoryCanaryStore implements CanaryStore {
  private readonly byToken = new Map<string, Canary>()
  add(c: Canary): boolean {
    if (this.byToken.has(c.token)) return false
    this.byToken.set(c.token, c)
    return true
  }
  all(): Canary[] {
    return [...this.byToken.values()]
  }
}

let counter = 0

export interface CanaryInput {
  originRequestId: string
  endpoint: string
  field: string
  agent: string
  vulnClass: string
  kind?: CanaryKind
  // Provide to register a specific marker (e.g. a template's evaluated value).
  // Omit to mint a fresh unique reflection token.
  token?: string
}

export class CanaryRegistry {
  constructor(private readonly store: CanaryStore = new MemoryCanaryStore()) {}

  // Mint a unique, low-collision reflection token: `cs` + time + counter + random,
  // all base36. Time+counter order it; the random tail makes an incidental substring
  // match — or a collision across processes/restarts — implausible.
  static mint(): string {
    counter = (counter + 1) % 0xffffff
    const rand = Math.random().toString(36).slice(2, 6)
    return `cs${Date.now().toString(36)}${counter.toString(36).padStart(4, "0")}${rand}`
  }

  /** Register an injection. Returns the stored canary (token minted if absent). */
  register(input: CanaryInput): Canary {
    const canary: Canary = {
      token: input.token ?? CanaryRegistry.mint(),
      kind: input.kind ?? "reflect",
      originRequestId: input.originRequestId,
      endpoint: input.endpoint,
      field: input.field,
      agent: input.agent,
      vulnClass: input.vulnClass,
      createdAt: Date.now(),
    }
    this.store.add(canary)
    return canary
  }

  /**
   * Scan a response body against every registered canary. Emits ONE
   * stored_reflection signal per canary whose token appears in a DIFFERENT
   * request than it was injected at. A hit in the SAME request is ordinary
   * (same-response) reflection — NOT stored — so it is deliberately excluded
   * here; the smart tool handles that via a marker on its own send.
   */
  scan(input: { requestId: string; body: string; url?: string }): Signal[] {
    if (!input.body) return []
    const out: Signal[] = []
    for (const c of this.store.all()) {
      if (!input.body.includes(c.token)) continue
      if (input.requestId === c.originRequestId) continue // same-site → not stored
      out.push({
        type: "stored_reflection",
        // Deterministic single owner (plan §06). The injection specialist confirms
        // the execution context; it hands DOM-only render sinks to client-side.
        owner: "input-validation",
        requestId: input.requestId,
        evidence: `canary ${c.token} injected at ${c.endpoint} (${c.field}) renders at ${input.url ?? input.requestId}`,
        meta: {
          token: c.token,
          kind: c.kind,
          injectSite: c.originRequestId,
          injectEndpoint: c.endpoint,
          injectField: c.field,
          renderSite: input.requestId,
          renderUrl: input.url,
          vulnClass: c.vulnClass,
        },
      })
    }
    return out
  }
}
