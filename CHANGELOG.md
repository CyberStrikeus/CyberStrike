# Changelog

All notable changes to CyberStrike are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/), versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

## [2.0.0] — 2026-11-07

CyberStrike 2.0 — the first fully public, open-core release, and effectively a rebuild: ~1,400 commits since v1.1.16. The execution and reasoning stack — HackBrowser, the Vortex traffic engine, the WSTG web pipeline and all its probes, the cloud program libraries, and the orchestration engine — ships under AGPL-3.0-only.

### Added

- A new, ownable Caido/Burp-class traffic engine with a durable, queryable corpus (SQLite-backed `SqliteStore`, with a `MemoryStore` for ephemeral use) and HAR import/export for interop with browsers, Burp, and Caido.
- One predicate DSL drives both rule conditions and agent queries, subsuming the former HTTPQL: logical/comparison/arithmetic operators, 24 functions (`contains`, `regex`, `jwt_header/payload/alg`, `base64_decode`, `compare_versions`, `count_header`, …) and corpus quantifiers (`any`/`all`/`count`/`countDistinct`), behind a ReDoS guard (`regex()` is full-scope-only, 2,000-char pattern cap, 1 MB subject cap).
- Rules are declarative data in four shapes — Declarative (one response), Aggregate (collapse many matches into one finding), Chain (multi-step cross-request correlation), and Probe (active: select → inject `{canary}` → detect). Ships ~650 technology-detection fingerprints across ~24 packs plus 106 security & bot-management fingerprints (WAFs, CAPTCHAs, bot/fraud protection).
- Canary correlation (same-request plus stored second-order reflection, with context scoring and an SSTI template-canary) and value-correlation "taint" chains that correlate by value rather than field name, so an identifier chains across requests even when the field is renamed.
- Signal triage lifecycle (`new → reviewed → confirmed → dismissed → escalated`) with API endpoints, an injection-point inventory (query/body/path/header, value-typed) with coverage tracking, and a reverse-index prefilter built for 20k × 20k rule/request workloads.

- Two agent tools, `http_replay` (structured) and `http_replay_raw` (byte-exact raw TCP/TLS). A lossless HTTP message model preserves header order, case, and duplicates, and deliberately does NOT normalize the target (`..`, `%2e`, `//` survive), so path-confusion and request-smuggling tests mean what they say.
- Field-level mutation across query, headers, body (raw and JSON dot-path), cookies, path, and method — each value optionally run through an 11-codec encoding pipeline (`url`, `url-double`, `base64(url)`, `hex`, `html-dec/hex`, `unicode`, …), the basis for WAF-bypass encoding.
- A governed batch runner: bounded or AIMD-adaptive concurrency, token-bucket rate pacing, per-host circuit breaker, idempotent-only retry, and a hard 5,000-request per-session global budget (anti-self-DoS). Baseline-vs-exploit diff in a single call; a single-quoted `curl` equivalent returned as evidence; replays are scope-guarded to already-captured hosts.

- The monolithic web-application agent is replaced by 13 WSTG-aligned specialist agents, one per WSTG top-level category (4.1 Information Gathering through 4.12 API Testing / OWASP API Top-10) plus a custom LLM/AI-security lane, beneath an orchestrator (`wstg-agent`) and a cross-cutting `escalation-hunter`.
- Deterministic probe tools owned per specialist: `access_probe` (cross-identity BAC / IDOR / BOLA / BFLA), `session_probe` (JWT alg:none / weak-HMAC / kid-traversal / RS256→HS256 confusion / cookie entropy), `crypto_probe` (cleartext / HSTS / mixed content + live TLS handshake), `error_probe`, `identity_probe`, `login_probe` (default-creds / lockout / enumeration), and `inject_probe`.
- `inject_probe` covers 15 injection classes: reflected XSS with a self-submitting-page PoC, blind/time-based SQLi, NoSQL/LDAP/XPath differentials, SSTI, command injection, LFI, CRLF, Host-header, mass-assignment, HTTP verb tampering, file-upload bypass (classifies stored vs executed), and HPP — with WAF detection and percent-encoding evasion. SSRF (out-of-band) and open-redirect are handled through dedicated paths.
- A deterministic dispatcher spawns a specialist only for a routable, medium-or-higher signal — low/info/technology leads stay visible in the sidebar and never burn a model call; a continuous worker pool (default 3 in flight) with timeout/lease recovery keeps the queue draining.
- An evidence gate: a finding cannot leave "draft" without a hashed `http_replay` verification token derived from its own evidence request-ids; an impact oracle downgrades unproven claims (open-redirect proven only on a realized off-site 302, XSS only on a browser-canary execution, authorization only on a success-vs-denial differential); per-class severity caps can only lower severity; a dedup fence merges duplicates and one-issue-across-many-endpoints.
- A loadable escalation chain catalog (`ssrf-internal`, `idor-mass`, `redirect-oauth`, `cors-token`, `bfla-privesc`, `jwt-authz`, …, overridable via external packs), an assessment-completion supervisor that re-wakes the deterministic runners and resumes only when coverage is incomplete, and a self-hosted OOB interaction server (`cyberstrike oob`) for blind SSRF / RCE / XXE / SQLi / SSTI and DNS exfil confirmation — no third-party service required.
- Per-role credential capture is now per origin/host (fixing cross-host identity bleed), and a discovery engine (crawl, JS-bundle route & secret mining, source-map parsing, OpenAPI import, well-known probing) feeds a per-session endpoint-template cache.

