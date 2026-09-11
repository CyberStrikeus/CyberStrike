// @cyberstrike-io/web — Web Application assessment domain provider.
//
// Ported out of the host (packages/cyberstrike/src/cloud/provider-web.ts) so the web
// domain ships as a self-contained package, exactly like @cyberstrike-io/azure. The
// package reaches core runtime only through the host-injected `input.core` (see
// index.ts) and the `@cyberstrike-io/plugin` contract — it never imports the host,
// so it works inside the compiled binary.
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

import PROMPT_WEB_HUNT_AGENT from "./prompts/orchestrator/web-hunt-agent/prompt.txt"
import DESC_WEB_HUNT_AGENT from "./prompts/orchestrator/web-hunt-agent/description.txt"
import PROMPT_HUNT_ANALYZER from "./prompts/analyzer/hunt-analyzer/prompt.txt"
import DESC_HUNT_ANALYZER from "./prompts/analyzer/hunt-analyzer/description.txt"

import PROMPT_HUNT_TESTER_IDOR from "./prompts/vuln/idor/prompt.txt"
import DESC_HUNT_TESTER_IDOR from "./prompts/vuln/idor/description.txt"
import PROMPT_HUNT_TESTER_AUTHZ from "./prompts/vuln/authz/prompt.txt"
import DESC_HUNT_TESTER_AUTHZ from "./prompts/vuln/authz/description.txt"
import PROMPT_HUNT_TESTER_MASS_ASSIGNMENT from "./prompts/vuln/mass-assignment/prompt.txt"
import DESC_HUNT_TESTER_MASS_ASSIGNMENT from "./prompts/vuln/mass-assignment/description.txt"
import PROMPT_HUNT_TESTER_INJECTION from "./prompts/vuln/injection/prompt.txt"
import DESC_HUNT_TESTER_INJECTION from "./prompts/vuln/injection/description.txt"
import PROMPT_HUNT_TESTER_AUTHN from "./prompts/vuln/authn/prompt.txt"
import DESC_HUNT_TESTER_AUTHN from "./prompts/vuln/authn/description.txt"
import PROMPT_HUNT_TESTER_BUSINESS_LOGIC from "./prompts/vuln/business-logic/prompt.txt"
import DESC_HUNT_TESTER_BUSINESS_LOGIC from "./prompts/vuln/business-logic/description.txt"
import PROMPT_HUNT_TESTER_SSRF from "./prompts/vuln/ssrf/prompt.txt"
import DESC_HUNT_TESTER_SSRF from "./prompts/vuln/ssrf/description.txt"
import PROMPT_HUNT_TESTER_FILE_ATTACKS from "./prompts/vuln/file-attacks/prompt.txt"
import DESC_HUNT_TESTER_FILE_ATTACKS from "./prompts/vuln/file-attacks/description.txt"
import PROMPT_HUNT_TESTER_LLM from "./prompts/vuln/llm/prompt.txt"
import DESC_HUNT_TESTER_LLM from "./prompts/vuln/llm/description.txt"
import PROMPT_HUNT_TESTER_MISCONFIG from "./prompts/vuln/misconfig/prompt.txt"
import DESC_HUNT_TESTER_MISCONFIG from "./prompts/vuln/misconfig/description.txt"
import PROMPT_WEB_INPUT_VALIDATION from "./prompts/vuln/web-input-validation/prompt.txt"
import DESC_WEB_INPUT_VALIDATION from "./prompts/vuln/web-input-validation/description.txt"
import PROMPT_WEB_AUTHORIZATION from "./prompts/vuln/web-authorization/prompt.txt"
import DESC_WEB_AUTHORIZATION from "./prompts/vuln/web-authorization/description.txt"
import PROMPT_WEB_AUTHENTICATION from "./prompts/vuln/web-authentication/prompt.txt"
import DESC_WEB_AUTHENTICATION from "./prompts/vuln/web-authentication/description.txt"
import PROMPT_WEB_SESSION_MGMT from "./prompts/vuln/web-session-mgmt/prompt.txt"
import DESC_WEB_SESSION_MGMT from "./prompts/vuln/web-session-mgmt/description.txt"

