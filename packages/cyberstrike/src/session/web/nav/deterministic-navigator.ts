// DeterministicNavigator — the no-model / error / test fallback brain (design §3.3).
//
// Picks the single best next action on the current page by the deterministic ranking we already
// have (links + safe forms, scope- and visited-filtered, priority-biased). No LLM. Returns an
// empty plan when the page is exhausted so the orchestrator can backtrack via the frontier.
// This wraps Rank / WebFormFill / WebStrategy — it does not re-implement them.
import type { Navigator, Plan, PageSnapshot } from "./types"
import { Rank } from "../rank"
import { WebFormFill } from "../formfill"
import { WebStrategy } from "../strategy"

export class DeterministicNavigator implements Navigator {
  async plan(sessionID: string, snapshot: PageSnapshot): Promise<Plan> {
    const priorities = WebStrategy.get(sessionID)?.priorities ?? []
    const clicks = Rank.candidates(sessionID, snapshot, priorities)
    const forms = WebFormFill.candidates(sessionID, snapshot, priorities)

    const topClick = clicks[0]
    const topForm = forms[0]
    // Highest score wins across links and forms; a form ties-break to the form (higher value).
    if (topForm && (!topClick || topForm.score >= topClick.score)) {
      return { rationale: `deterministic: fill+submit "${topForm.label}"`, actions: [{ kind: "form", form: topForm }] }
    }
    if (topClick) {
      return { rationale: `deterministic: follow "${topClick.label}"`, actions: [{ kind: "click", elementId: topClick.id, label: topClick.label }] }
    }
    return { rationale: "page exhausted (no in-scope, unvisited link or safe form)", actions: [] }
  }
}
