import type { InspectionRouter, InspectionTarget, Evidence } from "@cyberstrike-io/plugin"
import { resolveProvider } from "@/cloud/provider-registry"
import type { SpecialistClass } from "@/session/web/signal/types"
import { TechPlaybook } from "@/session/web/signal/tech-playbook"

const INJECTABLE_PATH = /(?:query|search|filter|report|export|run|sql|graphql|lookup|find|template|command|exec|columns|connection)/i

function isInjectionSurface(target: InspectionTarget): boolean {
  const method = ((target.meta.method as string) ?? "GET").toUpperCase()
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") return true
  return INJECTABLE_PATH.test(target.label)
}

let classMapPromise: Promise<Record<string, string>> | undefined
function classMap(): Promise<Record<string, string>> {
  if (!classMapPromise)
    classMapPromise = resolveProvider("web").then((p) => p?.specialistClasses?.() ?? {})
  return classMapPromise
}

async function agentForClass(cls: SpecialistClass): Promise<string | undefined> {
  return (await classMap())[cls]
}

export class WebInspectionRouter implements InspectionRouter {
  async resolve(target: InspectionTarget, evidence: Evidence[]): Promise<string[]> {
    const agents = new Set<string>()
    for (const ev of evidence) {
      if (ev.type === "signal") {
        const owner = ev.value.includes(":") ? (ev.value.split(":")[1] as SpecialistClass) : undefined
        const a = owner ? await agentForClass(owner) : undefined
        if (a) agents.add(a)
      }
      if (ev.type === "credential" || ev.type === "role") {
        const authz = await agentForClass("authorization")
        if (authz) agents.add(authz)
        else { /* classMap should always resolve authorization now */ }
      }
      if (ev.type === "object_value") {
        const authz = await agentForClass("authorization")
        if (authz) agents.add(authz)
      }
    }
    if (isInjectionSurface(target)) {
      const iv = await agentForClass("input-validation")
      if (iv) agents.add(iv)
    }
    return [...agents]
  }

  prompt(target: InspectionTarget, evidence: Evidence[], agent: string): string {
    const ep = target.meta.method ? `${target.meta.method} ${target.label}` : target.label
    const lines = [`Inspect the endpoint \`${ep}\` using the newly-discovered context below.`, ""]
    const byType: Record<string, string[]> = {}
    for (const ev of evidence) {
      const list = byType[ev.type] ?? []
      list.push(ev.value)
      byType[ev.type] = list
    }
    if (byType.credential?.length) lines.push(`- Credentials now available: ${byType.credential.join(", ")}`)
    if (byType.role?.length) lines.push(`- Roles discovered: ${byType.role.join(", ")}`)
    if (byType.object_value?.length) lines.push(`- Object values to try: ${byType.object_value.join(", ")}`)
    if (byType.signal?.length) lines.push(`- Signals: ${byType.signal.join(", ")}`)

    const techSlugs = (byType.signal ?? [])
      .filter((v) => v.startsWith("technology:"))
      .map((v) => v.split(":")[2])
      .filter((t): t is string => !!t)
    const playbook = techSlugs.length ? TechPlaybook.render(techSlugs) : ""
    if (playbook) {
      lines.push("", "## Detected stack — run these stack-specific test cases:", playbook)
    }

    if ((agent.includes("input-validation") || agent.includes("injection")) && isInjectionSurface(target)) {
      lines.push(
        "",
        "## Injection surface — discover parameters before fuzzing:",
        "- The captured request body/query may have empty or minimal params. Do NOT stop there.",
        "- Enumerate the real parameter set: replay sibling requests, and pull the schema from any",
        "  filter-options / table-columns / connection / saved-view / query-template endpoints seen.",
        "- Then inject SQL / NoSQL / command / template payloads into EVERY discovered parameter AND",
        "  into identifier fields (query_template_id, view/column/table names, filter fragments).",
        "- Use http_replay error-canary + boolean/time-based differential to confirm, not just 200s.",
      )
    }
    lines.push(
      "",
      "Call web_get_session_context first for the full credential/observation context, then use http_replay (compare / sweep) to test. Record a coverage note or report a finding when done.",
    )
    return lines.join("\n")
  }
}
