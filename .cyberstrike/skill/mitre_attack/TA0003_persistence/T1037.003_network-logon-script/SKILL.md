---
name: "T1037.003_network-logon-script"
description: "Adversaries may use network logon scripts automatically executed at logon initialization to establish persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1037.003
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1037.003"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1037/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1037
  - T1037.001
  - T1037.002
  - T1037.004
  - T1037.005
prerequisites:
  - T1037
severity_boost:
  T1037: "Chain with T1037 for deeper attack path"
  T1037.001: "Chain with T1037.001 for deeper attack path"
  T1037.002: "Chain with T1037.002 for deeper attack path"
---

# T1037.003 Network Logon Script

> **Sub-technique of:** T1037

## High-Level Description

Adversaries may use network logon scripts automatically executed at logon initialization to establish persistence. Network logon scripts can be assigned using Active Directory or Group Policy Objects. These logon scripts run with the privileges of the user they are assigned to. Depending on the systems within the network, initializing one of these scripts could apply to more than one or potentially all systems. 
 
Adversaries may use these scripts to maintain persistence on a network. Depending on the access configuration of the logon scripts, either local credentials or an administrator account may be necessary.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Network Logon Script technique is applicable to target environment
- [ ] Check Windows systems for indicators of Network Logon Script
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Logon Script by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1037.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Restrict write access to logon scripts to specific administrators.


## Detection

### Detect Network Logon Script Abuse via Multi-Event Correlation on Windows


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Network Logon Script technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Petri Logon Script AD](https://www.petri.com/setting-up-logon-script-through-active-directory-users-computers-windows-server-2008)
- [Atomic Red Team - T1037.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1037.003)
- [MITRE ATT&CK - T1037.003](https://attack.mitre.org/techniques/T1037/003)
