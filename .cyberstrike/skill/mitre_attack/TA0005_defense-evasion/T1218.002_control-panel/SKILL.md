---
name: "T1218.002_control-panel"
description: "Adversaries may abuse control.exe to proxy execution of malicious payloads."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.002
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1218
  - T1218.001
  - T1218.003
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
  T1218.003: "Chain with T1218.003 for deeper attack path"
---

# T1218.002 Control Panel

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse control.exe to proxy execution of malicious payloads. The Windows Control Panel process binary (control.exe) handles execution of Control Panel items, which are utilities that allow users to view and adjust computer settings.

Control Panel items are registered executable (.exe) or Control Panel (.cpl) files, the latter are actually renamed dynamic-link library (.dll) files that export a <code>CPlApplet</code> function. For ease of use, Control Panel items typically include graphical menus available to users after being registered and loaded into the Control Panel. Control Panel items can be executed directly from the command line, programmatically via an application programming interface (API) call, or by simply double-clicking the file.

Malicious Control Panel items can be delivered via Phishing campaigns or executed as part of multi-stage malware. Control Panel items, specifically CPL files, may also bypass application and/or file extension allow lists.

Adversaries may also rename malicious DLL files (.dll) with Control Panel file extensions (.cpl) and register them to <code>HKCU\Software\Microsoft\Windows\CurrentVersion\Control Panel\Cpls</code>. Even when these registered DLLs do not comply with the CPL file specification and do not export <code>CPlApplet</code> functions, they are loaded and executed through its <code>DllEntryPoint</code> when Control Panel is executed. CPL files not exporting <code>CPlApplet</code> are not directly executable.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Control Panel technique is applicable to target environment
- [ ] Check Windows systems for indicators of Control Panel
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Control Panel Items

This test simulates an adversary leveraging control.exe
Upon execution calc.exe will be launched

**Supported Platforms:** windows

```cmd
control.exe "#{cpl_file_path}"
```

**Dependencies:**

- Cpl file must exist on disk at specified location (#{cpl_file_path})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Control Panel by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Restrict storage and execution of Control Panel items to protected directories, such as <code>C:\Windows</code>, rather than user directories.

### M1038 Execution Prevention

Identify and block potentially malicious and unknown .cpl files by using application control tools, like Windows Defender Application Control, AppLocker, or Software Restriction Policies where appropriate.

## Detection

### Detection of Malicious Control Panel Item Execution via control.exe or Rundll32

## Risk Assessment

| Finding                            | Severity | Impact          |
| ---------------------------------- | -------- | --------------- |
| Control Panel technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Microsoft Implementing CPL](https://msdn.microsoft.com/library/windows/desktop/cc144185.aspx)
- [TrendMicro CPL Malware Jan 2014](https://www.trendmicro.de/cloud-content/us/pdfs/security-intelligence/white-papers/wp-cpl-malware.pdf)
- [TrendMicro CPL Malware Dec 2013](https://blog.trendmicro.com/trendlabs-security-intelligence/control-panel-files-used-as-malicious-attachments/)
- [Palo Alto Reaver Nov 2017](https://researchcenter.paloaltonetworks.com/2017/11/unit42-new-malware-with-ties-to-sunorcal-discovered/)
- [ESET InvisiMole June 2020](https://www.welivesecurity.com/wp-content/uploads/2020/06/ESET_InvisiMole.pdf)
- [Atomic Red Team - T1218.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.002)
- [MITRE ATT&CK - T1218.002](https://attack.mitre.org/techniques/T1218/002)
