import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_WEB_APPLICATION from "./prompt/web-application.txt"
import PROMPT_CLOUD_SECURITY from "./prompt/cloud-security.txt"
import PROMPT_INTERNAL_NETWORK from "./prompt/internal-network.txt"
import PROMPT_MOBILE_APPLICATION from "./prompt/mobile-application.txt"
import PROMPT_NORMALIZE_REQUEST from "./prompt/normalize-request.txt"
import PROMPT_CYBERSTRIKE from "./prompt/cyberstrike.txt"
import PROMPT_GENERAL from "./prompt/general.txt"

// New folder-based agent imports
import PROMPT_VULN_COMMON from "./prompt/vuln/common-prompt.txt"
import PROMPT_WEB_PROXY_AGENT from "./prompt/orchestrator/web-proxy-agent/prompt.txt"
import DESC_WEB_PROXY_AGENT from "./prompt/orchestrator/web-proxy-agent/description.txt"
import PROMPT_PROXY_ANALYZER from "./prompt/analyzer/proxy-analyzer/prompt.txt"
import DESC_PROXY_ANALYZER from "./prompt/analyzer/proxy-analyzer/description.txt"
import PROMPT_PROXY_TESTER_IDOR from "./prompt/vuln/idor/prompt.txt"
import DESC_PROXY_TESTER_IDOR from "./prompt/vuln/idor/description.txt"
import PROMPT_PROXY_TESTER_AUTHZ from "./prompt/vuln/authz/prompt.txt"
import DESC_PROXY_TESTER_AUTHZ from "./prompt/vuln/authz/description.txt"
import PROMPT_PROXY_TESTER_MASS_ASSIGNMENT from "./prompt/vuln/mass-assignment/prompt.txt"
import DESC_PROXY_TESTER_MASS_ASSIGNMENT from "./prompt/vuln/mass-assignment/description.txt"
import PROMPT_PROXY_TESTER_INJECTION from "./prompt/vuln/injection/prompt.txt"
import DESC_PROXY_TESTER_INJECTION from "./prompt/vuln/injection/description.txt"
import PROMPT_PROXY_TESTER_AUTHN from "./prompt/vuln/authn/prompt.txt"
import DESC_PROXY_TESTER_AUTHN from "./prompt/vuln/authn/description.txt"
import PROMPT_PROXY_TESTER_BUSINESS_LOGIC from "./prompt/vuln/business-logic/prompt.txt"
import DESC_PROXY_TESTER_BUSINESS_LOGIC from "./prompt/vuln/business-logic/description.txt"
import PROMPT_PROXY_TESTER_SSRF from "./prompt/vuln/ssrf/prompt.txt"
import DESC_PROXY_TESTER_SSRF from "./prompt/vuln/ssrf/description.txt"
import PROMPT_PROXY_TESTER_FILE_ATTACKS from "./prompt/vuln/file-attacks/prompt.txt"
import DESC_PROXY_TESTER_FILE_ATTACKS from "./prompt/vuln/file-attacks/description.txt"

import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"

// ============================================================================
// Static skill injection for vulnerability testing sub-agents
//
// Vuln tester sub-agents do not have access to the `skill` tool (their
// permission is `*: deny` with a small allowlist). To give them the
// methodology they need without runtime tool calls, we statically embed
// WSTG skill content via `Skill.get()` into each agent's prompt at startup.
// ============================================================================

// Strip defensive sections (Remediation, Risk Assessment, CWE Categories,
// References, Checklist) from skill content. Vuln testers are offensive —
// they only need attack techniques, not fix recommendations.
// Note: YAML frontmatter is already stripped by Skill.get() (.content field).
function stripDefensiveSections(content: string): string {
  if (!content) return ""
  let result = content
  for (const heading of ["Remediation", "Risk Assessment", "CWE Categories", "References", "Checklist"]) {
    const re = new RegExp(`(^|\\n)## ${heading}[\\s\\S]*?(?=\\n## (?!${heading})|$)`, "g")
    result = result.replace(re, "")
  }
  return result.trim()
}

