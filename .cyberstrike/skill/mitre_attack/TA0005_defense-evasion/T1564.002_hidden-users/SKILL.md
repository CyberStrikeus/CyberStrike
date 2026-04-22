---
name: "T1564.002_hidden-users"
description: "Adversaries may use hidden users to hide the presence of user accounts they create or modify."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.002
  - defense-evasion
  - macos
  - windows
  - linux
  - sub-technique
technique_id: "T1564.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - macOS
  - Windows
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1564/002"
tech_stack:
  - macos
  - windows
  - linux
cwe_ids:
  - CWE-693
chains_with:
  - T1564
  - T1564.001
  - T1564.003
  - T1564.004
  - T1564.005
  - T1564.006
  - T1564.007
  - T1564.008
  - T1564.009
  - T1564.010
  - T1564.011
  - T1564.012
  - T1564.013
  - T1564.014
prerequisites:
  - T1564
severity_boost:
  T1564: "Chain with T1564 for deeper attack path"
  T1564.001: "Chain with T1564.001 for deeper attack path"
  T1564.003: "Chain with T1564.003 for deeper attack path"
---

# T1564.002 Hidden Users

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may use hidden users to hide the presence of user accounts they create or modify. Administrators may want to hide users when there are many user accounts on a given system or if they want to hide their administrative or other management accounts from other users.

In macOS, adversaries can create or modify a user to be hidden through manipulating plist files, folder attributes, and user attributes. To prevent a user from being shown on the login screen and in System Preferences, adversaries can set the userID to be under 500 and set the key value <code>Hide500Users</code> to <code>TRUE</code> in the <code>/Library/Preferences/com.apple.loginwindow</code> plist file. Every user has a userID associated with it. When the <code>Hide500Users</code> key value is set to <code>TRUE</code>, users with a userID under 500 do not appear on the login screen and in System Preferences. Using the command line, adversaries can use the <code>dscl</code> utility to create hidden user accounts by setting the <code>IsHidden</code> attribute to <code>1</code>. Adversaries can also hide a user’s home folder by changing the <code>chflags</code> to hidden.

Adversaries may similarly hide user accounts in Windows. Adversaries can set the <code>HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList</code> Registry key value to <code>0</code> for a specific user to prevent that user from being listed on the logon screen.

On Linux systems, adversaries may hide user accounts from the login screen, also referred to as the greeter. The method an adversary may use depends on which Display Manager the distribution is currently using. For example, on an Ubuntu system using the GNOME Display Manger (GDM), accounts may be hidden from the greeter using the <code>gsettings</code> command (ex: <code>sudo -u gdm gsettings set org.gnome.login-screen disable-user-list true</code>). Display Managers are not anchored to specific distributions and may be changed by a user or adversary.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** macOS, Windows, Linux

## What to Check

- [ ] Identify if Hidden Users technique is applicable to target environment
- [ ] Check macOS systems for indicators of Hidden Users
- [ ] Check Windows systems for indicators of Hidden Users
- [ ] Check Linux systems for indicators of Hidden Users
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create Hidden User using UniqueID < 500

Add a hidden user on macOS using Unique ID < 500 (users with that ID are hidden by default)

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo dscl . -create /Users/#{user_name} UniqueID 333
```

### Atomic Test 2: Create Hidden User using IsHidden option

Add a hidden user on macOS using IsHidden optoin

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo dscl . -create /Users/#{user_name} IsHidden 1
```

### Atomic Test 3: Create Hidden User in Registry

Adversaries may similarly hide user accounts in Windows. Adversaries can set the HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList Registry key value to 0 for a specific user to prevent that user from being listed on the logon screen.
Reference https://attack.mitre.org/techniques/T1564/002/ and https://thedfirreport.com/2022/07/11/select-xmrig-from-sqlserver/

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
NET USER #{user_name}$ #{user_password} /ADD /expires:never
REG ADD "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\Userlist" /v #{user_name}$ /t REG_DWORD /d 0
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hidden Users by examining the target platforms (macOS, Windows, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration

If the computer is domain joined, then group policy can help restrict the ability to create or hide users. Similarly, preventing the modification of the <code>/Library/Preferences/com.apple.loginwindow</code> <code>Hide500Users</code> value will force all users to be visible.

## Detection

### Detection Strategy for Hidden User Accounts

## Risk Assessment

| Finding                           | Severity | Impact          |
| --------------------------------- | -------- | --------------- |
| Hidden Users technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Cybereason OSX Pirrit](https://cdn2.hubspot.net/hubfs/3354902/Content%20PDFs/Cybereason-Lab-Analysis-OSX-Pirrit-4-6-16.pdf)
- [Apple Support Hide a User Account](https://support.apple.com/en-us/HT203998)
- [FireEye SMOKEDHAM June 2021](https://www.fireeye.com/blog/threat-research/2021/06/darkside-affiliate-supply-chain-software-compromise.html)
- [Hide GDM User Accounts](https://ubuntuhandbook.org/index.php/2021/06/hide-user-accounts-ubuntu-20-04-login-screen/)
- [US-CERT TA18-074A](https://www.us-cert.gov/ncas/alerts/TA18-074A)
- [Atomic Red Team - T1564.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.002)
- [MITRE ATT&CK - T1564.002](https://attack.mitre.org/techniques/T1564/002)
