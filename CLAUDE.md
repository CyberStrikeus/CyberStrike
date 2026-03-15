# CyberStrike

## Project Context

CyberStrike is an AI-powered offensive security agent platform — autonomous pentesting with specialized agents, 120+ OWASP test cases.

- **Repo:** `CyberStrikeus/CyberStrike` (fork of `anomalyco/opencode`)
- **Default branch:** `dev` (NOT main)
- **Domain:** `cyberstrike.io`
- **CLI binary:** `cyberstrike`
- **Env prefix:** `CYBERSTRIKE_*`
- **License:** AGPL-3.0-only + Commercial Licensing (contact@cyberstrike.io)

## Tech Stack

- **Runtime:** Bun 1.3.9, TypeScript
- **Frontend:** SolidJS + Vite + TailwindCSS (packages/app)
- **Desktop:** Tauri 2.x (packages/desktop)
- **Backend:** Hono (packages/cyberstrike)
- **DB:** Drizzle ORM (SQLite, snake_case columns)
- **Infra:** SST (AWS) + Cloudflare Workers
- **AI:** 15+ provider support
- **Monorepo:** Bun workspaces + Turborepo

## Packages

```
packages/
├── cyberstrike/   # Core CLI + AI agent logic
├── app/           # Web UI (SolidJS)
├── desktop/       # Desktop app (Tauri)
├── console/       # Console components
├── containers/    # Container management
├── enterprise/    # Enterprise features
├── extensions/    # Plugin system
├── function/      # Function runtime
├── identity/      # Auth/identity
├── plugin/        # Plugin framework
├── script/        # Build scripts
├── sdk/           # JavaScript SDK
├── slack/         # Slack integration
├── ui/            # Shared UI components
└── util/          # Shared utilities
```

## Developer

- **Author:** Orhan Yildirim (badchars)
- **GitHub:** CyberStrikeus org
- **Domain:** cyberstrike.io — NEVER use cyberstrike.us

## Related Projects (same developer)

All under `/Users/orhanyildirim/Desktop/aum-pipeline/`:

| Project | Path | Description |
|---------|------|-------------|
| hackbrowser-mcp | mcp/hackbrowser-mcp/ | Browser security testing MCP — 39 tools |
| cloud-audit-mcp | mcp/cloud-audit-mcp/ | Cloud security MCP — 38 tools, AWS/Azure/GCP |
| github-security-mcp | mcp/github-security-mcp/ | GitHub security MCP — 39 tools, 45 checks |
| cve-mcp | mcp/cve-mcp/ | CVE intelligence MCP — 23 tools, NVD/EPSS/KEV/GHSA/OSV |
| vuln-research | vuln-research/ (LLM/) | LLM vulnerability analysis pipeline |
| recon0 | recon0/ | Bug bounty recon pipeline |

## Rules

- See AGENTS.md for coding style guide (single word vars, no destructuring, early returns, etc.)
- Tests cannot run from repo root — run from package dirs
- Default branch is `dev` — always branch from and PR into `dev`
- Domain is `cyberstrike.io` — NEVER use `cyberstrike.us`
- Prefer Bun APIs (Bun.file(), etc.)
- Avoid mocks in tests
- Avoid `any` type
- Use snake_case for Drizzle schema field names
