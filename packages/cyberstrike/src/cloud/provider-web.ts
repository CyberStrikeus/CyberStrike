import type { DomainProvider, AgentSpec, PermissionAction, PermissionRule } from "./provider"
import type { Detector, SpecialistClass } from "../session/web/signal/types"
import { DETECTORS } from "../session/web/signal/detectors"
import { SignalRouter } from "../session/web/signal/router"
import { Skill } from "../skill"

import PROMPT_VULN_COMMON from "../agent/prompt/vuln/common-prompt.txt"
import PROMPT_METHODOLOGY_COMMON from "../agent/prompt/methodology/common-methodology.txt"

import PROMPT_WEB_HUNT_AGENT from "../agent/prompt/orchestrator/web-hunt-agent/prompt.txt"
import DESC_WEB_HUNT_AGENT from "../agent/prompt/orchestrator/web-hunt-agent/description.txt"
import PROMPT_HUNT_ANALYZER from "../agent/prompt/analyzer/hunt-analyzer/prompt.txt"
import DESC_HUNT_ANALYZER from "../agent/prompt/analyzer/hunt-analyzer/description.txt"

import PROMPT_HUNT_TESTER_IDOR from "../agent/prompt/vuln/idor/prompt.txt"
import DESC_HUNT_TESTER_IDOR from "../agent/prompt/vuln/idor/description.txt"
import PROMPT_HUNT_TESTER_AUTHZ from "../agent/prompt/vuln/authz/prompt.txt"
import DESC_HUNT_TESTER_AUTHZ from "../agent/prompt/vuln/authz/description.txt"
import PROMPT_HUNT_TESTER_MASS_ASSIGNMENT from "../agent/prompt/vuln/mass-assignment/prompt.txt"
import DESC_HUNT_TESTER_MASS_ASSIGNMENT from "../agent/prompt/vuln/mass-assignment/description.txt"
import PROMPT_HUNT_TESTER_INJECTION from "../agent/prompt/vuln/injection/prompt.txt"
import DESC_HUNT_TESTER_INJECTION from "../agent/prompt/vuln/injection/description.txt"
import PROMPT_HUNT_TESTER_AUTHN from "../agent/prompt/vuln/authn/prompt.txt"
import DESC_HUNT_TESTER_AUTHN from "../agent/prompt/vuln/authn/description.txt"
import PROMPT_HUNT_TESTER_BUSINESS_LOGIC from "../agent/prompt/vuln/business-logic/prompt.txt"
import DESC_HUNT_TESTER_BUSINESS_LOGIC from "../agent/prompt/vuln/business-logic/description.txt"
import PROMPT_HUNT_TESTER_SSRF from "../agent/prompt/vuln/ssrf/prompt.txt"
import DESC_HUNT_TESTER_SSRF from "../agent/prompt/vuln/ssrf/description.txt"
import PROMPT_HUNT_TESTER_FILE_ATTACKS from "../agent/prompt/vuln/file-attacks/prompt.txt"
import DESC_HUNT_TESTER_FILE_ATTACKS from "../agent/prompt/vuln/file-attacks/description.txt"
import PROMPT_HUNT_TESTER_LLM from "../agent/prompt/vuln/llm/prompt.txt"
import DESC_HUNT_TESTER_LLM from "../agent/prompt/vuln/llm/description.txt"
import PROMPT_HUNT_TESTER_MISCONFIG from "../agent/prompt/vuln/misconfig/prompt.txt"
import DESC_HUNT_TESTER_MISCONFIG from "../agent/prompt/vuln/misconfig/description.txt"
import PROMPT_HUNT_TESTER_RECON from "../agent/prompt/vuln/recon/prompt.txt"
import DESC_HUNT_TESTER_RECON from "../agent/prompt/vuln/recon/description.txt"

function stripDefensiveSections(content: string): string {
  if (!content) return ""
  let result = content
  for (const heading of ["Remediation", "Risk Assessment", "CWE Categories", "References", "Checklist"]) {
    const re = new RegExp(`(^|\\n)## ${heading}[\\s\\S]*?(?=\\n## (?!${heading})|$)`, "g")
    result = result.replace(re, "")
  }
  return result.trim()
}

async function loadSkills(names: string[]): Promise<string> {
  let skills: Array<{ content: string } | undefined>
  try {
    skills = await Promise.all(names.map((name) => Skill.get(name)))
  } catch {
    return ""
  }
  const blocks: string[] = []
  for (let i = 0; i < names.length; i++) {
    const skill = skills[i]
    if (!skill) continue
    const content = stripDefensiveSections(skill.content)
    if (content) blocks.push(`<skill name="${names[i]}">\n${content}\n</skill>`)
  }
  if (blocks.length === 0) return ""
  return [
    "",
    "",
    "## Embedded Skill References",
    "",
    "Authoritative WSTG testing methodology for your specialty is statically embedded below.",
    "Use these payloads, patterns, and procedures during testing.",
    "",
    blocks.join("\n\n"),
  ].join("\n")
}

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

