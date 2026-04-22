---
name: "T1564.008_email-hiding-rules"
description: "Adversaries may use email rules to hide inbound emails in a compromised user's mailbox."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.008
  - defense-evasion
  - windows
  - linux
  - macos
  - office-suite
  - sub-technique
technique_id: "T1564.008"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - Linux
  - macOS
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1564/008"
tech_stack:
  - windows
  - linux
  - macos
  - office
cwe_ids:
  - CWE-693
chains_with:
  - T1564
  - T1564.001
  - T1564.002
  - T1564.003
  - T1564.004
  - T1564.005
  - T1564.006
  - T1564.007
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
  T1564.002: "Chain with T1564.002 for deeper attack path"
---

# T1564.008 Email Hiding Rules

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may use email rules to hide inbound emails in a compromised user's mailbox. Many email clients allow users to create inbox rules for various email functions, including moving emails to other folders, marking emails as read, or deleting emails. Rules may be created or modified within email clients or through external features such as the <code>New-InboxRule</code> or <code>Set-InboxRule</code> PowerShell cmdlets on Windows systems.

Adversaries may utilize email rules within a compromised user's mailbox to delete and/or move emails to less noticeable folders. Adversaries may do this to hide security alerts, C2 communication, or responses to Internal Spearphishing emails sent from the compromised account.

Any user or administrator within the organization (or adversary with valid credentials) may be able to create rules to automatically move or delete emails. These rules can be abused to impair/delay detection had the email content been immediately seen by a user or defender. Malicious rules commonly filter out emails based on key words (such as <code>malware</code>, <code>suspicious</code>, <code>phish</code>, and <code>hack</code>) found in message bodies and subject lines.

In some environments, administrators may be able to enable email rules that operate organization-wide rather than on individual inboxes. For example, Microsoft Exchange supports transport rules that evaluate all mail an organization receives against user-specified conditions, then performs a user-specified action on mail that adheres to those conditions. Adversaries that abuse such features may be able to automatically modify or delete all emails related to specific topics (such as internal security incident notifications).

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, Linux, macOS, Office Suite

## What to Check

- [ ] Identify if Email Hiding Rules technique is applicable to target environment
- [ ] Check Windows systems for indicators of Email Hiding Rules
- [ ] Check Linux systems for indicators of Email Hiding Rules
- [ ] Check macOS systems for indicators of Email Hiding Rules
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Email Hiding Rules by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit

Enterprise email solutions may have monitoring mechanisms that may include the ability to audit inbox rules on a regular basis.

In an Exchange environment, Administrators can use `Get-InboxRule` / `Remove-InboxRule` and `Get-TransportRule` / `Remove-TransportRule` to discover and remove potentially malicious inbox and transport rules.

## Detection

### Detection Strategy for Email Hiding Rules

## Risk Assessment

| Finding                                 | Severity | Impact          |
| --------------------------------------- | -------- | --------------- |
| Email Hiding Rules technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [MacOS Email Rules](https://support.apple.com/guide/mail/use-rules-to-manage-emails-you-receive-mlhlp1017/mac)
- [Microsoft BEC Campaign](https://www.microsoft.com/security/blog/2021/06/14/behind-the-scenes-of-business-email-compromise-using-cross-domain-threat-data-to-disrupt-a-large-bec-infrastructure/)
- [Microsoft Mail Flow Rules 2023](https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rules)
- [Microsoft Inbox Rules](https://support.microsoft.com/en-us/office/manage-email-messages-by-using-rules-c24f5dea-9465-4df4-ad17-a50704d66c59)
- [Microsoft New-InboxRule](https://docs.microsoft.com/en-us/powershell/module/exchange/new-inboxrule?view=exchange-ps)
- [Microsoft Set-InboxRule](https://docs.microsoft.com/en-us/powershell/module/exchange/set-inboxrule?view=exchange-ps)
- [Microsoft Cloud App Security](https://techcommunity.microsoft.com/t5/security-compliance-and-identity/rule-your-inbox-with-microsoft-cloud-app-security/ba-p/299154)
- [Atomic Red Team - T1564.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.008)
- [MITRE ATT&CK - T1564.008](https://attack.mitre.org/techniques/T1564/008)
