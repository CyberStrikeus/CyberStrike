import z from "zod"
import { Tool } from "../tool"
import type { Finding, WebReconResult } from "./shared"
import {
  fullRecon,
  sitemapScan,
  robotsScan,
  openapiScan,
  graphqlProbe,
  techDetect,
  headerAudit,
} from "./programs"

const PROGRAMS = {
  full_recon: {
    description:
      "Run all reconnaissance programs (tech detect, headers, sitemap, robots, OpenAPI, GraphQL) and return aggregated results — the starting tool for any web target",
  },
  sitemap_scan: {
    description:
      "Fetch sitemap.xml and sitemapindex, extract all declared page URLs. Follows child sitemaps up to 20 deep",
  },
  robots_scan: {
    description:
      "Parse robots.txt for Disallow/Allow paths and Sitemap references. Disallowed paths often reveal admin/API/sensitive areas",
  },
  openapi_scan: {
    description:
      "Probe 8 common OpenAPI/Swagger spec paths, parse discovered specs for all API endpoints with methods and auth schemes",
  },
  graphql_probe: {
    description:
      "Probe common GraphQL endpoints (/graphql, /api/graphql, /query, /v1/graphql, /gql) with {__typename}, test introspection",
  },
  tech_detect: {
    description:
      "Fingerprint technology stack from HTTP headers (Server, X-Powered-By), cookies (PHPSESSID, JSESSIONID), HTML patterns, and CDN/WAF indicators",
  },
  header_audit: {
    description:
      "Audit security headers: HSTS, CSP (with weakness analysis), X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy. Returns score and findings",
  },
} as const satisfies Record<string, { description: string }>

type Program = keyof typeof PROGRAMS

const dispatch: Record<Program, (target: string, args: string[], timeout: number) => Promise<WebReconResult>> = {
  full_recon: fullRecon,
  sitemap_scan: sitemapScan,
  robots_scan: robotsScan,
  openapi_scan: openapiScan,
  graphql_probe: graphqlProbe,
  tech_detect: techDetect,
  header_audit: headerAudit,
}

const CWE_MAP: Record<string, string> = {
  "WEB-OPENAPI": "CWE-200",
  "WEB-SITEMAP": "CWE-200",
  "WEB-ROBOTS": "CWE-200",
  "WEB-GRAPHQL": "CWE-200",
  "WEB-TECH": "CWE-200",
  "WEB-HDR-HSTS": "CWE-523",
  "WEB-HDR-CSP": "CWE-1021",
  "WEB-HDR-XCTO": "CWE-16",
  "WEB-HDR-XFO": "CWE-1021",
  "WEB-HDR-RP": "CWE-200",
  "WEB-HDR-PP": "CWE-16",
}

function resolveCwe(checkId: string): string | undefined {
  for (const prefix of Object.keys(CWE_MAP).sort((a, b) => b.length - a.length)) {
    if (checkId.startsWith(prefix)) return CWE_MAP[prefix]
  }
  return undefined
}

export const WebReconTool = Tool.define("web_recon", {
  description: `HTTP-based web reconnaissance — run deterministic checks against a target URL without a browser. Use BEFORE hackbrowser to understand the target's technology stack, exposed APIs, and security posture. Each program makes only safe read-only HTTP requests (no crawling, no form submission, no authentication). Available programs: ${Object.entries(PROGRAMS).map(([k, v]) => `${k} (${v.description})`).join("; ")}`,
  parameters: z.object({
    program: z
      .enum(Object.keys(PROGRAMS) as [Program, ...Program[]])
      .describe("Reconnaissance program to run. Use full_recon for comprehensive scan, or individual programs for targeted checks."),
    target: z
      .string()
      .url()
      .describe("Target URL to scan (e.g. https://target.com). All programs resolve paths relative to this origin."),
    args: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Additional arguments (reserved for future per-program options)."),
    timeout_seconds: z
      .number()
      .optional()
      .default(30)
      .describe("Maximum time per HTTP request in seconds (default: 30). Full recon may take up to 6x this."),
  }),
  async execute(params) {
    const program = params.program as Program
    const handler = dispatch[program]
    let result: WebReconResult
    try {
      result = await handler(params.target, params.args, params.timeout_seconds)
    } catch (e) {
      return {
        title: `web_recon: ${program}`,
        output: `[-] ${program} failed: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program, findings: [] as Finding[] },
      }
    }

    const enriched = result.findings.map((f) => ({
      ...f,
      severity: f.severity.toLowerCase(),
      cwe: f.cwe || resolveCwe(f.checkId),
    }))

    const output =
      enriched.length > 0
        ? result.output +
          "\n\n=== FINDINGS (" +
          enriched.length +
          ") ===\n" +
          enriched
            .map(
              (f, i) =>
                `[${i + 1}] ${f.severity} — ${f.title}${f.cwe ? ` (${f.cwe})` : ""}\n    Check: ${f.checkId} | Status: ${f.status} | Resource: ${f.resource}\n    ${f.details}\n    Remediation: ${f.remediation}`,
            )
            .join("\n") +
          "\n\nCall report_vulnerability for each finding: severity (lowercase), title, description=details, recommendation=remediation" +
          (enriched.some((f) => f.cwe) ? ", cwe_id from parentheses above" : "") +
          "."
        : result.output

    return {
      title: `web_recon: ${program}`,
      output,
      metadata: { program, findings: enriched },
    }
  },
})
