---
name: "T1219.001_ide-tunneling"
description: "Adversaries may abuse Integrated Development Environment (IDE) software with remote development features to establish an interactive command and control channel on target systems within a network."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1219.001
  - command-and-control
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1219.001"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1219/001"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1219
  - T1219.002
  - T1219.003
prerequisites:
  - T1219
severity_boost:
  T1219: "Chain with T1219 for deeper attack path"
  T1219.002: "Chain with T1219.002 for deeper attack path"
  T1219.003: "Chain with T1219.003 for deeper attack path"
---

# T1219.001 IDE Tunneling

> **Sub-technique of:** T1219

## High-Level Description

Adversaries may abuse Integrated Development Environment (IDE) software with remote development features to establish an interactive command and control channel on target systems within a network. IDE tunneling combines SSH, port forwarding, file sharing, and debugging into a single secure connection, letting developers work on remote systems as if they were local. Unlike SSH and port forwarding, IDE tunneling encapsulates an entire session and may use proprietary tunneling protocols alongside SSH, allowing adversaries to blend in with legitimate development workflows. Some IDEs, like Visual Studio Code, also provide CLI tools (e.g., `code tunnel`) that adversaries may use to programmatically establish tunnels and generate web-accessible URLs for remote access. These tunnels can be authenticated through accounts such as GitHub, enabling the adversary to control the compromised system via a legitimate developer portal.

Additionally, adversaries may use IDE tunneling for persistence. Some IDEs, such as Visual Studio Code and JetBrains, support automatic reconnection. Adversaries may configure the IDE to auto-launch at startup, re-establishing the tunnel upon execution. Compromised developer machines may also be exploited as jump hosts to move further into the network.

IDE tunneling tools may be built-in or installed as IDE Extensions.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if IDE Tunneling technique is applicable to target environment
- [ ] Check Linux systems for indicators of IDE Tunneling
- [ ] Check macOS systems for indicators of IDE Tunneling
- [ ] Check Windows systems for indicators of IDE Tunneling
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to IDE Tunneling by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1219.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention

Use Group Policies to require user authentication by disabling anonymous tunnel access, preventing any unauthenticated tunnel creation or usage. Disable the Visual Studio Dev Tunnels feature to block tunnel-related commands, allowing only minimal exceptions for utility functions (unset, echo, ping, and user). Restrict tunnel access to approved Microsoft Entra tenant IDs by specifying allowed tenants; all other users are denied access by default.

## Detection

### IDE Tunneling Detection via Process, File, and Network Behaviors

## Risk Assessment

| Finding                            | Severity | Impact              |
| ---------------------------------- | -------- | ------------------- |
| IDE Tunneling technique applicable | High     | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [sentinelone operationDigitalEye Dec 2024](https://www.sentinelone.com/labs/operation-digital-eye-chinese-apt-compromises-critical-digital-infrastructure-via-visual-studio-code-tunnels/)
- [Unit42 Chinese VSCode 06 September 2024](https://unit42.paloaltonetworks.com/stately-taurus-abuses-vscode-southeast-asian-espionage/)
- [Thornton tutorial VSCode shell September 2023](https://medium.com/@truvis.thornton/visual-studio-code-embedded-reverse-shell-and-how-to-block-create-sentinel-detection-and-add-e864ebafaf6d)
- [Atomic Red Team - T1219.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1219.001)
- [MITRE ATT&CK - T1219.001](https://attack.mitre.org/techniques/T1219/001)
