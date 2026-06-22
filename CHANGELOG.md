# Changelog

All notable changes to CyberStrike are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/), versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **eBPF post-exploitation tool** — 10 kernel-level programs for the `internal-network` agent, executed via `ebpf <program>` after gaining root on Linux targets
  - **Credential harvesting:** `pam_sniff` (PAM uprobe — cleartext SSH/sudo/su passwords), `ssl_sniff` (SSL uprobe — TLS plaintext capture), `keylog` (TTY kprobe — keystroke capture)
  - **Stealth operations:** `proc_hide` (hide processes from ps/top/htop), `file_hide` (hide files from ls/find), `conn_hide` (hide connections from netstat/ss)
  - **Monitoring:** `execve_sniff` (system-wide process execution tracing), `dns_sniff` (kernel-level DNS query capture), `dep_scan` (runtime dependency and vulnerable library scanner)
  - **Cleanup:** `cleanup` (enumerate and remove all CyberStrike eBPF programs from target)
- **`ebpf-attacks` skill** — kill chain methodology with 4 phases: situational awareness, credential harvesting, stealth operations, cleanup. Includes MITRE ATT&CK mappings (T1014, T1040, T1056.001, T1556) and detection considerations
- **Windows post-exploitation tool (winhook)** — 12 userland programs for the `internal-network` agent, executed via `winhook <program>` after gaining Administrator on Windows targets
  - **AV/EDR evasion:** `amsi_bypass` (patch AmsiScanBuffer in-memory), `etw_blind` (patch EtwEventWrite to blind EDR), `defender_exclude` (add Windows Defender exclusion paths)
  - **Credential harvesting:** `lsass_dump` (LSASS memory dump via comsvcs.dll/MiniDumpWriteDump), `sam_dump` (SAM/SYSTEM/SECURITY registry hive extraction), `dpapi_extract` (DPAPI secret decryption — browser passwords, WiFi, Vault), `credential_prompt` (fake CredUI dialog), `keylog_win` (SetWindowsHookEx keystroke capture), `clipboard_sniff` (clipboard monitoring)
  - **Monitoring:** `etw_process` (process creation tracking), `etw_network` (network connection tracking)
  - **Cleanup:** `cleanup_win` (event log clearing, artifact removal, Defender exclusion rollback)
- **macOS post-exploitation tool (machook)** — 12 programs for the `internal-network` agent, executed via `machook <program>` after gaining root on macOS targets
  - **Credential harvesting:** `keychain_dump` (Keychain password extraction via security CLI), `chrome_creds` (Chrome/Safari credential decryption — PBKDF2 + AES-128-CBC), `ssh_keys` (SSH private key discovery for all users), `tcc_bypass` (TCC.db manipulation for camera/mic/FDA access), `keylog_mac` (CGEventTap keystroke capture)
  - **Monitoring:** `dtrace_exec` (process execution tracing), `dtrace_net` (network connection tracing), `dtrace_file` (file access tracing)
  - **Stealth:** `xprotect_check` (XProtect/MRT/Gatekeeper/SIP/EDR enumeration), `gatekeeper_bypass` (quarantine xattr removal), `log_clear` (unified log, ASL, audit log clearing)
  - **Cleanup:** `cleanup_mac` (LaunchAgent/Daemon removal, process cleanup, temp file removal)
- **`windows-postexploit` skill** — kill chain with AV/EDR evasion → credential harvesting → monitoring → cleanup phases. MITRE ATT&CK mappings (T1003, T1056.001, T1059.001, T1562.001, T1070.001, T1555)
- **`macos-postexploit` skill** — kill chain with situational awareness → credential harvesting → monitoring → stealth → cleanup phases. MITRE ATT&CK mappings (T1555.001, T1056.001, T1059.004, T1562.001, T1070.002, T1553.001)
- **AWS post-exploitation tool (awshook)** — 10 cloud programs for `internal-network` and `cloud-security` agents, executed via `awshook <program>` with valid AWS credentials
  - **IAM exploitation:** `iam_enum` (IAM users/roles/groups enumeration + privilege escalation path analysis), `iam_privesc` (PassRole, AssumeRole, AttachPolicy, CreateAccessKey chains)
  - **Data exfiltration:** `s3_dump` (sensitive file discovery via pattern matching + download), `secrets_dump` (Secrets Manager + SSM Parameter Store extraction), `ec2_snapshot` (EBS volume snapshot + cross-account sharing)
  - **Persistence:** `lambda_backdoor` (layer injection or new backdoor function with admin role)
  - **Remote execution:** `ssm_exec` (SSM RunCommand on managed EC2 instances)
  - **Credential harvesting:** `metadata_harvest` (EC2 IMDSv1/v2, ECS task metadata, Lambda env credential extraction)
  - **Defense evasion:** `cloudtrail_blind` (stop trails, manipulate event selectors, delete logs)
  - **Cleanup:** `cleanup_aws` (restore CloudTrail, delete Lambda/IAM/EBS artifacts, clean state file)
