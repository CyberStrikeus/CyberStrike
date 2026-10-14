# Changelog

All notable changes to CyberStrike are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/), versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

## [2.0.0] — 2026-10-14

CyberStrike 2.0 — the first fully public open-core release. 1,284 commits since v1.1.16. The AI-pentester brain, orchestration engine, and all execution tools ship under AGPL-3.0-only; SaaS becomes a separate product built on top, not a code gate.

### Added

**UI / Desktop / v2 Shell**
- Tabbed multi-session interface (v2 shell) as the default across Web and Desktop — tabs, home page, command palette, session avatars with live progress
- Electron desktop app (macOS/Windows/Linux) with bundled server sidecar and CyberStrike branding
- 21 palette themes with automatic v2 token derivation
- `/pin` sessions (Alt+1–9 quick switch), `/timestamps` toggle, `/web` context viewer, `/skills` browser, `/rename`, `/copy`, `/timeline`, `/thinking`, `/status`, `/help` slash commands
- Log viewer under Settings > Help > Logs
- Vulnerability detail panel with severity badges, triage lifecycle, and Bugcrowd-format export
- Vortex Signals sidebar view with triage filter and category grouping

**HackBrowser / Web Pipeline**
- HackBrowser 2.0 — AI-driven navigation (LlmNavigator), framework-adaptive execution, DataCollector, JS-bundle route mining, secret scanning, source-map parsing
- Browser extension with co-driving overlay, control channel, multi-profile credential launcher, and CyberStrike panel
- WSTG-aligned specialist agents: authentication (4.4), authorization (4.5), session management (4.6), input validation (4.7), cryptography, error handling, identity management, API security (OWASP API Top-10)
- Deterministic probe tools: `access_probe`, `session_probe`, `crypto_probe`, `error_probe`, `login_probe`, `identity_probe`, `inject_probe` (XSS PoC, blind SQLi, SSRF OOB, CRLF, Host Header, Mass Assignment, HTTP Verb Tampering, file upload bypass)
- Injection probe engine — open-redirect, CRLF, command-injection, name/type targeting, WAF bypass encoding
- Code-enforced verification gate (evidence-based via `http_replay` + verification tokens), severity caps per vulnerability class, impact gate for false-positive elimination
- Escalation & correlation hunter agent with loadable chain catalog
- Assessment completion supervisor with resume-after-complete
- Self-hosted OOB interaction server for blind vulnerability confirmation

**Vortex (HTTP Traffic Engine)**
- Full `@cyberstrike-io/vortex` package — DSL rule engine, HTTPQL query language, durable SQLite store, HAR import/export
- 24 declarative tech-detection rule packs (~1000 rules) + security/bot-management fingerprints (40 products)
- Chain rules for multi-step correlation, probe rules (SSTI, path-traversal, active injection), aggregate rules
- Signal triage lifecycle (new/reviewed/confirmed/dismissed/escalated) with API endpoints
- Injection-point inventory with parameter-precise leads, coverage tracking, and gated active probing
- Canary correlation — same-request + stored cross-request reflection with context scoring
- Value-correlation (taint) chains for field-name-agnostic chained vulnerability detection

**`http_replay` Engine**
- Lossless HTTP message model with field-level mutation (query, headers, body, cookies, path)
- Dual backend — structured fetch + byte-exact raw TCP/TLS socket send
- Bounded-concurrency batch runner with retry, idempotency guard, circuit breaker, and rate governance
- Response observation and baseline diff, composable encoding toolkit, curl-equivalent export

**Cloud Security**
- `@cyberstrike-io/aws` (185 programs), `@cyberstrike-io/azure`, `@cyberstrike-io/gcp` domain packages with pre-flight simulate + detection mapping
- Cloud orchestrator with 9 analyst subagents, chain verification, and final validation agents
- Structured inventory system (CloudAsset/CloudEdge/CloudExposure) with graph-based chain detection

**Brain / SaaS**
- SaaS brain package — protocol, runner, playbook, relay, and remote tool dispatch
- BYO-key support + credit wallet with token usage tracking
- `cyberstrike brain` CLI command

**Domain Plugin Architecture**
- Pluggable domain packages with manifest auto-discovery (`cyberstrike domains list`)
- Runtime tier gating (free/pro/enterprise) with domain specialist routing
- Core API versioning (CORE_API_VERSION) with compatibility checks
- `input.core.web` building-block kit and third-party authoring contract

**Inspection Pipeline**
- InspectionQueue with lease-based dispatch, lifecycle phase detection, and sidebar indicator
- WebInspectionRouter with multi-source reconciliation and agent dispatch
- Parallel RetestWorker with per-endpoint scenario model and bounded fan-out

**Infrastructure / CLI**
- `web --open/--no-open` flag for headless serve
- HAR → CyberStrike ingest bridge for offline/extension capture
- OpenAPI/Swagger spec enumeration and scanning at ingest
- CDP stealth module (WebGL/Canvas/screen fingerprint protection, system Chrome auto-detect)
- Docs site moved into monorepo as `packages/docs`

### Changed

