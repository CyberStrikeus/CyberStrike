import z from "zod"
import { Tool } from "./tool"

export const ScopeCheckTool = Tool.define("scope_check", {
  description:
    "Validate that a target is in scope before testing. Supports exact domain match, wildcard domains (*.example.com), and CIDR ranges (10.0.0.0/24). Always check scope before actively testing a new target to avoid scope violations.",
  parameters: z.object({
    target: z.string().describe("The target to check (domain, IP, or URL)"),
    scope_items: z
      .array(z.string())
      .describe("List of in-scope items (domains, wildcards like *.example.com, CIDRs like 10.0.0.0/24)"),
  }),
  async execute(params) {
    const target = params.target.toLowerCase().trim()
    const results: Array<{ scope: string; matches: boolean; reason: string }> = []
    let inScope = false

    for (const scope of params.scope_items) {
      const s = scope.toLowerCase().trim()
      const match = checkMatch(target, s)
      results.push({ scope: s, ...match })
      if (match.matches) inScope = true
    }

    const output = [
      `Target: ${target}`,
      `In scope: ${inScope ? "YES" : "NO"}`,
      "",
      "Scope check details:",
      ...results.map((r) => `  ${r.matches ? "[MATCH]" : "[NO]"} ${r.scope} — ${r.reason}`),
    ]

    if (!inScope) {
      output.push("")
      output.push("WARNING: Target is NOT in scope. Do NOT perform active testing on this target.")
    }

    return {
      title: inScope ? `In scope: ${target}` : `OUT OF SCOPE: ${target}`,
      output: output.join("\n"),
      metadata: { target, inScope, results },
    }
  },
})

function checkMatch(target: string, scope: string): { matches: boolean; reason: string } {
  // Exact match
  if (target === scope) return { matches: true, reason: "exact match" }

  // Wildcard: *.example.com
  if (scope.startsWith("*.")) {
    const domain = scope.slice(2)
    if (target === domain) return { matches: true, reason: `matches root domain of wildcard ${scope}` }
    if (target.endsWith("." + domain)) return { matches: true, reason: `subdomain matches wildcard ${scope}` }
    return { matches: false, reason: `does not match wildcard ${scope}` }
  }

  // CIDR: 10.0.0.0/24
  if (/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(scope)) {
    const targetIP = extractIP(target)
    if (!targetIP) return { matches: false, reason: "target is not an IP address" }
    const inRange = ipInCIDR(targetIP, scope)
    return inRange
      ? { matches: true, reason: `IP ${targetIP} is within CIDR ${scope}` }
      : { matches: false, reason: `IP ${targetIP} is outside CIDR ${scope}` }
  }

  // URL prefix match: strip protocol
  const targetClean = target.replace(/^https?:\/\//, "").split("/")[0]
  const scopeClean = scope.replace(/^https?:\/\//, "").split("/")[0]
  if (targetClean === scopeClean) return { matches: true, reason: "domain match (ignoring protocol)" }

  // Partial domain match
  if (targetClean.endsWith("." + scopeClean)) return { matches: true, reason: `subdomain of ${scopeClean}` }

  return { matches: false, reason: "no match" }
}

function extractIP(input: string): string | null {
  const match = /(\d+\.\d+\.\d+\.\d+)/.exec(input)
  return match ? match[1] : null
}

function ipInCIDR(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split("/")
  const mask = ~((1 << (32 - Number(bits))) - 1) >>> 0
  const ipNum = ipToNum(ip)
  const rangeNum = ipToNum(range)
  return (ipNum & mask) === (rangeNum & mask)
}

function ipToNum(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
}
