---
name: "T1098_account-manipulation"
description: "Adversaries may manipulate accounts to maintain and/or elevate access to victim systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1098
  - persistence
  - privilege-escalation
  - containers
  - esxi
  - iaas
  - identity-provider
  - linux
  - macos
  - network-devices
  - office-suite
  - saas
  - windows
technique_id: "T1098"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Containers
  - ESXi
  - IaaS
  - Identity Provider
  - Linux
  - macOS
  - Network Devices
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1098"
tech_stack:
  - containers
  - esxi
  - cloud
  - identity
  - linux
  - macos
  - network devices
  - office
  - saas
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1098.001
  - T1098.002
  - T1098.003
  - T1098.004
  - T1098.005
  - T1098.006
  - T1098.007
prerequisites: []
severity_boost:
  T1098.001: "Chain with T1098.001 for deeper attack path"
  T1098.002: "Chain with T1098.002 for deeper attack path"
  T1098.003: "Chain with T1098.003 for deeper attack path"
---

# T1098 Account Manipulation

## High-Level Description

Adversaries may manipulate accounts to maintain and/or elevate access to victim systems. Account manipulation may consist of any action that preserves or modifies adversary access to a compromised account, such as modifying credentials or permission groups. These actions could also include account activity designed to subvert security policies, such as performing iterative password updates to bypass password duration policies and preserve the life of compromised credentials.

In order to create or manipulate accounts, the adversary must already have sufficient permissions on systems or the domain. However, account manipulation may also lead to privilege escalation where modifications grant access to additional roles, permissions, or higher-privileged Valid Accounts.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Containers, ESXi, IaaS, Identity Provider, Linux, macOS, Network Devices, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Account Manipulation technique is applicable to target environment
- [ ] Check Containers systems for indicators of Account Manipulation
- [ ] Check ESXi systems for indicators of Account Manipulation
- [ ] Check IaaS systems for indicators of Account Manipulation
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Admin Account Manipulate

Manipulate Admin Account Name

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$x = Get-Random -Minimum 2 -Maximum 9999
$y = Get-Random -Minimum 2 -Maximum 9999
$z = Get-Random -Minimum 2 -Maximum 9999
$w = Get-Random -Minimum 2 -Maximum 9999
Write-Host HaHa_$x$y$z

$fmm = Get-LocalGroupMember -Group Administrators |?{ $_.ObjectClass -match "User" -and $_.PrincipalSource -match "Local"} | Select Name

foreach($member in $fmm) {
    if($member -like "*Administrator*") {
        $account = $member.Name.Split("\")[-1] # strip computername\
        $originalDescription = (Get-LocalUser -Name $account).Description
        Set-LocalUser -Name $account -Description "atr:$account;$originalDescription".Substring(0,48) # Keep original name in description
        Rename-LocalUser -Name $account -NewName "HaHa_$x$y$z" # Required due to length limitation
        Write-Host "Successfully Renamed $account Account on " $Env:COMPUTERNAME
        }
    }
```

### Atomic Test 2: Domain Account and Group Manipulate

Create a random atr-nnnnnnnn account and add it to a domain group (by default, Domain Admins).

The quickest way to run it is against a domain controller, using `-Session` of `Invoke-AtomicTest`. Alternatively,
you need to install PS Module ActiveDirectory (in prereqs) and run the script with appropriare AD privileges to
create the user and alter the group. Automatic installation of the dependency requires an elevated session,
and is unlikely to work with Powershell Core (untested).

If you consider running this test against a production Active Directory, the good practise is to create a dedicated
service account whose delegation is given onto a dedicated OU for user creation and deletion, as well as delegated
as group manager of the target group.

Example: `Invoke-AtomicTest -Session $session 'T1098' -TestNames "Domain Account and Group Manipulate" -InputArgs @{"group" = "DNSAdmins" }`

**Supported Platforms:** windows

```powershell
$x = Get-Random -Minimum 2 -Maximum 99
$y = Get-Random -Minimum 2 -Maximum 99
$z = Get-Random -Minimum 2 -Maximum 99
$w = Get-Random -Minimum 2 -Maximum 99

Import-Module ActiveDirectory
$account = "#{account_prefix}-$x$y$z"
New-ADUser -Name $account -GivenName "Test" -DisplayName $account -SamAccountName $account -Surname $account -Enabled:$False #{create_args}
Add-ADGroupMember "#{group}" $account
```

**Dependencies:**

- PS Module ActiveDirectory

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Account Manipulation by examining the target platforms (Containers, ESXi, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1098 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1030 Network Segmentation

Configure access controls and firewalls to limit access to critical systems and domain controllers. Most cloud environments support separate virtual private cloud (VPC) instances that enable further segmentation of cloud systems.

### M1042 Disable or Remove Feature or Program

Remove unnecessary and potentially abusable authentication and authorization mechanisms where possible.

### M1018 User Account Management

Ensure that low-privileged user accounts do not have permissions to modify accounts or account-related policies.

### M1022 Restrict File and Directory Permissions

Restrict access to potentially sensitive files that deal with authentication and/or authorization.

### M1032 Multi-factor Authentication

Use multi-factor authentication for user and privileged accounts.

### M1026 Privileged Account Management

Do not allow domain administrator accounts to be used for day-to-day operations that may expose them to potential adversaries on unprivileged systems.

### M1028 Operating System Configuration

Protect domain controllers by ensuring proper security configuration for critical servers to limit access by potentially unnecessary protocols and services, such as SMB file sharing.

## Detection

### Account Manipulation Behavior Chain Detection

## Risk Assessment

| Finding                                   | Severity | Impact      |
| ----------------------------------------- | -------- | ----------- |
| Account Manipulation technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [FireEye SMOKEDHAM June 2021](https://www.fireeye.com/blog/threat-research/2021/06/darkside-affiliate-supply-chain-software-compromise.html)
- [Microsoft Security Event 4670](https://www.ultimatewindowssecurity.com/securitylog/encyclopedia/event.aspx?eventID=4670)
- [Microsoft User Modified Event](https://docs.microsoft.com/en-us/windows/security/threat-protection/auditing/event-4738)
- [InsiderThreat ChangeNTLM July 2017](https://blog.stealthbits.com/manipulating-user-passwords-with-mimikatz-SetNTLM-ChangeNTLM)
- [GitHub Mimikatz Issue 92 June 2017](https://github.com/gentilkiwi/mimikatz/issues/92)
- [Atomic Red Team - T1098](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1098)
- [MITRE ATT&CK - T1098](https://attack.mitre.org/techniques/T1098)
