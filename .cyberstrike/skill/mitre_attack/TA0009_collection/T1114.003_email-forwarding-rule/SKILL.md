---
name: "T1114.003_email-forwarding-rule"
description: "Adversaries may setup email forwarding rules to collect sensitive information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1114.003
  - collection
  - linux
  - macos
  - office-suite
  - windows
  - sub-technique
technique_id: "T1114.003"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - macOS
  - Office Suite
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1114/003"
tech_stack:
  - linux
  - macos
  - office
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1114
  - T1114.001
  - T1114.002
prerequisites:
  - T1114
severity_boost:
  T1114: "Chain with T1114 for deeper attack path"
  T1114.001: "Chain with T1114.001 for deeper attack path"
  T1114.002: "Chain with T1114.002 for deeper attack path"
---

# T1114.003 Email Forwarding Rule

> **Sub-technique of:** T1114

## High-Level Description

Adversaries may setup email forwarding rules to collect sensitive information. Adversaries may abuse email forwarding rules to monitor the activities of a victim, steal information, and further gain intelligence on the victim or the victim’s organization to use as part of further exploits or operations. Furthermore, email forwarding rules can allow adversaries to maintain persistent access to victim's emails even after compromised credentials are reset by administrators. Most email clients allow users to create inbox rules for various email functions, including forwarding to a different recipient. These rules may be created through a local email application, a web interface, or by command-line interface. Messages can be forwarded to internal or external recipients, and there are no restrictions limiting the extent of this rule. Administrators may also create forwarding rules for user accounts with the same considerations and outcomes.

Any user or administrator within the organization (or adversary with valid credentials) can create rules to automatically forward all received messages to another recipient, forward emails to different locations based on the sender, and more. Adversaries may also hide the rule by making use of the Microsoft Messaging API (MAPI) to modify the rule properties, making it hidden and not visible from Outlook, OWA or most Exchange Administration tools.

In some environments, administrators may be able to enable email forwarding rules that operate organization-wide rather than on individual inboxes. For example, Microsoft Exchange supports transport rules that evaluate all mail an organization receives against user-specified conditions, then performs a user-specified action on mail that adheres to those conditions. Adversaries that abuse such features may be able to enable forwarding on all or specific mail an organization receives.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, macOS, Office Suite, Windows

## What to Check

- [ ] Identify if Email Forwarding Rule technique is applicable to target environment
- [ ] Check Linux systems for indicators of Email Forwarding Rule
- [ ] Check macOS systems for indicators of Email Forwarding Rule
- [ ] Check Office Suite systems for indicators of Email Forwarding Rule
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Email Forwarding Rule by examining the target platforms (Linux, macOS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1114.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Consider disabling external email forwarding.

### M1041 Encrypt Sensitive Information

Use of encryption provides an added layer of security to sensitive information sent over email. Encryption using public key cryptography requires the adversary to obtain the private certificate along with an encryption key to decrypt messages.

### M1047 Audit

Enterprise email solutions have monitoring mechanisms that may include the ability to audit auto-forwarding rules on a regular basis.

In an Exchange environment, Administrators can use `Get-InboxRule` / `Remove-InboxRule` and `Get-TransportRule` / `Remove-TransportRule` to discover and remove potentially malicious auto-fowarding and transport rules. In addition to this, a MAPI Editor can be utilized to examine the underlying database structure and discover any modifications/tampering of the properties of auto-forwarding rules.

### M1060 Out-of-Band Communications Channel

Use secure out-of-band authentication methods to verify the authenticity of critical actions initiated via email, such as password resets, financial transactions, or access requests.

For highly sensitive information, utilize out-of-band communication channels instead of relying solely on email. This reduces the risk of sensitive data being collected through compromised email accounts.

Set up out-of-band alerts to notify security teams of unusual email activities, such as mass forwarding or large attachments being sent, which could indicate email collection attempts.

Create plans for leveraging a secure out-of-band communications channel, rather than an existing in-network email server, in case of a security incident.

## Detection

### Email Forwarding Rule Abuse Detection Across Platforms

## Risk Assessment

| Finding                                    | Severity | Impact     |
| ------------------------------------------ | -------- | ---------- |
| Email Forwarding Rule technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Mac Forwarding Rules](https://support.apple.com/guide/mail/reply-to-forward-or-redirect-emails-mlhlp1010/mac)
- [Pfammatter - Hidden Inbox Rules](https://blog.compass-security.com/2018/09/hidden-inbox-rules-in-microsoft-exchange/)
- [Microsoft Tim McMichael Exchange Mail Forwarding 2](https://blogs.technet.microsoft.com/timmcmic/2015/06/08/exchange-and-office-365-mail-forwarding-2/)
- [Microsoft Mail Flow Rules 2023](https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rules)
- [US-CERT TA18-068A 2018](https://www.us-cert.gov/ncas/alerts/TA18-086A)
- [Atomic Red Team - T1114.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1114.003)
- [MITRE ATT&CK - T1114.003](https://attack.mitre.org/techniques/T1114/003)
