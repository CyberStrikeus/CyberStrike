// Guardrails — the deterministic, binding limits on the AI (design §6). The per-action guard
// (logout=deny, destructive=confirm) and scope filtering already live in WebAct + Rank (single
// source); this exposes the LOOP-LEVEL terminal conditions so the orchestrator stays out of the
// policy details. The AI is powerful but caged — even a planned logout is denied downstream.
import type { Observer, PageSnapshot, StopReason } from "./types"
import { WebDriver } from "../driver"
import { WebControl } from "../control"
import { Crawl } from "../crawl"
import { PageState } from "../page-state"

export class Guardrails {
  // A reason the whole crawl must stop right now, or null to continue.
  terminal(sessionID: string): StopReason | null {
    if (WebDriver.isHuman(sessionID)) return "human-took-over" // human at the wheel
    if (!WebControl.connected(sessionID)) return "no-extension-connected"
    if (Crawl.overBudget(sessionID)) return "budget-exhausted"
    return null
  }
}

export class PageStateObserver implements Observer {
  observe(sessionID: string): PageSnapshot | null {
    return PageState.current(sessionID)
  }
}
