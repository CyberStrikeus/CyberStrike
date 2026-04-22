---
name: "T1037.002_login-hook"
description: "Adversaries may use a Login Hook to establish persistence executed upon user logon."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1037.002
  - persistence
  - privilege-escalation
  - macos
  - sub-technique
technique_id: "T1037.002"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1037/002"
tech_stack:
  - macos
cwe_ids:
  - CWE-276
chains_with:
  - T1037
  - T1037.001
  - T1037.003
  - T1037.004
  - T1037.005
prerequisites:
  - T1037
severity_boost:
  T1037: "Chain with T1037 for deeper attack path"
  T1037.001: "Chain with T1037.001 for deeper attack path"
  T1037.003: "Chain with T1037.003 for deeper attack path"
---

# T1037.002 Login Hook

> **Sub-technique of:** T1037

## High-Level Description

Adversaries may use a Login Hook to establish persistence executed upon user logon. A login hook is a plist file that points to a specific script to execute with root privileges upon user logon. The plist file is located in the <code>/Library/Preferences/com.apple.loginwindow.plist</code> file and can be modified using the <code>defaults</code> command-line utility. This behavior is the same for logout hooks where a script can be executed upon user logout. All hooks require administrator permissions to modify or create hooks. 

Adversaries can add or insert a path to a malicious script in the <code>com.apple.loginwindow.plist</code> file, using the <code>LoginHook</code> or <code>LogoutHook</code> key-value pair. The malicious script is executed upon the next user login. If a login hook already exists, adversaries can add additional commands to an existing login hook. There can be only one login and logout hook on a system at a time.

**Note:** Login hooks were deprecated in 10.11 version of macOS in favor of Launch Daemon and Launch Agent

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** macOS

## What to Check

- [ ] Identify if Login Hook technique is applicable to target environment
- [ ] Check macOS systems for indicators of Login Hook
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Logon Scripts - Mac

Mac logon script

**Supported Platforms:** macos


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Login Hook by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1037.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Restrict write access to logon scripts to specific administrators.


## Detection

### Detection Strategy for Login Hook Persistence on macOS


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Login Hook technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Login Scripts Apple Dev](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CustomLogin.html)
- [LoginWindowScripts Apple Dev](https://developer.apple.com/documentation/devicemanagement/loginwindowscripts)
- [Wardle Persistence Chapter](https://taomm.org/PDFs/vol1/CH%200x02%20Persistence.pdf)
- [S1 macOs Persistence](https://www.sentinelone.com/blog/how-malware-persists-on-macos/)
- [Atomic Red Team - T1037.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1037.002)
- [MITRE ATT&CK - T1037.002](https://attack.mitre.org/techniques/T1037/002)