// WSTG 4.7 Input Validation, Vortex-native. When enabled, the `input-validation` SpecialistClass is
// owned by the `web-input-validation` specialist (all of WSTG 4.7: injection/SSRF/file/mass-assignment
// …) instead of hunt-injection, which then cedes the class. Opt-in and removable during the WSTG
// agent build-out: unset the env var to restore the legacy hunt-injection path, and pair with
// CYBERSTRIKE_WEB_FOCUS=web-input-validation to run it in isolation. CYBERSTRIKE_VORTEX_INJECTION is
// accepted as the superseded alias for continuity.
const WEB_INPUT_VALIDATION =
  process.env.CYBERSTRIKE_WEB_INPUT_VALIDATION === "1" ||
  process.env.CYBERSTRIKE_WEB_INPUT_VALIDATION === "true" ||
  process.env.CYBERSTRIKE_VORTEX_INJECTION === "1" ||
  process.env.CYBERSTRIKE_VORTEX_INJECTION === "true"

// WSTG 4.5 Authorization, Vortex-native. When enabled, web-authorization owns the `authorization` class
// (IDOR/BOLA, BFLA, privesc, schema-bypass, OAuth) instead of hunt-authz, which cedes. Opt-in during the
// WSTG agent build-out: unset to restore hunt-authz; pair with CYBERSTRIKE_WEB_FOCUS=web-authorization
// to run it in isolation.
const WEB_AUTHORIZATION =
  process.env.CYBERSTRIKE_WEB_AUTHORIZATION === "1" || process.env.CYBERSTRIKE_WEB_AUTHORIZATION === "true"

// WSTG 4.4 Authentication, Vortex-native. When enabled, web-authentication owns the `authentication`
// class (credential transport, default creds, lockout, auth-schema bypass, JWT weaknesses, reset flows)
// instead of hunt-authn, which cedes. Opt-in during the WSTG build-out.
const WEB_AUTHENTICATION =
  process.env.CYBERSTRIKE_WEB_AUTHENTICATION === "1" || process.env.CYBERSTRIKE_WEB_AUTHENTICATION === "true"

// WSTG 4.6 Session Management, Vortex-native. A NEW class (no hunt-* owned it — auth-session's session
// half): web-session-mgmt owns it (cookie attrs, fixation, CSRF, logout, timeout, hijacking) when
// enabled. Opt-in.
const WEB_SESSION_MGMT =
  process.env.CYBERSTRIKE_WEB_SESSION_MGMT === "1" || process.env.CYBERSTRIKE_WEB_SESSION_MGMT === "true"

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

// A specialist def may declare the SpecialistClass it OWNS — the class the retest pipeline routes to
// (`input-validation` → web-input-validation). This is the single code bridge between the signal class
// taxonomy and the agent names; the orchestrator's routing table is rendered FROM it, never hand-kept.
// The class is a plain string here (not the host's SpecialistClass union) so the package stays
// host-dependency-free — the host validates the names against its own taxonomy.
type SpecDef = Omit<AgentSpec, "steps" | "color" | "group"> & {
  steps?: number
  color?: string
  specialistClass?: string
}

/**
 * Build the SpecialistClass → agent-name map from the specs. This is the ONLY source of truth for
 * "which agent confirms a given signal class". Throws if two agents claim the same class (an ambiguous
 * owner is a config bug, not a runtime guess).
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

// Placeholder the orchestrator prompt carries where the SpecialistClass → agent retest-routing table
// belongs. Replaced at assembly time with the rendered table so the prompt never hand-restates a mapping
// that lives in code. The constructor throws if the orchestrator prompt lost this token.
export const SIGNAL_ROUTING_PLACEHOLDER = "{{SIGNAL_ROUTING_TABLE}}"

// Placeholder for the roster of dispatchable subagents. Rendered from each agent's own description so
// adding/removing a sub-agent updates the orchestrator's roster automatically instead of drifting.
export const AGENT_ROSTER_PLACEHOLDER = "{{AGENT_ROSTER}}"

/**
 * Render the orchestrator's roster of dispatchable subagents FROM the specs — the analyzer under
 * "Architecture Analysis", the specialists under "Vulnerability Testing Agents". Each entry is the
 * agent's own `description` (single source). The orchestrator itself + hidden non-roster roles excluded.
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
 * Render the new_signal retest routing table (SpecialistClass → agent) for the orchestrator prompt,
 * FROM the class→agent map the specs declare — not hand-written prose, and not the retiring SignalRouter.
 * Every owned class has an agent by construction (buildClassAgentMap), so no coverage assertion is needed
 * here; Vortex-side signal-category coverage is validated in the host, against the Vortex routing layer.
 */
export function renderSignalRoutingTable(classAgent: ReadonlyMap<string, string>): string {
  const rows: string[] = []
  for (const [owner, agent] of classAgent) {
    rows.push(`| \`${owner}\` | ${agent} |`)
  }
  return ["| Specialist class | Agent name |", "|-----------------|------------|", ...rows].join("\n")
}

