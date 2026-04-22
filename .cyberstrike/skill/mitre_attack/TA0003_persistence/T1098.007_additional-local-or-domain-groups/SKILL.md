---
name: "T1098.007_additional-local-or-domain-groups"
description: "An adversary may add additional local or domain groups to an adversary-controlled account to maintain persistent access to a system or domain."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1098.007
  - persistence
  - privilege-escalation
  - windows
  - macos
  - linux
  - sub-technique
technique_id: "T1098.007"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1098/007"
tech_stack:
  - windows
  - macos
  - linux
cwe_ids:
  - CWE-276
chains_with:
  - T1098
  - T1098.001
  - T1098.002
  - T1098.003
  - T1098.004
  - T1098.005
  - T1098.006
prerequisites:
  - T1098
severity_boost:
  T1098: "Chain with T1098 for deeper attack path"
  T1098.001: "Chain with T1098.001 for deeper attack path"
  T1098.002: "Chain with T1098.002 for deeper attack path"
---

# T1098.007 Additional Local or Domain Groups

> **Sub-technique of:** T1098

## High-Level Description

An adversary may add additional local or domain groups to an adversary-controlled account to maintain persistent access to a system or domain.

On Windows, accounts may use the `net localgroup` and `net group` commands to add existing users to local and domain groups. On Linux, adversaries may use the `usermod` command for the same purpose.

For example, accounts may be added to the local administrators group on Windows devices to maintain elevated privileges. They may also be added to the Remote Desktop Users group, which allows them to leverage Remote Desktop Protocol to log into the endpoints in the future. Adversaries may also add accounts to VPN user groups to gain future persistence on the network. On Linux, accounts may be added to the sudoers group, allowing them to persistently leverage Sudo and Sudo Caching for elevated privileges. 

In Windows environments, machine accounts may also be added to domain groups. This allows the local SYSTEM account to gain privileges on the domain.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows, macOS, Linux

## What to Check

- [ ] Identify if Additional Local or Domain Groups technique is applicable to target environment
- [ ] Check Windows systems for indicators of Additional Local or Domain Groups
- [ ] Check macOS systems for indicators of Additional Local or Domain Groups
- [ ] Check Linux systems for indicators of Additional Local or Domain Groups
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Additional Local or Domain Groups by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1098.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Suspicious Addition to Local or Domain Groups


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Additional Local or Domain Groups technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Cyber Security News](https://cybersecuritynews.com/superblack-actors-exploiting-two-fortinet-vulnerabilities/)
- [Linux Usermod](https://www.man7.org/linux/man-pages/man8/usermod.8.html)
- [Microsoft Net Group](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/cc754051(v=ws.11))
- [Microsoft Net Localgroup](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/cc725622(v=ws.11))
- [Microsoft RDP Logons](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/allow-log-on-through-remote-desktop-services)
- [RootDSE AD Detection 2022](https://rootdse.org/posts/monitoring-realtime-activedirectory-domain-scenarios)
- [Atomic Red Team - T1098.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1098.007)
- [MITRE ATT&CK - T1098.007](https://attack.mitre.org/techniques/T1098/007)
