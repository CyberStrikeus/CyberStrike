# Changelog

All notable changes to CyberStrike are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/), versions follow [Semantic Versioning](https://semver.org/).

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

[1.1.0]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.1.0
[1.0.8-beta.1]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v1.0.8-beta.1
[0.1.0]: https://github.com/CyberStrikeus/CyberStrike/releases/tag/v0.1.0
