---
name: "T1087.002_domain-account"
description: "Adversaries may attempt to get a listing of domain accounts."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1087.002
  - discovery
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1087.002"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1087/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1087
  - T1087.001
  - T1087.003
  - T1087.004
prerequisites:
  - T1087
severity_boost:
  T1087: "Chain with T1087 for deeper attack path"
  T1087.001: "Chain with T1087.001 for deeper attack path"
  T1087.003: "Chain with T1087.003 for deeper attack path"
---

# T1087.002 Domain Account

> **Sub-technique of:** T1087

## High-Level Description

Adversaries may attempt to get a listing of domain accounts. This information can help adversaries determine which domain accounts exist to aid in follow-on behavior such as targeting specific accounts which possess particular privileges.

Commands such as <code>net user /domain</code> and <code>net group /domain</code> of the Net utility, <code>dscacheutil -q group</code> on macOS, and <code>ldapsearch</code> on Linux can list domain users and groups. PowerShell cmdlets including <code>Get-ADUser</code> and <code>Get-ADGroupMember</code> may enumerate members of Active Directory groups.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Domain Account technique is applicable to target environment
- [ ] Check Linux systems for indicators of Domain Account
- [ ] Check macOS systems for indicators of Domain Account
- [ ] Check Windows systems for indicators of Domain Account
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Enumerate all accounts (Domain)

Enumerate all accounts
Upon exection, multiple enumeration commands will be run and their output displayed in the PowerShell session

**Supported Platforms:** windows

```cmd
net user /domain
net group /domain
```

### Atomic Test 2: Enumerate all accounts via PowerShell (Domain)

Enumerate all accounts via PowerShell. Upon execution, lots of user account and group information will be displayed.

**Supported Platforms:** windows

```powershell
net user /domain
get-localgroupmember -group Users
get-aduser -filter *
```

### Atomic Test 3: Enumerate logged on users via CMD (Domain)

Enumerate logged on users. Upon exeuction, logged on users will be displayed.

**Supported Platforms:** windows

```cmd
query user /SERVER:#{computer_name}
```

### Atomic Test 4: Automated AD Recon (ADRecon)

ADRecon extracts and combines information about an AD environement into a report. Upon execution, an Excel file with all of the data will be generated and its
path will be displayed.

**Supported Platforms:** windows

```powershell
Invoke-Expression "#{adrecon_path}"
```

**Dependencies:**

- ADRecon must exist on disk at specified location (#{adrecon_path})

### Atomic Test 5: Adfind -Listing password policy

Adfind tool can be used for reconnaissance in an Active directory environment. The example chosen illustrates adfind used to query the local password policy.
reference- http://www.joeware.net/freetools/tools/adfind/, https://social.technet.microsoft.com/wiki/contents/articles/7535.adfind-command-examples.aspx

**Supported Platforms:** windows

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\AdFind.exe" #{optional_args} -default -s base lockoutduration lockoutthreshold lockoutobservationwindow maxpwdage minpwdage minpwdlength pwdhistorylength pwdproperties
```

**Dependencies:**

- AdFind.exe must exist on disk at specified location (PathToAtomicsFolder\..\ExternalPayloads\AdFind.exe)

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domain Account by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1087.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration

Prevent administrator accounts from being enumerated when an application is elevating through UAC since it can lead to the disclosure of account names. The Registry key is located at <code>HKLM\ SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\CredUI\EnumerateAdministrators</code>. It can be disabled through GPO: Computer Configuration > [Policies] > Administrative Templates > Windows Components > Credential User Interface: Enumerate administrator accounts on elevation.

## Detection

### Domain Account Enumeration Across Platforms

## Risk Assessment

| Finding                             | Severity | Impact    |
| ----------------------------------- | -------- | --------- |
| Domain Account technique applicable | High     | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [CrowdStrike StellarParticle January 2022](https://www.crowdstrike.com/blog/observations-from-the-stellarparticle-campaign/)
- [Atomic Red Team - T1087.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1087.002)
- [MITRE ATT&CK - T1087.002](https://attack.mitre.org/techniques/T1087/002)
