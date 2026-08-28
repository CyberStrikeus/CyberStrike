---
name: "T1037_boot-or-logon-initialization-scripts"
description: "Adversaries may use scripts automatically executed at boot or logon initialization to establish persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1037
  - persistence
  - privilege-escalation
  - macos
  - windows
  - linux
  - network-devices
  - esxi
technique_id: "T1037"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - macOS
  - Windows
  - Linux
  - Network Devices
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1037"
tech_stack:
  - macos
  - windows
  - linux
  - network devices
  - esxi
cwe_ids:
  - CWE-276
chains_with:
  - T1037.001
  - T1037.002
  - T1037.003
  - T1037.004
  - T1037.005
prerequisites: []
severity_boost:
  T1037.001: "Chain with T1037.001 for deeper attack path"
  T1037.002: "Chain with T1037.002 for deeper attack path"
  T1037.003: "Chain with T1037.003 for deeper attack path"
---

# T1037 Boot or Logon Initialization Scripts

## High-Level Description

Adversaries may use scripts automatically executed at boot or logon initialization to establish persistence. Initialization scripts can be used to perform administrative functions, which may often execute other programs or send information to an internal logging server. These scripts can vary based on operating system and whether applied locally or remotely.

Adversaries may use these scripts to maintain persistence on a single system. Depending on the access configuration of the logon scripts, either local credentials or an administrator account may be necessary.

An adversary may also be able to escalate their privileges since some boot or logon initialization scripts run with higher privileges.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** macOS, Windows, Linux, Network Devices, ESXi

## What to Check

- [ ] Identify if Boot or Logon Initialization Scripts technique is applicable to target environment
- [ ] Check macOS systems for indicators of Boot or Logon Initialization Scripts
- [ ] Check Windows systems for indicators of Boot or Logon Initialization Scripts
- [ ] Check Linux systems for indicators of Boot or Logon Initialization Scripts
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Boot or Logon Initialization Scripts by examining the target platforms (macOS, Windows, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1037 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1024 Restrict Registry Permissions

Ensure proper permissions are set for Registry hives to prevent users from modifying keys for logon scripts that may lead to persistence.

### M1022 Restrict File and Directory Permissions

Restrict write access to logon scripts to specific administrators.

## Detection

### Boot or Logon Initialization Scripts Detection Strategy

## Risk Assessment

| Finding                                                   | Severity | Impact      |
| --------------------------------------------------------- | -------- | ----------- |
| Boot or Logon Initialization Scripts technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Anomali Rocke March 2019](https://www.anomali.com/blog/rocke-evolves-its-arsenal-with-a-new-malware-family-written-in-golang)
- [Mandiant APT29 Eye Spy Email Nov 22](https://www.mandiant.com/resources/blog/unc3524-eye-spy-email)
- [Atomic Red Team - T1037](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1037)
- [MITRE ATT&CK - T1037](https://attack.mitre.org/techniques/T1037)
