// @cyberstrike-io/web — Web Application assessment domain provider.
//
// WSTG-aligned agent roster: every specialist maps 1:1 to an OWASP WSTG category (4.1–4.11)
// plus one custom LLM specialist. The hunt-* series and its feature flags are retired; all
// agents use the wstg-* naming convention unconditionally.
//
// Three deliberate de-couplings vs the old host file, all host-only concerns left behind:
//   1. Skills are referenced BY NAME in each spec's `skills:[]` (the azure pattern). The
//      host surfaces them as "Recommended skills for this agent (load these first)" and the
//      agent loads them at runtime via the `skill` tool — no build-time `Skill.get` bake, so
//      the package needs no host skill loader (CoreRuntime exposes none).
//   2. The orchestrator's retest-routing table is rendered FROM the SpecialistClass→agent map
//      the specs declare — not from the (retiring) CS SignalRouter. Vortex is the signal
//      producer now (#15); class→owner routing travels WITH the package via specialistClasses().
//   3. The old host-only `detectors()` / `signalRouter()` provider methods are dropped — they
//      had zero callers after the fabric retirement.
import type { AgentSpec, DomainProvider, PermissionRule } from "@cyberstrike-io/plugin"

import PROMPT_VULN_COMMON from "./prompts/vuln/common-prompt.txt"
import PROMPT_METHODOLOGY_COMMON from "./prompts/methodology/common-methodology.txt"

// ── Orchestrator ──
import PROMPT_WSTG_AGENT from "./prompts/orchestrator/wstg-agent/prompt.txt"
import DESC_WSTG_AGENT from "./prompts/orchestrator/wstg-agent/description.txt"

// ── WSTG 4.1 Information Gathering ──
import PROMPT_WSTG_INFO_GATHERING from "./prompts/vuln/wstg-info-gathering/prompt.txt"
import DESC_WSTG_INFO_GATHERING from "./prompts/vuln/wstg-info-gathering/description.txt"
// ── WSTG 4.2 Configuration & Deployment Management ──
import PROMPT_WSTG_CONFIG_DEPLOY from "./prompts/vuln/wstg-config-deploy/prompt.txt"
import DESC_WSTG_CONFIG_DEPLOY from "./prompts/vuln/wstg-config-deploy/description.txt"
// ── WSTG 4.3 Identity Management ──
import PROMPT_WSTG_IDENTITY_MGMT from "./prompts/vuln/wstg-identity-mgmt/prompt.txt"
import DESC_WSTG_IDENTITY_MGMT from "./prompts/vuln/wstg-identity-mgmt/description.txt"
// ── WSTG 4.4 Authentication ──
import PROMPT_WSTG_AUTHENTICATION from "./prompts/vuln/wstg-authentication/prompt.txt"
import DESC_WSTG_AUTHENTICATION from "./prompts/vuln/wstg-authentication/description.txt"
// ── WSTG 4.5 Authorization ──
import PROMPT_WSTG_AUTHORIZATION from "./prompts/vuln/wstg-authorization/prompt.txt"
import DESC_WSTG_AUTHORIZATION from "./prompts/vuln/wstg-authorization/description.txt"
// ── WSTG 4.6 Session Management ──
import PROMPT_WSTG_SESSION_MGMT from "./prompts/vuln/wstg-session-mgmt/prompt.txt"
import DESC_WSTG_SESSION_MGMT from "./prompts/vuln/wstg-session-mgmt/description.txt"
// ── WSTG 4.7 Input Validation ──
import PROMPT_WSTG_INPUT_VALIDATION from "./prompts/vuln/wstg-input-validation/prompt.txt"
import DESC_WSTG_INPUT_VALIDATION from "./prompts/vuln/wstg-input-validation/description.txt"
// ── WSTG 4.8 Error Handling ──
import PROMPT_WSTG_ERROR_HANDLING from "./prompts/vuln/wstg-error-handling/prompt.txt"
import DESC_WSTG_ERROR_HANDLING from "./prompts/vuln/wstg-error-handling/description.txt"
// ── WSTG 4.9 Cryptography ──
import PROMPT_WSTG_CRYPTOGRAPHY from "./prompts/vuln/wstg-cryptography/prompt.txt"
import DESC_WSTG_CRYPTOGRAPHY from "./prompts/vuln/wstg-cryptography/description.txt"
// ── WSTG 4.10 Business Logic ──
import PROMPT_WSTG_BUSINESS_LOGIC from "./prompts/vuln/wstg-business-logic/prompt.txt"
import DESC_WSTG_BUSINESS_LOGIC from "./prompts/vuln/wstg-business-logic/description.txt"
// ── WSTG 4.11 Client-side ──
import PROMPT_WSTG_CLIENT_SIDE from "./prompts/vuln/wstg-client-side/prompt.txt"
import DESC_WSTG_CLIENT_SIDE from "./prompts/vuln/wstg-client-side/description.txt"
// ── Custom: LLM Security ──
import PROMPT_WSTG_LLM from "./prompts/vuln/wstg-llm/prompt.txt"
import DESC_WSTG_LLM from "./prompts/vuln/wstg-llm/description.txt"

