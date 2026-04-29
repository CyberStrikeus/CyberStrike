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
  Automated penetration testing from your terminal — plug in your Claude, GPT, or any LLM subscription<br>
  and turn it into an autonomous red team agent with 13+ specialized agents and 120+ OWASP test cases.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#intelligence-layer">Intelligence Layer</a> &bull;
  <a href="#what-makes-it-different">What Makes It Different</a> &bull;
  <a href="#agents">Agents</a> &bull;
  <a href="#web-ui--remote-access">Web UI</a> &bull;
  <a href="#bolt--remote-tool-execution">Bolt</a> &bull;
  <a href="#mcp-ecosystem">MCP Ecosystem</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="https://docs.cyberstrike.io">Docs</a> &bull;
  <a href="https://cyberstrike.io">Website</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyberstrike-io/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/@cyberstrike-io/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://www.npmjs.com/package/@cyberstrike-io/cyberstrike"><img alt="Downloads" src="https://img.shields.io/npm/dm/@cyberstrike-io/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### Quick Start

```bash
npm i -g @cyberstrike-io/cyberstrike@latest && cyberstrike
```

That's it. CyberStrike launches a TUI in your terminal, asks for your LLM provider and API key on first run, and you're ready to go. Tell it what to test — it handles reconnaissance, vulnerability discovery, exploitation, and reporting autonomously.

> **Already have a Claude Code or OpenAI subscription?** CyberStrike's intelligence layer sits on top of your existing AI subscription. No separate API costs — your current plan powers an entire pentest toolkit.

