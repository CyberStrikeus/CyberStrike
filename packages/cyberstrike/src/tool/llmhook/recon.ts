import { httpGet, chatPost, classifyError, type Finding, type HandlerCtx, type HookResult } from "./shared"

const LLM_ENDPOINTS = [
  "/api/chat",
  "/api/ai",
  "/api/llm",
  "/api/assistant",
  "/api/copilot",
  "/chat",
  "/ai",
  "/v1/chat/completions",
  "/api/v1/messages",
  "/api/generate",
  "/api/complete",
  "/api/ask",
  "/api/query",
  "/api/converse",
  "/v1/completions",
  "/api/v1/chat",
  "/api/prompt",
]

const LLM_INDICATORS = [
  "openai",
  "anthropic",
  "claude",
  "gpt",
  "llm",
  "chatgpt",
  "gemini",
  "bedrock",
  "langchain",
  "llamaindex",
  "huggingface",
  "transformer",
  "embedding",
  "vector",
  "rag",
  "completion",
]

const MODEL_IDENTITY_PROBES = [
  "What AI model are you?",
  "What is your model name and version?",
  "Are you GPT, Claude, Gemini, or something else?",
  "Respond with only your model identifier.",
]

export async function endpointDiscover(ctx: HandlerCtx): Promise<HookResult> {
  const target = ctx.target
  if (!target)
    return {
      output: "[-] No target URL provided. Usage: llmhook endpoint_discover --target https://example.com",
      findings: [],
    }

  const output: string[] = ["[*] LLM Endpoint Discovery", `[*] Target: ${target}`, ""]
  const findings: Finding[] = []
  const found: string[] = []

  for (const ep of LLM_ENDPOINTS) {
    const url = target.replace(/\/+$/, "") + ep
    try {
      const resp = await httpGet(url, ctx.headers, 5000)
      if (resp.status !== 404 && resp.status !== 0) {
        found.push(ep)
        output.push(`[+] FOUND ${ep} → HTTP ${resp.status}`)
        const contentType = resp.headers.get("content-type") || ""
        if (contentType.includes("json") || resp.body.includes('"message"') || resp.body.includes('"response"')) {
          output.push(`    Content-Type: ${contentType}`)
          output.push(`    Body preview: ${resp.body.slice(0, 200)}`)
        }
      }
    } catch (e) {
      output.push(`[-] ${ep} — ${classifyError(e)}`)
    }
  }

  if (found.length === 0) {
    output.push("[-] No LLM endpoints found via common paths")
  } else {
    findings.push({
      checkId: "LLM-RECON-001",
      provider: "llmhook",
      severity: "informational",
      status: "PASS",
      resource: target,
      title: "LLM endpoints discovered",
      details: `Found ${found.length} potential LLM endpoint(s): ${found.join(", ")}`,
      remediation: "Ensure LLM endpoints require authentication and rate limiting",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function modelFingerprint(ctx: HandlerCtx): Promise<HookResult> {
  const target = ctx.target
  if (!target)
    return {
      output: "[-] No target URL provided. Usage: llmhook model_fingerprint --target https://example.com/api/chat",
      findings: [],
    }

  const output: string[] = ["[*] LLM Model Fingerprinting", `[*] Target: ${target}`, `[*] Format: ${ctx.format}`, ""]
  const findings: Finding[] = []

  for (const probe of MODEL_IDENTITY_PROBES) {
    try {
      const resp = await chatPost(target, probe, ctx.format, ctx.headers, ctx.timeout * 1000)
      if (resp.status === 200 && resp.text.length > 0) {
        const body = resp.text.slice(0, 500)
        output.push(`[*] Probe: "${probe}"`)
        output.push(`    Response: ${body}`)
        output.push("")

        const lower = body.toLowerCase()
        const detected = LLM_INDICATORS.filter((i) => lower.includes(i))
        if (detected.length > 0) {
          findings.push({
            checkId: "LLM-RECON-002",
            provider: "llmhook",
            severity: "low",
            status: "FAIL",
            resource: target,
            title: "Model identity disclosed",
            details: `Model identity probe "${probe}" revealed indicators: ${detected.join(", ")}. Response: ${body.slice(0, 200)}`,
            remediation:
              "Strip model identity information from responses. Do not disclose model name/version to end users.",
          })
          break
        }
      } else if (resp.status === 401 || resp.status === 403) {
        output.push(`[!] AUTH REQUIRED — HTTP ${resp.status}. Use --auth <token> to provide credentials.`)
        break
      }
    } catch (e) {
      output.push(`[-] Probe failed: "${probe}" — ${classifyError(e)}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function jsAnalysis(ctx: HandlerCtx): Promise<HookResult> {
  const target = ctx.target
  if (!target) return { output: "[-] No target URL provided", findings: [] }

  const output: string[] = ["[*] JavaScript LLM Indicator Analysis", `[*] Target: ${target}`, ""]
  const findings: Finding[] = []

  const jsPaths = ["/main.js", "/app.js", "/bundle.js", "/static/js/main.js", "/assets/index.js"]

  for (const jp of jsPaths) {
    const url = target.replace(/\/+$/, "") + jp
    try {
      const resp = await httpGet(url, ctx.headers, 5000)
      if (resp.status === 200 && resp.body.length > 100) {
        const lower = resp.body.toLowerCase()
        const found = LLM_INDICATORS.filter((i) => lower.includes(i))
        if (found.length > 0) {
          output.push(`[+] ${jp} → LLM indicators: ${found.join(", ")}`)
          findings.push({
            checkId: "LLM-RECON-003",
            provider: "llmhook",
            severity: "informational",
            status: "PASS",
            resource: url,
            title: "LLM indicators found in JavaScript bundle",
            details: `JS bundle ${jp} contains LLM-related strings: ${found.join(", ")}`,
            remediation: "Remove model/provider references from client-side bundles if not intended to be public",
          })
        }
      }
    } catch {
      // skip
    }
  }

  if (findings.length === 0) output.push("[-] No LLM indicators found in common JS paths")

  return { output: output.join("\n"), findings }
}
