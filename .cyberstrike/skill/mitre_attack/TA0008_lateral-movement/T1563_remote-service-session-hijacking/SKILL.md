---
name: "T1563_remote-service-session-hijacking"
description: "Adversaries may take control of preexisting sessions with remote services to move laterally in an environment."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1563
  - lateral-movement
  - linux
  - macos
  - windows
technique_id: "T1563"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1563"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-284
chains_with:
  - T1563.001
  - T1563.002
prerequisites:
  []
severity_boost:
  T1563.001: "Chain with T1563.001 for deeper attack path"
  T1563.002: "Chain with T1563.002 for deeper attack path"
---

# T1563 Remote Service Session Hijacking

## High-Level Description

Adversaries may take control of preexisting sessions with remote services to move laterally in an environment. Users may use valid credentials to log into a service specifically designed to accept remote connections, such as telnet, SSH, and RDP. When a user logs into a service, a session will be established that will allow them to maintain a continuous interaction with that service.

Adversaries may commandeer these sessions to carry out actions on remote systems. Remote Service Session Hijacking differs from use of Remote Services because it hijacks an existing session rather than creating a new session using Valid Accounts.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Remote Service Session Hijacking technique is applicable to target environment
- [ ] Check Linux systems for indicators of Remote Service Session Hijacking
- [ ] Check macOS systems for indicators of Remote Service Session Hijacking
- [ ] Check Windows systems for indicators of Remote Service Session Hijacking
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Remote Service Session Hijacking by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1563 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1030 Network Segmentation
Enable firewall rules to block unnecessary traffic between network security zones within a network.

### M1042 Disable or Remove Feature or Program
Disable the remote service (ex: SSH, RDP, etc.) if it is unnecessary.

### M1027 Password Policies
Set and enforce secure password policies for accounts.

### M1018 User Account Management
Limit remote user permissions if remote access is necessary.

### M1026 Privileged Account Management
Do not allow remote access to services as a privileged account unless necessary.


## Detection

### Detection of Remote Service Session Hijacking


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Remote Service Session Hijacking technique applicable | High | Lateral Movement |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [RDP Hijacking Medium](https://medium.com/@networksecurity/rdp-hijacking-how-to-hijack-rds-and-remoteapp-sessions-transparently-to-move-through-an-da2a1e73a5f6)
- [Breach Post-mortem SSH Hijack](https://matrix.org/blog/2019/05/08/post-mortem-and-remediations-for-apr-11-security-incident/)
- [Atomic Red Team - T1563](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1563)
- [MITRE ATT&CK - T1563](https://attack.mitre.org/techniques/T1563)
