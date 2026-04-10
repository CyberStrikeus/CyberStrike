import { Log } from "../util/log"
import { Skill } from "./skill"
import { SkillIndex } from "./index-engine"

export namespace SkillContext {
  const log = Log.create({ service: "skill-context" })

  const loaded = new Map<string, { content: string; tokens: number }>()

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  export async function load(name: string): Promise<string | undefined> {
    if (loaded.has(name)) return loaded.get(name)!.content

    const skill = await Skill.get(name)
    if (!skill) {
      log.warn("skill not found for loading", { name })
      return undefined
    }

    const tokens = estimateTokens(skill.content)
    loaded.set(name, { content: skill.content, tokens })
    log.info("skill loaded into context", { name, tokens })
    return skill.content
  }

  export function unload(name: string): boolean {
    const had = loaded.has(name)
    if (had) {
      log.info("skill unloaded from context", { name, tokens: loaded.get(name)!.tokens })
      loaded.delete(name)
    }
    return had
  }

  export function active(): string[] {
    return Array.from(loaded.keys())
  }

  export function tokenCount(): number {
    let total = 0
    for (const entry of loaded.values()) total += entry.tokens
    return total
  }

  export function isLoaded(name: string): boolean {
    return loaded.has(name)
  }

  export function clear() {
    loaded.clear()
    log.info("context cleared")
  }

  export type Suggestion = {
    name: string
    reason: string
    priority: "high" | "medium" | "low"
  }

  export function suggest(
    findings: Array<{ skill_id: string; severity?: string; cwe_id?: string; tech_stack?: string[] }>,
  ): Suggestion[] {
    const result: Suggestion[] = []
    const suggested = new Set<string>()
    const active = new Set(loaded.keys())

    for (const finding of findings) {
      const chains = SkillIndex.chainsFrom(finding.skill_id)
      for (const chain of chains) {
        if (active.has(chain.target) || suggested.has(chain.target)) continue
        suggested.add(chain.target)
        result.push({
          name: chain.target,
          reason: chain.boost ?? `chains with ${finding.skill_id}`,
          priority: chain.boost ? "high" : "medium",
        })
      }

      if (finding.tech_stack?.length) {
        const techSkills = SkillIndex.byTechStack(finding.tech_stack)
        for (const skill of techSkills) {
          if (active.has(skill.name) || suggested.has(skill.name)) continue
          suggested.add(skill.name)
          result.push({
            name: skill.name,
            reason: `matches tech stack: ${finding.tech_stack.join(", ")}`,
            priority: "low",
          })
        }
      }
    }

    return result.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.priority] - order[b.priority]
    })
  }
}
