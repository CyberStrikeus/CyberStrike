<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>AI-powered offensive security agent platform.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.el.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a> |
  <a href="README.hi.md">हिन्दी</a>
</p>

---

### What is CyberStrike?

CyberStrike is an open-source, autonomous offensive security agent that runs in your terminal. It comes with 13+ specialized security agents, 120+ OWASP test cases, and works with 15+ LLM providers. Point it at a target, and it handles reconnaissance, vulnerability discovery, and report generation — all from a single TUI.

### Features

- **13+ Security Agents** — Web application (OWASP WSTG), mobile (MASTG/MASVS), cloud (AWS/Azure/GCP), Active Directory/Kerberos, network, and 8 specialized proxy testers (IDOR, injection, SSRF, auth bypass, and more)
- **30+ Built-in Tools** — Shell execution, HTTP requests, file operations, code search, web scraping, vulnerability reporting
- **Bolt** — Remote tool server with MCP protocol and Ed25519 pairing. Run security tools on remote servers, control them from your terminal
- **MCP Ecosystem** — First-party integrations: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **15+ LLM Providers** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, local models via OpenAI-compatible endpoints, and more
- **Multi-Interface** — TUI (terminal), Web (SolidJS), Desktop (Tauri) — same agent engine everywhere
- **LSP Support** — Language server protocol integration for IDE-based workflows
- **Plugin System** — Build custom agents and tools with the plugin SDK

### Installation

```bash
# npm / bun / pnpm / yarn
npm i -g cyberstrike@latest

# macOS
brew install CyberStrikeus/tap/cyberstrike

# Windows
scoop install cyberstrike

# curl
curl -fsSL https://cyberstrike.io/install | bash
```

### Quick Start

```bash
# Start CyberStrike
cyberstrike

# Select your LLM provider on first run, then:
# "Run a full OWASP WSTG assessment on https://target.com"
```

### Agents

Switch between agents with `Tab` in the TUI.

| Agent | Domain | Description |
|-------|--------|-------------|
| **cyberstrike** | General | Default full-access offensive security agent |
| **web-application** | Web | OWASP Top 10, WSTG methodology, API security |
| **mobile-application** | Mobile | Android/iOS testing, Frida, MASTG/MASVS |
| **cloud-security** | Cloud | AWS, Azure, GCP, IAM, CIS benchmarks |
| **internal-network** | Network | Active Directory, Kerberos, lateral movement |

Plus 8 specialized **proxy tester** agents for targeted vulnerability classes: IDOR, authorization, mass assignment, injection, authentication, business logic, SSRF, and file attacks.

### Desktop App

Available for macOS, Windows, and Linux. Download from the [releases page](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Documentation

- [Documentation](https://cyberstrike.io/docs)
- [Contributing](./CONTRIBUTING.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)

### License

[AGPL-3.0-only](./LICENSE) — Commercial licensing available via [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
