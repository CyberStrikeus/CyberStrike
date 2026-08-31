import z from "zod"
import { Tool } from "./tool"
import { Intel } from "../methodology/intel"
import { Session } from "../session"
import { CLOUD_GROUPS, groupByKey } from "../cloud/groups"

const CLOUD_INTEL_TYPES = new Set([
  "attack_path",
  "iam_principal",
  "lateral_movement",
  "cloud_misconfiguration",
  "cloud_exposure",
  "infrastructure",
  "credential",
  "configuration",
  "vulnerability_hint",
])

export const GetCloudIntelTool = Tool.define("get_cloud_intel", {
  description:
    "Query the shared cloud intelligence store. Use this to see what other cloud analysts have discovered, avoid duplicate work, and find cross-group correlations. Returns intel entries filtered by type, source agent, group, or keyword.",
  parameters: z.object({
    group: z
      .string()
      .optional()
      .describe(
        "Filter by cloud group key: identity, compute, network, data, security, access, specialized, compliance, exposure",
      ),
    type: z
      .string()
      .optional()
      .describe(
        "Filter by intel type: attack_path, iam_principal, lateral_movement, cloud_misconfiguration, cloud_exposure, infrastructure, credential, configuration, vulnerability_hint",
      ),
    source: z
      .string()
      .optional()
      .describe("Filter by source agent name (e.g. cloud-analyst-identity)"),
    keyword: z
      .string()
      .optional()
      .describe("Search keyword in title and detail fields"),
    include_all: z
      .boolean()
      .optional()
      .describe("Include non-cloud intel types too (web endpoints, subdomains, etc.)"),
  }),
  async execute(params, ctx) {
    const emptyMeta = { count: 0, bySeverity: {} as Record<string, number>, byType: {} as Record<string, number>, bySource: {} as Record<string, number> }

    if (params.type && !CLOUD_INTEL_TYPES.has(params.type)) {
      return {
        title: "Cloud Intel: query error",
        output: `Unknown intel type '${params.type}'. Valid types: ${[...CLOUD_INTEL_TYPES].join(", ")}`,
        metadata: emptyMeta,
      }
    }

    if (params.group && !groupByKey(params.group)) {
      const validKeys = CLOUD_GROUPS.map((g) => g.key).join(", ")
      return {
        title: "Cloud Intel: query error",
        output: `Unknown group key '${params.group}'. Valid keys: ${validKeys}`,
        metadata: emptyMeta,
      }
    }

    const rootSession = Session.root(ctx.sessionID)
    let entries = Intel.get(rootSession)

    if (!params.include_all) {
      entries = entries.filter((e) => CLOUD_INTEL_TYPES.has(e.type))
    }

    if (params.type) {
      entries = entries.filter((e) => e.type === params.type)
    }

    if (params.source) {
      entries = entries.filter((e) => e.source === params.source)
    }

    if (params.group) {
      const grp = groupByKey(params.group)!
      const tag = `group:${params.group}`
      entries = entries.filter((e) => e.source === grp.analyst || e.tags.includes(tag))
    }

    if (params.keyword) {
      const kw = params.keyword.toLowerCase()
      entries = entries.filter(
        (e) =>
          e.title.toLowerCase().includes(kw) ||
          (e.detail && e.detail.toLowerCase().includes(kw)),
      )
    }

    const bySeverity: Record<string, number> = {}
    const byType: Record<string, number> = {}
    const bySource: Record<string, number> = {}

    if (entries.length === 0) {
      return {
        title: "Cloud Intel: 0 entries",
        output: "No cloud intel entries found matching the query.",
        metadata: { count: 0, bySeverity, byType, bySource },
      }
    }

    const lines: string[] = []
    for (const e of entries) {
      const sev = e.severity ?? "info"
      bySeverity[sev] = (bySeverity[sev] || 0) + 1
      byType[e.type] = (byType[e.type] || 0) + 1
      if (e.source) bySource[e.source] = (bySource[e.source] || 0) + 1

      lines.push(`[${e.id}] ${sev.toUpperCase()} | ${e.type} | ${e.title}`)
      if (e.detail) lines.push(`    ${e.detail.slice(0, 200)}`)
      if (e.source) lines.push(`    source: ${e.source}`)
      if (e.tags.length > 0) lines.push(`    tags: ${e.tags.join(", ")}`)
      if (e.chainPotential) lines.push(`    chain: ${e.chainPotential}`)
      if (e.relatedEntries.length > 0) lines.push(`    related: ${e.relatedEntries.join(", ")}`)
      lines.push("")
    }

    const summary = [
      `Total: ${entries.length}`,
      `By severity: ${Object.entries(bySeverity).map(([k, v]) => `${k}:${v}`).join(", ")}`,
      `By type: ${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(", ")}`,
    ]

    return {
      title: `Cloud Intel: ${entries.length} entries`,
      output: `${summary.join("\n")}\n\n${lines.join("\n")}`,
      metadata: { count: entries.length, bySeverity, byType, bySource },
    }
  },
})

export const GetCloudGroupsTool = Tool.define("get_cloud_groups", {
  description:
    "List the 9 cloud analysis groups with their programs and assigned analysts. Use this to understand which analyst covers which Azure services.",
  parameters: z.object({}),
  async execute() {
    const lines: string[] = ["Cloud Analysis Groups:\n"]
    for (const g of CLOUD_GROUPS) {
      lines.push(`## ${g.label} (${g.key})`)
      lines.push(`Analyst: ${g.analyst}`)
      lines.push(`Programs: ${g.programs.join(", ")}`)
      lines.push(`${g.description}\n`)
    }
    return {
      title: "Cloud Groups: 9 groups",
      output: lines.join("\n"),
      metadata: { groupCount: CLOUD_GROUPS.length },
    }
  },
})
