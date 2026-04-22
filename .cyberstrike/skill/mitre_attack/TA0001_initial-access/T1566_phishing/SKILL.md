---
name: "T1566_phishing"
description: "Adversaries may send phishing messages to gain access to victim systems."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1566
  - initial-access
  - identity-provider
  - linux
  - macos
  - office-suite
  - saas
  - windows
technique_id: "T1566"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Identity Provider
  - Linux
  - macOS
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1566"
tech_stack:
  - identity
  - linux
  - macos
  - office
  - saas
  - windows
cwe_ids:
  - CWE-20
chains_with:
  - T1566.001
  - T1566.002
  - T1566.003
  - T1566.004
prerequisites:
  []
severity_boost:
  T1566.001: "Chain with T1566.001 for deeper attack path"
  T1566.002: "Chain with T1566.002 for deeper attack path"
  T1566.003: "Chain with T1566.003 for deeper attack path"
---

# T1566 Phishing

## High-Level Description

Adversaries may send phishing messages to gain access to victim systems. All forms of phishing are electronically delivered social engineering. Phishing can be targeted, known as spearphishing. In spearphishing, a specific individual, company, or industry will be targeted by the adversary. More generally, adversaries can conduct non-targeted phishing, such as in mass malware spam campaigns.

Adversaries may send victims emails containing malicious attachments or links, typically to execute malicious code on victim systems. Phishing may also be conducted via third-party services, like social media platforms. Phishing may also involve social engineering techniques, such as posing as a trusted source, as well as evasive techniques such as removing or manipulating emails or metadata/headers from compromised accounts being abused to send messages (e.g., Email Hiding Rules). Another way to accomplish this is by Email Spoofing the identity of the sender, which can be used to fool both the human recipient as well as automated security tools, or by including the intended target as a party to an existing email thread that includes malicious files or links (i.e., "thread hijacking").

Victims may also receive phishing messages that instruct them to call a phone number where they are directed to visit a malicious URL, download malware, or install adversary-accessible remote management tools onto their computer (i.e., User Execution).

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Identity Provider, Linux, macOS, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Phishing technique is applicable to target environment
- [ ] Check Identity Provider systems for indicators of Phishing
- [ ] Check Linux systems for indicators of Phishing
- [ ] Check macOS systems for indicators of Phishing
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Phishing by examining the target platforms (Identity Provider, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1566 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit
Perform audits or scans of systems, permissions, insecure software, insecure configurations, etc. to identify potential weaknesses.

### M1031 Network Intrusion Prevention
Network intrusion prevention systems and systems designed to scan and remove malicious email attachments or links can be used to block activity.

### M1054 Software Configuration
Use anti-spoofing and email authentication mechanisms to filter messages based on validity checks of the sender domain (using SPF) and integrity of messages (using DKIM). Enabling these mechanisms within an organization (through policies such as DMARC) may enable recipients (intra-org and cross domain) to perform similar message filtering and validation.

### M1021 Restrict Web-Based Content
Determine if certain websites or attachment types (ex: .scr, .exe, .pif, .cpl, etc.) that can be used for phishing are necessary for business operations and consider blocking access if activity cannot be monitored well or if it poses a significant risk.

### M1049 Antivirus/Antimalware
Anti-virus can automatically quarantine suspicious files.

### M1017 User Training
Users can be trained to identify social engineering techniques and phishing emails.


## Detection

### Detection Strategy for Phishing across platforms.


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Phishing technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [ACSC Email Spoofing](https://web.archive.org/web/20210708014107/https://www.cyber.gov.au/sites/default/files/2019-03/spoof_email_sender_policy_framework.pdf)
- [phishing-krebs](https://krebsonsecurity.com/2024/03/thread-hijacking-phishes-that-prey-on-your-curiosity/)
- [CISA Remote Monitoring and Management Software](https://www.cisa.gov/uscert/ncas/alerts/aa23-025a)
- [cyberproof-double-bounce](https://blog.cyberproof.com/blog/double-bounced-attacks-with-email-spoofing-2022-trends)
- [Unit42 Luna Moth](https://unit42.paloaltonetworks.com/luna-moth-callback-phishing/)
- [Microsoft Anti Spoofing](https://docs.microsoft.com/en-us/microsoft-365/security/office-365-security/anti-spoofing-protection?view=o365-worldwide)
- [Microsoft OAuth Spam 2022](https://www.microsoft.com/en-us/security/blog/2022/09/22/malicious-oauth-applications-used-to-compromise-email-servers-and-spread-spam/)
- [sygnia Luna Month](https://blog.sygnia.co/luna-moth-false-subscription-scams)
- [Proofpoint-spoof](https://www.proofpoint.com/us/threat-reference/email-spoofing)
- [Palo Alto Unit 42 VBA Infostealer 2014](https://unit42.paloaltonetworks.com/examining-vba-initiated-infostealer-campaign/)
- [Atomic Red Team - T1566](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1566)
- [MITRE ATT&CK - T1566](https://attack.mitre.org/techniques/T1566)
