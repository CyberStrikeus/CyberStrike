# Changelog

All notable changes to CyberStrike are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/), versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

## [1.1.16] — 2026-08-08

### Added

- **linuxhook** — 120 native TypeScript post-exploitation programs across 9 categories (recon, credentials, privesc, persistence, lateral movement, evasion, exfiltration, network attacks, IPv6) with bash/sh/python3/perl fallback chain
- **llmhook** — 23 LLM security testing programs (OWASP LLM Top 10), 130+ probes/payloads with `--format openai|anthropic|generic`
- **containerhook** — 7 Docker container security programs (escape, privesc, pivoting)
- **iachook** — 8 Terraform/IaC audit programs
- **k8s-audit** — 10 read-only Kubernetes security assessment programs
- **ci-audit** — 8 CI/CD pipeline security programs (GitHub Actions, GitLab CI, Jenkins, CircleCI)
- **gcphook** — native GCP post-exploitation tool
- **cloud_audit** — native cloud security audit tool for `internal-network` and `cloud-security` agents
- Skills: `linux-postexploit` (kill chain + MITRE ATT&CK), `ci-assessment`
- **cve-mcp dynamic CTA** — all OS hooks guide agents to query `cve-mcp` for discovered services

### Changed

- **winhook** — modular refactor (16 files, 154 programs) + cmd.exe/reg.exe/wmic fallback
- **machook** — modular refactor (10 files, 46 programs) with new credential/lateral/evasion handlers
- **azurehook, kubehook, cipipe** — converted from Python to native TypeScript
- **`macos-postexploit` skill** — updated from 12 to 46 programs

### Fixed

- **Hackbrowser:** shell quoting error in Chromium path detection
- **Hackbrowser:** Esc now stops the crawl subprocess (previously continued in background)
- **Build:** bundled migration crash on first-time setup (Drizzle ORM 1.0 missing `name` field)
- **Provider:** Vertex AI autoload, regional endpoints, Copilot stale response IDs, Gemini/Copilot schema sanitization, overflow detection for 5 new providers, Devstral Turkish locale fix, Codex compatibility
- **MCP:** orphan process cleanup, token masking, tool execution crash handling, URL validation
- **Session:** auto-compaction toggle, content-filter surfacing, empty message filtering, reasoning fallback
- **Config:** CRLF frontmatter, invalid permission JSON, inaccessible config dirs
- **Tools:** destructive edit prevention, symlink grep, script binary detection, Windows permission paths
- **Other:** entity double-escaping, ID generation modulo bias, backslash escaping in sanitization

### Security

- **fast-xml-parser** 5.9.3 → 5.10.1 (DoS via XML parsing)
- **dompurify** 3.4.11 → 3.4.13 (XSS via hook removal)

### Testing

- **inject-probe** — 13 new test files (payload battery, cross-location injection, WAF detection, XSS routing)
- **vuln-scope** — 7 new test files, 166+ test cases

---

## [1.1.15] — 2026-06-23

### Added

- **eBPF post-exploitation tool** — 10 kernel-level programs for credential harvesting, process/file/connection hiding, system monitoring, and cleanup
- **eBPF blind spot monitors** — 20 kernel-level detection programs covering io_uring bypass, memfd fileless exec, ptrace injection, VDSO side-channels, namespace escape, and 14 more attack primitives
- **winhook** — 12 Windows post-exploitation programs (AV/EDR evasion, credential harvesting, monitoring, cleanup)
- **machook** — 12 macOS post-exploitation programs (Keychain, Chrome creds, SSH keys, TCC bypass, DTrace tracing)
- **awshook** — 10 AWS post-exploitation programs (IAM privesc, S3/Secrets dump, Lambda backdoor, CloudTrail evasion)
- **azurehook** — 8 Azure post-exploitation programs (Entra ID, Key Vault, managed identity, runbook backdoor)
- **kubehook** — 7 Kubernetes post-exploitation programs (secrets extraction, container escape, RBAC privesc)
- **cipipe** — 5 CI/CD attack programs (GitHub Actions/GitLab/Jenkins secret extraction, pipeline injection)
- Skills: `ebpf-attacks`, `windows-postexploit`, `macos-postexploit`, `aws-postexploit`, `azure-postexploit`, `k8s-postexploit`, `cicd-attacks` — all with MITRE ATT&CK mappings
- **GitHub Copilot Enterprise provider** — Claude/GPT/Gemini at zero cost through Copilot, OAuth device flow auth
- **DAST proxy-testing memory** — per-credential coverage notes, observed values for IDOR substrate
- **GraphQL & JSON-RPC** as first-class endpoints with deterministic op-keys
- `web_get_detail` tool, vulnerability triage lifecycle with grouped views, hybrid HackerOne-ready report generation

