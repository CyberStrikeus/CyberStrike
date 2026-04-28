# Contributing to CyberStrike

CyberStrike is an AI-powered offensive security platform. We welcome contributions that make it a more powerful, reliable, and comprehensive security testing tool.

## What We're Looking For

### High-Impact Contributions

- **Security agents** — New specialist agents (e.g., API security, wireless, IoT)
- **Security skills** — OWASP test case knowledge, attack methodology guides
- **Tool integrations** — New security tool wrappers, MCP server tools
- **Knowledge base** — WSTG, MASTG, PTES, OSSTMM test case documentation
- **Bug fixes** — Crashes, incorrect behavior, edge cases
- **Provider support** — Additional LLM providers and models
- **Performance** — Faster tool execution, reduced token usage

### Requires Design Review

UI changes, core architecture modifications, and new agent types must go through a design review with the core team. Open an issue first to discuss.

If you're unsure whether a PR would be accepted, look for issues labeled:

- [`help wanted`](https://github.com/CyberStrikeus/CyberStrike/issues?q=is%3Aissue+state%3Aopen+label%3Ahelp-wanted)
- [`good first issue`](https://github.com/CyberStrikeus/CyberStrike/issues?q=is%3Aissue+state%3Aopen+label%3A%22good+first+issue%22)
- [`bug`](https://github.com/CyberStrikeus/CyberStrike/issues?q=is%3Aissue+state%3Aopen+label%3Abug)
- [`security-tool`](https://github.com/CyberStrikeus/CyberStrike/issues?q=is%3Aissue+state%3Aopen+label%3Asecurity-tool)

> [!NOTE]
> PRs that ignore these guardrails will likely be closed.

## Getting Started

### Requirements

- [Bun](https://bun.sh/) 1.3+
- Docker (for Bolt/Kali MCP development)

### Setup

```bash
git clone https://github.com/CyberStrikeus/CyberStrike.git
cd CyberStrike
bun install
bun dev
```

### Running Against a Different Directory

```bash
bun dev <directory>    # Run in a specific directory
bun dev .              # Run in the repo root
```

### Building a Standalone Binary

```bash
bun run --cwd packages/cyberstrike build --single
./packages/cyberstrike/dist/cyberstrike-<platform>/bin/cyberstrike
```

Replace `<platform>` with your platform (e.g., `darwin-arm64`, `linux-x64`).

## Project Structure

| Package                | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `packages/cyberstrike` | Core CLI — agents, tools, session, provider logic |
| `packages/app`         | Web UI components (SolidJS)                       |
| `packages/plugin`      | Plugin SDK (`@cyberstrike-io/plugin`)             |
| `knowledge/`           | Security knowledge base (WSTG test cases)         |
| `.cyberstrike/skill/`  | Security skills (methodology guides)              |

### MCP Ecosystem (separate repos)

| Server              | Repo                                                                            | Description                           |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------- |
| cloud-audit-mcp     | [badchars/cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | Cloud security audits — AWS/Azure/GCP |
| github-security-mcp | [badchars/github-security-mcp](https://github.com/badchars/github-security-mcp) | GitHub security posture — 39 tools    |
| cve-mcp             | [badchars/cve-mcp](https://github.com/badchars/cve-mcp)                         | CVE intelligence — NVD/EPSS/KEV       |
| osint-mcp           | [badchars/osint-mcp](https://github.com/badchars/osint-mcp)                     | OSINT recon — Shodan/VT/DNS/WHOIS     |

## How to Contribute

### Adding a Security Skill

Skills are markdown files that provide domain knowledge to agents. Create a new directory under `.cyberstrike/skill/`:

```
.cyberstrike/skill/your-skill-name/
  SKILL.md    # Methodology, checklists, tool commands
```

Reference it in an agent's `skills` array in `packages/cyberstrike/src/agent/agent.ts`.

### Adding Knowledge Base Content

Knowledge base files go under `knowledge/`. Follow the existing WSTG format:

```
knowledge/web-application/WSTG-CATEGORY/WSTG-CATEGORY-XX.md
```

Each file should include: objective, test description, tools, commands, and remediation.

### Adding a Security Agent

1. Create a system prompt: `packages/cyberstrike/src/agent/prompt/your-agent.txt`
2. Register in `packages/cyberstrike/src/agent/agent.ts` as a native agent
3. Configure permissions (bash, browser, read, grep, etc.)
4. Add associated skills if applicable

### Adding MCP Tools

MCP servers live in their own repos (see table above). Each tool needs:

- Tool definition with Zod input schema
- Implementation with proper error handling
- Category tagging for lazy loading

To contribute to an MCP server, open a PR in the relevant repo.

## Development Commands

```bash
bun dev                    # Start CyberStrike TUI (development)
bun dev serve              # Start headless API server
bun dev web                # Start server + web interface
bun turbo typecheck        # Run type checking across all packages
```

### Running the Web App

1. Start the server: `bun dev serve`
2. Start the web app: `bun run --cwd packages/app dev`

### Debugging

Run with Bun's inspector:

```bash
bun run --inspect=ws://localhost:6499/ --cwd packages/cyberstrike ./src/index.ts serve --port 4096
```

Or set `export BUN_OPTIONS=--inspect=ws://localhost:6499/` for all invocations.

## Pull Request Guidelines

### Issue First Policy

**All PRs must reference an existing issue.** Open an issue first describing the bug, feature, or security tool request. Use `Fixes #123` or `Closes #123` in your PR description.

### General Requirements

- Keep PRs small and focused
- Explain the issue and why your change fixes it
- Verify your changes work and explain how

### PR Titles

Follow conventional commit format:

- `feat:` — new feature or agent
- `fix:` — bug fix
- `security:` — new security tool, skill, or knowledge base content
- `docs:` — documentation changes
- `chore:` — maintenance, dependencies
- `refactor:` — code changes without behavior change

Optional scope: `feat(agent):`, `fix(browser):`, `security(wstg):`

### No AI-Generated Walls of Text

Long, AI-generated PR descriptions will be ignored. Write short, focused descriptions in your own words.

### Style Preferences

- **Functions:** Keep logic in a single function unless reuse is clear.
- **Control flow:** Avoid `else` statements.
- **Error handling:** Prefer `.catch(...)` over `try/catch`.
- **Types:** Use precise types, avoid `any`.
- **Variables:** Prefer `const`, avoid `let`.
- **Naming:** Concise, descriptive identifiers.
- **Runtime:** Use Bun APIs (`Bun.file()`, etc.) when applicable.

## Ethical Use Policy

CyberStrike is designed for **authorized security testing only**. All contributions must:

- Support legitimate penetration testing and security research
- Not enable unauthorized access to systems
- Follow responsible disclosure practices
- Comply with applicable laws and regulations

Contributions that facilitate malicious use will be rejected.

## Trust & Vouch System

This project uses [vouch](https://github.com/mitchellh/vouch) to manage contributor trust. The vouch list is in [`.github/VOUCHED.td`](.github/VOUCHED.td).

- **Vouched users** are explicitly trusted contributors
- **Denounced users** are blocked (issues and PRs auto-closed)
- **Everyone else** can participate normally

Maintainers can manage the list by commenting `vouch`, `denounce`, or `unvouch` on any issue.

## Feature Requests

For new functionality, start with a design conversation. Open an issue describing the problem, your proposed approach, and why it belongs in CyberStrike. Wait for core team approval before opening a PR.

## Community

- **Discord:** [Join the community](https://discord.gg/snunAaHf6U)
- **X:** [@cyberstrike](https://x.com/cyberstrike)
- **Website:** [cyberstrike.io](https://cyberstrike.io)