- **Azure post-exploitation tool (azurehook)** — 8 cloud programs for `internal-network` and `cloud-security` agents, executed via `azurehook <program>` with Azure access tokens
  - **Entra ID exploitation:** `entra_enum` (users, groups, apps, service principals, directory roles via Graph API), `entra_privesc` (OAuth2 consent grant, PIM role activation, SP credential injection)
  - **Data exfiltration:** `keyvault_dump` (secrets, keys, certificates from all accessible Key Vaults), `storage_dump` (Blob storage sensitive file discovery + download)
  - **Credential harvesting:** `managed_identity` (IMDS token harvest from VM/App Service for ARM, Graph, KeyVault, Storage, SQL), `azuread_token` (FOCI client ID abuse, token refresh, JWT decode)
  - **Persistence:** `runbook_backdoor` (Automation Account Python3 runbook with callback + hourly schedule)
  - **Cleanup:** `cleanup_azure` (revoke consent grants, remove SP secrets, delete runbooks/schedules)
- **Kubernetes post-exploitation tool (kubehook)** — 7 programs for `internal-network` and `cloud-security` agents, executed via `kubehook <program>` with valid kubeconfig
  - **Enumeration:** `k8s_enum` (namespaces, pods, services, secrets, RBAC, nodes — 11 resource categories)
  - **Credential harvesting:** `k8s_secrets` (Secret extraction + base64 decode across namespaces, TLS cert/dockerconfig/SA token parsing), `etcd_dump` (direct etcd connection for protobuf-encoded secret extraction)
  - **Privilege escalation:** `k8s_privesc` (SA token theft, ClusterRoleBinding creation, TokenRequest API minting)
  - **Container escape:** `k8s_escape` (privileged mode, hostPID, hostNetwork, Docker socket, cgroup release_agent — 7 detection vectors)
  - **Persistence:** `k8s_backdoor` (privileged DaemonSet on all nodes or CronJob with callback, deployed to kube-system)
  - **Cleanup:** `cleanup_k8s` (state file + label selector `app=cyberstrike` resource removal)
- **CI/CD pipeline attack tool (cipipe)** — 5 programs for the `internal-network` agent, executed via `cipipe <program>` with platform API tokens
  - **Secret extraction:** `gh_secrets` (GitHub Actions secret enumeration, workflow log credential scanning, workflow dispatch exfiltration), `gitlab_tokens` (CI/CD variables, runner tokens, deploy tokens, project access tokens), `jenkins_creds` (credential API dump + Groovy Script Console extraction with password/SSH key/secret decryption)
  - **Pipeline injection:** `pipeline_inject` (GitHub Actions / GitLab CI workflow file injection with env exfiltration to callback URL)
  - **Cleanup:** `cleanup_ci` (GitHub/GitLab branch deletion from state file)
- **`aws-postexploit` skill** — 6-phase kill chain: recon → IAM privesc → data access → persistence → defense evasion → cleanup. MITRE ATT&CK mappings (T1078.004, T1530, T1537, T1562.008, T1098)
- **`azure-postexploit` skill** — 5-phase kill chain: Entra ID recon → privilege escalation → secret extraction → persistence → cleanup. MITRE ATT&CK mappings (T1078.004, T1552.001, T1098.001, T1550.001)
- **`k8s-postexploit` skill** — 5-phase kill chain: cluster recon → secret extraction → privilege escalation → persistence → cleanup. MITRE ATT&CK mappings (T1611, T1552.007, T1613, T1610)
- **`cicd-attacks` skill** — 4-phase kill chain: enumeration → secret extraction → pipeline injection → cleanup. MITRE ATT&CK mappings (T1195.002, T1552.004, T1059)

---

## [1.1.6] — 2026-03-30

### Added

