import z from "zod"
import { Tool } from "../tool"
import { argVal, type Finding, type HookResult } from "./shared"

import { endpointDiscover, modelFingerprint, jsAnalysis } from "./recon"
import { promptInject, systemPromptExtract, outputHandling } from "./injection"
import { excessiveAgency, ssrfProbe, dataExfil, rateLimitTest } from "./abuse"

const PROGRAMS = {
  // ── Recon (3) ──────────────────────────────────────────────
  endpoint_discover: "Scan target for common LLM API endpoints (/api/chat, /v1/chat/completions, etc.)",
  model_fingerprint: "Probe LLM endpoint to identify the underlying model (GPT, Claude, Gemini, etc.)",
  js_analysis: "Analyze JavaScript bundles for LLM framework indicators",

  // ── Injection (3) ─────────────────────────────────────────
  prompt_inject: "Test direct prompt injection with 10 canary-based payloads (OWASP LLM01)",
  system_prompt_extract: "Attempt system prompt extraction via 10 techniques (OWASP LLM07)",
  output_handling: "Test XSS/SQLi/command injection via LLM output (OWASP LLM05)",

  // ── Abuse (4) ──────────────────────────────────────────────
  excessive_agency: "Test unauthorized tool/action access via LLM (OWASP LLM06)",
  ssrf_probe: "Test SSRF via LLM tools — cloud metadata, internal services (OWASP LLM06)",
  data_exfil: "Test sensitive information disclosure — credentials, PII, system info (OWASP LLM02)",
  rate_limit: "Test unbounded consumption / missing rate limiting (OWASP LLM10)",
} as const

type Program = keyof typeof PROGRAMS

const dispatch: Record<Program, (args: string, timeout: number) => Promise<HookResult>> = {
  endpoint_discover: endpointDiscover,
  model_fingerprint: modelFingerprint,
  js_analysis: jsAnalysis,
  prompt_inject: promptInject,
  system_prompt_extract: systemPromptExtract,
  output_handling: outputHandling,
  excessive_agency: excessiveAgency,
  ssrf_probe: ssrfProbe,
  data_exfil: dataExfil,
  rate_limit: rateLimitTest,
}

const CWE_MAP: Record<string, string> = {
  "LLM-RECON": "CWE-200",
  "LLM-INJ": "CWE-74",
  "LLM-LEAK": "CWE-200",
  "LLM-OUT-001": "CWE-79",
  "LLM-OUT-002": "CWE-89",
  "LLM-OUT-003": "CWE-78",
  "LLM-AGENCY": "CWE-284",
  "LLM-SSRF": "CWE-918",
  "LLM-DISC": "CWE-200",
  "LLM-DOS": "CWE-770",
}

function resolveCwe(checkId: string): string | undefined {
  for (const prefix of Object.keys(CWE_MAP).sort((a, b) => b.length - a.length)) {
    if (checkId.startsWith(prefix)) return CWE_MAP[prefix]
  }
  return undefined
}

export const LlmhookTool = Tool.define("llmhook", {
  description: `LLM security testing tool — automated OWASP LLM Top 10 vulnerability scanning. ${Object.keys(PROGRAMS).length} programs across recon, injection, and abuse categories. ONLY use when the user has explicitly requested LLM/AI security testing.`,
  parameters: z.object({
    program: z
      .string()
      .describe(
        `Program to run. Available:\n${Object.entries(PROGRAMS)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join("\n")}`,
      ),
    args: z.string().default("").describe("Arguments: --target <URL> (required for most programs)"),
    timeout_seconds: z.number().optional().default(30).describe("Per-request timeout in seconds (default: 30)"),
  }),
  async execute(params) {
    const program = params.program as Program
    const handler = dispatch[program]

    if (!handler) {
      const available = Object.entries(PROGRAMS)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n")
      return {
        title: `llmhook: ${params.program}`,
        output: `[-] Unknown program: ${params.program}\n\nAvailable programs:\n${available}`,
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const target = argVal(params.args, "--target") || params.args.trim()
    const result = await handler(target, params.timeout_seconds)

    for (const f of result.findings) {
      if (!f.cwe) f.cwe = resolveCwe(f.checkId)
    }

    return {
      title: `llmhook: ${program} (${result.findings.length} findings)`,
      output: result.output,
      metadata: { program, findings: result.findings },
    }
  },
})
