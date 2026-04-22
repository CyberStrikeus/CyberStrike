---
name: "T1598.002_spearphishing-attachment"
description: "Adversaries may send spearphishing messages with a malicious attachment to elicit sensitive information that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1598.002
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1598.002"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1598/002"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1598
  - T1598.001
  - T1598.003
  - T1598.004
prerequisites:
  - T1598
severity_boost:
  T1598: "Chain with T1598 for deeper attack path"
  T1598.001: "Chain with T1598.001 for deeper attack path"
  T1598.003: "Chain with T1598.003 for deeper attack path"
---

# T1598.002 Spearphishing Attachment

> **Sub-technique of:** T1598

## High-Level Description

Adversaries may send spearphishing messages with a malicious attachment to elicit sensitive information that can be used during targeting. Spearphishing for information is an attempt to trick targets into divulging information, frequently credentials or other actionable information. Spearphishing for information frequently involves social engineering techniques, such as posing as a source with a reason to collect information (ex: Establish Accounts or Compromise Accounts) and/or sending multiple, seemingly urgent messages.

All forms of spearphishing are electronically delivered social engineering targeted at a specific individual, company, or industry. In this scenario, adversaries attach a file to the spearphishing email. In some cases, they may rely upon the recipient populating information, then returning the file. The text of the spearphishing email usually tries to give a plausible reason why the file should be filled-in, such as a request for information from a business associate. In other cases, adversaries may leverage techniques such as HTML Smuggling to harvest user credentials via fake login portals.

Adversaries may also use information from previous reconnaissance efforts (ex: Search Open Websites/Domains or Search Victim-Owned Websites) to craft persuasive and believable lures.

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Spearphishing Attachment technique is applicable to target environment
- [ ] Check PRE systems for indicators of Spearphishing Attachment
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Spearphishing Attachment by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1598.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training
Users can be trained to identify social engineering techniques and spearphishing attempts.

### M1054 Software Configuration
Use anti-spoofing and email authentication mechanisms to filter messages based on validity checks of the sender domain (using SPF) and integrity of messages (using DKIM). Enabling these mechanisms within an organization (through policies such as DMARC) may enable recipients (intra-org and cross domain) to perform similar message filtering and validation.


## Detection

### Detection of Spearphishing Attachment


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Spearphishing Attachment technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [ACSC Email Spoofing](https://web.archive.org/web/20210708014107/https://www.cyber.gov.au/sites/default/files/2019-03/spoof_email_sender_policy_framework.pdf)
- [Sophos Attachment](https://nakedsecurity.sophos.com/2020/10/02/serious-security-phishing-without-links-when-phishers-bring-along-their-own-web-pages/)
- [Huntress HTML Smuggling 2024](https://www.huntress.com/blog/smugglers-gambit-uncovering-html-smuggling-adversary-in-the-middle-tradecraft)
- [Microsoft Anti Spoofing](https://docs.microsoft.com/en-us/microsoft-365/security/office-365-security/anti-spoofing-protection?view=o365-worldwide)
- [GitHub Phishery](https://github.com/ryhanson/phishery)
- [Atomic Red Team - T1598.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1598.002)
- [MITRE ATT&CK - T1598.002](https://attack.mitre.org/techniques/T1598/002)
