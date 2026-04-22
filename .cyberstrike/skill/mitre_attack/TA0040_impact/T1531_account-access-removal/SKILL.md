---
name: "T1531_account-access-removal"
description: "Adversaries may interrupt availability of system and network resources by inhibiting access to accounts utilized by legitimate users."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1531
  - impact
  - linux
  - macos
  - windows
  - saas
  - iaas
  - office-suite
  - esxi
technique_id: "T1531"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - macOS
  - Windows
  - SaaS
  - IaaS
  - Office Suite
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1531"
tech_stack:
  - linux
  - macos
  - windows
  - saas
  - cloud
  - office
  - esxi
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1531 Account Access Removal

## High-Level Description

Adversaries may interrupt availability of system and network resources by inhibiting access to accounts utilized by legitimate users. Accounts may be deleted, locked, or manipulated (ex: changed credentials, revoked permissions for SaaS platforms such as Sharepoint) to remove access to accounts. Adversaries may also subsequently log off and/or perform a System Shutdown/Reboot to set malicious changes into place.

In Windows, Net utility, <code>Set-LocalUser</code> and <code>Set-ADAccountPassword</code> PowerShell cmdlets may be used by adversaries to modify user accounts. Accounts could also be disabled by Group Policy. In Linux, the <code>passwd</code> utility may be used to change passwords. On ESXi servers, accounts can be removed or modified via esxcli (`system account set`, `system account remove`).

Adversaries who use ransomware or similar attacks may first perform this and other Impact behaviors, such as Data Destruction and Defacement, in order to impede incident response/recovery before completing the Data Encrypted for Impact objective.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, macOS, Windows, SaaS, IaaS, Office Suite, ESXi

## What to Check

- [ ] Identify if Account Access Removal technique is applicable to target environment
- [ ] Check Linux systems for indicators of Account Access Removal
- [ ] Check macOS systems for indicators of Account Access Removal
- [ ] Check Windows systems for indicators of Account Access Removal
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Change User Password - Windows

Changes the user password to hinder access attempts. Seen in use by LockerGoga. Upon execution, log into the user account "AtomicAdministrator" with
the password "HuHuHUHoHo283283".

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
net user #{user_account} #{new_user_password} /add
net.exe user #{user_account} #{new_password}
```

### Atomic Test 2: Delete User - Windows

Deletes a user account to prevent access. Upon execution, run the command "net user" to verify that the new "AtomicUser" account was deleted.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
net user #{user_account} #{new_user_password} /add
net.exe user #{user_account} /delete
```

### Atomic Test 3: Remove Account From Domain Admin Group

This test will remove an account from the domain admins group

**Supported Platforms:** windows

```powershell
$PWord = ConvertTo-SecureString -String #{super_pass} -AsPlainText -Force
$Credential = New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList #{super_user}, $PWord
if((Get-ADUser #{remove_user} -Properties memberof).memberof -like "CN=Domain Admins*"){
  Remove-ADGroupMember -Identity "Domain Admins" -Members #{remove_user} -Credential $Credential -Confirm:$False
} else{
    write-host "Error - Make sure #{remove_user} is in the domain admins group" -foregroundcolor Red
}
```

**Dependencies:**

- Requires the Active Directory module for powershell to be installed.

### Atomic Test 4: Change User Password via passwd

This test changes the user password to hinder access to the account using passwd utility.

**Supported Platforms:** macos, linux
**Elevation Required:** Yes

```bash
passwd #{user_account} #enter admin password > enter new password > confirm new password
```

### Atomic Test 5: Delete User via dscl utility

This test deletes the user account using the dscl utility.

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
dscl . -delete /Users/#{user_account} #enter admin password
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Account Access Removal by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1531 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Account Access Removal via Multi-Platform Audit Correlation

## Risk Assessment

| Finding                                     | Severity | Impact |
| ------------------------------------------- | -------- | ------ |
| Account Access Removal technique applicable | High     | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [CarbonBlack LockerGoga 2019](https://www.carbonblack.com/2019/03/22/tau-threat-intelligence-notification-lockergoga-ransomware/)
- [Unit42 LockerGoga 2019](https://unit42.paloaltonetworks.com/born-this-way-origins-of-lockergoga/)
- [Obsidian Security SaaS Ransomware June 2023](https://web.archive.org/web/20230608061141/https://www.obsidiansecurity.com/blog/saas-ransomware-observed-sharepoint-microsoft-365/)
- [Atomic Red Team - T1531](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1531)
- [MITRE ATT&CK - T1531](https://attack.mitre.org/techniques/T1531)