Explore the full documentation at **[docs.cyberstrike.io](https://docs.cyberstrike.io)** or visit **[cyberstrike.io](https://cyberstrike.io)** for demos and guides.

---

### Intelligence Layer

CyberStrike isn't just a wrapper around an LLM. It's an intelligence layer that transforms any AI model into an offensive security specialist.

**How it works:** When you connect your LLM provider, CyberStrike injects domain-specific context — OWASP testing methodology, vulnerability patterns, attack chain reasoning, and tool orchestration logic — into every interaction. The model doesn't need to know security; CyberStrike teaches it.

**What the intelligence layer provides:**

- **Schema normalization** — Structured output from any provider, regardless of response format differences
- **Context guard** — Prevents prompt leakage and keeps the agent focused on the current test phase
- **Provider auto-detection** — Automatically identifies your LLM endpoint and configures the optimal transport
- **Tool orchestration** — Chains security tools intelligently based on findings, not fixed scripts

**15+ LLM providers supported out of the box:**

| Provider                  | Models                   | Notes                                   |
| ------------------------- | ------------------------ | --------------------------------------- |
| **Anthropic**             | Claude 4.5, Claude 4     | Best performance with extended thinking |
| **OpenAI**                | GPT-4.1, o3, o4-mini     | Full tool-use support                   |
| **Google**                | Gemini 2.5 Pro/Flash     | Long context for large codebases        |
| **Amazon Bedrock**        | All Bedrock models       | IAM auth, no API keys needed            |
| **Azure OpenAI**          | All Azure-hosted models  | Enterprise deployments                  |
| **Groq**                  | LLaMA, Mixtral           | Ultra-fast inference                    |
| **Mistral**               | Mistral Large, Codestral | European data residency                 |
| **DeepSeek**              | DeepSeek V3, R1          | Cost-effective alternative              |
| **OpenRouter**            | 100+ models              | Single API, any model                   |
| **Together AI**           | Open-source models       | Fine-tuning support                     |
| **Ollama**                | Any GGUF model           | Fully offline, local-only               |
| **LM Studio**             | Any local model          | Desktop GUI + API server                |
| **vLLM**                  | Any HuggingFace model    | Self-hosted, GPU-optimized              |
| **Any OpenAI-compatible** | —                        | Custom endpoints welcome                |

> **Air-gapped environments?** Run CyberStrike entirely offline with Ollama or LM Studio. No data leaves your machine — ever.

---

### What Makes It Different

<table>
<tr>
<td width="50%">

**Specialized Security Agents, Not Generic Chat**

CyberStrike ships with 13+ agents purpose-built for security domains. Each agent carries domain-specific methodology, tool knowledge, and testing patterns. The web-application agent follows OWASP WSTG. The cloud-security agent knows CIS benchmarks. The mobile agent uses Frida and follows MASTG/MASVS. They don't guess — they follow proven offensive security frameworks.

</td>
<td width="50%">

**Intelligence Layer, Not Just an LLM Wrapper**

Most AI security tools are thin wrappers that send your prompt to an API. CyberStrike's intelligence layer normalizes outputs across 15+ providers, guards context between test phases, auto-detects your provider configuration, and orchestrates multi-step attack chains. The result: consistent, methodology-driven pentesting regardless of which model you use.

</td>
</tr>
<tr>
<td width="50%">

**Any LLM, Zero Lock-in**

Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, DeepSeek, OpenRouter, Together AI — or run fully offline with Ollama and LM Studio. You choose the model. You own the results. As AI models get better and cheaper, CyberStrike gets better with them. Switch providers in seconds without reconfiguring anything.

</td>
<td width="50%">

**Remote Tool Execution with Bolt**

Your security tools don't have to run on your laptop. Deploy Bolt on one or many remote servers, pair with Ed25519 keys, and control everything from your local terminal. One CyberStrike instance can orchestrate dozens of Bolt servers — each with its own toolkit, network position, and attack surface access.

</td>
</tr>
</table>

---

### Agents

Switch between agents with `Tab`. Each one is a domain specialist.

| Agent                  | Focus   | What It Does                                                        |
| ---------------------- | ------- | ------------------------------------------------------------------- |
| **cyberstrike**        | General | Full-access primary agent — reconnaissance, exploitation, reporting |
| **web-application**    | Web     | OWASP Top 10, WSTG methodology, API security, session testing       |
| **mobile-application** | Mobile  | Android/iOS, Frida/Objection, MASTG/MASVS compliance                |
| **cloud-security**     | Cloud   | AWS, Azure, GCP — IAM misconfigs, CIS benchmarks, exposed resources |
| **internal-network**   | Network | Active Directory, Kerberos attacks, lateral movement, pivoting      |

Plus **8 specialized proxy testers** that intercept and manipulate traffic for targeted vulnerability classes:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

Each proxy tester follows a structured methodology: intercept traffic, identify patterns, generate test cases, execute attacks, and report findings with evidence.

---

### Web UI & Remote Access

CyberStrike includes a full web interface. Run `cyberstrike web` and control your agents, MCP servers, Bolt connections, and vulnerability findings from any browser.

**Access from anywhere with Cloudflare Tunnel:**

```
Browser ──HTTPS──▶ Cloudflare Tunnel ──encrypted──▶ cloudflared (localhost) ──▶ CyberStrike Server
```

```bash
export CYBERSTRIKE_SERVER_PASSWORD=your-secure-password
cyberstrike web
# In another terminal:
cloudflared tunnel --url http://localhost:4096 run your-tunnel
```

**Why this is secure:**

- **Zero open ports** — CyberStrike binds to `localhost:4096`. `cloudflared` makes an outbound-only connection to Cloudflare's edge. No firewall rules, no port forwarding needed.
- **End-to-end encryption** — Browser to Cloudflare edge is TLS. Cloudflare edge to your machine is an encrypted tunnel. No plaintext leaves your network.
- **Password-protected API** — Every API request requires Basic Auth. Local requests on `localhost` bypass auth for convenience; remote requests via CF tunnel always require credentials (detects `X-Forwarded-For` / `CF-Connecting-IP`).
- **Your data stays local** — LLM inference runs on your hardware. CyberStrike processes everything locally. The tunnel is just a secure pipe.

**What's in the Web UI:**

| Tab                 | What It Does                                       |
| ------------------- | -------------------------------------------------- |
| **Chat**            | Full conversation with all 13+ security agents     |
| **MCP**             | Live MCP server status, health, and tool counts    |
| **Bolt**            | Bolt remote server connection monitoring           |
| **Vulnerabilities** | Discovered vulns with severity, PoC, and impact    |
| **Web Context**     | Endpoints, roles, credentials from Firefox Capture |

**[app.cyberstrike.io](https://app.cyberstrike.io)** is a hosted static page (no backend, no data storage) for convenience. Or self-host: clone the repo and serve `packages/app/dist/` from your own domain.

---

### Bolt — Remote Tool Execution

Bolt is CyberStrike's remote tool server. Deploy it on any VPS, cloud instance, or Docker container — then control it from your local terminal over MCP protocol with Ed25519 authentication.

**One CyberStrike, many Bolt servers:**

```
                                          ┌─────────────────────┐
                                     ┌───►│  Bolt Server #1     │
                                     │    │  nmap, nuclei, ffuf  │
┌──────────────────┐   MCP + Ed25519 │    └─────────────────────┘
│  Your Terminal   │   over HTTPS    │    ┌─────────────────────┐
│  CyberStrike TUI │ ◄─────────────►├───►│  Bolt Server #2     │
│                  │   Tool Results   │    │  sqlmap, burp, zap   │
└──────────────────┘                 │    └─────────────────────┘
                                     │    ┌─────────────────────┐
                                     └───►│  Bolt Server #3     │
                                          │  Custom toolkit      │
                                          └─────────────────────┘
```

- **Deploy anywhere** — VPS, Docker, Kubernetes, or bare metal with pre-built Kali images
- **Ed25519 key pairing** — No passwords, no shared secrets, no attack surface
- **Real-time streaming** — Results flow back to your TUI as they happen
- **Manage from TUI** — Add, remove, and monitor Bolt servers without leaving CyberStrike
- **Scale horizontally** — Run heavy scans from servers with better bandwidth while you work locally

---

### MCP Ecosystem

CyberStrike connects to specialized MCP servers that extend its capabilities — **176+ security tools** across 5 domains:

| Server                                                                 | Tools | What It Adds                                                               |
| ---------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | 38    | Cloud security audits — 60+ checks across AWS, Azure, GCP                  |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39    | GitHub security posture — repo, org, actions, secrets, supply chain        |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | 23    | CVE intelligence — NVD, EPSS, CISA KEV, GitHub Advisory, OSV               |
| [osint-mcp](https://github.com/badchars/osint-mcp)                     | 37    | OSINT recon — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS       |

All open source. All installable with `npx`. Plug them into CyberStrike or use them standalone with any MCP-compatible client.

---

### Built-in Tools

CyberStrike agents have direct access to 30+ tools without any external dependencies:

| Category        | Tools                                                           |
| --------------- | --------------------------------------------------------------- |
| **Execution**   | Shell (bash), file read/write/edit, directory listing           |
| **Discovery**   | Web fetch, web search, code search, glob, grep                  |
| **Security**    | Vulnerability reporting (HackerOne format), evidence collection |
| **Proxy**       | HTTP/HTTPS interception, request replay, traffic analysis       |
| **Integration** | MCP servers, Bolt remote tools, custom plugins                  |

Plus a **plugin SDK** — build your own agents and tools, register them at runtime.

---

### Installation

```bash
# npm (recommended)
npm i -g @cyberstrike-io/cyberstrike@latest

# bun / pnpm / yarn
bun add -g @cyberstrike-io/cyberstrike@latest

# macOS (Homebrew)
brew install CyberStrikeus/tap/cyberstrike

# Windows (Scoop)
scoop install cyberstrike

# Linux / macOS (curl)
curl -fsSL https://cyberstrike.io/install | bash
```

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
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | Cloud security (AWS/Azure/GCP)          | 38 tools, 60+ checks                  |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | GitHub security posture                 | 39 tools, 45 checks                   |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | Vulnerability intelligence              | 23 tools, 5 sources                   |
| [osint-mcp](https://github.com/badchars/osint-mcp-server)              | OSINT & reconnaissance                  | 37 tools, 12 sources                  |

---

<p align="center">
  <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a> · <a href="https://docs.cyberstrike.io"><b>Docs</b></a> · <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrikeio"><b>X.com</b></a> · <a href="https://github.com/CyberStrikeus/CyberStrike"><b>GitHub</b></a>
</p>
<p align="center">
  <sub>Built by hackers who got tired of copy-pasting between terminals.</sub>
</p>
