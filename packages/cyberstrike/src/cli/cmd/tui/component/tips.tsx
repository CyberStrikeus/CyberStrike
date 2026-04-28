import { createMemo, createSignal, For } from "solid-js"
import { DEFAULT_THEMES, useTheme } from "@tui/context/theme"

type TipPart = { text: string; highlight: boolean }

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

export function Tips() {
  const theme = useTheme().theme
  const parts = parse(TIPS[Math.floor(Math.random() * TIPS.length)])

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ● Tip{" "}
      </text>
      <text flexShrink={1}>
        <For each={parts}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}

const TIPS = [
  // Offensive security capabilities
  "CyberStrike runs {highlight}120+ OWASP test cases{/highlight} autonomously across web targets",
  "Use specialized agents for {highlight}recon{/highlight}, {highlight}exploitation{/highlight}, and {highlight}reporting{/highlight}",
  "CyberStrike generates {highlight}HackerOne-ready{/highlight} vulnerability reports from verified findings",
  "Agents can chain tools — {highlight}recon → scan → exploit → verify → report{/highlight} in a single session",
  "Use {highlight}@pentest{/highlight} agent for full autonomous penetration testing workflows",
  "CyberStrike supports {highlight}15+ vulnerability skills{/highlight}: IDOR, SSRF, XSS, injection, misconfig, and more",
  "The verify agent uses a {highlight}ReAct loop{/highlight} with 10 tools to confirm vulnerabilities with PoC",
  "Sub-agents ({highlight}key_validator{/highlight}, {highlight}poc_builder{/highlight}, {highlight}exploit_tester{/highlight}) handle specialized tasks",
  "Agents can {highlight}create custom tools at runtime{/highlight} with define_tool for adaptive testing",
  "Use {highlight}scope enforcement{/highlight} to restrict HTTP requests to authorized targets only",
  "CyberStrike supports {highlight}HAR replay{/highlight} — replay captured traffic with modifications",

  // MCP integrations
  "Connect {highlight}hackbrowser-mcp{/highlight} for 39 browser-based security testing tools",
  "Use {highlight}cloud-audit-mcp{/highlight} for AWS, Azure, and GCP security audits (60+ checks)",
  "Add {highlight}github-security-mcp{/highlight} for repo security posture analysis (45 checks)",
  "Use {highlight}cve-mcp{/highlight} for real-time CVE intelligence from NVD, EPSS, CISA KEV, and OSV",
  "Configure MCP servers in the {highlight}mcp{/highlight} config section for extended capabilities",

  // Local LLM & provider
  "Run {highlight}cyberstrike provider add{/highlight} to connect local LLMs (vLLM, Ollama, llama.cpp)",
  "Use {highlight}/models{/highlight} or {highlight}Ctrl+X M{/highlight} to switch between cloud and local models",
  "Local models show under {highlight}Local Models{/highlight} in the model selector — fully searchable",
  "Use {highlight}/connect{/highlight} to add API keys for 75+ supported LLM providers",

  // Navigation & workflow
  "Type {highlight}@{/highlight} followed by a filename to fuzzy search and attach files",
  "Start a message with {highlight}!{/highlight} to run shell commands directly (e.g., {highlight}!nmap -sV target{/highlight})",
  "Press {highlight}Escape{/highlight} to stop the AI mid-response",
  "Press {highlight}Ctrl+X N{/highlight} or {highlight}/new{/highlight} to start a fresh session",
  "Use {highlight}/sessions{/highlight} or {highlight}Ctrl+X L{/highlight} to resume previous sessions",
  "Press {highlight}Ctrl+P{/highlight} to see all available actions and commands",
  "Press {highlight}Shift+Enter{/highlight} or {highlight}Ctrl+J{/highlight} to add newlines in your prompt",
  "Run {highlight}/compact{/highlight} to summarize long sessions near context limits",
  "Press {highlight}Ctrl+X E{/highlight} to compose complex prompts in your external editor",
  "Use {highlight}PageUp{/highlight}/{highlight}PageDown{/highlight} to navigate through conversation history",

  // Config & agents
  "Add {highlight}.md{/highlight} files to {highlight}.cyberstrike/agent/{/highlight} for specialized security personas",
  "Create custom agents for {highlight}bug bounty{/highlight}, {highlight}red team{/highlight}, or {highlight}compliance{/highlight} workflows",
  "Use {highlight}cyberstrike run{/highlight} for non-interactive scripting and CI/CD integration",
  "Create {highlight}.ts{/highlight} files in {highlight}.cyberstrike/tools/{/highlight} to define custom LLM tools",
  "Use {highlight}--format json{/highlight} for machine-readable output in automation pipelines",
]
