---
name: "T1552.006_group-policy-preferences"
description: "Adversaries may attempt to find unsecured credentials in Group Policy Preferences (GPP)."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1552.006
  - credential-access
  - windows
  - sub-technique
technique_id: "T1552.006"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1552/006"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1552
  - T1552.001
  - T1552.002
  - T1552.003
  - T1552.004
  - T1552.005
  - T1552.007
  - T1552.008
prerequisites:
  - T1552
severity_boost:
  T1552: "Chain with T1552 for deeper attack path"
  T1552.001: "Chain with T1552.001 for deeper attack path"
  T1552.002: "Chain with T1552.002 for deeper attack path"
---

# T1552.006 Group Policy Preferences

> **Sub-technique of:** T1552

## High-Level Description

Adversaries may attempt to find unsecured credentials in Group Policy Preferences (GPP). GPP are tools that allow administrators to create domain policies with embedded credentials. These policies allow administrators to set local accounts.

These group policies are stored in SYSVOL on a domain controller. This means that any domain user can view the SYSVOL share and decrypt the password (using the AES key that has been made public).

The following tools and scripts can be used to gather and decrypt the password file from Group Policy Preference XML files:

- Metasploit’s post exploitation module: <code>post/windows/gather/credentials/gpp</code>
- Get-GPPPassword
- gpprefdecrypt.py

On the SYSVOL share, adversaries may use the following command to enumerate potential GPP XML files: <code>dir /s \* .xml</code>

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if Group Policy Preferences technique is applicable to target environment
- [ ] Check Windows systems for indicators of Group Policy Preferences
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: GPP Passwords (findstr)

Look for the encrypted cpassword value within Group Policy Preference files on the Domain Controller. This value can be decrypted with gpp-decrypt on Kali Linux.

**Supported Platforms:** windows

```cmd
findstr /S cpassword %logonserver%\sysvol\*.xml
```

**Dependencies:**

- Computer must be domain joined

### Atomic Test 2: GPP Passwords (Get-GPPPassword)

Look for the encrypted cpassword value within Group Policy Preference files on the Domain Controller.
This test is intended to be run from a domain joined workstation, not on the Domain Controller itself.
The Get-GPPPasswords.ps1 executed during this test can be obtained using the get-prereq_commands.

Successful test execution will either display the credentials found in the GPP files or indicate "No preference files found".

**Supported Platforms:** windows

```powershell
. "#{gpp_script_path}"
Get-GPPPassword -Verbose
```

**Dependencies:**

- Get-GPPPassword PowerShell Script must exist at #{gpp_script_path}
- Computer must be domain joined

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Group Policy Preferences by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1552.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit

Search SYSVOL for any existing GGPs that may contain credentials and remove them.

### M1051 Update Software

Apply patch KB2962486 which prevents credentials from being stored in GPPs.

### M1015 Active Directory Configuration

Remove vulnerable Group Policy Preferences.

## Detection

### Detect Access and Decryption of Group Policy Preference (GPP) Credentials in SYSVOL

## Risk Assessment

| Finding                                       | Severity | Impact            |
| --------------------------------------------- | -------- | ----------------- |
| Group Policy Preferences technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Obscuresecurity Get-GPPPassword](https://obscuresecurity.blogspot.co.uk/2012/05/gpp-password-retrieval-with-powershell.html)
- [Microsoft GPP 2016](<https://docs.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/dn581922(v%3Dws.11)>)
- [Microsoft GPP Key](https://msdn.microsoft.com/library/cc422924.aspx)
- [ADSecurity Finding Passwords in SYSVOL](https://adsecurity.org/?p=2288)
- [Atomic Red Team - T1552.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1552.006)
- [MITRE ATT&CK - T1552.006](https://attack.mitre.org/techniques/T1552/006)
