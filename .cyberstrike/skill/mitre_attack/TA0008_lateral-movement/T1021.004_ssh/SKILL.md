---
name: "T1021.004_ssh"
description: "Adversaries may use Valid Accounts to log into remote machines using Secure Shell (SSH)."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1021.004
  - lateral-movement
  - esxi
  - linux
  - macos
  - sub-technique
technique_id: "T1021.004"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - ESXi
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1021/004"
tech_stack:
  - esxi
  - linux
  - macos
cwe_ids:
  - CWE-284
chains_with:
  - T1021
  - T1021.001
  - T1021.002
  - T1021.003
  - T1021.005
  - T1021.006
  - T1021.007
  - T1021.008
prerequisites:
  - T1021
severity_boost:
  T1021: "Chain with T1021 for deeper attack path"
  T1021.001: "Chain with T1021.001 for deeper attack path"
  T1021.002: "Chain with T1021.002 for deeper attack path"
---

# T1021.004 SSH

> **Sub-technique of:** T1021

## High-Level Description

Adversaries may use Valid Accounts to log into remote machines using Secure Shell (SSH). The adversary may then perform actions as the logged-on user.

SSH is a protocol that allows authorized users to open remote shells on other computers. Many Linux and macOS versions come with SSH installed by default, although typically disabled until the user enables it. On ESXi, SSH can be enabled either directly on the host (e.g., via `vim-cmd hostsvc/enable_ssh`) or via vCenter. The SSH server can be configured to use standard password authentication or public-private keypairs in lieu of or in addition to a password. In this authentication scenario, the user’s public key must be in a special file on the computer running the server that lists which keypairs are allowed to login as that user (i.e., SSH Authorized Keys).

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** ESXi, Linux, macOS

## What to Check

- [ ] Identify if SSH technique is applicable to target environment
- [ ] Check ESXi systems for indicators of SSH
- [ ] Check Linux systems for indicators of SSH
- [ ] Check macOS systems for indicators of SSH
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SSH by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1021.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
Disable the SSH daemon on systems that do not require it, especially ESXi servers. For macOS, ensure Remote Login is disabled under Sharing Preferences.

### M1032 Multi-factor Authentication
Require multi-factor authentication for SSH connections wherever possible, such as password protected SSH keys.

### M1018 User Account Management
Limit which user accounts are allowed to login via SSH.


## Detection

### Behavioral Detection of Remote SSH Logins Followed by Post-Login Execution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SSH technique applicable | Low | Lateral Movement |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [Sygnia Abyss Locker 2025](https://www.sygnia.co/blog/abyss-locker-ransomware-attack-analysis/)
- [TrendMicro ESXI Ransomware](https://www.trendmicro.com/en_us/research/22/a/analysis-and-Impact-of-lockbit-ransomwares-first-linux-and-vmware-esxi-variant.html)
- [Apple Unified Log Analysis Remote Login and Screen Sharing](https://sarah-edwards-xzkc.squarespace.com/blog/2020/4/30/analysis-of-apple-unified-logs-quarantine-edition-entry-6-working-from-home-remote-logins)
- [Sygnia ESXi Ransomware 2025](https://www.sygnia.co/blog/esxi-ransomware-ssh-tunneling-defense-strategies/)
- [Atomic Red Team - T1021.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1021.004)
- [MITRE ATT&CK - T1021.004](https://attack.mitre.org/techniques/T1021/004)