- AI-driven navigation (`LlmNavigator` — "observe → interpret", with a deterministic fallback on any model failure), framework fingerprinting (SPA/SSR) feeding a framework-adaptive executor, a `DataCollector` that classifies every request, JS-bundle route mining, secret scanning (AWS/Google/GitHub/Slack keys and JWTs, values redacted), and source-map parsing. The 1,859-line crawl monolith was split into ~17 modules over a shared probe runner.
- A real MV3 browser extension ships with the appliance and desktop app: a draggable CyberStrike panel and co-driving overlay (AI → Human → Idle driver toggle with a HUD, synthetic cursor, and reasoning narration), a direct server control channel (the intermediate receiver is gone), and a multi-profile credential launcher that spawns a color-badged Chrome-for-Testing profile per role.
- Crawl safety: browser-death detection, a worker-crash net, SIGKILL on teardown, and visited-on-navigate so redirects can't spin the crawl.

- Three domain packages — `@cyberstrike-io/aws` (174 offensive programs), `@cyberstrike-io/azure` (156, including an M365 lane), `@cyberstrike-io/gcp` (34, a 4-phase assessment) — with every program detection-mapped to the CloudTrail event and GuardDuty finding it would trigger, and AWS actions gated by an `iam simulate-principal-policy` pre-flight (including a 21-vector privilege-escalation-path scan).
- One provider-agnostic orchestrator over the `AssessmentProvider` interface runs a Layer-2 agentic pipeline (identity → triage → parallel → sync → followup → verify → complete) with per-service-group analyst subagents (AWS 9 / Azure 9 / GCP 6) plus shared `cloud-orchestrator`, `cloud-batch-verifier`, `cloud-followup`, `cloud-verify`, and a red `escalation-hunter`.
- A provider-agnostic inventory graph (`CloudAsset` / `CloudEdge` / `CloudExposure`) traversed deterministically by 7 chain patterns (privilege-escalation, lateral-movement, data-exfiltration, subdomain-takeover, credential-harvest, identity-pivot, network-path), replacing LLM-guessed follow-up detection.

- Native (non-MCP) domain plugins: a package default-exports `(input) => Promise<Hooks>`, the host injects a typed `CoreRuntime` as `input.core`, and packages import types only (erased at build). `CORE_API_VERSION = 2.0.0`, with `requireCoreApi()` fail-fast compatibility checks.
- Plugins contribute custom tools (`tool({ description, args, execute })`) into the host registry, and hook a broad event surface (`event`, `config`, `tool`, `provider`, `auth`, `chat.message/params/headers`, `permission.ask`, `command.execute.before`, `tool.execute.before/after`, `shell.env`, plus experimental transforms).
- The `input.core.web` building-block kit exposes the governed-send seam, the lossless message model and pure transforms, and the replay engine + captured-traffic store, so third-party web tools get the same governed, in-scope request machinery as the first-party probes. Static `cyberstrike` package manifest + auto-discovery via `cyberstrike domains list` / `domains info`.

- Tabbed multi-session v2 shell as the default across Web and Desktop (tabs, home page, command palette, live-progress session avatars), plus an Electron desktop app (macOS/Windows/Linux) with a bundled server sidecar and signed MSI/pkg managed-deploy targets.
- One shared command catalog consumed by TUI, Web, and Desktop so slash names, aliases, categories, and behavior can't drift; new/unified `/pin` (Alt+1–9 quick switch), `/web` context viewer, `/skills` browser, `/timestamps`, `/thinking`, `/rename`, `/copy`, `/timeline`, `/status`, `/help`, plus real Methodology and Report dialogs on the web app.
- Canonical severity colors across every surface (crit+high red / medium orange / low yellow / info gray), a unified vulnerability panel (severity badges, triage lifecycle, Bugcrowd-format export), a Vortex Signals sidebar, 21 palette themes with automatic v2 token derivation, and a log viewer under Settings → Help → Logs.
- Model selection now persists server-side, so every out-of-band action (navigator, compaction, idle resume) uses the model you picked instead of silently falling back to the catalog default.

- InspectionQueue with lease-based dispatch and lifecycle phase detection (with a sidebar indicator), a WebInspectionRouter with multi-source reconciliation, and a parallel RetestWorker with a per-endpoint scenario model and bounded fan-out.
- HAR → CyberStrike ingest bridge for offline/extension capture, OpenAPI/Swagger spec enumeration at ingest, a CDP stealth module (WebGL/Canvas/screen fingerprint protection, system-Chrome auto-detect), and a `web --open/--no-open` flag for headless serve.

### Changed

- **Web pipeline:** the monolithic web-application agent and its per-transaction "proxy agents" are replaced by WSTG specialists behind a deterministic dispatcher — the LLM fires only on signal-producing transactions, never in the byte-level hot path.
- **Vortex:** rules and queries migrated to the DSL engine; HTTPQL retired (the DSL subsumes it).
- **HackBrowser:** the extension talks directly to the CyberStrike server (intermediate receiver dropped); the 1,859-line crawl monolith refactored into ~17 modules over a shared probe runner.
- **Cloud:** hardcoded cloud agents replaced by a `specsToAgents` bridge that turns each provider's declarative `AgentSpec`s into host agents, making the orchestrator provider-agnostic and letting web/cloud/mobile/internal specialists all come from the domain registry.
- **Providers:** Anthropic OAuth/subscription migrated to LanguageModelV3 and `@ai-sdk/*` aligned to v6-native; Claude routes through the Anthropic Messages API, GPT-5 Copilot models through the Responses API.
- **UI/CLI:** canonical severity colors and a unified vulnerability format across TUI/Web/Desktop; slash command names and aliases aligned across all three surfaces from the shared catalog.
- **License:** all packages unified under AGPL-3.0-only.

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
