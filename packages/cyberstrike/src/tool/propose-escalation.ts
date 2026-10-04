import z from "zod"
import { Tool } from "./tool"
import { EscalationFrontier } from "../inspection/escalation-frontier"

const DESCRIPTION = [
  "Propose an escalation/chaining HYPOTHESIS (escalation-hunter only). This is the relentless engine:",
  "you emit the creative idea; the CODE holds the frontier — it dedups closed paths, orders by expected",
  "impact, meters the budget, and hands you the NEXT item to work. You cannot re-attempt a closed path",
  "(it is rejected), and you keep proposing + working until it returns no next item or budget-spent.",
  "",
  "Flow: propose a hypothesis → work the `next` it returns (construct the attack, CONFIRM by http_replay,",
  "report_vulnerability if proven) → on a confirmed chain, propose follow-ups from what it revealed.",
  "Do NOT stop while a `next` keeps coming back. A hypothesis is only a finding once replay proves it.",
].join("\n")

export const ProposeEscalationTool = Tool.define("propose_escalation", {
  description: DESCRIPTION,
  parameters: z.object({
    from_finding_ids: z
      .array(z.string())
      .describe("The finding id(s) this chain builds on (from the seed brief / web_get_vulnerabilities). May be empty for a pure tech-stack/CVE hypothesis."),
    hypothesis: z
      .string()
      .describe("The concrete chain/escalation to attempt, e.g. 'the internal host leaked by F1 + the SSRF in F2 → reach the cloud metadata endpoint'."),
    target_impact: z
      .string()
      .describe("The escalated impact you expect to prove, e.g. 'account takeover', 'internal RCE', 'mass data exfiltration', 'authz-wide bypass'."),
  }),
  async execute(params, ctx) {
    const r = EscalationFrontier.propose(ctx.sessionID, {
      from: params.from_finding_ids,
      hypothesis: params.hypothesis,
      targetImpact: params.target_impact,
    })
    const lines = [
      r.message,
      `Frontier: ${r.used}/${r.budget} hypotheses used · ${r.pending} pending.`,
    ]
    if (r.next) {
      lines.push(
        "",
        "## Work this NEXT (highest expected impact):",
        `- hypothesis: ${r.next.hypothesis}`,
        `- target impact: ${r.next.targetImpact}`,
        r.next.from.length ? `- from findings: ${r.next.from.join(", ")}` : "- from findings: (none — tech/CVE-driven)",
      )
    } else if (r.status !== "budget-spent") {
      lines.push("", "No next item — the frontier is drained. Finalize any remaining confirmed chains and end.")
    }
    return { title: `propose_escalation → ${r.status}`, output: lines.join("\n"), metadata: {} }
  },
})
