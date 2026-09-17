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
import PROMPT_CLOUD_SECURITY from "./prompt/cloud-security.txt"
import PROMPT_INTERNAL_NETWORK from "./prompt/internal-network.txt"
import PROMPT_MOBILE_APPLICATION from "./prompt/mobile-application.txt"
import PROMPT_NORMALIZE_REQUEST from "./prompt/normalize-request.txt"
import PROMPT_CYBERSTRIKE from "./prompt/cyberstrike.txt"
import PROMPT_GENERAL from "./prompt/general.txt"
// Methodology Engine prompts — intelligence logging, coverage tracking, forced continuation
import PROMPT_METHODOLOGY_COMMON from "./prompt/methodology/common-methodology.txt"
import PROMPT_METHODOLOGY_CONTINUATION from "./prompt/methodology/forced-continuation.txt"

// Domain providers define agent specs; the registry collects built-in + plugin domains.
import { collectAgentSpecs } from "../cloud/provider-registry"
import type { AgentSpec } from "../cloud/provider"

import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { Tier } from "../tier/tier"

export namespace Agent {
  // Hard step-caps (Layer 1 backstop for the loop-termination fix — see
  // AGENT_LOOP_TERMINATION_SPEC.md). Single tuning point. NOTE: wstg-* are
  // deliberately left at their existing default of 50 (see the `startsWith` guard
  // below — lowering them regressed findings); only the two genuinely-uncapped
  // orchestration agents get a cap here. Enforcement (tool-strip + break on the
  // capped turn) lives in session/prompt.ts.
  const STEP_CAPS = { orchestrator: 40 } as const

