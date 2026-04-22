---
name: "T1672_email-spoofing"
description: "Adversaries may fake, or spoof, a sender’s identity by modifying the value of relevant email headers in order to establish contact with victims under false pretenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1672
  - defense-evasion
  - office-suite
  - windows
  - macos
  - linux
technique_id: "T1672"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Office Suite
  - Windows
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1672"
tech_stack:
  - office
  - windows
  - macos
  - linux
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1672 Email Spoofing

## High-Level Description

Adversaries may fake, or spoof, a sender’s identity by modifying the value of relevant email headers in order to establish contact with victims under false pretenses. In addition to actual email content, email headers (such as the FROM header, which contains the email address of the sender) may also be modified. Email clients display these headers when emails appear in a victim's inbox, which may cause modified emails to appear as if they were from the spoofed entity. 

This behavior may succeed when the spoofed entity either does not enable or enforce identity authentication tools such as Sender Policy Framework (SPF), DomainKeys Identified Mail (DKIM), and/or Domain-based Message Authentication, Reporting and Conformance (DMARC). Even if SPF and DKIM are configured properly, spoofing may still succeed when a domain sets a weak DMARC policy such as `v=DMARC1; p=none; fo=1;`. This means that while DMARC is technically present, email servers are not instructed to take any filtering action when emails fail authentication checks.

Adversaries may abuse Microsoft 365’s Direct Send functionality to spoof internal users by using internal devices like printers to send emails without authentication. Adversaries may also abuse absent or weakly configured SPF, SKIM, and/or DMARC policies to conceal social engineering attempts such as Phishing. They may also leverage email spoofing for Impersonation of legitimate external individuals and organizations, such as journalists and academics.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Office Suite, Windows, macOS, Linux

## What to Check

- [ ] Identify if Email Spoofing technique is applicable to target environment
- [ ] Check Office Suite systems for indicators of Email Spoofing
- [ ] Check Windows systems for indicators of Email Spoofing
- [ ] Check macOS systems for indicators of Email Spoofing
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Email Spoofing by examining the target platforms (Office Suite, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1672 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1054 Software Configuration
Use anti-spoofing and email authentication mechanisms to filter messages based on validity checks of the sender domain (using SPF) and integrity of messages (using DKIM). Enabling these mechanisms within an organization (through policies such as DMARC) may enable recipients (intra-org and cross domain) to perform similar message filtering and validation.


## Detection

### Detection Strategy for Email Spoofing


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Email Spoofing technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Cloudflare DMARC, DKIM, and SPF](https://www.cloudflare.com/learning/email-security/dmarc-dkim-spf/)
- [DMARC-overview](https://dmarc.org/overview)
- [ic3-dprk](https://www.ic3.gov/CSA/2024/240502.pdf)
- [Proofpoint TA427 April 2024](https://www.proofpoint.com/us/blog/threat-insight/social-engineering-dmarc-abuse-ta427s-art-information-gathering)
- [Proofpoint-DMARC](https://www.proofpoint.com/us/threat-reference/dmarc)
- [Barnea DirectSend](https://www.varonis.com/blog/direct-send-exploit)
- [Atomic Red Team - T1672](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1672)
- [MITRE ATT&CK - T1672](https://attack.mitre.org/techniques/T1672)
