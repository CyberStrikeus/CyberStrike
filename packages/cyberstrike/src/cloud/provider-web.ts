import type { DomainProvider, AgentSpec } from "./provider"
import type { Detector } from "../session/web/signal/types"
import { DETECTORS } from "../session/web/signal/detectors"
import { SignalRouter } from "../session/web/signal/router"
import { Skill } from "../skill"

import PROMPT_VULN_COMMON from "../agent/prompt/vuln/common-prompt.txt"
import PROMPT_METHODOLOGY_COMMON from "../agent/prompt/methodology/common-methodology.txt"

import PROMPT_WEB_PROXY_AGENT from "../agent/prompt/orchestrator/web-proxy-agent/prompt.txt"
import DESC_WEB_PROXY_AGENT from "../agent/prompt/orchestrator/web-proxy-agent/description.txt"
import PROMPT_PROXY_ANALYZER from "../agent/prompt/analyzer/proxy-analyzer/prompt.txt"
import DESC_PROXY_ANALYZER from "../agent/prompt/analyzer/proxy-analyzer/description.txt"

import PROMPT_PROXY_TESTER_IDOR from "../agent/prompt/vuln/idor/prompt.txt"
import DESC_PROXY_TESTER_IDOR from "../agent/prompt/vuln/idor/description.txt"
import PROMPT_PROXY_TESTER_AUTHZ from "../agent/prompt/vuln/authz/prompt.txt"
import DESC_PROXY_TESTER_AUTHZ from "../agent/prompt/vuln/authz/description.txt"
import PROMPT_PROXY_TESTER_MASS_ASSIGNMENT from "../agent/prompt/vuln/mass-assignment/prompt.txt"
import DESC_PROXY_TESTER_MASS_ASSIGNMENT from "../agent/prompt/vuln/mass-assignment/description.txt"
import PROMPT_PROXY_TESTER_INJECTION from "../agent/prompt/vuln/injection/prompt.txt"
import DESC_PROXY_TESTER_INJECTION from "../agent/prompt/vuln/injection/description.txt"
import PROMPT_PROXY_TESTER_AUTHN from "../agent/prompt/vuln/authn/prompt.txt"
import DESC_PROXY_TESTER_AUTHN from "../agent/prompt/vuln/authn/description.txt"
import PROMPT_PROXY_TESTER_BUSINESS_LOGIC from "../agent/prompt/vuln/business-logic/prompt.txt"
import DESC_PROXY_TESTER_BUSINESS_LOGIC from "../agent/prompt/vuln/business-logic/description.txt"
import PROMPT_PROXY_TESTER_SSRF from "../agent/prompt/vuln/ssrf/prompt.txt"
import DESC_PROXY_TESTER_SSRF from "../agent/prompt/vuln/ssrf/description.txt"
import PROMPT_PROXY_TESTER_FILE_ATTACKS from "../agent/prompt/vuln/file-attacks/prompt.txt"
import DESC_PROXY_TESTER_FILE_ATTACKS from "../agent/prompt/vuln/file-attacks/description.txt"
import PROMPT_PROXY_TESTER_LLM from "../agent/prompt/vuln/llm/prompt.txt"
import DESC_PROXY_TESTER_LLM from "../agent/prompt/vuln/llm/description.txt"
import PROMPT_PROXY_TESTER_MISCONFIG from "../agent/prompt/vuln/misconfig/prompt.txt"
import DESC_PROXY_TESTER_MISCONFIG from "../agent/prompt/vuln/misconfig/description.txt"
import PROMPT_PROXY_TESTER_RECON from "../agent/prompt/vuln/recon/prompt.txt"
import DESC_PROXY_TESTER_RECON from "../agent/prompt/vuln/recon/description.txt"

type PermissionAction = "ask" | "allow" | "deny"
type PermissionRule = PermissionAction | Record<string, PermissionAction>

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

interface SpecDef {
  name: string
  role: AgentSpec["role"]
  prompt: string
  description: string
  skills: string[]
  permissions: Record<string, PermissionRule>
  steps?: number
  color?: string
  hidden?: boolean
  prependRequestContext?: boolean
  useSmallModel?: boolean
}

export class WebProvider implements DomainProvider {
  key = "web" as const
  private specs: AgentSpec[]

  private constructor(specs: AgentSpec[]) {
    this.specs = specs
  }