// A specialist def may declare the signal-fabric SpecialistClass it OWNS — the
// class the signal router routes to (`open_redirect` → `access-control`). This is
// the single code bridge between the signal fabric's class taxonomy and the agent
// names; the orchestrator's routing table is rendered FROM it, never hand-kept.
type SpecDef = Omit<AgentSpec, "steps" | "color" | "group"> & {
  steps?: number
  color?: string
  specialistClass?: SpecialistClass
}

/**
 * Build the SpecialistClass → agent-name map from the specs. This is the ONLY
 * source of truth for "which agent confirms a given signal class". Throws if two
 * agents claim the same class (an ambiguous owner is a config bug, not a runtime
 * guess). Pure — testable without async skill loading.
 */
export function buildClassAgentMap(defs: ReadonlyArray<{ name: string; specialistClass?: SpecialistClass }>): Map<SpecialistClass, string> {
  const map = new Map<SpecialistClass, string>()
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

// Placeholder the orchestrator prompt carries where the SpecialistClass → agent
// retest-routing table belongs. Replaced at assembly time with the rendered table
// so the prompt never hand-restates a mapping that lives in code (closes the old
// prose drift). create() throws if the orchestrator prompt lost this token.
export const SIGNAL_ROUTING_PLACEHOLDER = "{{SIGNAL_ROUTING_TABLE}}"

// Placeholder for the roster of dispatchable subagents. Rendered from each agent's
// own description (its single source), grouped by role, so adding/removing a
// sub-agent updates the orchestrator's roster automatically instead of drifting.
export const AGENT_ROSTER_PLACEHOLDER = "{{AGENT_ROSTER}}"

/**
 * Render the orchestrator's roster of dispatchable subagents FROM the specs —
 * the analyzer under "Architecture Analysis", the specialists under "Vulnerability
 * Testing Agents". Each entry is the agent's own `description` (single source; the
 * orchestrator no longer keeps a hand-maintained copy). The orchestrator itself
 * and any hidden non-roster roles are excluded.
 */
export function renderRoster(specs: ReadonlyArray<{ name: string; role: AgentSpec["role"]; description: string }>): string {
  const analyzers = specs.filter((s) => s.role === "analyzer")
  const specialists = specs.filter((s) => s.role === "specialist")
  const entry = (s: { name: string; description: string }) => `- **${s.name}**: ${s.description}`
  const lines: string[] = ["### Architecture Analysis"]
  for (const s of analyzers) lines.push(entry(s))
  lines.push("", "### Vulnerability Testing Agents", "")
  lines.push(specialists.map(entry).join("\n\n"))
  return lines.join("\n")
}

/**
 * Render the new_signal retest routing table (SpecialistClass → agent) for the
 * orchestrator prompt, FROM the code map — not hand-written prose. Only classes a
 * signal actually routes to appear (distinct signal owners, in SignalType order);
 * client-side has no agent and is handled as static prose in the prompt.
 */
export function renderSignalRoutingTable(
  classAgent: ReadonlyMap<SpecialistClass, string>,
  router: SignalRouter,
): string {
  const seen = new Set<SpecialistClass>()
  const rows: string[] = []
  for (const type of SignalRouter.signalTypes()) {
    const owner = router.ownerOf(type)
    if (seen.has(owner)) continue
    seen.add(owner)
    const agent = classAgent.get(owner)
    if (!agent) continue // assertSignalCoverage guarantees this is unreachable
    rows.push(`| \`${owner}\` | ${agent} |`)
  }
  return ["| Specialist class | Agent name |", "|-----------------|------------|", ...rows].join("\n")
}

/**
 * Replace one placeholder token in the orchestrator prompt. Throws if the token is
 * missing — a prompt edit that drops it would silently ship an orchestrator with a
 * missing section (no retest routing, no roster), so we fail loud at assembly.
 */
function injectPlaceholder(agentName: string, prompt: string, token: string, value: string): string {
  if (!prompt.includes(token)) {
    throw new Error(
      `WebProvider: orchestrator "${agentName}" prompt is missing the ${token} placeholder — cannot compose it from code.`,
    )
  }
  return prompt.replace(token, value)
}

/**
 * Assert every class the signal router can route to has an owning agent. A signal
 * whose owner class resolves to no agent would enqueue a retest nobody can run —
 * so the plugin refuses to assemble rather than silently drop leads. This is the
 * fail-fast that closes the old drift: rename/remove an owner agent and startup
 * throws instead of the routing breaking silently in prose.
 */
function assertSignalCoverage(classAgent: ReadonlyMap<SpecialistClass, string>, router: SignalRouter): void {
  const orphans = new Set<SpecialistClass>()
  for (const type of SignalRouter.signalTypes()) {
    const owner = router.ownerOf(type)
    if (!classAgent.has(owner)) orphans.add(owner)
  }
  if (orphans.size > 0) {
    throw new Error(
      `WebProvider: signal owner class(es) with no agent: ${[...orphans].join(", ")}. ` +
        `Every SpecialistClass a signal routes to must be declared as an agent's specialistClass.`,
    )
  }
}

export class WebProvider implements DomainProvider {
  key = "web" as const
  private specs: AgentSpec[]
  private classAgent: ReadonlyMap<SpecialistClass, string>

  private constructor(specs: AgentSpec[], classAgent: ReadonlyMap<SpecialistClass, string>) {
    this.specs = specs
    this.classAgent = classAgent
  }

  static async create(): Promise<WebProvider> {
    const router = new SignalRouter()
    const defs = await buildSpecDefs()
    const classAgent = buildClassAgentMap(defs)
    assertSignalCoverage(classAgent, router)
    const routingTable = renderSignalRoutingTable(classAgent, router)

    // Normalize descriptions first: spec.description AND the rendered roster both
    // read the same trimmed one-liner, so they can never disagree.
    const normalized = defs.map((d) => ({ ...d, description: (d.description.split("\n")[0] ?? d.description).trim() }))
    const roster = renderRoster(normalized)

    const specs = normalized.map((d) => ({
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
    return new WebProvider(specs, classAgent)
  }

  agentSpecs(): AgentSpec[] {
    return this.specs
  }

  /** The agent that confirms/reports a given signal class, or undefined if none owns it. */
  agentForClass(cls: SpecialistClass): string | undefined {
    return this.classAgent.get(cls)
  }

  /** The full SpecialistClass → agent map (for prompt rendering + coverage tests). */
  classAgentMap(): ReadonlyMap<SpecialistClass, string> {
    return this.classAgent
  }

  detectors(): Detector[] {
    return DETECTORS
  }

  signalRouter(): SignalRouter {
    return new SignalRouter()
  }
}

async function buildSpecDefs(): Promise<SpecDef[]> {
  const [
    idorSkills,
    authzSkills,
    massAssignmentSkills,
    injectionSkills,
    authnSkills,
    businessLogicSkills,
    ssrfSkills,
    fileAttacksSkills,
    llmSkills,
    misconfigSkills,
    reconSkills,
  ] = await Promise.all([
    loadSkills(["wstg-authz-04", "wstg-apit-02"]),
    loadSkills(["wstg-authz-02", "wstg-authz-03", "wstg-authz-01"]),
    loadSkills(["wstg-inpv-20", "wstg-busl-02"]),
    loadSkills(["wstg-injection", "wstg-inpv-05", "wstg-inpv-12", "wstg-inpv-18"]),
    loadSkills(["wstg-auth-session", "wstg-athn-04", "wstg-athn-09", "wstg-athn-11", "wstg-sess-10"]),
    loadSkills(["wstg-logic-client-api", "wstg-busl-04", "wstg-busl-10"]),
    loadSkills(["wstg-inpv-19", "wstg-conf-13"]),
    loadSkills(["wstg-inpv-11.1", "wstg-inpv-11", "wstg-busl-08", "wstg-busl-09"]),
    loadSkills(["llm-security"]),
    loadSkills(["wstg-conf-01", "wstg-conf-02", "wstg-conf-03", "wstg-conf-04", "wstg-conf-05", "wstg-conf-06", "wstg-conf-07", "wstg-conf-08", "wstg-conf-09", "wstg-conf-10", "wstg-conf-11", "wstg-cryp-01"]),
    loadSkills(["wstg-info-02", "wstg-info-03", "wstg-info-05", "wstg-info-08"]),
  ])

  function vulnPrompt(prompt: string, skills: string): string {
    return `${PROMPT_VULN_COMMON}\n\n---\n\n${prompt}${skills}`
  }

  return [
    {
      name: "hunt-agent",
      role: "orchestrator",
      prompt: `${PROMPT_METHODOLOGY_COMMON}\n\n---\n\n${PROMPT_WEB_HUNT_AGENT}`,
      description: DESC_WEB_HUNT_AGENT,
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
    {
      name: "hunt-analyzer",
      role: "analyzer",
      prompt: PROMPT_HUNT_ANALYZER,
      description: DESC_HUNT_ANALYZER,
      skills: [],
      steps: 20,
      hidden: true,
      useSmallModel: true,
      prependRequestContext: true,
      permissions: {
        "*": "deny",
        bash: "allow",
        webfetch: "allow",
        http_replay: "allow",
        web_get_session_context: "allow",
        web_get_detail: "allow",
        web_get_request_detail: "allow",
        web_write_role: "allow",
        web_write_object: "allow",
        web_write_object_value: "allow",
        web_write_function: "allow",
        web_update_credential_claims: "allow",
      },
    },
    {
      name: "hunt-idor",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_IDOR, idorSkills),
      description: DESC_HUNT_TESTER_IDOR,
      skills: ["wstg-authz-04", "wstg-apit-02"],
      prependRequestContext: true,
      permissions: VULN_BASE_PERMISSIONS,
    },
    {
      name: "hunt-authz",
      role: "specialist",
      specialistClass: "access-control",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_AUTHZ, authzSkills),
      description: DESC_HUNT_TESTER_AUTHZ,
      skills: ["wstg-authz-02", "wstg-authz-03", "wstg-authz-01"],
      prependRequestContext: true,
      permissions: VULN_BASE_PERMISSIONS,
    },
    {
      name: "hunt-mass-assignment",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_MASS_ASSIGNMENT, massAssignmentSkills),
      description: DESC_HUNT_TESTER_MASS_ASSIGNMENT,
      skills: ["wstg-inpv-20", "wstg-busl-02"],
      prependRequestContext: true,
      permissions: VULN_BASE_PERMISSIONS,
    },
    {
      name: "hunt-injection",
      role: "specialist",
      specialistClass: "injection",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_INJECTION, injectionSkills),
      description: DESC_HUNT_TESTER_INJECTION,
      skills: ["wstg-injection", "wstg-inpv-05", "wstg-inpv-12", "wstg-inpv-18"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, {
        inject_probe: "allow",
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
      }),
    },
    {
      name: "hunt-authn",
      role: "specialist",
      specialistClass: "auth-session",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_AUTHN, authnSkills),
      description: DESC_HUNT_TESTER_AUTHN,
      skills: ["wstg-auth-session", "wstg-athn-04", "wstg-athn-09", "wstg-athn-11", "wstg-sess-10"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { authn_test: "allow" }),
    },
    {
      name: "hunt-business-logic",
      role: "specialist",
      specialistClass: "business-logic",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_BUSINESS_LOGIC, businessLogicSkills),
      description: DESC_HUNT_TESTER_BUSINESS_LOGIC,
      skills: ["wstg-logic-client-api", "wstg-busl-04", "wstg-busl-10"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { business_test: "allow" }),
    },
    {
      name: "hunt-ssrf",
      role: "specialist",
      specialistClass: "server-side-request",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_SSRF, ssrfSkills),
      description: DESC_HUNT_TESTER_SSRF,
      skills: ["wstg-inpv-19", "wstg-conf-13"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { ssrf_test: "allow" }),
    },
    {
      name: "hunt-file-attacks",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_FILE_ATTACKS, fileAttacksSkills),
      description: DESC_HUNT_TESTER_FILE_ATTACKS,
      skills: ["wstg-inpv-11.1", "wstg-inpv-11", "wstg-busl-08", "wstg-busl-09"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { inject_probe: "allow" }),
    },
    {
      name: "hunt-llm",
      role: "specialist",
      specialistClass: "llm",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_LLM, llmSkills),
      description: DESC_HUNT_TESTER_LLM,
      skills: ["llm-security"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { llmhook: "allow" }),
    },
    {
      name: "hunt-misconfig",
      role: "specialist",
      specialistClass: "misconfiguration",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_MISCONFIG, misconfigSkills),
      description: DESC_HUNT_TESTER_MISCONFIG,
      skills: ["wstg-conf-01", "wstg-conf-02", "wstg-conf-03", "wstg-conf-04", "wstg-conf-05", "wstg-conf-06", "wstg-conf-07", "wstg-conf-08", "wstg-conf-09", "wstg-conf-10", "wstg-conf-11", "wstg-cryp-01"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { misconfig_test: "allow" }),
    },
    {
      name: "hunt-recon",
      role: "specialist",
      specialistClass: "recon",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_RECON, reconSkills),
      description: DESC_HUNT_TESTER_RECON,
      skills: ["wstg-info-02", "wstg-info-03", "wstg-info-05", "wstg-info-08"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { recon_test: "allow" }),
    },
  ]
}
