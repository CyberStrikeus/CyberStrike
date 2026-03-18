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

<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">The first open-source AI agent built for offensive security.</h3>

<p align="center">
  Autonomous pentesting from your terminal — reconnaissance, vulnerability discovery, exploitation, and reporting.<br>
  One command. 13+ specialized agents. 120+ OWASP test cases. Your AI red team.
</p>

<p align="center">
  <a href="#why-cyberstrike">Why CyberStrike?</a> &bull;
  <a href="#what-makes-it-different">What Makes It Different</a> &bull;
  <a href="#agents">Agents</a> &bull;
  <a href="#mcp-ecosystem">MCP Ecosystem</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#built-in-tools">Built-in Tools</a> &bull;
  <a href="#who-is-this-for">Who Is This For?</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyberstrike-io/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/@cyberstrike-io/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### Why CyberStrike?

Security testing is still overwhelmingly manual. Pentesters juggle dozens of tools, copy-paste outputs between terminals, and spend hours on repetitive reconnaissance before touching the actual attack surface. Bug bounty hunters burn time on the same recon workflow for every program.

**CyberStrike changes that.** It's an autonomous AI agent that understands offensive security methodology — not just running tools, but reasoning about what to test, chaining findings together, and adapting its approach based on what it discovers. Think of it as having a tireless red team member in your terminal that follows OWASP WSTG, knows when to pivot, and writes the report when it's done.

```bash
npm i -g @cyberstrike-io/cyberstrike@latest && cyberstrike
# "Run a full OWASP WSTG assessment on https://target.com"
```

It's open source, works with any LLM provider, and you own everything it produces.

---

### What Makes It Different

<table>
<tr>
<td width="50%">

**Specialized Security Agents, Not Generic Chat**

CyberStrike ships with 13+ agents purpose-built for security domains. Each agent carries domain-specific methodology, tool knowledge, and testing patterns. The web-application agent follows WSTG. The cloud-security agent knows CIS benchmarks. The mobile agent uses Frida and follows MASTG/MASVS. They don't guess — they follow proven frameworks.

</td>
<td width="50%">

**Autonomous, Not Just Assistive**

Other AI tools wait for you to tell them what to do next. CyberStrike agents plan multi-step attack chains, execute tools, analyze results, pivot when they find something interesting, and generate evidence-backed reports. You set the objective — they handle the methodology.

</td>
</tr>
<tr>
<td width="50%">

**Any LLM, No Lock-in**

15+ providers out of the box: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — even local models through OpenAI-compatible endpoints. Run it with Claude, GPT, Gemini, or your own self-hosted LLM. As models get better and cheaper, CyberStrike gets better with them.

</td>
<td width="50%">

**Remote Tool Execution with Bolt**

Your security tools don't have to run on your laptop. Bolt is CyberStrike's remote tool server — deploy it on a VPS with your pentest toolkit, pair it with Ed25519 keys, and control everything from your local terminal over MCP protocol. One TUI, multiple attack servers.

</td>
</tr>
</table>

---

### Agents

Switch between agents with `Tab`. Each one is a specialist.

| Agent                  | Focus   | What It Does                                                        |
| ---------------------- | ------- | ------------------------------------------------------------------- |
| **cyberstrike**        | General | Full-access primary agent — reconnaissance, exploitation, reporting |
| **web-application**    | Web     | OWASP Top 10, WSTG methodology, API security, session testing       |
| **mobile-application** | Mobile  | Android/iOS, Frida/Objection, MASTG/MASVS compliance                |
| **cloud-security**     | Cloud   | AWS, Azure, GCP — IAM misconfigs, CIS benchmarks, exposed resources |
| **internal-network**   | Network | Active Directory, Kerberos attacks, lateral movement, pivoting      |

Plus **8 specialized proxy testers** that intercept and manipulate traffic for targeted vulnerability classes:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### MCP Ecosystem

CyberStrike connects to specialized MCP servers that extend its capabilities:

