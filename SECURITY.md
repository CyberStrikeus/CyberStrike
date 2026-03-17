# Security

## Threat Model

### Overview

CyberStrike is an AI-powered offensive security agent that runs locally on your machine. It provides specialized security testing agents with access to powerful tools including shell execution, file operations, browser automation, and security tool integration.

### No Sandbox

CyberStrike does **not** sandbox the agent. The permission system exists as a UX feature to help users stay aware of what actions the agent is taking — it prompts for confirmation before executing commands, writing files, etc. However, it is not designed to provide security isolation.

If you need true isolation, run CyberStrike inside a Docker container or VM. The Bolt system runs security tools on remote servers by design.

### Server Mode

Server mode is opt-in only. When enabled, set `CYBERSTRIKE_SERVER_PASSWORD` to require HTTP Basic Auth. Without this, the server runs unauthenticated (with a warning). It is the end user's responsibility to secure the server.

### Bolt Remote Tool Server

Bolt connections are authenticated with Ed25519 key pairs. All tool execution happens on the remote server — your local machine only sends commands over MCP protocol. Ensure your Bolt server is on a trusted network or behind a VPN.

### MCP Servers

CyberStrike connects to external MCP servers (hackbrowser-mcp, cloud-audit-mcp, etc.) that you explicitly configure. These servers run with whatever permissions you grant them. Review MCP server code before adding it to your configuration.

### Out of Scope

| Category | Rationale |
|----------|-----------|
| **Server access when opted-in** | If you enable server mode, API access is expected behavior |
| **Sandbox escapes** | The permission system is not a sandbox (see above) |
| **LLM provider data handling** | Data sent to your configured LLM provider is governed by their policies |
| **MCP server behavior** | External MCP servers you configure are outside our trust boundary |
| **Malicious config files** | Users control their own config; modifying it is not an attack vector |
| **Security tool output** | Tools like nmap, nuclei, etc. produce expected offensive security output |

---

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Previous minor | Best effort |
| Older versions | No |

We recommend always running the latest version.

---

## Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security issue, please use the GitHub Security Advisory ["Report a Vulnerability"](https://github.com/CyberStrikeus/CyberStrike/security/advisories/new) tab.

The team will send a response indicating the next steps in handling your report. After the initial reply, we will keep you informed of progress towards a fix and full announcement, and may ask for additional information.

**Please do NOT:**
- Open a public GitHub issue for security vulnerabilities
- Post vulnerability details on Discord or social media
- Exploit vulnerabilities beyond what is necessary to demonstrate the issue

## Escalation

If you do not receive an acknowledgement within 5 business days, contact **security@cyberstrike.io**.

## Disclosure Policy

- We aim to confirm receipt within 2 business days
- We aim to provide an initial assessment within 5 business days
- We coordinate disclosure timelines with the reporter
- We credit reporters in the security advisory (unless anonymity is requested)