const VULN_BASE_PERMISSIONS: Record<string, PermissionRule> = {
  "*": "deny",
  bash: {
    "*": "allow",
    "*curl *": "deny",
    "*curl.exe*": "deny",
    "*wget *": "deny",
    "*python*requests*": "deny",
    "*python*urllib*": "deny",
    "*python*aiohttp*": "deny",
    "*python*httpx*": "deny",
    "*python3*requests*": "deny",
    "*python3*urllib*": "deny",
    "*python3*aiohttp*": "deny",
    "*python3*httpx*": "deny",
    "*import requests*": "deny",
    "*from requests *": "deny",
    "*import urllib*": "deny",
    "*import aiohttp*": "deny",
    "*import httpx*": "deny",
    "*bun -e*": "deny",
    "*bun --eval*": "deny",
    "*node -e*": "deny",
    "*node --eval*": "deny",
    "*deno eval*": "deny",
    "*deno run *": "deny",
    "* nc *": "deny",
    "nc *": "deny",
    "*ncat *": "deny",
    "*socat *": "deny",
    "*telnet *": "deny",
    "*base64*| python*": "deny",
    "*base64*| python3*": "deny",
    "*base64*| bun*": "deny",
    "*base64*| node*": "deny",
  },
  webfetch: "deny",
  web_get_session_context: "allow",
  web_get_detail: "allow",
  web_get_request_detail: "allow",
  web_get_vulnerabilities: "allow",
  report_vulnerability: "allow",
  triage_vulnerability: "allow",
  add_intel: "allow",
  update_vrt_check: "allow",
  record_coverage_note: "allow",
  get_coverage_notes: "allow",
  methodology_status: "allow",
  scope_check: "allow",
  attack_script: "allow",
  skill: "allow",
  http_replay: "allow",
  http_replay_raw: "allow",
  web_update_credential: "allow",
  csrf_extract: "allow",
}

function mergePermissions(base: Record<string, PermissionRule>, extra: Record<string, PermissionRule>): Record<string, PermissionRule> {
  const result: Record<string, PermissionRule> = { ...base }
  for (const [key, val] of Object.entries(extra)) {
    const existing = result[key]
    if (typeof existing === "object" && typeof val === "object") {
      result[key] = { ...existing, ...val }
    } else {
      result[key] = val
    }
  }
  return result
}

type SpecDef = Omit<AgentSpec, "steps" | "color" | "group"> & {
  steps?: number
  color?: string
  specialistClass?: string
}

/**
 * Build the SpecialistClass → agent-name map from the specs. This is the ONLY source of truth for
 * "which agent confirms a given signal class". Throws if two agents claim the same class.
 */
export function buildClassAgentMap(defs: ReadonlyArray<{ name: string; specialistClass?: string }>): Map<string, string> {
  const map = new Map<string, string>()
  for (const d of defs) {
    if (!d.specialistClass) continue
    const existing = map.get(d.specialistClass)
    if (existing) {
      throw new Error(
        `WebProvider: SpecialistClass "${d.specialistClass}" is claimed by both "${existing}" and "${d.name}" — exactly one agent may own a class.`,
      )
    }
    map.set(d.specialistClass, d.name)
  }
  return map
}

