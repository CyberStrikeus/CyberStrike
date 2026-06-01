import z from "zod"
import { Tool } from "./tool"
import path from "path"

const SCRIPTS_DIR = path.resolve(import.meta.dir, "../../data/scripts")

const AVAILABLE_SCRIPTS: Record<string, { description: string; args: string }> = {
  jwt_tamper: {
    description: "JWT token decode/modify/re-encode for auth bypass testing (alg=none, role escalation, user ID swap)",
    args: "TOKEN [--decode-only] [--set key=value] [--set-header key=value] [--key SECRET] [--json-output]",
  },
  race_tester: {
    description: "Race condition tester — concurrent requests to detect TOCTOU vulnerabilities",
    args: "URL [-m METHOD] [-H key:value] [-d JSON_BODY] [-c COUNT] [--delay MS] [--json-output]",
  },
  ssti_tester: {
    description: "Server-Side Template Injection detection and engine fingerprinting (Jinja2, FreeMarker, Velocity, Twig, ERB, Pebble)",
    args: "URL [--param NAME] [--method GET|POST] [--data JSON] [-H key:value] [--quick] [--json-output]",
  },
  ssrf_listener: {
    description: "SSRF callback listener — lightweight HTTP server that logs all incoming requests as evidence",
    args: "[-p PORT] [-o OUTPUT_FILE] [--timeout SECONDS]",
  },
  idor_tester: {
    description: "IDOR cross-account access tester with two sets of credentials",
    args: "--token-a TOKEN --token-b TOKEN --endpoints FILE_OR_CSV [--method METHOD] [--data JSON] [--json-output]",
  },
  cors_checker: {
    description: "CORS misconfiguration checker — tests origin reflection, wildcard, null origin, bypass patterns",
    args: "URL [--json-output]",
  },
  graphql_tester: {
    description: "GraphQL vulnerability tester — introspection, complexity DoS, batch abuse, alias DoS",
    args: "URL [-H key:value] [--depth N] [--batch-count N] [--json-output]",
  },
  file_upload_tester: {
    description: "File upload vulnerability tester — extension bypass, MIME bypass, polyglot files, SVG XSS/SSRF",
    args: "URL [--field NAME] [-H key:value] [--data JSON] [--json-output]",
  },
  oauth_tester: {
    description: "OAuth 2.0 vulnerability tester — redirect_uri bypass, state manipulation, scope escalation",
    args: "AUTH_URL --client-id ID --redirect-uri URI [--json-output]",
  },
  rate_limit_bypass: {
    description: "Rate limit bypass tester — XFF rotation, case variation, method switching, query params, header variations",
    args: "URL [--method METHOD] [-H key:value] [-d JSON] [--count N] [--json-output]",
  },
  waf_bypass: {
    description: "WAF bypass encoder — generates encoding variants (URL, unicode, HTML entity, hex, mixed case) with optional live testing",
    args: "PAYLOAD [--test-url URL] [--param NAME] [--json-output]",
  },
  cloud_storage_enum: {
    description: "Cloud storage enumeration — S3/Azure/GCP bucket discovery with permission checks",
    args: "TARGET [--names BUCKET_NAME...] [--json-output]",
  },
  subdomain_takeover: {
    description: "Subdomain takeover checker — CNAME detection + cloud service fingerprint matching (20 services)",
    args: "FILE_OR_DOMAIN [--json-output]",
  },
  github_dorker: {
    description: "GitHub intelligence dorker — search for leaked secrets using gh CLI (30+ patterns)",
    args: "ORG [--repo ORG/REPO] [--patterns PATTERN...] [--commits] [--json-output]",
  },
  wayback_endpoints: {
    description: "Wayback Machine endpoint discovery — find historical/hidden endpoints via CDX API",
    args: "DOMAIN [--probe] [--limit N] [--json-output]",
  },
  response_diff: {
    description: "HTTP response diff — compare two responses with different headers to detect access control differences",
    args: "URL [--header-a key:value] [--header-b key:value] [--method METHOD] [--data JSON] [--json-output]",
  },
}

export const AttackScriptTool = Tool.define("attack_script", {
  description: `Execute a bundled attack script for automated vulnerability testing. Available scripts: ${Object.keys(AVAILABLE_SCRIPTS).join(", ")}. Each script outputs structured results. Use --json-output for machine-readable output.`,
  parameters: z.object({
    script: z
      .enum(Object.keys(AVAILABLE_SCRIPTS) as [string, ...string[]])
      .describe(
        "Script to execute. Options: " +
          Object.entries(AVAILABLE_SCRIPTS)
            .map(([k, v]) => `${k} — ${v.description}`)
            .join("; "),
      ),
    args: z.array(z.string()).describe("Arguments to pass to the script"),
    timeout_seconds: z
      .number()
      .optional()
      .default(120)
      .describe("Maximum execution time in seconds (default: 120)"),
  }),
  async execute(params) {
    const scriptPath = path.join(SCRIPTS_DIR, `${params.script}.py`)
    const file = Bun.file(scriptPath)
    if (!(await file.exists())) {
      return {
        title: `attack_script: ${params.script}`,
        output: `Script not found: ${params.script}.py\n\nAvailable scripts:\n${Object.entries(AVAILABLE_SCRIPTS)
          .map(([k, v]) => `  ${k}: ${v.description}\n    Usage: ${v.args}`)
          .join("\n")}`,
        metadata: { script: params.script, exitCode: -1, hasStderr: false },
      }
    }

    const proc = Bun.spawn(["python3", scriptPath, ...params.args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    })

    const timeout = setTimeout(() => {
      proc.kill()
    }, params.timeout_seconds * 1000)

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])

    clearTimeout(timeout)
    const exitCode = await proc.exited

    const output = [stdout]
    if (stderr.trim()) output.push(`\n--- stderr ---\n${stderr}`)
    if (exitCode !== 0) output.push(`\nExit code: ${exitCode}`)

    return {
      title: `attack_script: ${params.script}`,
      output: output.join(""),
      metadata: {
        script: params.script,
        exitCode,
        hasStderr: stderr.trim().length > 0,
      },
    }
  },
})
