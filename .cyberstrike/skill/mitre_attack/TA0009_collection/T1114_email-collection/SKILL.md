---
name: "T1114_email-collection"
description: "Adversaries may target user email to collect sensitive information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1114
  - collection
  - windows
  - macos
  - linux
  - office-suite
technique_id: "T1114"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Windows
  - macOS
  - Linux
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1114"
tech_stack:
  - windows
  - macos
  - linux
  - office
cwe_ids:
  - CWE-200
chains_with:
  - T1114.001
  - T1114.002
  - T1114.003
prerequisites:
  []
severity_boost:
  T1114.001: "Chain with T1114.001 for deeper attack path"
  T1114.002: "Chain with T1114.002 for deeper attack path"
  T1114.003: "Chain with T1114.003 for deeper attack path"
---

# T1114 Email Collection

## High-Level Description

Adversaries may target user email to collect sensitive information. Emails may contain sensitive data, including trade secrets or personal information, that can prove valuable to adversaries. Emails may also contain details of ongoing incident response operations, which may allow adversaries to adjust their techniques in order to maintain persistence or evade defenses. Adversaries can collect or forward email from mail servers or clients.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Windows, macOS, Linux, Office Suite

## What to Check

- [ ] Identify if Email Collection technique is applicable to target environment
- [ ] Check Windows systems for indicators of Email Collection
- [ ] Check macOS systems for indicators of Email Collection
- [ ] Check Linux systems for indicators of Email Collection
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Email Collection by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1114 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication
Use of multi-factor authentication for public-facing webmail servers is a recommended best practice to minimize the usefulness of usernames and passwords to adversaries.

### M1060 Out-of-Band Communications Channel
Use secure out-of-band authentication methods to verify the authenticity of critical actions initiated via email, such as password resets, financial transactions, or access requests. For highly sensitive information, utilize out-of-band communication channels instead of relying solely on email to prevent adversaries from collecting data through compromised email accounts.

### M1041 Encrypt Sensitive Information
Use of encryption provides an added layer of security to sensitive information sent over email. Encryption using public key cryptography requires the adversary to obtain the private certificate along with an encryption key to decrypt messages.

### M1047 Audit
Enterprise email solutions have monitoring mechanisms that may include the ability to audit auto-forwarding rules on a regular basis.

In an Exchange environment, Administrators can use Get-InboxRule to discover and remove potentially malicious auto-forwarding rules.


## Detection

### Email Collection via Local Email Access and Auto-Forwarding Behavior


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Email Collection technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [CISA AA20-352A 2021](https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a)
- [Microsoft Tim McMichael Exchange Mail Forwarding 2](https://blogs.technet.microsoft.com/timmcmic/2015/06/08/exchange-and-office-365-mail-forwarding-2/)
- [TrustedSec OOB Communications](https://trustedsec.com/blog/to-oob-or-not-to-oob-why-out-of-band-communications-are-essential-for-incident-response)
- [Atomic Red Team - T1114](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1114)
- [MITRE ATT&CK - T1114](https://attack.mitre.org/techniques/T1114)