export const SIGNAL_ROUTING_PLACEHOLDER = "{{SIGNAL_ROUTING_TABLE}}"
export const AGENT_ROSTER_PLACEHOLDER = "{{AGENT_ROSTER}}"

export function renderRoster(specs: ReadonlyArray<{ name: string; role: AgentSpec["role"]; description: string }>): string {
  const specialists = specs.filter((s) => s.role === "specialist")
  const entry = (s: { name: string; description: string }) => `- **${s.name}**: ${s.description}`
  const lines: string[] = ["### Vulnerability Testing Agents", ""]
  lines.push(specialists.map(entry).join("\n\n"))
  return lines.join("\n")
}

export function renderSignalRoutingTable(classAgent: ReadonlyMap<string, string>): string {
  const rows: string[] = []
  for (const [owner, agent] of classAgent) {
    rows.push(`| \`${owner}\` | ${agent} |`)
  }
  return ["| Specialist class | Agent name |", "|-----------------|------------|", ...rows].join("\n")
}

function injectPlaceholder(agentName: string, prompt: string, token: string, value: string): string {
  if (!prompt.includes(token)) {
    throw new Error(
      `WebProvider: orchestrator "${agentName}" prompt is missing the ${token} placeholder — cannot compose it from code.`,
    )
  }
  return prompt.replace(token, value)
}

// Debug/observation focus mode. Set CYBERSTRIKE_WEB_FOCUS to a comma-separated list of specialist
// short-names (e.g. "input-validation,authorization") to TEMPORARILY enable only those specialists.
// The orchestrator (wstg-agent) is always kept.
function focusSet(): Set<string> | null {
  const raw = process.env.CYBERSTRIKE_WEB_FOCUS
  if (!raw || !raw.trim()) return null
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/^wstg-/, ""))
      .filter(Boolean),
  )
  return set.size > 0 ? set : null
}

function vulnPrompt(prompt: string): string {
  return `${PROMPT_VULN_COMMON}\n\n---\n\n${prompt}`
}

const INJECTION_DENY_RULES: Record<string, PermissionRule> = {
  bash: {
    "*DROP TABLE*": "deny",
    "*drop table*": "deny",
    "*DROP DATABASE*": "deny",
    "*drop database*": "deny",
    "*DROP SCHEMA*": "deny",
    "*drop schema*": "deny",
    "*TRUNCATE TABLE*": "deny",
    "*truncate table*": "deny",
    "*INTO OUTFILE*": "deny",
    "*into outfile*": "deny",
    "*INTO DUMPFILE*": "deny",
    "*into dumpfile*": "deny",
    "*xp_cmdshell*": "deny",
    "*sp_OACreate*": "deny",
    "*sys_exec*": "deny",
    "*sys_eval*": "deny",
    "*COPY * TO PROGRAM*": "deny",
    "*copy * to program*": "deny",
    "*--os-shell*": "deny",
    "*--os-cmd*": "deny",
    "*--os-pwn*": "deny",
    "*--file-write*": "deny",
    "*--reg-add*": "deny",
    "*--reg-del*": "deny",
  },
}

const VORTEX_READ_PERMISSIONS: Record<string, PermissionRule> = {
  vortex_leads: "allow",
  vortex_inspect: "allow",
  vortex_query: "allow",
  vortex_objects: "allow",
  vortex_functions: "allow",
  vortex_cross_role: "allow",
  vortex_where_value: "allow",
  vortex_untested: "allow",
}

