import z from "zod"
import { Tool } from "./tool"
import { Vulnerability } from "../session/vulnerability"
import { Session } from "../session"

const description = `Get full details for one or more reported vulnerabilities by ID.

Use this after web_get_vulnerabilities to inspect specific findings in full detail,
including PoC, steps to reproduce, business impact, and recommendation.

Maximum 10 IDs per call.`

export const WebGetVulnDetailTool = Tool.define("web_get_vuln_detail", {
  description,
  parameters: z.object({
    ids: z.array(z.string()).min(1).max(10).describe("Array of vulnerability IDs to retrieve (max 10)."),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const all = Vulnerability.get(sessionID)
    const idSet = new Set(params.ids)

    const found = all.filter((v) => v.id && idSet.has(v.id))
    const missing = params.ids.filter((id) => !found.some((v) => v.id === id))

    const result = {
      found: found.length,
      missing: missing.length > 0 ? missing : undefined,
      items: found,
    }

    return {
      title: `Vuln Detail (${found.length} found)`,
      output: JSON.stringify(result, null, 2),
      metadata: { vulnerabilities: found },
    }
  },
})
