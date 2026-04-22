---
name: "T1548.006_tcc-manipulation"
description: "Adversaries can manipulate or abuse the Transparency, Consent, & Control (TCC) service or database to grant malicious executables elevated permissions."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1548.006
  - defense-evasion
  - privilege-escalation
  - macos
  - sub-technique
technique_id: "T1548.006"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1548/006"
tech_stack:
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1548
  - T1548.001
  - T1548.002
  - T1548.003
  - T1548.004
  - T1548.005
prerequisites:
  - T1548
severity_boost:
  T1548: "Chain with T1548 for deeper attack path"
  T1548.001: "Chain with T1548.001 for deeper attack path"
  T1548.002: "Chain with T1548.002 for deeper attack path"
---

# T1548.006 TCC Manipulation

> **Sub-technique of:** T1548

## High-Level Description

Adversaries can manipulate or abuse the Transparency, Consent, & Control (TCC) service or database to grant malicious executables elevated permissions. TCC is a Privacy & Security macOS control mechanism used to determine if the running process has permission to access the data or services protected by TCC, such as screen sharing, camera, microphone, or Full Disk Access (FDA).

When an application requests to access data or a service protected by TCC, the TCC daemon (`tccd`) checks the TCC database, located at `/Library/Application Support/com.apple.TCC/TCC.db` (and `~/` equivalent), and an overwrites file (if connected to an MDM) for existing permissions. If permissions do not exist, then the user is prompted to grant permission. Once permissions are granted, the database stores the application's permissions and will not prompt the user again unless reset. For example, when a web browser requests permissions to the user's webcam, once granted the web browser may not explicitly prompt the user again.

Adversaries may access restricted data or services protected by TCC through abusing applications previously granted permissions through Process Injection or executing a malicious binary using another application. For example, adversaries can use Finder, a macOS native app with FDA permissions, to execute a malicious AppleScript. When executing under the Finder App, the malicious AppleScript inherits access to all files on the system without requiring a user prompt. When System Integrity Protection (SIP) is disabled, TCC protections are also disabled. For a system without SIP enabled, adversaries can manipulate the TCC database to add permissions to their malicious executable through loading an adversary controlled TCC database using environment variables and Launchctl.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** macOS

## What to Check

- [ ] Identify if TCC Manipulation technique is applicable to target environment
- [ ] Check macOS systems for indicators of TCC Manipulation
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to TCC Manipulation by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1548.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management
Remove unnecessary users from the local administrator group on systems.

### M1047 Audit
Routinely check applications using Automation under Security & Privacy System Preferences. To reset permissions, user's can utilize the `tccutil reset` command. When using Mobile Device Management (MDM), review the list of enabled or disabled applications in the `MDMOverrides.plist` which overrides the TCC database.

### M1022 Restrict File and Directory Permissions
When using an MDM, ensure the permissions granted are specific to the requirements of the binary. Full Disk Access should be restricted to only necessary binaries in alignment with policy.


## Detection

### TCC Database Manipulation via Launchctl and Unprotected SIP


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| TCC Manipulation technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [welivesecurity TCC](https://www.welivesecurity.com/2022/07/19/i-see-what-you-did-there-look-cloudmensis-macos-spyware/)
- [TCC Database](https://interpressecurity.com/resources/return-of-the-macos-tcc/)
- [TCC macOS bypass](https://www.sentinelone.com/labs/bypassing-macos-tcc-user-privacy-protections-by-accident-and-design/)
- [Atomic Red Team - T1548.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1548.006)
- [MITRE ATT&CK - T1548.006](https://attack.mitre.org/techniques/T1548/006)