function buildSpecDefs(): SpecDef[] {
  return [
    // ── Support ──
    {
      name: "wstg-agent",
      role: "orchestrator",
      prompt: `${PROMPT_METHODOLOGY_COMMON}\n\n---\n\n${PROMPT_WSTG_AGENT}`,
      description: DESC_WSTG_AGENT,
      skills: [],
      steps: 40,
      color: "blue",
      hidden: false,
      permissions: {
        "*": "deny",
        task: "allow",
        question: "allow",
        web_get_session_context: "allow",
        web_get_detail: "allow",
        web_get_vulnerabilities: "allow",
        web_get_vuln_detail: "allow",
        get_coverage_notes: "allow",
        methodology_status: "allow",
        scope_check: "allow",
      },
    },
    // ── WSTG 4.1 Information Gathering ──
    {
      name: "wstg-info-gathering",
      role: "specialist",
      specialistClass: "info-gathering",
      prompt: vulnPrompt(PROMPT_WSTG_INFO_GATHERING),
      description: DESC_WSTG_INFO_GATHERING,
      skills: ["wstg-info-02", "wstg-info-03", "wstg-info-05", "wstg-info-08"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { recon_test: "allow", ...VORTEX_READ_PERMISSIONS }),
    },

    // ── WSTG 4.2 Configuration & Deployment Management ──
    {
      name: "wstg-config-deploy",
      role: "specialist",
      specialistClass: "config-deployment",
      prompt: vulnPrompt(PROMPT_WSTG_CONFIG_DEPLOY),
      description: DESC_WSTG_CONFIG_DEPLOY,
      skills: [
        "wstg-conf-01", "wstg-conf-02", "wstg-conf-03", "wstg-conf-04", "wstg-conf-05", "wstg-conf-06",
        "wstg-conf-07", "wstg-conf-08", "wstg-conf-09", "wstg-conf-10", "wstg-conf-11", "wstg-cryp-01",
        "wstg-info-02", "wstg-info-03", "wstg-info-05", "wstg-info-08",
      ],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { misconfig_test: "allow", recon_test: "allow", ...VORTEX_READ_PERMISSIONS }),
    },

    // ── WSTG 4.3 Identity Management ──
    {
      name: "wstg-identity-mgmt",
      role: "specialist",
      specialistClass: "identity-management",
      prompt: vulnPrompt(PROMPT_WSTG_IDENTITY_MGMT),
      description: DESC_WSTG_IDENTITY_MGMT,
      skills: ["wstg-idnt-01", "wstg-idnt-02", "wstg-idnt-03", "wstg-idnt-04", "wstg-idnt-05"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, VORTEX_READ_PERMISSIONS),
    },

    // ── WSTG 4.4 Authentication ──
    {
      name: "wstg-authentication",
      role: "specialist",
      specialistClass: "authentication",
      prompt: vulnPrompt(PROMPT_WSTG_AUTHENTICATION),
      description: DESC_WSTG_AUTHENTICATION,
      skills: ["wstg-auth-session", "wstg-athn-04", "wstg-athn-09", "wstg-athn-11", "wstg-sess-10"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, {
        ...VORTEX_READ_PERMISSIONS,
        authn_test: "allow",
        login_probe: "allow",
      }),
    },

    // ── WSTG 4.5 Authorization ──
    {
      name: "wstg-authorization",
      role: "specialist",
      specialistClass: "authorization",
      prompt: vulnPrompt(PROMPT_WSTG_AUTHORIZATION),
      description: DESC_WSTG_AUTHORIZATION,
      skills: ["wstg-authz-01", "wstg-authz-02", "wstg-authz-03", "wstg-authz-04", "wstg-apit-02"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { access_probe: "allow", ...VORTEX_READ_PERMISSIONS }),
    },

    // ── WSTG 4.6 Session Management ──
    {
      name: "wstg-session-mgmt",
      role: "specialist",
      specialistClass: "session-management",
      prompt: vulnPrompt(PROMPT_WSTG_SESSION_MGMT),
      description: DESC_WSTG_SESSION_MGMT,
      skills: ["wstg-sess-10", "wstg-auth-session"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { session_probe: "allow", ...VORTEX_READ_PERMISSIONS }),
    },

    // ── WSTG 4.7 Input Validation ──
    {
      name: "wstg-input-validation",
      role: "specialist",
      specialistClass: "input-validation",
      prompt: vulnPrompt(PROMPT_WSTG_INPUT_VALIDATION),
      description: DESC_WSTG_INPUT_VALIDATION,
      skills: ["wstg-injection", "wstg-inpv-05", "wstg-inpv-12", "wstg-inpv-18", "wstg-inpv-19", "wstg-inpv-11"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, {
        ...VORTEX_READ_PERMISSIONS,
        vortex_inject_points: "allow",
        vortex_probe: "allow",
        inject_probe: "allow",
        ...INJECTION_DENY_RULES,
      }),
    },

    // ── WSTG 4.8 Error Handling ──
    {
      name: "wstg-error-handling",
      role: "specialist",
      specialistClass: "error-handling",
      prompt: vulnPrompt(PROMPT_WSTG_ERROR_HANDLING),
      description: DESC_WSTG_ERROR_HANDLING,
      skills: ["wstg-errh-01", "wstg-errh-02"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, VORTEX_READ_PERMISSIONS),
    },

    // ── WSTG 4.9 Cryptography ──
    {
      name: "wstg-cryptography",
      role: "specialist",
      specialistClass: "cryptography",
      prompt: vulnPrompt(PROMPT_WSTG_CRYPTOGRAPHY),
      description: DESC_WSTG_CRYPTOGRAPHY,
      skills: ["wstg-cryp-01", "wstg-cryp-02", "wstg-cryp-03", "wstg-cryp-04"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, VORTEX_READ_PERMISSIONS),
    },

    // ── WSTG 4.10 Business Logic ──
    {
      name: "wstg-business-logic",
      role: "specialist",
      specialistClass: "business-logic",
      prompt: vulnPrompt(PROMPT_WSTG_BUSINESS_LOGIC),
      description: DESC_WSTG_BUSINESS_LOGIC,
      skills: ["wstg-logic-client-api", "wstg-busl-04", "wstg-busl-10"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { business_test: "allow", ...VORTEX_READ_PERMISSIONS }),
    },

    // ── WSTG 4.11 Client-side ──
    {
      name: "wstg-client-side",
      role: "specialist",
      specialistClass: "client-side",
      prompt: vulnPrompt(PROMPT_WSTG_CLIENT_SIDE),
      description: DESC_WSTG_CLIENT_SIDE,
      skills: ["wstg-clnt-01", "wstg-clnt-04", "wstg-clnt-07", "wstg-clnt-09", "wstg-clnt-10"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, VORTEX_READ_PERMISSIONS),
    },

    // ── Custom: LLM Security ──
    {
      name: "wstg-llm",
      role: "specialist",
      specialistClass: "llm",
      prompt: vulnPrompt(PROMPT_WSTG_LLM),
      description: DESC_WSTG_LLM,
      skills: ["llm-security"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { llmhook: "allow", ...VORTEX_READ_PERMISSIONS }),
    },
  ]
}

