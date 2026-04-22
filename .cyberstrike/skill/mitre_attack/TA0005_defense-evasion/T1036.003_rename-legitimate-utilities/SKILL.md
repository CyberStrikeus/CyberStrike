---
name: "T1036.003_rename-legitimate-utilities"
description: "Adversaries may rename legitimate / system utilities to try to evade security mechanisms concerning the usage of those utilities."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.003
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1036.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1036/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.001
  - T1036.002
  - T1036.004
  - T1036.005
  - T1036.006
  - T1036.007
  - T1036.008
  - T1036.009
  - T1036.010
  - T1036.011
  - T1036.012
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
---

# T1036.003 Rename Legitimate Utilities

> **Sub-technique of:** T1036

## High-Level Description

Adversaries may rename legitimate / system utilities to try to evade security mechanisms concerning the usage of those utilities. Security monitoring and control mechanisms may be in place for legitimate utilities adversaries are capable of abusing, including both built-in binaries and tools such as PSExec, AutoHotKey, and IronPython. It may be possible to bypass those security mechanisms by renaming the utility prior to utilization (ex: rename <code>rundll32.exe</code>). An alternative case occurs when a legitimate utility is copied or moved to a different directory and renamed to avoid detections based on these utilities executing from non-standard paths.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Rename Legitimate Utilities technique is applicable to target environment
- [ ] Check Linux systems for indicators of Rename Legitimate Utilities
- [ ] Check macOS systems for indicators of Rename Legitimate Utilities
- [ ] Check Windows systems for indicators of Rename Legitimate Utilities
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Masquerading as Windows LSASS process

Copies cmd.exe, renames it, and launches it to masquerade as an instance of lsass.exe.

Upon execution, cmd will be launched by powershell. If using Invoke-AtomicTest, The test will hang until the 120 second timeout cancels the session

**Supported Platforms:** windows

```cmd
copy %SystemRoot%\System32\cmd.exe %SystemRoot%\Temp\lsass.exe
%SystemRoot%\Temp\lsass.exe /B
```

### Atomic Test 2: Masquerading as FreeBSD or Linux crond process.

Copies sh process, renames it as crond, and executes it to masquerade as the cron daemon.

Upon successful execution, sh is renamed to `crond` and executed.

**Supported Platforms:** linux

```bash
cp /bin/sh /tmp/crond;
echo 'sleep 5' | /tmp/crond
```

### Atomic Test 3: Masquerading - cscript.exe running as notepad.exe

Copies cscript.exe, renames it, and launches it to masquerade as an instance of notepad.exe.

Upon successful execution, cscript.exe is renamed as notepad.exe and executed from non-standard path.

**Supported Platforms:** windows

```cmd
copy %SystemRoot%\System32\cscript.exe %APPDATA%\notepad.exe /Y
cmd.exe /c %APPDATA%\notepad.exe /B
```

### Atomic Test 4: Masquerading - wscript.exe running as svchost.exe

Copies wscript.exe, renames it, and launches it to masquerade as an instance of svchost.exe.

Upon execution, no windows will remain open but wscript will have been renamed to svchost and ran out of the temp folder

**Supported Platforms:** windows

```cmd
copy %SystemRoot%\System32\wscript.exe %APPDATA%\svchost.exe /Y
cmd.exe /c %APPDATA%\svchost.exe "PathToAtomicsFolder\..\ExternalPayloads\T1036.003\src\T1036.003_masquerading.vbs"
```

**Dependencies:**
- Wscript file to execute must exist on disk

### Atomic Test 5: Masquerading - powershell.exe running as taskhostw.exe

Copies powershell.exe, renames it, and launches it to masquerade as an instance of taskhostw.exe.

Upon successful execution, powershell.exe is renamed as taskhostw.exe and executed from non-standard path.

**Supported Platforms:** windows

```cmd
copy %windir%\System32\windowspowershell\v1.0\powershell.exe %APPDATA%\taskhostw.exe /Y
cmd.exe /K %APPDATA%\taskhostw.exe
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Rename Legitimate Utilities by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Use file system access controls to protect folders such as `C:\Windows\System32`.


## Detection

### Renamed Legitimate Utility Execution with Metadata Mismatch and Suspicious Path


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Rename Legitimate Utilities technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Twitter ItsReallyNick Masquerading Update](https://x.com/ItsReallyNick/status/1055321652777619457)
- [Elastic Masquerade Ball](https://www.elastic.co/blog/how-hunt-masquerade-ball)
- [F-Secure CozyDuke](https://www.f-secure.com/documents/996508/1030745/CozyDuke)
- [LOLBAS Main Site](https://lolbas-project.github.io/)
- [Huntress Python Malware 2025](https://www.huntress.com/blog/snakes-on-a-domain-an-analysis-of-a-python-malware-loader)
- [Splunk Detect Renamed PSExec](https://research.splunk.com/endpoint/683e6196-b8e8-11eb-9a79-acde48001122/)
- [The DFIR Report AutoHotKey 2023](https://thedfirreport.com/2023/02/06/collect-exfiltrate-sleep-repeat/)
- [Atomic Red Team - T1036.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.003)
- [MITRE ATT&CK - T1036.003](https://attack.mitre.org/techniques/T1036/003)