  static async create(): Promise<WebProvider> {
    const defs = await buildSpecDefs()
    const specs = defs.map((d) => ({
      name: d.name,
      role: d.role,
      description: (d.description.split("\n")[0] ?? d.description).trim(),
      steps: d.steps ?? 50,
      color: d.color ?? "cyan",
      prompt: d.prompt,
      skills: d.skills,
      permissions: d.permissions,
      hidden: d.hidden,
      prependRequestContext: d.prependRequestContext,
      useSmallModel: d.useSmallModel,
    }))
    return new WebProvider(specs)
  }

  agentSpecs(): AgentSpec[] {
    return this.specs
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
      name: "proxy-agent",
      role: "orchestrator",
      prompt: `${PROMPT_METHODOLOGY_COMMON}\n\n---\n\n${PROMPT_WEB_PROXY_AGENT}`,
      description: DESC_WEB_PROXY_AGENT,
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
      name: "proxy-analyzer",
      role: "analyzer",
      prompt: PROMPT_PROXY_ANALYZER,
      description: DESC_PROXY_ANALYZER,
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
      name: "proxy-tester-idor",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_IDOR, idorSkills),
      description: DESC_PROXY_TESTER_IDOR,
      skills: ["wstg-authz-04", "wstg-apit-02"],
      prependRequestContext: true,
      permissions: VULN_BASE_PERMISSIONS,
    },
    {
      name: "proxy-tester-authz",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_AUTHZ, authzSkills),
      description: DESC_PROXY_TESTER_AUTHZ,
      skills: ["wstg-authz-02", "wstg-authz-03", "wstg-authz-01"],
      prependRequestContext: true,
      permissions: VULN_BASE_PERMISSIONS,
    },
    {
      name: "proxy-tester-mass-assignment",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_MASS_ASSIGNMENT, massAssignmentSkills),
      description: DESC_PROXY_TESTER_MASS_ASSIGNMENT,
      skills: ["wstg-inpv-20", "wstg-busl-02"],
      prependRequestContext: true,
      permissions: VULN_BASE_PERMISSIONS,
    },
    {
      name: "proxy-tester-injection",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_INJECTION, injectionSkills),
      description: DESC_PROXY_TESTER_INJECTION,
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
      name: "proxy-tester-authn",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_AUTHN, authnSkills),
      description: DESC_PROXY_TESTER_AUTHN,
      skills: ["wstg-auth-session", "wstg-athn-04", "wstg-athn-09", "wstg-athn-11", "wstg-sess-10"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { authn_test: "allow" }),
    },
    {
      name: "proxy-tester-business-logic",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_BUSINESS_LOGIC, businessLogicSkills),
      description: DESC_PROXY_TESTER_BUSINESS_LOGIC,
      skills: ["wstg-logic-client-api", "wstg-busl-04", "wstg-busl-10"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { business_test: "allow" }),
    },
    {
      name: "proxy-tester-ssrf",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_SSRF, ssrfSkills),
      description: DESC_PROXY_TESTER_SSRF,
      skills: ["wstg-inpv-19", "wstg-conf-13"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { ssrf_test: "allow" }),
    },
    {
      name: "proxy-tester-file-attacks",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_FILE_ATTACKS, fileAttacksSkills),
      description: DESC_PROXY_TESTER_FILE_ATTACKS,
      skills: ["wstg-inpv-11.1", "wstg-inpv-11", "wstg-busl-08", "wstg-busl-09"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { inject_probe: "allow" }),
    },
    {
      name: "proxy-tester-llm",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_LLM, llmSkills),
      description: DESC_PROXY_TESTER_LLM,
      skills: ["llm-security"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { llmhook: "allow" }),
    },
    {
      name: "proxy-tester-misconfig",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_MISCONFIG, misconfigSkills),
      description: DESC_PROXY_TESTER_MISCONFIG,
      skills: ["wstg-conf-01", "wstg-conf-02", "wstg-conf-03", "wstg-conf-04", "wstg-conf-05", "wstg-conf-06", "wstg-conf-07", "wstg-conf-08", "wstg-conf-09", "wstg-conf-10", "wstg-conf-11", "wstg-cryp-01"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { misconfig_test: "allow" }),
    },
    {
      name: "proxy-tester-recon",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_PROXY_TESTER_RECON, reconSkills),
      description: DESC_PROXY_TESTER_RECON,
      skills: ["wstg-info-02", "wstg-info-03", "wstg-info-05", "wstg-info-08"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { recon_test: "allow" }),
    },
  ]
}