export class WebProvider implements DomainProvider {
  readonly key = "web"
  private readonly specs: AgentSpec[]
  private readonly classAgent: ReadonlyMap<string, string>

  constructor() {
    let defs = buildSpecDefs()
    const focus = focusSet()
    if (focus) {
      const short = (n: string) => n.replace(/^wstg-/, "").toLowerCase()
      defs = defs.filter((d) => d.role === "orchestrator" || focus.has(short(d.name)))
      console.warn(
        `[web-provider] CYBERSTRIKE_WEB_FOCUS active — reduced roster: ${defs.map((d) => d.name).join(", ")}`,
      )
    }
    const classAgent = buildClassAgentMap(defs)
    const routingTable = renderSignalRoutingTable(classAgent)
    const normalized = defs.map((d) => ({ ...d, description: (d.description.split("\n")[0] ?? d.description).trim() }))
    const roster = renderRoster(normalized)

    this.specs = normalized.map((d) => ({
      name: d.name,
      role: d.role,
      description: d.description,
      steps: d.steps ?? 50,
      color: d.color ?? "cyan",
      prompt:
        d.role === "orchestrator"
          ? injectPlaceholder(
              d.name,
              injectPlaceholder(d.name, d.prompt, SIGNAL_ROUTING_PLACEHOLDER, routingTable),
              AGENT_ROSTER_PLACEHOLDER,
              roster,
            )
          : d.prompt,
      skills: d.skills,
      permissions: d.permissions,
      hidden: d.hidden,
      prependRequestContext: d.prependRequestContext,
      useSmallModel: d.useSmallModel,
    }))
    this.classAgent = classAgent
  }

  agentSpecs(): AgentSpec[] {
    return this.specs
  }

  specialistClasses(): Record<string, string> {
    return Object.fromEntries(this.classAgent)
  }
}