### Changed

- **Bounded session context** — `web_get_session_context` returns scoped data instead of full session dump (O(N²) → O(1) per call)

### Fixed

- Endpoint over-fragmentation for form/multipart POST bodies
- Phantom hosts from `//`-relative targets and HTTP/2 `:authority`
- Silent vulnerability loss in dedup path (~50% drop rate → 0)
- Proxy-flow ordering (analyzer blocks before tester subagents)
- Hackbrowser crawl coverage (shadow-DOM, web components, framework bindings, ephemeral ID rejection)
- Hackbrowser provider routing for non-OpenAI keys
- Token cost double-charging for reasoning tokens

---

## [1.1.6] — 2026-03-30

### Added

- **Web UI v1.1.6-beta** — branding, auth, side panel, offensive tooling
- Web UI bundled in npm package (auto-installs to `~/.cyberstrike/web/`)
- MCP/Bolt status tabs in TUI status popover with config persistence

### Fixed

- CORS and auth failures on remote/tunnel access
- Enterprise infra made conditional on `CYBERSTRIKE_ENTERPRISE` env var
- Stripe/PlanetScale providers made optional

---

## [1.1.4] — 2026-03-18

### Added

- Intelligence layer, SEO optimization, Bolt 1:N architecture in README
- `--beta` flag for install script

### Fixed

- Schema reconciler for partially applied migrations
- Auto-fallback to available port when default port busy
- npm scope renamed `@cyberstrikeus` → `@cyberstrike-io`
- All `cyberstrike.us` → `cyberstrike.io`
- Bin launcher `opencode` → `cyberstrike`

### Changed

- License consolidated to AGPL-3.0-only
- Docker and Tauri desktop app removed (opencode legacy)
- 13 unused inherited workflows removed

---

## [1.1.0] — 2026-03-17

### Added

- **Bolt remote tool server** — Ed25519 key pairing, SDK fetch chain, live sidebar status, TUI management
- **MCP server management** — add/remove from TUI with validation
- **Local LLM provider support** — any OpenAI-compatible endpoint (vLLM, Ollama, LM Studio)
- 23-language README with social preview SVGs
- GitHub issue/PR templates, SECURITY.md, CONTRIBUTING.md

### Fixed

- Config discovery, lazy tool registry, Bus.subscribe timing, Bolt auth, opentui borders

---

## [1.0.8-beta.1] — 2026-03-15

### Added

- **13+ specialized security agents** (web, mobile, cloud, internal-network, 8 proxy testing agents)
- **120+ OWASP WSTG test cases** built into agent methodology
- Vulnerability reporting dialog and web proxy context tools

---

## [0.1.0] — 2026-02-16

### Added

- Initial public release of CyberStrike
- AI-powered offensive security agent platform with 13+ specialized agents
- Claude Code CLI/API provider, cloud security agent, chunked context compaction
- MCP browser server, ASCII logo

---

[1.1.16]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.1.16
[1.1.15]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.1.15
[1.1.6]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.1.6
[1.1.4]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.1.4
[1.1.0]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.1.0
[1.0.8-beta.1]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.0.8-beta.1
[0.1.0]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v0.1.0