- **Web UI v1.1.6-beta** — branding, auth, side panel, offensive tooling (#26)
- **Web UI bundled in npm package** — auto-installs to `~/.cyberstrike/web/` via postinstall
- **MCP tab in status popover** — live MCP server status from TUI
- **Bolt tab in status popover** — live Bolt connection status from TUI
- **MCP/Bolt config persistence** — save to global scope via REST API
- **npm-optimized README** — bundled in published package for npmjs.com display
- **Web UI build step** in publish workflow
- Long-running task strategy added to cyberstrike agent prompt
- Offensive security agent prompts hardened

### Fixed

- CORS and auth failures on remote/tunnel access
- MCP/Bolt status fetch on panel mount + bootstrap hardening
- Enterprise infra made conditional on `CYBERSTRIKE_ENTERPRISE` env var
- Stripe/PlanetScale providers made optional, `RegionalHostname` skipped
- XDG data path for web UI install in postinstall
- `PUBLISH_TOKEN` PAT fallback in publish workflow

### Changed

- Enterprise infrastructure no longer loaded by default — opt-in via env

---

## [1.1.4] — 2026-03-18

### Added

- Intelligence layer, SEO optimization, and Bolt 1:N architecture in README rewrite
- Offensive security agent prompts and hardened publish script
- `--beta` flag for install script

### Fixed

- Schema reconciler to repair partially applied migrations
- @opentui/core and @opentui/solid updated to 0.1.88
- Auto-fallback to available port when default port is busy
- Scoped package names in uninstall script
- npm install commands and domain references on website
- Billing header for OAT token auth on Sonnet/Opus models
- All `cyberstrike.us` references replaced with `cyberstrike.io`
- Bin launcher script renamed `opencode` → `cyberstrike`

### Changed

- npm scope renamed `@cyberstrikeus` → `@cyberstrike-io`
- License consolidated to AGPL-3.0-only, copyright year updated
- Docker removed from build pipeline
- Tauri desktop app removed (opencode legacy)
- 13 unused workflows inherited from opencode removed
- Playwright e2e removed from test workflow

---

## [1.1.0] — 2026-03-17

### Added

- **Bolt remote tool server** — full client integration with Ed25519 key pairing, SDK fetch chain, live sidebar status
- **Bolt management from TUI** — add, delete (`Ctrl+D`), configure Bolt connections
- **MCP server management** — add/remove MCP servers from TUI with duplicate detection and validation
- **Local LLM provider support** — connect to any OpenAI-compatible endpoint (vLLM, Ollama, LM Studio)
- **23-language README** — complete rewrite with social preview SVGs (dark + light) using the CyberStrike logo
- **MCP ecosystem showcase** — hackbrowser-mcp, cloud-audit-mcp, github-security-mcp, cve-mcp, osint-mcp
- GitHub issue templates (bug report, feature request, security tool request)
- PR template with security impact section
- SECURITY.md with threat model and disclosure policy
- CONTRIBUTING.md with MCP ecosystem and community links

### Fixed

- Config discovery: `findUp` correctly locates `.cyberstrike/` config files
- Lazy tool registry refresh on `ToolListChanged` notification
- `Bus.subscribe` deferred to `init()` to avoid Instance context error
- Bolt auth error detection and user feedback
- opentui border rendering bug in prompt input
- @opentui/core updated 0.1.79 → 0.1.87
- SVG `<filter>` elements removed for GitHub rendering compatibility
- Discord invite link fixed across all files (`discord.gg/snunAaHf6U`)
- LSP section hidden from sidebar (not applicable to security agents)

### Changed

- Bolt delete keybind changed from `d` to `Ctrl+D` to avoid conflicts with search input

---

## [1.0.8-beta.1] — 2026-03-15

### Added

- **13+ specialized security agents** — cyberstrike (primary), web-application, mobile-application, cloud-security, internal-network
- **8 proxy testing agents** — IDOR, Authorization Bypass, Mass Assignment, Injection, Authentication, Business Logic, SSRF, File Attacks
- **120+ OWASP WSTG test cases** built into agent methodology
- Common vulnerability testing prompt shared across all proxy agents
- Vulnerability reporting dialog in TUI
- Web proxy context dialog and request detail tools
- Vulnerability PoC and business impact DB migrations

### Changed

- Default agent renamed from `build` to `cyberstrike`
- All specialty agents visible in tab agent list
- Removed plan mode tools and workflow

### Fixed

- Crash in error handler (missing ResolveMessage import)
- Stale "build" agent references in config schema
- Debug/placeholder fields removed from package.json

---

## [0.1.0] — 2026-02-16

### Added

- Initial public release of CyberStrike
- Fork of [opencode](https://github.com/anomalyco/opencode) with offensive security focus
- Claude Code CLI/API provider integration
- Cloud security agent
- Chunked context compaction and pre-compaction memory flush
- Browser tool for default agents
- MCP browser server for Claude CLI tool support
- ASCII logo with theme colors

### Fixed

- Rebrand: OpenCode → CyberStrike across terminal title, sidebar, all references
- Claude CLI timeout increased to 15 minutes
- Session-id continuity for multi-turn tool calling
- Infinite loop prevention in multi-step tool calling
- Empty endpoint migration placeholder

---

[1.1.6]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.1.6
[1.1.4]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.1.4
[1.1.0]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.1.0
[1.0.8-beta.1]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.0.8-beta.1
[0.1.0]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v0.1.0
