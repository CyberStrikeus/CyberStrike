---
name: "T1547.005_security-support-provider"
description: "Adversaries may abuse security support providers (SSPs) to execute DLLs when the system boots."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.005
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1547.005"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1547/005"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.001
  - T1547.002
  - T1547.003
  - T1547.004
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
  T1547.002: "Chain with T1547.002 for deeper attack path"
---

# T1547.005 Security Support Provider

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may abuse security support providers (SSPs) to execute DLLs when the system boots. Windows SSP DLLs are loaded into the Local Security Authority (LSA) process at system start. Once loaded into the LSA, SSP DLLs have access to encrypted and plaintext passwords that are stored in Windows, such as any logged-on user's Domain password or smart card PINs.

The SSP configuration is stored in two Registry keys: <code>HKLM\SYSTEM\CurrentControlSet\Control\Lsa\Security Packages</code> and <code>HKLM\SYSTEM\CurrentControlSet\Control\Lsa\OSConfig\Security Packages</code>. An adversary may modify these Registry keys to add new SSPs, which will be loaded the next time the system boots, or when the AddSecurityPackage Windows API function is called.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Security Support Provider technique is applicable to target environment
- [ ] Check Windows systems for indicators of Security Support Provider
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Modify HKLM:\System\CurrentControlSet\Control\Lsa Security Support Provider configuration in registry

Add a value to a Windows registry Security Support Provider pointing to a payload .dll which will normally need to be copied in the system32 folder.
A common DLL used with this techquite is the minilib.dll from mimikatz, see https://pentestlab.blog/2019/10/21/persistence-security-support-provider/

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$oldvalue = $(Get-ItemProperty HKLM:\System\CurrentControlSet\Control\Lsa -Name 'Security Packages' | Select-Object -ExpandProperty 'Security Packages');
Set-ItemProperty -Path "HKLM:\System\CurrentControlSet\Control\Lsa" -Name 'Security Packages old' -Value "$oldvalue";
$newvalue = "AtomicTest.dll";
Set-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\Lsa -Name 'Security Packages' -Value $newvalue
```

### Atomic Test 2: Modify HKLM:\System\CurrentControlSet\Control\Lsa\OSConfig Security Support Provider configuration in registry

Add a value to a Windows registry SSP key, simulating an adversarial modification of those keys.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$oldvalue = $(Get-ItemProperty HKLM:\System\CurrentControlSet\Control\Lsa\OSConfig -Name 'Security Packages' | Select-Object -ExpandProperty 'Security Packages');
Set-ItemProperty -Path "HKLM:\System\CurrentControlSet\Control\Lsa\OSConfig" -Name 'Security Packages old' -Value "$oldvalue";
$newvalue = "AtomicTest.dll";
Set-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\Lsa\OSConfig -Name 'Security Packages' -Value $newvalue
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Security Support Provider by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1025 Privileged Process Integrity
Windows 8.1, Windows Server 2012 R2, and later versions may make LSA run as a Protected Process Light (PPL) by setting the Registry key <code>HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa\\RunAsPPL</code>, which requires all SSP DLLs to be signed by Microsoft.


## Detection

### Registry and LSASS Monitoring for Security Support Provider Abuse


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Security Support Provider technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Graeber 2014](http://docplayer.net/20839173-Analysis-of-malicious-security-support-provider-dlls.html)
- [Microsoft Configure LSA](https://technet.microsoft.com/en-us/library/dn408187.aspx)
- [Atomic Red Team - T1547.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.005)
- [MITRE ATT&CK - T1547.005](https://attack.mitre.org/techniques/T1547/005)
