---
name: "T1574.010_services-file-permissions-weakness"
description: "Adversaries may execute their own malicious payloads by hijacking the binaries used by services."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574.010
  - persistence
  - privilege-escalation
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1574.010"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1574/010"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1574
  - T1574.001
  - T1574.004
  - T1574.005
  - T1574.006
  - T1574.007
  - T1574.008
  - T1574.009
  - T1574.011
  - T1574.012
  - T1574.013
  - T1574.014
prerequisites:
  - T1574
severity_boost:
  T1574: "Chain with T1574 for deeper attack path"
  T1574.001: "Chain with T1574.001 for deeper attack path"
  T1574.004: "Chain with T1574.004 for deeper attack path"
---

# T1574.010 Services File Permissions Weakness

> **Sub-technique of:** T1574

## High-Level Description

Adversaries may execute their own malicious payloads by hijacking the binaries used by services. Adversaries may use flaws in the permissions of Windows services to replace the binary that is executed upon service start. These service processes may automatically execute specific binaries as part of their functionality or to perform other actions. If the permissions on the file system directory containing a target binary, or permissions on the binary itself are improperly set, then the target binary may be overwritten with another binary using user-level permissions and executed by the original process. If the original process and thread are running under a higher permissions level, then the replaced binary will also execute under higher-level permissions, which could include SYSTEM.

Adversaries may use this technique to replace legitimate binaries with malicious ones as a means of executing code at a higher permissions level. If the executing process is set to run at a specific time or during a certain event (e.g., system bootup) then this technique can also be used for persistence.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Services File Permissions Weakness technique is applicable to target environment
- [ ] Check Windows systems for indicators of Services File Permissions Weakness
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Services File Permissions Weakness by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1574.010 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

Limit privileges of user accounts and groups so that only authorized administrators can interact with service changes and service binary target path locations. Deny execution from user directories such as file download directories and temp directories where able.

### M1047 Audit

Use auditing tools capable of detecting file system permissions abuse opportunities on systems within an enterprise and correct them. Toolkits like the PowerSploit framework contain PowerUp modules that can be used to explore systems for service file system permissions weaknesses.

### M1052 User Account Control

Turn off UAC's privilege elevation for standard users <code>[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System]</code>to automatically deny elevation requests, add: <code>"ConsentPromptBehaviorUser"=dword:00000000</code>. Consider enabling installer detection for all users by adding: <code>"EnableInstallerDetection"=dword:00000001</code>. This will prompt for a password for installation and also log the attempt. To disable installer detection, instead add: <code>"EnableInstallerDetection"=dword:00000000</code>. This may prevent potential elevation of privileges through exploitation during the process of UAC detecting the installer, but will allow the installation process to continue without being logged.

## Detection

### Detection Strategy for Hijack Execution Flow through Services File Permissions Weakness.

## Risk Assessment

| Finding                                                 | Severity | Impact      |
| ------------------------------------------------------- | -------- | ----------- |
| Services File Permissions Weakness technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Atomic Red Team - T1574.010](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574.010)
- [MITRE ATT&CK - T1574.010](https://attack.mitre.org/techniques/T1574/010)