| Server                                                                 | Tools | What It Adds                                                               |
| ---------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)         | 39    | Browser-based security testing — XSS, CSRF, DOM manipulation, cookie theft |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | 38    | Cloud security audits — 60+ checks across AWS, Azure, GCP                  |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39    | GitHub security posture — repo, org, actions, secrets, supply chain        |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | 23    | CVE intelligence — NVD, EPSS, CISA KEV, GitHub Advisory, OSV               |
| [osint-mcp](https://github.com/badchars/osint-mcp)                     | 37    | OSINT recon — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS       |

All open source. All installable with `npx`. Plug them into CyberStrike or use them standalone with any MCP client.

---

### Bolt

Bolt is CyberStrike's remote tool execution server. Instead of running security tools on your laptop, deploy them on a VPS (or multiple) and control everything from your local terminal.

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**How it works:**

- Deploy Bolt on any server with your pentest toolkit installed
- Pair with Ed25519 keys — no passwords, no shared secrets
- CyberStrike agents call tools remotely over MCP protocol
- Results stream back to your local TUI in real-time
- Manage connections from the TUI: add, remove, monitor status

**Why it matters:** Your attack surface stays on dedicated infrastructure. Run heavy scans from a VPS with better bandwidth, keep your tools updated in one place, and switch between multiple attack servers from a single terminal.

---

### Installation

```bash
# npm / bun / pnpm / yarn
npm i -g @cyberstrike-io/cyberstrike@latest

# macOS
brew install CyberStrikeus/tap/cyberstrike

# Windows
scoop install cyberstrike

# curl (Linux/macOS)
curl -fsSL https://cyberstrike.io/install | bash
```

**Desktop app** (macOS, Windows, Linux) — download from the [releases page](https://github.com/CyberStrikeus/CyberStrike/releases) or:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Built-in Tools

CyberStrike agents have direct access to 30+ tools:

| Category        | Tools                                                           |
| --------------- | --------------------------------------------------------------- |
| **Execution**   | Shell (bash), file read/write/edit, directory listing           |
| **Discovery**   | Web fetch, web search, code search, glob, grep                  |
| **Security**    | Vulnerability reporting (HackerOne format), evidence collection |
| **Proxy**       | HTTP/HTTPS interception, request replay, traffic analysis       |
| **Integration** | MCP servers, Bolt remote tools, custom plugins                  |

Plus a **plugin SDK** — build your own agents and tools, register them at runtime.

---

### Who Is This For?

- **Pentesters** — Automate the repetitive parts. Let agents handle recon and initial testing while you focus on the creative attack chains that need human intuition.
- **Bug Bounty Hunters** — Faster reconnaissance, wider coverage, consistent methodology across programs. CyberStrike doesn't get tired at 3am.
- **Security Teams** — Run structured OWASP assessments with reproducible methodology. Get reports that map to standards your compliance team understands.
- **Security Researchers** — Extend CyberStrike with custom agents and MCP servers. The plugin system and MCP protocol make it a platform, not just a tool.

---

### Contributing

CyberStrike is built by the security community, for the security community. We welcome contributions across:

- **Security agents and skills** — New attack methodologies, testing patterns, vulnerability detection
- **MCP servers** — Connect new security tools and data sources
- **Knowledge base** — WSTG, MASTG, PTES, CIS methodology guides
- **Core improvements** — Performance, UX, provider integrations, bug fixes

Read the [Contributing Guide](./CONTRIBUTING.md) before submitting a PR. All contributions must follow the project's [ethical use policy](./CODE_OF_CONDUCT.md) — CyberStrike is for authorized security testing only.

---

### License

[AGPL-3.0-only](./LICENSE) — Free for personal and open-source use. Commercial licensing available via [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

### MCP Security Suite

CyberStrike is the core platform. These MCP servers extend its capabilities:

| Project                                                                | Domain                                  | Tools                                 |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------- |
| **CyberStrike**                                                        | **Autonomous offensive security agent** | **13+ agents, 120+ OWASP test cases** |
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)         | Browser-based security testing          | 39 tools, Firefox, injection testing  |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | Cloud security (AWS/Azure/GCP)          | 38 tools, 60+ checks                  |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | GitHub security posture                 | 39 tools, 45 checks                   |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | Vulnerability intelligence              | 23 tools, 5 sources                   |
| [osint-mcp](https://github.com/badchars/osint-mcp-server)              | OSINT & reconnaissance                  | 37 tools, 12 sources                  |

---

<p align="center">
  <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrikeio"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>Built by hackers who got tired of copy-pasting between terminals.</sub>
</p>
