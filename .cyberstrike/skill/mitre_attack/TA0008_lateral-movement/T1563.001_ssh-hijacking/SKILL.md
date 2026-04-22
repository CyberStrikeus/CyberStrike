---
name: "T1563.001_ssh-hijacking"
description: "Adversaries may hijack a legitimate user's SSH session to move laterally within an environment."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1563.001
  - lateral-movement
  - linux
  - macos
  - sub-technique
technique_id: "T1563.001"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1563/001"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-284
chains_with:
  - T1563
  - T1563.002
prerequisites:
  - T1563
severity_boost:
  T1563: "Chain with T1563 for deeper attack path"
  T1563.002: "Chain with T1563.002 for deeper attack path"
---

# T1563.001 SSH Hijacking

> **Sub-technique of:** T1563

## High-Level Description

Adversaries may hijack a legitimate user's SSH session to move laterally within an environment. Secure Shell (SSH) is a standard means of remote access on Linux and macOS systems. It allows a user to connect to another system via an encrypted tunnel, commonly authenticating through a password, certificate or the use of an asymmetric encryption key pair.

In order to move laterally from a compromised host, adversaries may take advantage of trust relationships established with other systems via public key authentication in active SSH sessions by hijacking an existing connection to another system. This may occur through compromising the SSH agent itself or by having access to the agent's socket. If an adversary is able to obtain root access, then hijacking SSH sessions is likely trivial.

SSH Hijacking differs from use of SSH because it hijacks an existing SSH session rather than creating a new session using Valid Accounts.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if SSH Hijacking technique is applicable to target environment
- [ ] Check Linux systems for indicators of SSH Hijacking
- [ ] Check macOS systems for indicators of SSH Hijacking
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SSH Hijacking by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1563.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Ensure proper file permissions are set and harden system to prevent root privilege escalation opportunities.

### M1042 Disable or Remove Feature or Program

Ensure that agent forwarding is disabled on systems that do not explicitly require this feature to prevent misuse.

### M1027 Password Policies

Ensure SSH key pairs have strong passwords and refrain from using key-store technologies such as ssh-agent unless they are properly protected.

### M1026 Privileged Account Management

Do not allow remote access via SSH as root or other privileged accounts.

## Detection

### Detection Strategy for SSH Session Hijacking

## Risk Assessment

| Finding                            | Severity | Impact           |
| ---------------------------------- | -------- | ---------------- |
| SSH Hijacking technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [SSHjack Blackhat](https://www.blackhat.com/presentations/bh-usa-05/bh-us-05-boileau.pdf)
- [Clockwork SSH Agent Hijacking](https://web.archive.org/web/20210311184303/https://www.clockwork.com/news/2012/09/28/602/ssh_agent_hijacking/)
- [Slideshare Abusing SSH](https://www.slideshare.net/morisson/mistrusting-and-abusing-ssh-13526219)
- [Breach Post-mortem SSH Hijack](https://matrix.org/blog/2019/05/08/post-mortem-and-remediations-for-apr-11-security-incident/)
- [Atomic Red Team - T1563.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1563.001)
- [MITRE ATT&CK - T1563.001](https://attack.mitre.org/techniques/T1563/001)
