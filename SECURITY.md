# Security

## Threat Model

### Overview

CyberStrike is an AI-powered offensive security agent that runs locally on your machine. It provides specialized security testing agents with access to powerful tools including shell execution, file operations, browser automation, and security tool integration.

### No Sandbox

CyberStrike does **not** sandbox the agent. The permission system exists as a UX feature to help users stay aware of what actions the agent is taking — it prompts for confirmation before executing commands, writing files, etc. However, it is not designed to provide security isolation.

If you need true isolation, run CyberStrike inside a Docker container or VM. The Bolt system (Kali MCP) runs security tools in Docker by design.

### Server Mode

Server mode is opt-in only. When enabled, set `CYBERSTRIKE_SERVER_PASSWORD` to require HTTP Basic Auth. Without this, the server runs unauthenticated (with a warning). It is the end user's responsibility to secure the server.

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

## Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security issue, please use the GitHub Security Advisory ["Report a Vulnerability"](https://github.com/CyberStrikeus/CyberStrike/security/advisories/new) tab.

The team will send a response indicating the next steps in handling your report. After the initial reply, we will keep you informed of progress towards a fix and full announcement, and may ask for additional information.

## Escalation

If you do not receive an acknowledgement within 6 business days, you may send an email to **security@cyberstrike.us**
