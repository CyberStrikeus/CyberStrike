<p align="center">
  <img src="https://raw.githubusercontent.com/CyberStrikeus/CyberStrike/dev/assets/social-preview-dark.svg" alt="CyberStrike" width="800">
</p>

<h3 align="center">The first open-source AI agent built for offensive security.</h3>

<p align="center">
  Automated penetration testing from your terminal — plug in your Claude, GPT, or any LLM subscription<br>
  and turn it into an autonomous red team agent with 7,300+ security skills across MITRE ATT&CK, CIS, OWASP, and NIST.
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

That's it. CyberStrike launches a TUI in your terminal, asks for your LLM provider and API key on first run, and you're ready to go. Tell it what to test — it loads relevant skills from 7,300+ MITRE ATT&CK, CIS, OWASP, and NIST test procedures, then handles reconnaissance, vulnerability discovery, exploitation, and reporting autonomously.

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

### Skills System — 7,300+ Actionable Security Tests

CyberStrike doesn't just give agents generic security knowledge — it loads domain-specific skills on-demand with zero context pollution.

**What's a skill?** A skill is a structured test procedure that includes:

- Target methodology (OWASP WSTG, MITRE ATT&CK, CIS Benchmark, NIST)
- Copy-paste ready test commands
- Tool references and dependencies
- Remediation guidance
- CWE mappings and severity ratings

**Coverage:**

| Framework          | Skills | What It Includes                                                                    |
| ------------------ | ------ | ----------------------------------------------------------------------------------- |
| **MITRE ATT&CK**   | 691    | Enterprise tactics + 2,000+ Atomic Red Team tests (Kerberoasting, LSASS dump, etc.) |
| **CIS Benchmarks** | 1,500+ | Cloud (AWS/Azure/GCP), Containers (Docker/K8s), OS (Ubuntu), Server (Apache/Nginx)  |
| **OWASP WSTG**     | 125    | Web app security testing (XSS, SQLi, AuthN, AuthZ, Session, API)                    |
| **NIST**           | 200+   | Security controls and compliance frameworks                                         |

**Lazy Loading** — Skills load only when needed. An agent testing for Kerberoasting pulls T1558.003 skill (7 Atomic tests) into context, runs the tests, then discards it. Next test = new skill. Zero bloat.

**Search & Discovery** — Built-in skill search with relevance scoring. Query by keyword, tech stack, CWE ID, or category. 7,633 skills indexed in-memory.

```bash
# Example: Agent loads T1558.003 Kerberoasting skill
Skill: T1558.003 - Kerberoasting
Tests: 7 Atomic Red Team test scenarios
Tools: Invoke-Kerberoast.ps1, Rubeus, setspn
Platforms: Windows
```

Read more: [MITRE ATT&CK Integration](https://github.com/CyberStrikeus/CyberStrike/blob/main/.cyberstrike/skill/mitre_attack/), [CIS Benchmarks](https://github.com/CyberStrikeus/CyberStrike/tree/main/.cyberstrike/skill/CIS_benchmarks)

---

### What Makes It Different

<table>
<tr>
<td width="50%">

**7,300+ Security Skills, Not Generic Prompts**

CyberStrike agents don't improvise — they follow proven methodologies with lazy-loaded skills. Testing for Kerberoasting? Load T1558.003 (7 Atomic Red Team tests). Auditing Docker? Load CIS Docker v1.8.0 (118 controls). Agents pull exactly what they need, execute structured test procedures with copy-paste commands, then discard. Zero context pollution. Real pentest frameworks: MITRE ATT&CK, CIS Benchmarks, OWASP WSTG, NIST.

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

Run `cyberstrike web` and control your agents, MCP servers, Bolt connections, and vulnerability findings from any browser. Access from anywhere with Cloudflare Tunnel — zero open ports, end-to-end encryption, password-protected API. Your data stays on your machine.

```bash
export CYBERSTRIKE_SERVER_PASSWORD=your-secure-password
cyberstrike web
```

Use **[app.cyberstrike.io](https://app.cyberstrike.io)** (static page, no backend) or self-host from `packages/app/dist/`.

See the [full README](https://github.com/CyberStrikeus/CyberStrike#web-ui--remote-access) for the complete security model.

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
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)         | 39    | Browser-based security testing — XSS, CSRF, DOM manipulation, cookie theft |
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

Read the [Contributing Guide](https://github.com/CyberStrikeus/CyberStrike/blob/dev/CONTRIBUTING.md) before submitting a PR. All contributions must follow the project's [ethical use policy](https://github.com/CyberStrikeus/CyberStrike/blob/dev/CODE_OF_CONDUCT.md) — CyberStrike is for authorized security testing only.

---

### License

[AGPL-3.0-only](https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE) — Free for personal and open-source use. Commercial licensing available via [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

### MCP Security Suite

CyberStrike is the core platform. These MCP servers extend its capabilities:

| Project                                                                | Domain                                  | Tools                                       |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------- |
| **CyberStrike**                                                        | **Autonomous offensive security agent** | **7,300+ skills (MITRE, CIS, OWASP, NIST)** |
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)         | Browser-based security testing          | 39 tools, Firefox, injection testing        |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | Cloud security (AWS/Azure/GCP)          | 38 tools, 60+ checks                        |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | GitHub security posture                 | 39 tools, 45 checks                         |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | Vulnerability intelligence              | 23 tools, 5 sources                         |
| [osint-mcp](https://github.com/badchars/osint-mcp-server)              | OSINT & reconnaissance                  | 37 tools, 12 sources                        |

---

<p align="center">
  <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a> · <a href="https://docs.cyberstrike.io"><b>Docs</b></a> · <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrikeio"><b>X.com</b></a> · <a href="https://github.com/CyberStrikeus/CyberStrike"><b>GitHub</b></a>
</p>
<p align="center">
  <sub>Built by hackers who got tired of copy-pasting between terminals.</sub>
</p>
