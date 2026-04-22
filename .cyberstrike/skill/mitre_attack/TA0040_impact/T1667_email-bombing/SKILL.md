---
name: "T1667_email-bombing"
description: "Adversaries may flood targeted email addresses with an overwhelming volume of messages."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1667
  - impact
  - linux
  - office-suite
  - windows
  - macos
technique_id: "T1667"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - Office Suite
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1667"
tech_stack:
  - linux
  - office
  - windows
  - macos
cwe_ids:
  - CWE-400
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1667 Email Bombing

## High-Level Description

Adversaries may flood targeted email addresses with an overwhelming volume of messages. This may bury legitimate emails in a flood of spam and disrupt business operations.

An adversary may accomplish email bombing by leveraging an automated bot to register a targeted address for e-mail lists that do not validate new signups, such as online newsletters. The result can be a wave of thousands of e-mails that effectively overloads the victim’s inbox.

By sending hundreds or thousands of e-mails in quick succession, adversaries may successfully divert attention away from and bury legitimate messages including security alerts, daily business processes like help desk tickets and client correspondence, or ongoing scams. This behavior can also be used as a tool of harassment.

This behavior may be a precursor for Spearphishing Voice. For example, an adversary may email bomb a target and then follow up with a phone call to fraudulently offer assistance. This social engineering may lead to the use of Remote Access Software to steal credentials, deploy ransomware, conduct Financial Theft, or engage in other malicious activity.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, Office Suite, Windows, macOS

## What to Check

- [ ] Identify if Email Bombing technique is applicable to target environment
- [ ] Check Linux systems for indicators of Email Bombing
- [ ] Check Office Suite systems for indicators of Email Bombing
- [ ] Check Windows systems for indicators of Email Bombing
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Email Bombing by examining the target platforms (Linux, Office Suite, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1667 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training
Train users to be aware of access or manipulation attempts by an adversary to reduce the risk of successful social engineering via e-mail bombing.

### M1054 Software Configuration
Use anti-spoofing and email authentication mechanisms to filter messages based on validity checks of the sender domain (using SPF) and integrity of messages (using DKIM). Enabling these mechanisms within an organization (through policies such as DMARC) may enable recipients (intra-org and cross domain) to perform similar message filtering and validation. Note that additional filtering may be necessary if emails are coming from legitimate sources.


## Detection

### Detection Strategy for Email Bombing


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Email Bombing technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [krebs-email-bombing](https://krebsonsecurity.com/2016/08/massive-email-bombs-target-gov-addresses/)
- [sophos-bombing](https://news.sophos.com/en-us/2025/01/21/sophos-mdr-tracks-two-ransomware-campaigns-using-email-bombing-microsoft-teams-vishing/)
- [rapid7-email-bombing](https://www.rapid7.com/blog/post/2024/05/10/ongoing-social-engineering-campaign-linked-to-black-basta-ransomware-operators)
- [hhs-email-bombing](https://www.hhs.gov/sites/default/files/email-bombing-sector-alert-tlpclear.pdf)
- [Atomic Red Team - T1667](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1667)
- [MITRE ATT&CK - T1667](https://attack.mitre.org/techniques/T1667)