  function specsToAgents(specs: AgentSpec[], defaults: PermissionNext.Ruleset, user: PermissionNext.Ruleset): Record<string, Info> {
    const result: Record<string, Info> = {}
    for (const spec of specs) {
      const info: Info = {
        name: spec.name,
        description: spec.description,
        mode: "subagent",
        native: true,
        hidden: spec.hidden !== false,
        steps: spec.steps,
        color: spec.color,
        prompt: spec.prompt,
        skills: spec.skills,
        permission: PermissionNext.merge(defaults, PermissionNext.fromConfig(spec.permissions), user),
        options: {},
      }
      if (spec.prependRequestContext) info.prependRequestContext = true
      if (spec.useSmallModel) info.useSmallModel = true
      result[spec.name] = info
    }
    return result
  }

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
      // Run this agent on the provider's SMALL tier (Phase 1.3, docs/
      // proxy-pipeline-redesign) regardless of the session model — for cheap,
      // routing-only agents (orchestrator). Resolved via
      // Provider.getSmallModel(<session provider>).
      useSmallModel: z.boolean().optional(),
      variant: z.string().optional(),
      prompt: z.string().optional(),
      skills: z.array(z.string()).optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
      prependRequestContext: z.boolean().optional(),
      // Minimum runtime tier that unlocks this agent (Tier gate, issue #35). Absent
      // means "free" — visible in every build. See src/tier/tier.ts.
      tier: z.enum(["free", "pro", "enterprise"]).optional(),
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
        prompt: `${PROMPT_METHODOLOGY_COMMON}\n\n---\n\n${PROMPT_CYBERSTRIKE}`,
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
            triage_vulnerability: "deny",
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
      "mobile-application": {
        name: "mobile-application",
        description:
          "Mobile application security specialist. Android/iOS testing, OWASP MASTG/MASVS, static/dynamic analysis, Frida/Objection.",
        mode: "subagent",
        native: true,
        tier: "pro",
        color: "magenta",
        prompt: `${PROMPT_METHODOLOGY_COMMON}\n\n${PROMPT_METHODOLOGY_CONTINUATION}\n\n---\n\n${PROMPT_MOBILE_APPLICATION}`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            bash: "allow",
            hackbrowser: "allow",
            read: "allow",
            glob: "allow",
            grep: "allow",
            report_vulnerability: "allow",
            triage_vulnerability: "allow",
            add_intel: "allow",
            update_vrt_check: "allow",
            methodology_status: "allow",
            scope_check: "allow",
            ensure_tools: "allow",
            attack_script: "allow",
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
        tier: "pro",
        color: "cyan",
        prompt: `${PROMPT_METHODOLOGY_COMMON}\n\n${PROMPT_METHODOLOGY_CONTINUATION}\n\n---\n\n${PROMPT_CLOUD_SECURITY}`,
        skills: [
          "cis-aws-foundations-2.1.1",
          "cis-aws-foundations-2.2",
          "cis-aws-foundations-3.1.1",
          "cis-aws-foundations-4.1",
          "cis-aws-foundations-5.1",
          "cis-aws-foundations-6.2",
          "aws-postexploit",
          "azure-postexploit",
          "k8s-postexploit",
          "gcp-postexploit",
          "cloud-assessment",
          "k8s-assessment",
          "ci-assessment",
        ],
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            bash: "allow",
            hackbrowser: "allow",
            read: "allow",
            glob: "allow",
            grep: "allow",
            report_vulnerability: "allow",
            triage_vulnerability: "allow",
            add_intel: "allow",
            update_vrt_check: "allow",
            methodology_status: "allow",
            scope_check: "allow",
            ensure_tools: "allow",
            attack_script: "allow",
            awshook: "allow",
            azurehook: "allow",
            kubehook: "allow",
            gcphook: "allow",
            containerhook: "allow",
            iachook: "allow",
            cloud_audit: "allow",
            k8s_audit: "allow",
            ci_audit: "allow",
          }),
          user,
        ),
        options: {},
      },
      // ── Domain providers — collected from the registry (built-in web/azure +
      // any installed plugin domains). Adding a domain is a registerProvider call,
      // never an edit here. See docs/domain-plugin-architecture.md.
      ...(await (async () => {
        try {
          const { specs, errors } = await collectAgentSpecs()
          for (const e of errors) console.error(`[agent] domain provider "${e.key}" failed to load: ${e.error}`)
          return specsToAgents(specs, defaults, user)
        } catch (e) {
          console.error(`[agent] failed to collect domain agents: ${e}`)
          return {}
        }
      })()),
      "internal-network": {
        name: "internal-network",
        description: "Internal network and Active Directory specialist. AD attacks, Kerberos, lateral movement.",
        mode: "subagent",
        native: true,
        tier: "pro",
        color: "yellow",
        prompt: `${PROMPT_METHODOLOGY_COMMON}\n\n${PROMPT_METHODOLOGY_CONTINUATION}\n\n---\n\n${PROMPT_INTERNAL_NETWORK}`,
        skills: [
          "ad-security",
          "kerberos-attacks",
          "ebpf-attacks",
          "windows-postexploit",
          "linux-postexploit",
          "macos-postexploit",
          "aws-postexploit",
          "azure-postexploit",
          "k8s-postexploit",
          "gcp-postexploit",
          "cicd-attacks",
        ],
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            bash: "allow",
            hackbrowser: "allow",
            read: "allow",
            glob: "allow",
            grep: "allow",
            report_vulnerability: "allow",
            triage_vulnerability: "allow",
            add_intel: "allow",
            update_vrt_check: "allow",
            methodology_status: "allow",
            scope_check: "allow",
            ensure_tools: "allow",
            attack_script: "allow",
            ebpf: "allow",
            winhook: "allow",
            machook: "allow",
            linuxhook: "allow",
            awshook: "allow",
            azurehook: "allow",
            kubehook: "allow",
            gcphook: "allow",
            containerhook: "allow",
            iachook: "allow",
            cloud_audit: "allow",
            k8s_audit: "allow",
            ci_audit: "allow",
            cipipe: "allow",
          }),
          user,
        ),
        options: {},
      },
      // Web + Azure pipeline agents are collected via the domain provider
      // registry above (collectAgentSpecs), not hardcoded here.
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

    // Phase 1a (docs/proxy-pipeline-redesign): default turn budget for the proxy
    // vuln testers. Measured baseline: a single tester ran up to ~12 turns on ONE
    // request. An earlier cap of 8 turned out to be BELOW that natural length —
    // testers spent all their turns verifying via bash and hit the soft wrap-up
    // before ever calling report_vulnerability, so confirmed findings were summarized
    // to the orchestrator but never recorded. Raised to 50 to leave ample headroom for
    // multi-step verification AND reporting on complex endpoints. Affordable now that
    // prompt caching is on (extra turns re-read the cached prefix at ~10% cost, not full
    // price). The cap is soft (forces a text wrap-up at the limit, prompt.ts) and only
    // applies when not explicitly configured, so user config still overrides.
    for (const name in result) {
      if (result[name].steps == null && name.startsWith("wstg-")) result[name].steps = 60
    }

    // Tier gate (issue #35): drop any agent whose minimum tier is above the active
    // runtime tier. Untagged agents are free and always survive. The default (free)
    // build therefore hides mobile-application / cloud-security / internal-network;
    // CYBERSTRIKE_TIER=pro (or enterprise) brings them back.
    for (const name in result) {
      if (Tier.allows(result[name].tier ?? "free")) continue
      delete result[name]
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
