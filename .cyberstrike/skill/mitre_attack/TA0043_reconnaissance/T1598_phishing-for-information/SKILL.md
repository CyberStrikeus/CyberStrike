---
name: "T1598_phishing-for-information"
description: "Adversaries may send phishing messages to elicit sensitive information that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1598
  - reconnaissance
  - pre
technique_id: "T1598"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1598"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1598.001
  - T1598.002
  - T1598.003
  - T1598.004
prerequisites: []
severity_boost:
  T1598.001: "Chain with T1598.001 for deeper attack path"
  T1598.002: "Chain with T1598.002 for deeper attack path"
  T1598.003: "Chain with T1598.003 for deeper attack path"
---

# T1598 Phishing for Information

## High-Level Description

Adversaries may send phishing messages to elicit sensitive information that can be used during targeting. Phishing for information is an attempt to trick targets into divulging information, frequently credentials or other actionable information. Phishing for information is different from Phishing in that the objective is gathering data from the victim rather than executing malicious code.

All forms of phishing are electronically delivered social engineering. Phishing can be targeted, known as spearphishing. In spearphishing, a specific individual, company, or industry will be targeted by the adversary. More generally, adversaries can conduct non-targeted phishing, such as in mass credential harvesting campaigns.

Adversaries may also try to obtain information directly through the exchange of emails, instant messages, or other electronic conversation means. Victims may also receive phishing messages that direct them to call a phone number where the adversary attempts to collect confidential information.

Phishing for information frequently involves social engineering techniques, such as posing as a source with a reason to collect information (ex: Establish Accounts or Compromise Accounts) and/or sending multiple, seemingly urgent messages. Another way to accomplish this is by Email Spoofing the identity of the sender, which can be used to fool both the human recipient as well as automated security tools.

Phishing for information may also involve evasive techniques, such as removing or manipulating emails or metadata/headers from compromised accounts being abused to send messages (e.g., Email Hiding Rules).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Phishing for Information technique is applicable to target environment
- [ ] Check PRE systems for indicators of Phishing for Information
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Phishing for Information by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1598 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training

Users can be trained to identify social engineering techniques and spearphishing attempts.

### M1054 Software Configuration

Use anti-spoofing and email authentication mechanisms to filter messages based on validity checks of the sender domain (using SPF) and integrity of messages (using DKIM). Enabling these mechanisms within an organization (through policies such as DMARC) may enable recipients (intra-org and cross domain) to perform similar message filtering and validation.

## Detection

### Detection of Phishing for Information

## Risk Assessment

| Finding                                       | Severity | Impact         |
| --------------------------------------------- | -------- | -------------- |
| Phishing for Information technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [ACSC Email Spoofing](https://web.archive.org/web/20210708014107/https://www.cyber.gov.au/sites/default/files/2019-03/spoof_email_sender_policy_framework.pdf)
- [Avertium callback phishing](https://www.avertium.com/resources/threat-reports/everything-you-need-to-know-about-callback-phishing)
- [TrendMictro Phishing](https://www.trendmicro.com/en_us/research/20/i/tricky-forms-of-phishing.html)
- [Sophos Attachment](https://nakedsecurity.sophos.com/2020/10/02/serious-security-phishing-without-links-when-phishers-bring-along-their-own-web-pages/)
- [cyberproof-double-bounce](https://blog.cyberproof.com/blog/double-bounced-attacks-with-email-spoofing-2022-trends)
- [PCMag FakeLogin](https://www.pcmag.com/news/hackers-try-to-phish-united-nations-staffers-with-fake-login-pages)
- [Microsoft Anti Spoofing](https://docs.microsoft.com/en-us/microsoft-365/security/office-365-security/anti-spoofing-protection?view=o365-worldwide)
- [Microsoft OAuth Spam 2022](https://www.microsoft.com/en-us/security/blog/2022/09/22/malicious-oauth-applications-used-to-compromise-email-servers-and-spread-spam/)
- [ThreatPost Social Media Phishing](https://threatpost.com/facebook-launching-pad-phishing-attacks/160351/)
- [Proofpoint-spoof](https://www.proofpoint.com/us/threat-reference/email-spoofing)
- [GitHub Phishery](https://github.com/ryhanson/phishery)
- [Palo Alto Unit 42 VBA Infostealer 2014](https://unit42.paloaltonetworks.com/examining-vba-initiated-infostealer-campaign/)
- [Atomic Red Team - T1598](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1598)
- [MITRE ATT&CK - T1598](https://attack.mitre.org/techniques/T1598)
