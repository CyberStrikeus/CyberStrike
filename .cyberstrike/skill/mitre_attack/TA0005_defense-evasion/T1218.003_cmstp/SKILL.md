---
name: "T1218.003_cmstp"
description: "Adversaries may abuse CMSTP to proxy execution of malicious code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.003
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1218
  - T1218.001
  - T1218.002
  - T1218.004
  - T1218.005
  - T1218.007
  - T1218.008
  - T1218.009
  - T1218.010
  - T1218.011
  - T1218.012
  - T1218.013
  - T1218.014
  - T1218.015
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
---

# T1218.003 CMSTP

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse CMSTP to proxy execution of malicious code. The Microsoft Connection Manager Profile Installer (CMSTP.exe) is a command-line program used to install Connection Manager service profiles. CMSTP.exe accepts an installation information file (INF) as a parameter and installs a service profile leveraged for remote access connections.

Adversaries may supply CMSTP.exe with INF files infected with malicious commands. Similar to Regsvr32 / ”Squiblydoo”, CMSTP.exe may be abused to load and execute DLLs and/or COM scriptlets (SCT) from remote servers. This execution may also bypass AppLocker and other application control defenses since CMSTP.exe is a legitimate binary that may be signed by Microsoft.

CMSTP.exe can also be abused to Bypass User Account Control and execute arbitrary commands from a malicious INF through an auto-elevated COM interface.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if CMSTP technique is applicable to target environment
- [ ] Check Windows systems for indicators of CMSTP
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: CMSTP Executing Remote Scriptlet

Adversaries may supply CMSTP.exe with INF files infected with malicious commands

**Supported Platforms:** windows

```cmd
cmstp.exe /s "#{inf_file_path}"
```

**Dependencies:**
- INF file must exist on disk at specified location (#{inf_file_path})

### Atomic Test 2: CMSTP Executing UAC Bypass

Adversaries may invoke cmd.exe (or other malicious commands) by embedding them in the RunPreSetupCommandsSection of an INF file

**Supported Platforms:** windows

```cmd
cmstp.exe /s "#{inf_file_uac}" /au
```

**Dependencies:**
- INF file must exist on disk at specified location (#{inf_file_uac})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to CMSTP by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Consider using application control configured to block execution of CMSTP.exe if it is not required for a given system or network to prevent potential misuse by adversaries.

### M1042 Disable or Remove Feature or Program
CMSTP.exe may not be necessary within a given environment (unless using it for VPN connection installation).


## Detection

### Detection of Malicious Profile Installation via CMSTP.exe


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CMSTP technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Twitter CMSTP Usage Jan 2018](https://x.com/ItsReallyNick/status/958789644165894146)
- [Microsoft Connection Manager Oct 2009](https://docs.microsoft.com/previous-versions/windows/it-pro/windows-server-2003/cc786431(v=ws.10))
- [MSitPros CMSTP Aug 2017](https://msitpros.com/?p=3960)
- [GitHub Ultimate AppLocker Bypass List](https://github.com/api0cradle/UltimateAppLockerByPassList)
- [Endurant CMSTP July 2018](https://web.archive.org/web/20190316220149/http://www.endurant.io/cmstp/detecting-cmstp-enabled-code-execution-and-uac-bypass-with-sysmon/)
- [Twitter CMSTP Jan 2018](https://x.com/NickTyrer/status/958450014111633408)
- [Atomic Red Team - T1218.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.003)
- [MITRE ATT&CK - T1218.003](https://attack.mitre.org/techniques/T1218/003)