// Helper function to load vulnerability agent with common prompt prepended
// and (optionally) statically-embedded WSTG skill content.
async function loadVulnAgent(
  prompt: string,
  description: string,
  skillNames: string[] = [],
): Promise<{ prompt: string; description: string }> {
  // First line of description for agent.ts, full description for future use
  const shortDesc = description.split("\n")[0].trim()

  const skills = await Promise.all(skillNames.map((name) => Skill.get(name)))
  const skillBlocks: string[] = []
  for (let i = 0; i < skillNames.length; i++) {
    const skill = skills[i]
    if (!skill) continue
    const content = stripDefensiveSections(skill.content)
    if (content) skillBlocks.push(`<skill name="${skillNames[i]}">\n${content}\n</skill>`)
  }

  const skillSection =
    skillBlocks.length > 0
      ? [
          "",
          "",
          "## Embedded Skill References",
          "",
          "Authoritative WSTG testing methodology for your specialty is statically embedded below.",
          "Use these payloads, patterns, and procedures during testing.",
          "",
          skillBlocks.join("\n\n"),
        ].join("\n")
      : ""

  // Prepend common vulnerability testing instructions to agent-specific prompt
  const fullPrompt = `${PROMPT_VULN_COMMON}\n\n---\n\n${prompt}${skillSection}`
  return { prompt: fullPrompt, description: shortDesc }
}

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      variant: z.string().optional(),
      prompt: z.string().optional(),
      skills: z.array(z.string()).optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
      prependRequestContext: z.boolean().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    // Use lightweight dirsOnly() to avoid triggering full skill indexing (4.3s → ~500ms)
    const skillDirs = await Skill.dirsOnly()
    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      doom_loop: "ask",
      external_directory: {
        "*": "ask",
        [Truncate.GLOB]: "allow",
        ...Object.fromEntries(skillDirs.map((dir) => [path.join(dir, "*"), "allow"])),
      },
      question: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    const result: Record<string, Info> = {
      cyberstrike: {
        name: "cyberstrike",
        description: "The default CyberStrike agent. AI-powered offensive security with full tool access.",
        prompt: PROMPT_CYBERSTRIKE,
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        prompt: PROMPT_GENERAL,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
            report_vulnerability: "deny",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      explore: {
        name: "explore",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            read: "allow",
            external_directory: {
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        prompt: PROMPT_EXPLORE,
        options: {},
        mode: "subagent",
        native: true,
      },
      compaction: {
        name: "compaction",
        mode: "subagent",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        options: {},
      },
      title: {
        name: "title",
        mode: "subagent",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_TITLE,
      },
      "normalize-request": {
        name: "normalize-request",
        mode: "subagent",
        options: {},
        native: true,
        hidden: true,
        temperature: 0,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_NORMALIZE_REQUEST,
      },
      summary: {
        name: "summary",
        mode: "subagent",
        options: {},
        native: true,
        hidden: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_SUMMARY,
      },
      "web-application": {
        name: "web-application",
        description: "Web application security specialist. OWASP Top 10, WSTG methodology, API security testing.",
        mode: "subagent",
        native: true,
        color: "red",
        prompt: PROMPT_WEB_APPLICATION,
        skills: ["wstg-recon-config", "wstg-auth-session", "wstg-injection", "wstg-logic-client-api"],
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            bash: "allow",
            browser: "allow",
            read: "allow",
            glob: "allow",
            grep: "allow",
            webfetch: "allow",
            websearch: "allow",
            report_vulnerability: "allow",
          }),
          user,
        ),
        options: {},
      },
      "mobile-application": {
        name: "mobile-application",
        description:
          "Mobile application security specialist. Android/iOS testing, OWASP MASTG/MASVS, static/dynamic analysis, Frida/Objection.",
        mode: "subagent",
        native: true,
        color: "magenta",
        prompt: PROMPT_MOBILE_APPLICATION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            bash: "allow",
            browser: "allow",
            read: "allow",
            glob: "allow",
            grep: "allow",
            report_vulnerability: "allow",
          }),
          user,
        ),
        options: {},
      },
      "cloud-security": {
        name: "cloud-security",
        description: "Cloud security specialist. AWS, Azure, GCP security testing. IAM, CIS benchmarks.",
        mode: "subagent",
        native: true,
        color: "cyan",
        prompt: PROMPT_CLOUD_SECURITY,
        skills: [
          "cis-aws-foundations-2.1.1",
          "cis-aws-foundations-2.2",
          "cis-aws-foundations-3.1.1",
          "cis-aws-foundations-4.1",
          "cis-aws-foundations-5.1",
          "cis-aws-foundations-6.2",
        ],
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            bash: "allow",
            browser: "allow",
            read: "allow",
            glob: "allow",
            grep: "allow",
            report_vulnerability: "allow",
          }),
          user,
        ),
        options: {},
      },
      "internal-network": {
        name: "internal-network",
        description: "Internal network and Active Directory specialist. AD attacks, Kerberos, lateral movement.",
        mode: "subagent",
        native: true,
        color: "yellow",
        prompt: PROMPT_INTERNAL_NETWORK,
        skills: ["ad-security", "kerberos-attacks"],
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            bash: "allow",
            browser: "allow",
            read: "allow",
            glob: "allow",
            grep: "allow",
            report_vulnerability: "allow",
          }),
          user,
        ),
        options: {},
      },
      "proxy-agent": {
        name: "proxy-agent",
        description: DESC_WEB_PROXY_AGENT.split("\n")[0].trim(),
        mode: "subagent",
        native: true,
        color: "blue",
        prompt: PROMPT_WEB_PROXY_AGENT,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            web_get_session_context: "allow",
            // proxy-agent is a pure orchestrator - it only reads session context
            // and delegates to subagents. Writing is done by proxy-analyzer.
          }),
          user,
        ),
        options: {},
      },
      // Proxy Agent SubAgents
      "proxy-analyzer": {
        name: "proxy-analyzer",
        description: DESC_PROXY_ANALYZER.split("\n")[0].trim(),
        mode: "subagent",
        native: true,
        hidden: true,
        prompt: PROMPT_PROXY_ANALYZER,
        prependRequestContext: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            bash: "allow",
            webfetch: "allow",
            web_get_session_context: "allow",
            web_get_request_detail: "allow",
            web_write_role: "allow",
            web_write_object: "allow",
            web_write_object_value: "allow",
            web_write_function: "allow",
            web_update_credential_claims: "allow",
          }),
          user,
        ),
        options: {},
      },
      ...(await (async () => {
        const [
          idorAgent,
          authzAgent,
          massAssignmentAgent,
          injectionAgent,
          authnAgent,
          businessLogicAgent,
          ssrfAgent,
          fileAttacksAgent,
        ] = await Promise.all([
          loadVulnAgent(PROMPT_PROXY_TESTER_IDOR, DESC_PROXY_TESTER_IDOR, ["wstg-authz-04", "wstg-apit-02"]),
          loadVulnAgent(PROMPT_PROXY_TESTER_AUTHZ, DESC_PROXY_TESTER_AUTHZ, [
            "wstg-authz-02",
            "wstg-authz-03",
            "wstg-authz-01",
          ]),
          loadVulnAgent(PROMPT_PROXY_TESTER_MASS_ASSIGNMENT, DESC_PROXY_TESTER_MASS_ASSIGNMENT, [
            "wstg-inpv-20",
            "wstg-busl-02",
          ]),
          loadVulnAgent(PROMPT_PROXY_TESTER_INJECTION, DESC_PROXY_TESTER_INJECTION, [
            "wstg-injection",
            "wstg-inpv-05",
            "wstg-inpv-12",
            "wstg-inpv-18",
          ]),
          loadVulnAgent(PROMPT_PROXY_TESTER_AUTHN, DESC_PROXY_TESTER_AUTHN, [
            "wstg-auth-session",
            "wstg-athn-04",
            "wstg-athn-09",
            "wstg-athn-11",
            "wstg-sess-10",
          ]),
          loadVulnAgent(PROMPT_PROXY_TESTER_BUSINESS_LOGIC, DESC_PROXY_TESTER_BUSINESS_LOGIC, [
            "wstg-logic-client-api",
            "wstg-busl-04",
            "wstg-busl-10",
          ]),
          loadVulnAgent(PROMPT_PROXY_TESTER_SSRF, DESC_PROXY_TESTER_SSRF, ["wstg-inpv-19", "wstg-conf-13"]),
          loadVulnAgent(PROMPT_PROXY_TESTER_FILE_ATTACKS, DESC_PROXY_TESTER_FILE_ATTACKS, [
            "wstg-inpv-11.1",
            "wstg-inpv-11",
            "wstg-busl-08",
            "wstg-busl-09",
          ]),
        ])

        const vulnAgentPermission = PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            bash: "allow",
            webfetch: "allow",
            web_get_session_context: "allow",
            web_get_request_detail: "allow",
            report_vulnerability: "allow",
          }),
          user,
        )

        // Injection-specific permission: blocks destructive SQL payloads and
        // RCE primitives that the injection agent might otherwise execute via
        // bash (curl, sqlmap, etc.). Defense-in-depth alongside prompt rules.
        // Patterns are case-sensitive — common variants listed for both upper
        // and lower case. User overrides cannot loosen these denies because
        // they are merged AFTER the user ruleset.
        const injectionAgentPermission = PermissionNext.merge(
          vulnAgentPermission,
          PermissionNext.fromConfig({
            bash: {
              // Destructive SQL DDL
              "*DROP TABLE*": "deny",
              "*drop table*": "deny",
              "*DROP DATABASE*": "deny",
              "*drop database*": "deny",
              "*DROP SCHEMA*": "deny",
              "*drop schema*": "deny",
              "*TRUNCATE TABLE*": "deny",
              "*truncate table*": "deny",
              // SQL-based file write (destructive primitive)
              "*INTO OUTFILE*": "deny",
              "*into outfile*": "deny",
              "*INTO DUMPFILE*": "deny",
              "*into dumpfile*": "deny",
              // SQL-to-RCE primitives
              "*xp_cmdshell*": "deny",
              "*sp_OACreate*": "deny",
              "*sys_exec*": "deny",
              "*sys_eval*": "deny",
              "*COPY * TO PROGRAM*": "deny",
              "*copy * to program*": "deny",
              // sqlmap dangerous flags (RCE / file write)
              "*--os-shell*": "deny",
              "*--os-cmd*": "deny",
              "*--os-pwn*": "deny",
              "*--file-write*": "deny",
              "*--reg-add*": "deny",
              "*--reg-del*": "deny",
            },
          }),
        )

        return {
          "proxy-tester-idor": {
            name: "proxy-tester-idor",
            description: idorAgent.description,
            mode: "subagent" as const,
            native: true,
            hidden: true,
            prompt: idorAgent.prompt,
            prependRequestContext: true,
            permission: vulnAgentPermission,
            options: {},
          },
          "proxy-tester-authz": {
            name: "proxy-tester-authz",
            description: authzAgent.description,
            mode: "subagent" as const,
            native: true,
            hidden: true,
            prompt: authzAgent.prompt,
            prependRequestContext: true,
            permission: vulnAgentPermission,
            options: {},
          },
          "proxy-tester-mass-assignment": {
            name: "proxy-tester-mass-assignment",
            description: massAssignmentAgent.description,
            mode: "subagent" as const,
            native: true,
            hidden: true,
            prompt: massAssignmentAgent.prompt,
            prependRequestContext: true,
            permission: vulnAgentPermission,
            options: {},
          },
          "proxy-tester-injection": {
            name: "proxy-tester-injection",
            description: injectionAgent.description,
            mode: "subagent" as const,
            native: true,
            hidden: true,
            prompt: injectionAgent.prompt,
            prependRequestContext: true,
            permission: injectionAgentPermission,
            options: {},
          },
          "proxy-tester-authn": {
            name: "proxy-tester-authn",
            description: authnAgent.description,
            mode: "subagent" as const,
            native: true,
            hidden: true,
            prompt: authnAgent.prompt,
            prependRequestContext: true,
            permission: vulnAgentPermission,
            options: {},
          },
          "proxy-tester-business-logic": {
            name: "proxy-tester-business-logic",
            description: businessLogicAgent.description,
            mode: "subagent" as const,
            native: true,
            hidden: true,
            prompt: businessLogicAgent.prompt,
            prependRequestContext: true,
            permission: vulnAgentPermission,
            options: {},
          },
          "proxy-tester-ssrf": {
            name: "proxy-tester-ssrf",
            description: ssrfAgent.description,
            mode: "subagent" as const,
            native: true,
            hidden: true,
            prompt: ssrfAgent.prompt,
            prependRequestContext: true,
            permission: vulnAgentPermission,
            options: {},
          },
          "proxy-tester-file-attacks": {
            name: "proxy-tester-file-attacks",
            description: fileAttacksAgent.description,
            mode: "subagent" as const,
            native: true,
            hidden: true,
            prompt: fileAttacksAgent.prompt,
            prependRequestContext: true,
            permission: vulnAgentPermission,
            options: {},
          },
        }
      })()),
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.variant = value.variant ?? item.variant
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
    }

    // Ensure Truncate.GLOB is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "cyberstrike"), "desc"]),
    )
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      const agent = agents[cfg.default_agent]
      if (!agent) throw new Error(`default agent "${cfg.default_agent}" not found`)
      if (agent.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
      if (agent.hidden === true) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
      return agent.name
    }

    const primaryVisible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
    if (!primaryVisible) throw new Error("no primary visible agent found")
    return primaryVisible.name
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    const system = [PROMPT_GENERATE]
    await Plugin.trigger("experimental.chat.system.transform", { model }, { system })
    const existing = await list()

    const params = {
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    } satisfies Parameters<typeof generateObject>[0]

    if (defaultModel.providerID === "openai" && (await Auth.get(defaultModel.providerID))?.type === "oauth") {
      const result = streamObject({
        ...params,
        providerOptions: ProviderTransform.providerOptions(model, {
          instructions: SystemPrompt.instructions(),
          store: false,
        }),
        onError: () => {},
      })
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      return result.object
    }

    const result = await generateObject(params)
    return result.object
  }
}
