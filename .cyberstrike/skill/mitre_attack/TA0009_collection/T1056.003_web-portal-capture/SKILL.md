---
name: "T1056.003_web-portal-capture"
description: "Adversaries may install code on externally facing portals, such as a VPN login page, to capture and transmit credentials of users who attempt to log into the service."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1056.003
  - collection
  - credential-access
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1056.003"
tactic: "collection"
all_tactics:
  - collection
  - credential-access
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1056/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1056
  - T1056.001
  - T1056.002
  - T1056.004
prerequisites:
  - T1056
severity_boost:
  T1056: "Chain with T1056 for deeper attack path"
  T1056.001: "Chain with T1056.001 for deeper attack path"
  T1056.002: "Chain with T1056.002 for deeper attack path"
---

# T1056.003 Web Portal Capture

> **Sub-technique of:** T1056

## High-Level Description

Adversaries may install code on externally facing portals, such as a VPN login page, to capture and transmit credentials of users who attempt to log into the service. For example, a compromised login page may log provided user credentials before logging the user in to the service.

This variation on input capture may be conducted post-compromise using legitimate administrative access as a backup measure to maintain network access through External Remote Services and Valid Accounts or as part of the initial compromise by exploitation of the externally facing web service.

## Kill Chain Phase

- Collection (TA0009)
- Credential Access (TA0006)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Web Portal Capture technique is applicable to target environment
- [ ] Check Linux systems for indicators of Web Portal Capture
- [ ] Check macOS systems for indicators of Web Portal Capture
- [ ] Check Windows systems for indicators of Web Portal Capture
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Web Portal Capture by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1056.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management
Do not allow administrator accounts that have permissions to modify the Web content of organization login portals to be used for day-to-day operations that may expose them to potential adversaries on unprivileged systems.


## Detection

### Detection of Credential Harvesting via Web Portal Modification


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Web Portal Capture technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Volexity Virtual Private Keylogging](https://www.volexity.com/blog/2015/10/07/virtual-private-keylogging-cisco-web-vpns-leveraged-for-access-and-persistence/)
- [Atomic Red Team - T1056.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1056.003)
- [MITRE ATT&CK - T1056.003](https://attack.mitre.org/techniques/T1056/003)
