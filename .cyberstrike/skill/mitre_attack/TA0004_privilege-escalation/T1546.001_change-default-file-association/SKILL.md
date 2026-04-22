---
name: "T1546.001_change-default-file-association"
description: "Adversaries may establish persistence by executing malicious content triggered by a file type association."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.001
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.001"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-269
chains_with:
  - T1546
  - T1546.002
  - T1546.003
  - T1546.004
  - T1546.005
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
  - T1546.016
  - T1546.017
  - T1546.018
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
  T1546.003: "Chain with T1546.003 for deeper attack path"
---

# T1546.001 Change Default File Association

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence by executing malicious content triggered by a file type association. When a file is opened, the default program used to open the file (also called the file association or handler) is checked. File association selections are stored in the Windows Registry and can be edited by users, administrators, or programs that have Registry access or by administrators using the built-in assoc utility. Applications can modify the file association for a given file extension to call an arbitrary program when a file with the given extension is opened.

System file associations are listed under <code>HKEY_CLASSES_ROOT\.[extension]</code>, for example <code>HKEY_CLASSES_ROOT\.txt</code>. The entries point to a handler for that extension located at <code>HKEY_CLASSES_ROOT\\[handler]</code>. The various commands are then listed as subkeys underneath the shell key at <code>HKEY_CLASSES_ROOT\\[handler]\shell\\[action]\command</code>. For example: 

* <code>HKEY_CLASSES_ROOT\txtfile\shell\open\command</code>
* <code>HKEY_CLASSES_ROOT\txtfile\shell\print\command</code>
* <code>HKEY_CLASSES_ROOT\txtfile\shell\printto\command</code>

The values of the keys listed are commands that are executed when the handler opens the file extension. Adversaries can modify these values to continually execute arbitrary commands.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Change Default File Association technique is applicable to target environment
- [ ] Check Windows systems for indicators of Change Default File Association
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Change Default File Association

Change Default File Association From cmd.exe of hta to notepad.

Upon successful execution, cmd.exe will change the file association of .hta to notepad.exe.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
assoc #{extension_to_change}=#{target_extension_handler}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Change Default File Association by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Default File Association Hijack via Registry & Execution Correlation on Windows


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Change Default File Association technique applicable | Low | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [Microsoft Change Default Programs](https://support.microsoft.com/en-us/help/18539/windows-7-change-default-programs)
- [Microsoft File Handlers](https://learn.microsoft.com/en-us/previous-versions/visualstudio/visual-studio-2015/extensibility/specifying-file-handlers-for-file-name-extensions?view=vs-2015)
- [Microsoft Assoc Oct 2017](https://docs.microsoft.com/windows-server/administration/windows-commands/assoc)
- [TrendMicro TROJ-FAKEAV OCT 2012](https://www.trendmicro.com/vinfo/us/threat-encyclopedia/malware/troj_fakeav.gzd)
- [Atomic Red Team - T1546.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.001)
- [MITRE ATT&CK - T1546.001](https://attack.mitre.org/techniques/T1546/001)