/**
 * Replace one placeholder token in the orchestrator prompt. Throws if the token is missing — a prompt
 * edit that drops it would silently ship an orchestrator with a missing section (no retest routing, no
 * roster), so we fail loud at assembly.
 */
function injectPlaceholder(agentName: string, prompt: string, token: string, value: string): string {
  if (!prompt.includes(token)) {
    throw new Error(
      `WebProvider: orchestrator "${agentName}" prompt is missing the ${token} placeholder — cannot compose it from code.`,
    )
  }
  return prompt.replace(token, value)
}

// Debug/observation focus mode. Set CYBERSTRIKE_WEB_FOCUS to a comma-separated list of specialist
// short-names (e.g. "idor,authz") to TEMPORARILY enable only those specialists — the orchestrator
// (hunt-agent) and analyzer (hunt-analyzer) are always kept, since they are the dispatch backbone and the
// object/context extraction the testers rely on. Names match with or without the "hunt-" prefix.
function focusSet(): Set<string> | null {
  const raw = process.env.CYBERSTRIKE_WEB_FOCUS
  if (!raw || !raw.trim()) return null
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/^hunt-/, ""))
      .filter(Boolean),
  )
  return set.size > 0 ? set : null
}

function vulnPrompt(prompt: string): string {
  // Skills are no longer baked in (see file header): the common methodology preamble wraps the
  // specialist body, and each spec's `skills:[]` names the WSTG packs the agent loads at runtime.
  return `${PROMPT_VULN_COMMON}\n\n---\n\n${prompt}`
}

