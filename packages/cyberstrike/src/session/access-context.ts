import { Observation } from "./observation"
import { WebCredential } from "./web/web-credential"
export interface AccessContextInput {
  triggerElement?: string
  elementRoles?: string[]
  pageUrl?: string
  pageVisitedBy?: string[]
  uiContext?: Record<string, unknown>
}

// Renders the `## Access Context` block when hackbrowser enrichment is
// present. Returns an empty array for requests from sources without UI
// enrichment (e.g., Firefox extension manual browsing). Shared by the ingest
// prompt builder (below) and the subagent-dispatch prompt builder in task.ts,
// so the orchestrator and subagents see the same structured signals.
export function renderAccessContextLines(accessContext: AccessContextInput): string[] {
  const ac = accessContext
  const hasData = ac.triggerElement || ac.pageUrl || ac.uiContext || ac.pageVisitedBy?.length
  if (!hasData) return []
  const lines: string[] = ["", "## Access Context"]
  if (ac.pageUrl) {
    const visitedBy = ac.pageVisitedBy?.length ? ` (visited by: ${ac.pageVisitedBy.join(", ")})` : ""
    lines.push(`Page: ${ac.pageUrl}${visitedBy}`)
  } else if (ac.pageVisitedBy?.length) {
    lines.push(`Visited by: ${ac.pageVisitedBy.join(", ")}`)
  }
  if (ac.triggerElement) {
    const visibleTo = ac.elementRoles?.length ? ` (visible to: ${ac.elementRoles.join(", ")})` : ""
    lines.push(`Trigger: ${ac.triggerElement}${visibleTo}`)
  }
  if (ac.uiContext) {
    const ui = ac.uiContext as {
      formName?: string
      fields?: Array<{
        name: string
        type: string
        isReadOnly?: boolean
        isDisabled?: boolean
        isHidden?: boolean
        validation?: { required?: boolean }
      }>
      hiddenParams?: string[]
    }
    if (ui.formName) lines.push(`Form: ${ui.formName}`)
    if (ui.fields?.length) {
      const fieldsSummary = ui.fields
        .map((f) => {
          const flags: string[] = []
          if (f.validation?.required) flags.push("required")
          if (f.isReadOnly) flags.push("readonly")
          if (f.isDisabled) flags.push("disabled")
          if (f.isHidden) flags.push("hidden")
          return `${f.name}(${f.type}${flags.length ? "," + flags.join(",") : ""})`
        })
        .join(", ")
      lines.push(`Fields: ${fieldsSummary}`)
    }
    if (ui.hiddenParams?.length) {
      lines.push(`Hidden Params: ${ui.hiddenParams.join(", ")}`)
    }
  }
  return lines
}

// Derive visited_by from observed credential attribution (request_observation), merging
// with any capture-time label. This is the Firefox fix: Firefox traffic has no
// page_visited_by at capture time, but request_observation carries per-credential
// reachability for both paths. Merged, distinct, label-resolved.
export function getVisitedByForKeyHash(
  sessionID: string,
  keyHash: string,
  captureVisitedBy?: string[],
): string[] {
  const obs = Observation.listByKeyHash(sessionID, keyHash)
  const ids = [...new Set(obs.map((o) => o.credential_id).filter((id): id is string => !!id))]
  const labels = ids.map((id) => WebCredential.getById(id)?.label ?? id)
  const merged = new Set<string>([...(captureVisitedBy ?? []), ...labels])
  return [...merged]
}

export function resolveVisitedBy(input: {
  sessionID: string
  keyHash?: string
  captureVisitedBy?: string[]
}): string[] | undefined {
  if (!input.keyHash) return input.captureVisitedBy
  const derived = getVisitedByForKeyHash(input.sessionID, input.keyHash, input.captureVisitedBy)
  return derived.length ? derived : input.captureVisitedBy
}
