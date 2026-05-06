import z from "zod"
import { Tool } from "./tool"
import { Vulnerability } from "../session/vulnerability"
import { Session } from "../session"

const description = `Get vulnerabilities reported in this session.

Returns the last 30 vulnerabilities by default. Use this to:
- Check existing findings before reporting a new vulnerability (avoid duplicates)
- Review current session findings by severity or status

Always call this (or web_get_session_context) before calling report_vulnerability.`

export const WebGetVulnerabilitiesTool = Tool.define("web_get_vulnerabilities", {
  description,
  parameters: z.object({
    severity: z
      .enum(["critical", "high", "medium", "low", "info"])
      .optional()
      .describe("Filter by severity. Omit to return all severities."),
    status: z
      .enum(["open", "fixed", "ignored"])
      .optional()
      .describe("Filter by status. Omit to return all statuses."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(30)
      .describe("Maximum number of results to return (default: 30, max: 100)."),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    let vulns = Vulnerability.get(sessionID)

    if (params.severity) {
      vulns = vulns.filter((v) => v.severity === params.severity)
    }

    if (params.status) {
      vulns = vulns.filter((v) => v.status === params.status)
    }

    const limit = params.limit ?? 30
    const items = vulns.slice(-limit)

    const result = {
      total: vulns.length,
      returned: items.length,
      items: items.map((v) => ({
        id: v.id,
        severity: v.severity,
        title: v.title,
        endpoint: v.endpoint,
        attack_vector: v.attack_vector,
        status: v.status,
        cwe_id: v.cwe_id,
      })),
    }

    return {
      title: `Vulnerabilities (${items.length}/${vulns.length})`,
      output: JSON.stringify(result, null, 2),
      metadata: { vulnerabilities: items },
    }
  },
})
