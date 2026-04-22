---
name: "T1216_system-script-proxy-execution"
description: "Adversaries may use trusted scripts, often signed with certificates, to proxy the execution of malicious files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1216
  - defense-evasion
  - windows
technique_id: "T1216"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1216"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1216.001
  - T1216.002
prerequisites:
  []
severity_boost:
  T1216.001: "Chain with T1216.001 for deeper attack path"
  T1216.002: "Chain with T1216.002 for deeper attack path"
---

# T1216 System Script Proxy Execution

## High-Level Description

Adversaries may use trusted scripts, often signed with certificates, to proxy the execution of malicious files. Several Microsoft signed scripts that have been downloaded from Microsoft or are default on Windows installations can be used to proxy execution of other files. This behavior may be abused by adversaries to execute malicious files that could bypass application control and signature validation on systems.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if System Script Proxy Execution technique is applicable to target environment
- [ ] Check Windows systems for indicators of System Script Proxy Execution
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: SyncAppvPublishingServer Signed Script PowerShell Command Execution

Executes the signed SyncAppvPublishingServer script with options to execute an arbitrary PowerShell command.
Upon execution, calc.exe will be launched.

**Supported Platforms:** windows

```cmd
C:\windows\system32\SyncAppvPublishingServer.vbs "\n;#{command_to_execute}"
```

### Atomic Test 2: manage-bde.wsf Signed Script Command Execution

Executes the signed manage-bde.wsf script with options to execute an arbitrary command.

**Supported Platforms:** windows

```cmd
set comspec=#{command_to_execute}
cscript %windir%\System32\manage-bde.wsf
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Script Proxy Execution by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1216 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Certain signed scripts that can be used to execute other programs may not be necessary within a given environment. Use application control configured to block execution of these scripts if they are not required for a given system or network to prevent potential misuse by adversaries.


## Detection

### Detection of Script-Based Proxy Execution via Signed Microsoft Utilities


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Script Proxy Execution technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [GitHub Ultimate AppLocker Bypass List](https://github.com/api0cradle/UltimateAppLockerByPassList)
- [LOLBAS Project](https://github.com/LOLBAS-Project/LOLBAS#criteria)
- [Atomic Red Team - T1216](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1216)
- [MITRE ATT&CK - T1216](https://attack.mitre.org/techniques/T1216)
