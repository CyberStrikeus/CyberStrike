import type { AgentSpec, DomainProvider, PermissionRule } from "@cyberstrike-io/plugin"

// ── Orchestrator ──
import PROMPT_RE_AGENT from "./prompts/orchestrator/re-agent/prompt.txt"
import DESC_RE_AGENT from "./prompts/orchestrator/re-agent/description.txt"

// ── Specialists ──
import PROMPT_RE_BINARY from "./prompts/specialist/re-binary/prompt.txt"
import DESC_RE_BINARY from "./prompts/specialist/re-binary/description.txt"

import PROMPT_RE_WEB from "./prompts/specialist/re-web/prompt.txt"
import DESC_RE_WEB from "./prompts/specialist/re-web/description.txt"

import PROMPT_RE_MOBILE from "./prompts/specialist/re-mobile/prompt.txt"
import DESC_RE_MOBILE from "./prompts/specialist/re-mobile/description.txt"

import PROMPT_RE_FIRMWARE from "./prompts/specialist/re-firmware/prompt.txt"
import DESC_RE_FIRMWARE from "./prompts/specialist/re-firmware/description.txt"

import PROMPT_RE_MANAGED from "./prompts/specialist/re-managed/prompt.txt"
import DESC_RE_MANAGED from "./prompts/specialist/re-managed/description.txt"

import PROMPT_RE_NETWORK from "./prompts/specialist/re-network/prompt.txt"
import DESC_RE_NETWORK from "./prompts/specialist/re-network/description.txt"

import PROMPT_RE_DEBUG from "./prompts/specialist/re-debug/prompt.txt"
import DESC_RE_DEBUG from "./prompts/specialist/re-debug/description.txt"

// REA MCP tools are permission-gated per specialist. Each family maps to a tool
// prefix the host resolves at runtime (e.g. `mcp__rea__disassemble_*`). We grant
// broad MCP access here because the agent prompt constrains the tool set and REA
// itself is read-only analysis — no destructive ops.
const RE_MCP_PERMISSIONS: Record<string, PermissionRule> = {
  "mcp__rea__*": "allow",
}

const BASE_PERMISSIONS: Record<string, PermissionRule> = {
  "*": "deny",
  bash: {
    "*": "allow",
    // no network egress from RE agents — they analyze local artifacts
    "*curl *": "deny",
    "*wget *": "deny",
    "*nc *": "deny",
    "nc *": "deny",
    "*ncat *": "deny",
    "*socat *": "deny",
  },
  report_vulnerability: "allow",
  add_intel: "allow",
  ...RE_MCP_PERMISSIONS,
}

type SpecDef = {
  name: string
  role: AgentSpec["role"]
  description: string
  prompt: string
  steps?: number
  color: string
  permissions: Record<string, PermissionRule>
  skills?: string[]
  hidden?: boolean
}

function specs(): SpecDef[] {
  return [
    // ── Orchestrator ──
    {
      name: "re-agent",
      role: "orchestrator",
      prompt: PROMPT_RE_AGENT,
      description: DESC_RE_AGENT,
      steps: 30,
      color: "purple",
      hidden: false,
      permissions: {
        "*": "deny",
        task: "allow",
        question: "allow",
        ...RE_MCP_PERMISSIONS,
      },
    },

    // ── Binary Analysis ──
    {
      name: "re-binary",
      role: "specialist",
      prompt: PROMPT_RE_BINARY,
      description: DESC_RE_BINARY,
      color: "red",
      permissions: { ...BASE_PERMISSIONS },
    },

    // ── Dynamic Analysis & Debugging ──
    {
      name: "re-debug",
      role: "specialist",
      prompt: PROMPT_RE_DEBUG,
      description: DESC_RE_DEBUG,
      color: "orange",
      permissions: { ...BASE_PERMISSIONS },
    },

    // ── Web / JavaScript RE ──
    {
      name: "re-web",
      role: "specialist",
      prompt: PROMPT_RE_WEB,
      description: DESC_RE_WEB,
      color: "yellow",
      permissions: { ...BASE_PERMISSIONS },
    },

    // ── Mobile RE ──
    {
      name: "re-mobile",
      role: "specialist",
      prompt: PROMPT_RE_MOBILE,
      description: DESC_RE_MOBILE,
      color: "green",
      permissions: { ...BASE_PERMISSIONS },
    },

    // ── Firmware RE ──
    {
      name: "re-firmware",
      role: "specialist",
      prompt: PROMPT_RE_FIRMWARE,
      description: DESC_RE_FIRMWARE,
      color: "teal",
      permissions: { ...BASE_PERMISSIONS },
    },

    // ── Managed Code RE ──
    {
      name: "re-managed",
      role: "specialist",
      prompt: PROMPT_RE_MANAGED,
      description: DESC_RE_MANAGED,
      color: "blue",
      permissions: { ...BASE_PERMISSIONS },
    },

    // ── Network & Smart Contract RE ──
    {
      name: "re-network",
      role: "specialist",
      prompt: PROMPT_RE_NETWORK,
      description: DESC_RE_NETWORK,
      color: "indigo",
      permissions: { ...BASE_PERMISSIONS },
    },
  ]
}

export class REProvider implements DomainProvider {
  key = "re"

  agentSpecs(): AgentSpec[] {
    return specs().map((s) => ({
      name: s.name,
      role: s.role,
      description: s.description,
      prompt: s.prompt,
      steps: s.steps,
      color: s.color,
      permissions: s.permissions,
      skills: s.skills,
      hidden: s.hidden,
    }))
  }
}
