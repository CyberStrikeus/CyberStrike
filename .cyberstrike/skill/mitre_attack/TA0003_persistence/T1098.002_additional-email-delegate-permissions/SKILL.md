---
name: "T1098.002_additional-email-delegate-permissions"
description: "Adversaries may grant additional permission levels to maintain persistent access to an adversary-controlled email account."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1098.002
  - persistence
  - privilege-escalation
  - windows
  - office-suite
  - sub-technique
technique_id: "T1098.002"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1098/002"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-276
chains_with:
  - T1098
  - T1098.001
  - T1098.003
  - T1098.004
  - T1098.005
  - T1098.006
  - T1098.007
prerequisites:
  - T1098
severity_boost:
  T1098: "Chain with T1098 for deeper attack path"
  T1098.001: "Chain with T1098.001 for deeper attack path"
  T1098.003: "Chain with T1098.003 for deeper attack path"
---

# T1098.002 Additional Email Delegate Permissions

> **Sub-technique of:** T1098

## High-Level Description

Adversaries may grant additional permission levels to maintain persistent access to an adversary-controlled email account. 

For example, the <code>Add-MailboxPermission</code> PowerShell cmdlet, available in on-premises Exchange and in the cloud-based service Office 365, adds permissions to a mailbox. In Google Workspace, delegation can be enabled via the Google Admin console and users can delegate accounts via their Gmail settings. 

Adversaries may also assign mailbox folder permissions through individual folder permissions or roles. In Office 365 environments, adversaries may assign the Default or Anonymous user permissions or roles to the Top of Information Store (root), Inbox, or other mailbox folders. By assigning one or both user permissions to a folder, the adversary can utilize any other account in the tenant to maintain persistence to the target user’s mail folders.

This may be used in persistent threat incidents as well as BEC (Business Email Compromise) incidents where an adversary can add Additional Cloud Roles to the accounts they wish to compromise. This may further enable use of additional techniques for gaining access to systems. For example, compromised business accounts are often used to send messages to other accounts in the network of the target business while creating inbox rules (ex: Internal Spearphishing), so the messages evade spam/phishing detection mechanisms.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Additional Email Delegate Permissions technique is applicable to target environment
- [ ] Check Windows systems for indicators of Additional Email Delegate Permissions
- [ ] Check Office Suite systems for indicators of Additional Email Delegate Permissions
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Additional Email Delegate Permissions by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1098.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management
Do not allow domain administrator accounts to be used for day-to-day operations that may expose them to potential adversaries on unprivileged systems.

### M1032 Multi-factor Authentication
Use multi-factor authentication for user and privileged accounts.

### M1042 Disable or Remove Feature or Program
If email delegation is not required, disable it. In Google Workspace this can be accomplished through the Google Admin console.


## Detection

### Detection Strategy for Addition of Email Delegate Permissions


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Additional Email Delegate Permissions technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Bienstock, D. - Defending O365 - 2019](https://www.slideshare.net/slideshow/shmoocon-2019-becs-and-beyond-investigating-and-defending-office-365/128744511)
- [Crowdstrike Hiding in Plain Sight 2018](https://www.crowdstrike.com/blog/hiding-in-plain-sight-using-the-office-365-activities-api-to-investigate-business-email-compromises/)
- [Google Ensuring Your Information is Safe](https://googleblog.blogspot.com/2011/06/ensuring-your-information-is-safe.html)
- [Gmail Delegation](https://support.google.com/a/answer/7223765?hl=en)
- [FireEye APT35 2018](https://static.carahsoft.com/concrete/files/1015/2779/3571/M-Trends-2018-Report.pdf)
- [Mandiant Defend UNC2452 White Paper](https://www.mandiant.com/resources/blog/remediation-and-hardening-strategies-for-microsoft-365-to-defend-against-unc2452)
- [Microsoft - Add-MailboxPermission](https://docs.microsoft.com/en-us/powershell/module/exchange/mailboxes/add-mailboxpermission?view=exchange-ps)
- [Atomic Red Team - T1098.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1098.002)
- [MITRE ATT&CK - T1098.002](https://attack.mitre.org/techniques/T1098/002)
