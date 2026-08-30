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
  sensitiveFiles,
  corsCheck,
  methodCheck,
  openRedirect,
} from "./programs"
import { sessionScan } from "./session-scan"

const PROGRAMS = {
  session_scan: {
    description:
      "Run vulnerability tests on ALL endpoints collected by hackbrowser in the current session. Automatically performs header_audit + sensitive_files per origin, cors_check + method_check per API endpoint, and open_redirect on pages with redirect parameters. Use AFTER hackbrowser completes — does not require a target URL",
  },
  full_recon: {
    description:
      "Run all reconnaissance programs against a single target URL and return aggregated results — useful for quick standalone checks without hackbrowser",
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
  sensitive_files: {
    description:
      "Probe for 22 sensitive files: .env, .git/HEAD, .git/config, .DS_Store, phpinfo, server-status, actuator/env, wp-config.bak, elmah.axd, trace.axd, backup.sql, web.config, crossdomain.xml. Content-validated to avoid false positives from custom 404 pages",
  },
  cors_check: {
    description:
      "Test CORS for origin reflection (evil.com), null origin bypass, wildcard with credentials. Detects cross-origin data theft vulnerabilities",
  },
  method_check: {
    description:
      "Test TRACE (XST), PUT, DELETE methods on target. Check OPTIONS Allow header for dangerous method advertisement",
  },
  open_redirect: {
    description:
      "Test 17 common redirect parameters (?url=, ?next=, ?redirect=, ?returnUrl=, etc.) for open redirect via 3xx Location, meta refresh, and JavaScript redirect",
  },
} as const satisfies Record<string, { description: string }>

type Program = keyof typeof PROGRAMS

const dispatch: Record<
  Exclude<Program, "session_scan">,
  (target: string, args: string[], timeout: number) => Promise<WebReconResult>
> = {
  full_recon: fullRecon,
  sitemap_scan: sitemapScan,
  robots_scan: robotsScan,
  openapi_scan: openapiScan,
  graphql_probe: graphqlProbe,
  tech_detect: techDetect,
  header_audit: headerAudit,
  sensitive_files: sensitiveFiles,
  cors_check: corsCheck,
  method_check: methodCheck,
  open_redirect: openRedirect,
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
  "WEB-FILE": "CWE-538",
  "WEB-CORS": "CWE-942",
  "WEB-METHOD": "CWE-749",
  "WEB-REDIR": "CWE-601",
}

function resolveCwe(checkId: string): string | undefined {
  for (const prefix of Object.keys(CWE_MAP).sort((a, b) => b.length - a.length)) {
    if (checkId.startsWith(prefix)) return CWE_MAP[prefix]
  }
  return undefined
}

function formatOutput(program: string, result: WebReconResult): { output: string; enriched: Finding[] } {
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

  return { output, enriched }
}

export const WebReconTool = Tool.define("web_recon", {
  description: `Web reconnaissance and vulnerability testing. Two modes: (1) session_scan — run AFTER hackbrowser to test ALL collected endpoints for vulnerabilities (headers, sensitive files, CORS, methods, open redirect). No target needed. (2) Individual programs — run against a specific target URL for standalone checks. Programs: ${Object.entries(PROGRAMS).map(([k, v]) => `${k} (${v.description})`).join("; ")}`,
  parameters: z.object({
    program: z
      .enum(Object.keys(PROGRAMS) as [Program, ...Program[]])
      .describe(
        "Program to run. Use session_scan after hackbrowser to test all collected endpoints. Use individual programs for targeted checks against a specific URL.",
      ),
    target: z
      .string()
      .url()
      .optional()
      .describe("Target URL (required for all programs except session_scan). All programs resolve paths relative to this origin."),
    args: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Additional arguments (reserved for future per-program options)."),
    timeout_seconds: z
      .number()
      .optional()
      .default(30)
      .describe("Maximum time per HTTP request in seconds (default: 30)."),
  }),
  async execute(params, ctx) {
    const program = params.program as Program

    if (program === "session_scan") {
      let result: WebReconResult
      try {
        result = await sessionScan(ctx.sessionID, params.timeout_seconds)
      } catch (e) {
        return {
          title: "web_recon: session_scan",
          output: `[-] session_scan failed: ${e instanceof Error ? e.message : String(e)}`,
          metadata: { program, findings: [] as Finding[] },
        }
      }
      const { output, enriched } = formatOutput(program, result)
      return { title: "web_recon: session_scan", output, metadata: { program, findings: enriched } }
    }

    if (!params.target) {
      return {
        title: `web_recon: ${program}`,
        output: `[-] target URL is required for ${program}. Only session_scan runs without a target.`,
        metadata: { program, findings: [] as Finding[] },
      }
    }

    const handler = dispatch[program as Exclude<Program, "session_scan">]
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

    const { output, enriched } = formatOutput(program, result)
    return { title: `web_recon: ${program}`, output, metadata: { program, findings: enriched } }
  },
})