function buildSpecDefs(): SpecDef[] {
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
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_IDOR),
      description: DESC_HUNT_TESTER_IDOR,
      skills: ["wstg-authz-04", "wstg-apit-02"],
      prependRequestContext: true,
      permissions: VULN_BASE_PERMISSIONS,
    },
    {
      name: "hunt-authz",
      role: "specialist",
      // web-authorization (WSTG 4.5) owns the class when enabled; hunt-authz then cedes but stays in
      // the roster, so retest-worker's agentForClass("authorization") dispatches the Vortex specialist.
      specialistClass: WEB_AUTHORIZATION ? undefined : "authorization",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_AUTHZ),
      description: DESC_HUNT_TESTER_AUTHZ,
      skills: ["wstg-authz-02", "wstg-authz-03", "wstg-authz-01"],
      prependRequestContext: true,
      permissions: VULN_BASE_PERMISSIONS,
    },
    {
      name: "hunt-mass-assignment",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_MASS_ASSIGNMENT),
      description: DESC_HUNT_TESTER_MASS_ASSIGNMENT,
      skills: ["wstg-inpv-20", "wstg-busl-02"],
      prependRequestContext: true,
      permissions: VULN_BASE_PERMISSIONS,
    },
    {
      name: "hunt-injection",
      role: "specialist",
      // When the WSTG input-validation specialist is enabled it owns the class (WSTG 4.7); hunt-injection
      // stays in the roster but cedes ownership, so retest-worker's agentForClass("input-validation")
      // dispatches web-input-validation. Otherwise hunt-injection remains the input-validation owner.
      specialistClass: WEB_INPUT_VALIDATION ? undefined : "input-validation",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_INJECTION),
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
    // WSTG 4.7 Input Validation specialist (Vortex-native) — the single agent for injection, SSRF,
    // file upload, mass assignment, path traversal, etc. Joins the roster and owns the class only when
    // WEB_INPUT_VALIDATION is enabled; hunt-injection then cedes. Reads Vortex's pre-computed leads +
    // inject-point inventory, actively probes (vortex_probe + inject_probe), confirms with http_replay.
    ...(WEB_INPUT_VALIDATION
      ? [
          {
            name: "web-input-validation",
            role: "specialist" as const,
            specialistClass: "input-validation",
            prompt: vulnPrompt(PROMPT_WEB_INPUT_VALIDATION),
            description: DESC_WEB_INPUT_VALIDATION,
            skills: ["wstg-injection", "wstg-inpv-05", "wstg-inpv-12", "wstg-inpv-18", "wstg-inpv-19", "wstg-inpv-11"],
            prependRequestContext: true,
            permissions: mergePermissions(VULN_BASE_PERMISSIONS, {
              vortex_leads: "allow",
              vortex_inspect: "allow",
              vortex_query: "allow",
              vortex_objects: "allow",
              vortex_functions: "allow",
              vortex_cross_role: "allow",
              vortex_where_value: "allow",
              vortex_untested: "allow",
              // Full parameter inventory + coverage — the coverage-contract denominator (see prompt.txt).
              vortex_inject_points: "allow",
              // Active probing, VORTEX-NATIVE: where the deterministic auto-probe skipped a point, the
              // agent probes it itself with Vortex's own prober. vortex_probe RETURNS its findings and
              // does NOT write to Vortex.
              vortex_probe: "allow",
              // The richer per-class probe battery for classes vortex_probe doesn't cover natively
              // (command, LDAP, XPath, NoSQL, HPP, LFI). Read-only detection — hands the agent leads.
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
          } satisfies SpecDef,
        ]
      : []),
    // WSTG 4.5 Authorization specialist (Vortex-native) — reads the deterministic cross-identity leads
    // and confirms with credential-swap replays. Read-only over Vortex (read facade + http_replay only).
    // Joins + owns the class only when WEB_AUTHORIZATION is enabled.
    ...(WEB_AUTHORIZATION
      ? [
          {
            name: "web-authorization",
            role: "specialist" as const,
            specialistClass: "authorization",
            prompt: vulnPrompt(PROMPT_WEB_AUTHORIZATION),
            description: DESC_WEB_AUTHORIZATION,
            skills: ["wstg-authz-01", "wstg-authz-02", "wstg-authz-03", "wstg-authz-04", "wstg-apit-02"],
            prependRequestContext: true,
            permissions: mergePermissions(VULN_BASE_PERMISSIONS, {
              vortex_leads: "allow",
              vortex_inspect: "allow",
              vortex_query: "allow",
              vortex_objects: "allow",
              vortex_functions: "allow",
              vortex_cross_role: "allow",
              vortex_where_value: "allow",
              vortex_untested: "allow",
            }),
          } satisfies SpecDef,
        ]
      : []),
    // WSTG 4.4 Authentication specialist (Vortex-native) — maps the auth surface from Vortex leads and
    // confirms with crafted http_replay (token strip/forge, transport downgrade, default creds, JWT
    // tamper, lockout). Read-only over Vortex (read facade + http_replay; no probe). Owns the class
    // only when WEB_AUTHENTICATION is enabled.
    ...(WEB_AUTHENTICATION
      ? [
          {
            name: "web-authentication",
            role: "specialist" as const,
            specialistClass: "authentication",
            prompt: vulnPrompt(PROMPT_WEB_AUTHENTICATION),
            description: DESC_WEB_AUTHENTICATION,
            skills: ["wstg-auth-session", "wstg-athn-04", "wstg-athn-09", "wstg-athn-11", "wstg-sess-10"],
            prependRequestContext: true,
            permissions: mergePermissions(VULN_BASE_PERMISSIONS, {
              vortex_leads: "allow",
              vortex_inspect: "allow",
              vortex_query: "allow",
              vortex_objects: "allow",
              vortex_functions: "allow",
              vortex_where_value: "allow",
              vortex_untested: "allow",
              // JWT/bearer forgery engine (alg:none, weak-secret, RS256→HS256, role/id swap) — the
              // concrete weapon behind the prompt's JWT sub-test. Sends forged variants with a no-token
              // negative control; hands the agent leads, never a verdict.
              authn_test: "allow",
              // Default-credential spray + weak-lockout probe (WSTG 4.4.2 / 4.4.3) — embedded common-cred
              // battery against the login form, plus an N-failure lockout/throttle observation.
              login_probe: "allow",
            }),
          } satisfies SpecDef,
        ]
      : []),
    // WSTG 4.6 Session Management specialist (Vortex-native) — the session half of the old auth-session
    // split. Reads session leads + inspects the cookie/session lifecycle and confirms with reuse/craft
    // replays (fixation, logout, CSRF via csrf_extract, hijacking). Read-only over Vortex (read facade +
    // http_replay + csrf_extract). NEW class: owns session-management only when WEB_SESSION_MGMT is on.
    ...(WEB_SESSION_MGMT
      ? [
          {
            name: "web-session-mgmt",
            role: "specialist" as const,
            specialistClass: "session-management",
            prompt: vulnPrompt(PROMPT_WEB_SESSION_MGMT),
            description: DESC_WEB_SESSION_MGMT,
            skills: ["wstg-sess-10", "wstg-auth-session"],
            prependRequestContext: true,
            permissions: mergePermissions(VULN_BASE_PERMISSIONS, {
              vortex_leads: "allow",
              vortex_inspect: "allow",
              vortex_query: "allow",
              vortex_objects: "allow",
              vortex_functions: "allow",
              vortex_where_value: "allow",
              vortex_untested: "allow",
            }),
          } satisfies SpecDef,
        ]
      : []),
    {
      name: "hunt-authn",
      role: "specialist",
      // auth-session split into WSTG 4.4 (authentication) + 4.6 (session-management). hunt-authn owns
      // authentication until web-authentication is enabled (then it cedes); session-management stays
      // pending until web-session-mgmt is built.
      specialistClass: WEB_AUTHENTICATION ? undefined : "authentication",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_AUTHN),
      description: DESC_HUNT_TESTER_AUTHN,
      skills: ["wstg-auth-session", "wstg-athn-04", "wstg-athn-09", "wstg-athn-11", "wstg-sess-10"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { authn_test: "allow" }),
    },
    {
      name: "hunt-business-logic",
      role: "specialist",
      specialistClass: "business-logic",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_BUSINESS_LOGIC),
      description: DESC_HUNT_TESTER_BUSINESS_LOGIC,
      skills: ["wstg-logic-client-api", "wstg-busl-04", "wstg-busl-10"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { business_test: "allow" }),
    },
    {
      name: "hunt-ssrf",
      role: "specialist",
      // SSRF folds into WSTG 4.7 input-validation (owned by web-input-validation); hunt-ssrf stays in
      // the roster as a dispatch-by-name specialist but no longer owns a routed class.
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_SSRF),
      description: DESC_HUNT_TESTER_SSRF,
      skills: ["wstg-inpv-19", "wstg-conf-13"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { ssrf_test: "allow" }),
    },
    {
      name: "hunt-file-attacks",
      role: "specialist",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_FILE_ATTACKS),
      description: DESC_HUNT_TESTER_FILE_ATTACKS,
      skills: ["wstg-inpv-11.1", "wstg-inpv-11", "wstg-busl-08", "wstg-busl-09"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { inject_probe: "allow" }),
    },
    {
      name: "hunt-llm",
      role: "specialist",
      specialistClass: "llm",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_LLM),
      description: DESC_HUNT_TESTER_LLM,
      skills: ["llm-security"],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { llmhook: "allow" }),
    },
    {
      // Merged Security-Misconfiguration specialist: origin-wide config testing (paths, methods,
      // CORS, security headers) AND reconnaissance (metafile parsing, tech fingerprinting, info
      // leakage). One agent owns everything origin-level — recon feeds config testing on the same pass.
      name: "hunt-misconfig",
      role: "specialist",
      // WSTG 4.2 Configuration & Deployment Management; owns config-deployment until the dedicated
      // web-config-deploy specialist is built.
      specialistClass: "config-deployment",
      prompt: vulnPrompt(PROMPT_HUNT_TESTER_MISCONFIG),
      description: DESC_HUNT_TESTER_MISCONFIG,
      skills: [
        "wstg-conf-01", "wstg-conf-02", "wstg-conf-03", "wstg-conf-04", "wstg-conf-05", "wstg-conf-06",
        "wstg-conf-07", "wstg-conf-08", "wstg-conf-09", "wstg-conf-10", "wstg-conf-11", "wstg-cryp-01",
        "wstg-info-02", "wstg-info-03", "wstg-info-05", "wstg-info-08",
      ],
      prependRequestContext: true,
      permissions: mergePermissions(VULN_BASE_PERMISSIONS, { misconfig_test: "allow", recon_test: "allow" }),
    },
  ]
}

export class WebProvider implements DomainProvider {
  readonly key = "web"
  private readonly specs: AgentSpec[]
  private readonly classAgent: ReadonlyMap<string, string>

  constructor() {
    let defs = buildSpecDefs()
    // Focus mode (debug): keep only the orchestrator, analyzer, and the named specialists.
    const focus = focusSet()
    if (focus) {
      const short = (n: string) => n.replace(/^hunt-/, "").toLowerCase()
      defs = defs.filter((d) => d.role === "orchestrator" || d.role === "analyzer" || focus.has(short(d.name)))
      console.warn(
        `[web-provider] CYBERSTRIKE_WEB_FOCUS active — reduced roster: ${defs.map((d) => d.name).join(", ")}`,
      )
    }
    const classAgent = buildClassAgentMap(defs)
    const routingTable = renderSignalRoutingTable(classAgent)

    // Normalize descriptions first: spec.description AND the rendered roster both read the same trimmed
    // one-liner, so they can never disagree.
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

  /** DomainProvider contract: class → agent as a portable plain map, so retest routing travels WITH the
   *  domain package. The host's deterministic retest pipeline dispatches a class-C signal to this[C]. */
  specialistClasses(): Record<string, string> {
    return Object.fromEntries(this.classAgent)
  }
}
