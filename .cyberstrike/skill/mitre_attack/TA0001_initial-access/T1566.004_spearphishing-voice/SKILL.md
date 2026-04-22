---
name: "T1566.004_spearphishing-voice"
description: "Adversaries may use voice communications to ultimately gain access to victim systems."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1566.004
  - initial-access
  - linux
  - macos
  - windows
  - identity-provider
  - sub-technique
technique_id: "T1566.004"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Linux
  - macOS
  - Windows
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1566/004"
tech_stack:
  - linux
  - macos
  - windows
  - identity
cwe_ids:
  - CWE-20
chains_with:
  - T1566
  - T1566.001
  - T1566.002
  - T1566.003
prerequisites:
  - T1566
severity_boost:
  T1566: "Chain with T1566 for deeper attack path"
  T1566.001: "Chain with T1566.001 for deeper attack path"
  T1566.002: "Chain with T1566.002 for deeper attack path"
---

# T1566.004 Spearphishing Voice

> **Sub-technique of:** T1566

## High-Level Description

Adversaries may use voice communications to ultimately gain access to victim systems. Spearphishing voice is a specific variant of spearphishing. It is different from other forms of spearphishing in that it employs the use of manipulating a user into providing access to systems through a phone call or other forms of voice communications. Spearphishing frequently involves social engineering techniques, such as posing as a trusted source (ex: Impersonation) and/or creating a sense of urgency or alarm for the recipient.

All forms of phishing are electronically delivered social engineering. In this scenario, adversaries are not directly sending malware to a victim vice relying on User Execution for delivery and execution. For example, victims may receive phishing messages that instruct them to call a phone number where they are directed to visit a malicious URL, download malware, or install adversary-accessible remote management tools (Remote Access Tools) onto their computer.

Adversaries may also combine voice phishing with Multi-Factor Authentication Request Generation in order to trick users into divulging MFA credentials or accepting authentication prompts.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Linux, macOS, Windows, Identity Provider

## What to Check

- [ ] Identify if Spearphishing Voice technique is applicable to target environment
- [ ] Check Linux systems for indicators of Spearphishing Voice
- [ ] Check macOS systems for indicators of Spearphishing Voice
- [ ] Check Windows systems for indicators of Spearphishing Voice
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Spearphishing Voice by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1566.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training

Users can be trained to identify and report social engineering techniques and spearphishing attempts, while also being suspicious of and verifying the identify of callers.

## Detection

### Detection Strategy for Spearphishing Voice across OS platforms

## Risk Assessment

| Finding                                  | Severity | Impact         |
| ---------------------------------------- | -------- | -------------- |
| Spearphishing Voice technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [CISA Remote Monitoring and Management Software](https://www.cisa.gov/uscert/ncas/alerts/aa23-025a)
- [Unit42 Luna Moth](https://unit42.paloaltonetworks.com/luna-moth-callback-phishing/)
- [sygnia Luna Month](https://blog.sygnia.co/luna-moth-false-subscription-scams)
- [Proofpoint Vishing](https://www.proofpoint.com/us/threat-reference/vishing)
- [Atomic Red Team - T1566.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1566.004)
- [MITRE ATT&CK - T1566.004](https://attack.mitre.org/techniques/T1566/004)
