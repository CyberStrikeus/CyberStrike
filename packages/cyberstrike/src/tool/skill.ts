import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { SkillIndex } from "../skill/index-engine"
import { SkillContext } from "../skill/context"
import { KillChain } from "../skill/killchain"
import { PermissionNext } from "../permission/next"
import { Ripgrep } from "../file/ripgrep"
import { iife } from "@/util/iife"

export const SkillTool = Tool.define("skill", async (ctx) => {
  const skills = await Skill.all()

  const agent = ctx?.agent
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        return rule.action !== "deny"
      })
    : skills

  const description =
    accessibleSkills.length === 0
      ? "Manage and load specialized skills. No skills are currently available."
      : [
          "Manage and load specialized security skills with context-efficient lazy loading.",
          "",
          "Actions:",
          "  load    - Load a skill into context (requires skill name)",
          "  unload  - Remove a skill from context to free tokens",
          "  search  - Search skills by keyword, tech stack, CWE, or category",
          "  chain   - Analyze current findings for kill chain opportunities",
          "  suggest - Get next-step skill suggestions based on findings",
          "  list    - Show all available skills or currently loaded skills",
          "",
          `${accessibleSkills.length} skills available. Use "search" or "list" action to discover them.`,
        ].join("\n")

  const parameters = z.object({
    action: z
      .enum(["load", "unload", "search", "chain", "suggest", "list"])
      .default("load")
      .describe("Action to perform"),
    name: z.string().optional().describe("Skill name (for load/unload)"),
    query: z.string().optional().describe("Search query (for search action)"),
    tech: z.array(z.string()).optional().describe("Tech stack filter (for search action)"),
    cwe: z.string().optional().describe("CWE ID filter (for search action)"),
    category: z.string().optional().describe("Category filter (for search action)"),
    loaded: z.boolean().optional().describe("For list action: only show currently loaded skills"),
    findings: z
      .array(
        z.object({
          skill_id: z.string(),
          severity: z.enum(["info", "low", "medium", "high", "critical"]).default("medium"),
          cwe_id: z.string().optional(),
          tech_stack: z.array(z.string()).optional(),
        }),
      )
      .optional()
      .describe("Current findings (for chain/suggest actions)"),
  })

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      await SkillIndex.rebuild()

      if (params.action === "list") {
        if (params.loaded) {
          const active = SkillContext.active()
          const tokens = SkillContext.tokenCount()
          if (active.length === 0)
            return {
              title: "No skills loaded",
              output: "No skills are currently loaded in context.",
              metadata: {} as { name?: string; dir?: string },
            }
          return {
            title: `${active.length} skills loaded (${tokens} tokens)`,
            output: [
              `## Skills in Context (${tokens} estimated tokens)`,
              "",
              ...active.map((name) => `- ${name}`),
            ].join("\n"),
            metadata: {} as { name?: string; dir?: string },
          }
        }
        const all = accessibleSkills
        return {
          title: `${all.length} skills available`,
          output: [
            `## Available Skills (${all.length})`,
            "",
            ...all.map(
              (s) =>
                `- **${s.name}** [${s.verified ?? "unverified"}] — ${s.description}` +
                (s.category ? ` (${s.category})` : "") +
                (s.tech_stack?.length ? ` [${s.tech_stack.join(", ")}]` : ""),
            ),
          ].join("\n"),
          metadata: {} as { name?: string; dir?: string },
        }
      }

      if (params.action === "unload") {
        if (!params.name) throw new Error("Skill name required for unload action")
        const removed = SkillContext.unload(params.name)
        return {
          title: removed ? `Unloaded: ${params.name}` : `Not loaded: ${params.name}`,
          output: removed
            ? `Skill "${params.name}" removed from context. Active tokens: ${SkillContext.tokenCount()}`
            : `Skill "${params.name}" was not in context.`,
          metadata: {} as { name?: string; dir?: string },
        }
      }

      if (params.action === "search") {
        const limit = 50
        let results: SkillIndex.Entry[] = []
        let totalCount = 0

        if (params.cwe) {
          results = SkillIndex.byCWE(params.cwe, limit)
          totalCount = SkillIndex.byCWE(params.cwe, Infinity).length
        } else if (params.tech?.length) {
          results = SkillIndex.byTechStack(params.tech, limit)
          totalCount = SkillIndex.byTechStack(params.tech, Infinity).length
        } else if (params.category) {
          results = SkillIndex.byCategory(params.category, limit)
          totalCount = SkillIndex.byCategory(params.category, Infinity).length
        } else if (params.query) {
          results = SkillIndex.search(params.query, limit)
          totalCount = results.length
        } else {
          results = SkillIndex.all().slice(0, limit)
          totalCount = SkillIndex.all().length
        }

        if (results.length === 0)
          return {
            title: "No results",
            output: "No skills matched the search criteria.",
            metadata: {} as { name?: string; dir?: string },
          }

        const truncated = totalCount > results.length
        const header = truncated
          ? `## Search Results (top ${results.length} of ${totalCount} — refine your query for more specific results)`
          : `## Search Results (${results.length})`

        return {
          title: truncated ? `${results.length}/${totalCount} skills found` : `${results.length} skills found`,
          output: [
            header,
            "",
            ...results.map(
              (r) =>
                `- **${r.name}** [${r.verified ?? "unverified"}] — ${r.description}${r.tech_stack.length ? ` (${r.tech_stack.join(", ")})` : ""}`,
            ),
          ].join("\n"),
          metadata: {} as { name?: string; dir?: string },
        }
      }

      if (params.action === "chain") {
        if (!params.findings?.length) throw new Error("Findings required for chain analysis")
        const summary = KillChain.summary(params.findings)
        return { title: "Kill Chain Analysis", output: summary, metadata: {} as { name?: string; dir?: string } }
      }

      if (params.action === "suggest") {
        if (!params.findings?.length) throw new Error("Findings required for suggestions")
        const suggestions = SkillContext.suggest(params.findings)
        if (suggestions.length === 0)
          return {
            title: "No suggestions",
            output: "No additional skills suggested for current findings.",
            metadata: {} as { name?: string; dir?: string },
          }
        return {
          title: `${suggestions.length} suggestions`,
          output: [
            "## Suggested Next Skills",
            "",
            ...suggestions.map((s) => `- **${s.name}** [${s.priority}] — ${s.reason}`),
          ].join("\n"),
          metadata: {} as { name?: string; dir?: string },
        }
      }

      // Default: load action
      if (!params.name) throw new Error("Skill name required for load action")

      const skill = await Skill.get(params.name)
      if (!skill) {
        const available = accessibleSkills.map((s) => s.name).join(", ")
        throw new Error(`Skill "${params.name}" not found. Available: ${available || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {} as { name?: string; dir?: string },
      })

      SkillContext.load(params.name)

      const dir = path.dirname(skill.location)
      const base = pathToFileURL(dir).href

      const limit = 10
      const files = await iife(async () => {
        const arr: string[] = []
        for await (const file of Ripgrep.files({
          cwd: dir,
          follow: false,
          hidden: true,
          signal: ctx.abort,
        })) {
          if (file.includes("SKILL.md")) continue
          arr.push(path.resolve(dir, file))
          if (arr.length >= limit) break
        }
        return arr
      }).then((f) => f.map((file) => `<file>${file}</file>`).join("\n"))

      const chains = SkillIndex.chainsFrom(params.name)
      const chainInfo =
        chains.length > 0
          ? [
              "",
              "<kill_chain_links>",
              ...chains.map((c) => `  <chain target="${c.target}"${c.boost ? ` boost="${c.boost}"` : ""} />`),
              "</kill_chain_links>",
            ].join("\n")
          : ""

      return {
        title: `Loaded skill: ${skill.name}`,
        output: [
          `<skill_content name="${skill.name}" verified="${skill.verified ?? "unverified"}">`,
          `# Skill: ${skill.name}`,
          "",
          skill.content.trim(),
          "",
          `Base directory for this skill: ${base}`,
          "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
          "Note: file list is sampled.",
          "",
          "<skill_files>",
          files,
          "</skill_files>",
          chainInfo,
          "</skill_content>",
        ].join("\n"),
        metadata: { name: skill.name, dir },
      }
    },
  }
})
