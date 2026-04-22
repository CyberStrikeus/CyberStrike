---
name: "T1556.002_password-filter-dll"
description: "Adversaries may register malicious password filter dynamic link libraries (DLLs) into the authentication process to acquire user credentials as they are validated."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1556.002
  - credential-access
  - defense-evasion
  - persistence
  - windows
  - sub-technique
technique_id: "T1556.002"
tactic: "credential-access"
all_tactics:
  - credential-access
  - defense-evasion
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1556/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1556
  - T1556.001
  - T1556.003
  - T1556.004
  - T1556.005
  - T1556.006
  - T1556.007
  - T1556.008
  - T1556.009
prerequisites:
  - T1556
severity_boost:
  T1556: "Chain with T1556 for deeper attack path"
  T1556.001: "Chain with T1556.001 for deeper attack path"
  T1556.003: "Chain with T1556.003 for deeper attack path"
---

# T1556.002 Password Filter DLL

> **Sub-technique of:** T1556

## High-Level Description

Adversaries may register malicious password filter dynamic link libraries (DLLs) into the authentication process to acquire user credentials as they are validated.

Windows password filters are password policy enforcement mechanisms for both domain and local accounts. Filters are implemented as DLLs containing a method to validate potential passwords against password policies. Filter DLLs can be positioned on local computers for local accounts and/or domain controllers for domain accounts. Before registering new passwords in the Security Accounts Manager (SAM), the Local Security Authority (LSA) requests validation from each registered filter. Any potential changes cannot take effect until every registered filter acknowledges validation.

Adversaries can register malicious password filters to harvest credentials from local computers and/or entire domains. To perform proper validation, filters must receive plain-text credentials from the LSA. A malicious password filter would receive these plain-text credentials every time a password request is made.

## Kill Chain Phase

- Credential Access (TA0006)
- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Password Filter DLL technique is applicable to target environment
- [ ] Check Windows systems for indicators of Password Filter DLL
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Install and Register Password Filter DLL

Uses PowerShell to install and register a password filter DLL. Requires a reboot and administrative privileges.
The binary in bin is https://www.virustotal.com/gui/file/95140c1ad39fd632d1c1300b246293297aa272ce6035eecc3da56e337200221d/detection
Source is in src folder.
This does require a reboot to see the filter loaded into lsass.exe.
It does require Administrative privileges to import the clean registry values back into LSA, it is possible you may have to manually do this after for cleanup.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
reg.exe export HKLM\SYSTEM\CurrentControlSet\Control\Lsa\ "PathToAtomicsFolder\T1556.002\lsa_backup.reg"
$passwordFilterName = (Copy-Item "#{dll_path}\#{dll_name}" -Destination "C:\Windows\System32" -PassThru).basename
$lsaKey = Get-Item "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa\"
$notificationPackagesValues = $lsaKey.GetValue("Notification Packages")
$notificationPackagesValues += $passwordFilterName
Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa\" "Notification Packages" $notificationPackagesValues
```

**Dependencies:**

- AtomicRedTeamPWFilter.dll must exist on disk at specified location (#{dll_path}\#{dll_name})

### Atomic Test 2: Install Additional Authentication Packages

lsass.exe loads all DLLs specified by the Authentication Packages REG_MULTI_SZ value.
Uses PowerShell to install and register a password filter DLL. Requires a reboot and administrative privileges.
The binary in bin is https://www.virustotal.com/gui/file/95140c1ad39fd632d1c1300b246293297aa272ce6035eecc3da56e337200221d/detection
Source is in src folder.
This does require a reboot to see the filter loaded into lsass.exe.
It does require Administrative privileges to import the clean registry values back into LSA, it is possible you may have to manually do this after for cleanup.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
reg.exe export HKLM\SYSTEM\CurrentControlSet\Control\Lsa\ "PathToAtomicsFolder\T1556.002\lsa_backup.reg"
$passwordFilterName = (Copy-Item "#{dll_path}\#{dll_name}" -Destination "C:\Windows\System32" -PassThru).basename
$lsaKey = Get-Item "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa\"
$AuthenticationPackagesValues = $lsaKey.GetValue("Authentication Packages")
$AuthenticationPackagesValues += $passwordFilterName
Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa\" "Authentication Packages" $AuthenticationPackagesValues
```

**Dependencies:**

- AtomicRedTeamPWFilter.dll must exist on disk at specified location (#{dll_path}\#{dll_name})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Password Filter DLL by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1556.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration

Ensure only valid password filters are registered. Filter DLLs must be present in Windows installation directory (C:\Windows\System32\ by default) of a domain controller and/or local computer with a corresponding entry in HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Lsa\Notification Packages.

## Detection

### Detect Malicious Password Filter DLL Registration

## Risk Assessment

| Finding                                  | Severity | Impact            |
| ---------------------------------------- | -------- | ----------------- |
| Password Filter DLL technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Clymb3r Function Hook Passwords Sept 2013](https://clymb3r.wordpress.com/2013/09/15/intercepting-password-changes-with-function-hooking/)
- [Carnal Ownage Password Filters Sept 2013](http://carnal0wnage.attackresearch.com/2013/09/stealing-passwords-every-time-they.html)
- [Atomic Red Team - T1556.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1556.002)
- [MITRE ATT&CK - T1556.002](https://attack.mitre.org/techniques/T1556/002)