- **Web Pipeline:** Replace monolithic web-application agent with modular proxy-agent architecture and WSTG-aligned specialist dispatch
- **Web Pipeline:** Deterministic dispatcher replaces per-transaction orchestrator brief — LLM triggered only on signal-producing transactions
- **Vortex:** Migrate rules and queries to the DSL engine, retire HTTPQL
- **HackBrowser:** Extension communicates directly with CyberStrike server, drop intermediate receiver
- **HackBrowser:** R0–R2 refactor — extract 1859-line monolith into 17 modules with shared probe runner
- **Cloud:** Decouple Azure (paid tier) from open-core host; extract to `@cyberstrike-io-ent/azure`
- **Cloud:** Replace hardcoded cloud agents with specsToAgents bridge, make orchestrator provider-agnostic
- **Providers:** Migrate Anthropic OAuth/subscription model to LanguageModelV3; align @ai-sdk/* pins to v6-native
- **Providers:** Route Claude models through Anthropic Messages API, GPT-5 Copilot models through Responses API
- **UI:** Canonical severity color scheme across all surfaces — crit+high=red, medium=orange, low=yellow, info=gray
- **UI:** Unify vulnerability display format across TUI/web/desktop
- **CLI:** Align slash command names and aliases across TUI, Web, and Desktop
- **License:** All packages unified under AGPL-3.0-only

### Fixed

- **HackBrowser:** Detect browser death and gracefully terminate crawl instead of hanging
- **HackBrowser:** Worker crash safety net — one throw can't kill the entire crawl
- **HackBrowser:** Ingest full-page navigations, not just fetch/XHR; static JS/CSS assets no longer counted as endpoints
- **HackBrowser:** LLM navigator works with thinking/reasoning models
- **HackBrowser:** Mark frontier URL visited on navigate, so redirects can't spin the crawl
- **HackBrowser:** SIGKILL spawned browsers on process teardown, not just SIGTERM
- **Web Pipeline:** Cap agent scaling at MAX_AGENTS_PER_GROUP (4) to prevent runaway spawning
- **Web Pipeline:** Continuous worker-pool drain — no longer serialize behind one slow specialist
- **Web Pipeline:** Dedup fence keeps the highest-severity finding as primary; retroactive reconciliation on first read
- **Web Pipeline:** Recover stalled/failed dispatches; re-arm dispatcher against lost wakeups
- **Web Pipeline:** Re-arm lifecycle poll on re-entry so phase never sticks at 'inspecting'
- **Vortex:** Acknowledge structurally un-routable signals; mark unroutable items examined so the queue drains
- **Vortex:** Bridge uses durable SqliteStore, not MemoryStore
- **Providers:** Abort stalled provider stream instead of hanging the loop forever
- **Providers:** Cap LLM retry at 5 to prevent infinite loops; handle undefined finishReason
- **Providers:** Exchange GitHub OAuth token for Copilot session token; retry once with fresh token on 403
- **Desktop:** Prefer workspace `app/dist` over data-dir copy for web UI; boot the bundled server correctly on first launch
- **Desktop:** Gate macOS signing/notarization on CSC_LINK; fix platform=all building zero targets
- **UI:** Guard 15+ sdk()/sync() accessors against undefined during init — prevent crashes on cold start
- **UI:** Provide top-level QueryClientProvider so v2 createMutation works
- **CLI:** Cap process stdout/stderr to 5MB to prevent OOM
- **CLI:** Add 5s force-exit watchdog after stdin close; abort crawl on stdin close to prevent orphan processes
- **Security Tools:** Professional finding format — flat H2 sections, CWE+OWASP tags, safe PoC
- **MCP:** Survive EMFILE/ENFILE during skill load + bound concurrency
- **Build:** Break web↔cyberstrike cyclic build dependency; ship declaration types for domain packages

### Performance

- **Vortex:** Reverse-index prefilter for 20k×20k rule/request workloads
- **Vortex:** Corpus analysis moved off the hot signals read path; chain value-reuse join indexed
- **Vortex:** Compile regexes once + add `~=` literal-contains operator
- **Inspection:** Drop redundant reclaimStale scan from wake()

### Security

- **Vortex:** Replay never touches the original request; replay verified end-to-end
- **Vortex:** DSL regex ReDoS guard; surface swallowed ingest failures at WARN
- **Security Tools:** Block bun/node/nc/socat bash bypasses in vuln agent denies

### Documentation

- Docs site overhaul — consolidate permissions, hooks, providers, CLI, MCP, slash commands into single pages; remove 90+ orphan files across 9 locales
- README rewrite — outcome-first structure, correct MCP claims, add Vortex
- Vortex architecture doc, roadmap, agent-authoring + SDK/embedding guide
- HackBrowser 2.0 design — AI-driven navigator, framework-adaptive strategies
- Desktop enterprise deployment — Azure Trusted Signing setup + deployment guide

### Infrastructure

- Windows MSI + macOS pkg managed-deploy targets; wire Windows + mac-installer signing
- Add canary channel for throwaway test builds; add platform input for single-OS builds

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
