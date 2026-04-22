---
name: "T1547.002_authentication-package"
description: "Adversaries may abuse authentication packages to execute DLLs when the system boots."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.002
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1547.002"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1547/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.001
  - T1547.003
  - T1547.004
  - T1547.005
  - T1547.006
  - T1547.007
  - T1547.008
  - T1547.009
  - T1547.010
  - T1547.012
  - T1547.013
  - T1547.014
  - T1547.015
prerequisites:
  - T1547
severity_boost:
  T1547: "Chain with T1547 for deeper attack path"
  T1547.001: "Chain with T1547.001 for deeper attack path"
  T1547.003: "Chain with T1547.003 for deeper attack path"
---

# T1547.002 Authentication Package

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may abuse authentication packages to execute DLLs when the system boots. Windows authentication package DLLs are loaded by the Local Security Authority (LSA) process at system start. They provide support for multiple logon processes and multiple security protocols to the operating system.

Adversaries can use the autostart mechanism provided by LSA authentication packages for persistence by placing a reference to a binary in the Windows Registry location <code>HKLM\SYSTEM\CurrentControlSet\Control\Lsa\</code> with the key value of <code>"Authentication Packages"=&lt;target binary&gt;</code>. The binary will then be executed by the system when the authentication packages are loaded.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Authentication Package technique is applicable to target environment
- [ ] Check Windows systems for indicators of Authentication Package
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Authentication Package

Establishes persistence using a custom authentication package for the Local Security Authority (LSA).
After a reboot, Notepad.exe will be executed as child process of lsass.exe.
Payload source code: https://github.com/tr4cefl0w/payloads/tree/master/T1547.002/package
[Related blog](https://pentestlab.blog/2019/10/21/persistence-security-support-provider/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Copy-Item "$PathToAtomicsFolder\T1547.002\bin\package.dll" C:\Windows\System32\
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Lsa" /v "Authentication Packages" /t REG_MULTI_SZ /d "msv1_0\0package.dll" /f
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Authentication Package by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1025 Privileged Process Integrity

Windows 8.1, Windows Server 2012 R2, and later versions, may make LSA run as a Protected Process Light (PPL) by setting the Registry key <code>HKLM\SYSTEM\CurrentControlSet\Control\Lsa\RunAsPPL</code>, which requires all DLLs loaded by LSA to be signed by Microsoft.

## Detection

### Detect LSA Authentication Package Persistence via Registry and LSASS DLL Load

## Risk Assessment

| Finding                                     | Severity | Impact      |
| ------------------------------------------- | -------- | ----------- |
| Authentication Package technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Graeber 2014](http://docplayer.net/20839173-Analysis-of-malicious-security-support-provider-dlls.html)
- [Microsoft Configure LSA](https://technet.microsoft.com/en-us/library/dn408187.aspx)
- [MSDN Authentication Packages](https://msdn.microsoft.com/library/windows/desktop/aa374733.aspx)
- [Atomic Red Team - T1547.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.002)
- [MITRE ATT&CK - T1547.002](https://attack.mitre.org/techniques/T1547/002)
