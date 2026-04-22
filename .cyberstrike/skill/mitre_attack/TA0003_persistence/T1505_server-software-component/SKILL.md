---
name: "T1505_server-software-component"
description: "Adversaries may abuse legitimate extensible development features of servers to establish persistent access to systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1505
  - persistence
  - windows
  - linux
  - macos
  - network-devices
  - esxi
technique_id: "T1505"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - Linux
  - macOS
  - Network Devices
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1505"
tech_stack:
  - windows
  - linux
  - macos
  - network devices
  - esxi
cwe_ids:
  - CWE-276
chains_with:
  - T1505.001
  - T1505.002
  - T1505.003
  - T1505.004
  - T1505.005
  - T1505.006
prerequisites:
  []
severity_boost:
  T1505.001: "Chain with T1505.001 for deeper attack path"
  T1505.002: "Chain with T1505.002 for deeper attack path"
  T1505.003: "Chain with T1505.003 for deeper attack path"
---

# T1505 Server Software Component

## High-Level Description

Adversaries may abuse legitimate extensible development features of servers to establish persistent access to systems. Enterprise server applications may include features that allow developers to write and install software or scripts to extend the functionality of the main application. Adversaries may install malicious components to extend and abuse server applications.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, Linux, macOS, Network Devices, ESXi

## What to Check

- [ ] Identify if Server Software Component technique is applicable to target environment
- [ ] Check Windows systems for indicators of Server Software Component
- [ ] Check Linux systems for indicators of Server Software Component
- [ ] Check macOS systems for indicators of Server Software Component
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Server Software Component by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1505 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1045 Code Signing
Ensure all application component binaries are signed by the correct application developers.

### M1047 Audit
Regularly check component software on critical services that adversaries may target for persistence to verify the integrity of the systems and identify if unexpected changes have been made.

### M1024 Restrict Registry Permissions
Consider using Group Policy to configure and block modifications to service and other critical server parameters in the Registry.

### M1042 Disable or Remove Feature or Program
Consider disabling software components from servers when possible to prevent abuse by adversaries.

### M1046 Boot Integrity
Enabling secure boot allows validation of software and drivers during initial system boot.

### M1018 User Account Management
Enforce the principle of least privilege by limiting privileges of user accounts so only authorized accounts can modify and/or add server software components.

### M1026 Privileged Account Management
Do not allow administrator accounts that have permissions to add component software on these services to be used for day-to-day operations that may expose them to potential adversaries on unprivileged systems.


## Detection

### Detection Strategy for T1505 - Server Software Component


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Server Software Component technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [volexity_0day_sophos_FW](https://www.volexity.com/blog/2022/06/15/driftingcloud-zero-day-sophos-firewall-exploitation-and-an-insidious-breach/)
- [US-CERT Alert TA15-314A Web Shells](https://www.us-cert.gov/ncas/alerts/TA15-314A)
- [Atomic Red Team - T1505](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1505)
- [MITRE ATT&CK - T1505](https://attack.mitre.org/techniques/T1505)
