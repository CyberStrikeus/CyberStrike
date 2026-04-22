---
name: "T1598.004_spearphishing-voice"
description: "Adversaries may use voice communications to elicit sensitive information that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1598.004
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1598.004"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1598/004"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1598
  - T1598.001
  - T1598.002
  - T1598.003
prerequisites:
  - T1598
severity_boost:
  T1598: "Chain with T1598 for deeper attack path"
  T1598.001: "Chain with T1598.001 for deeper attack path"
  T1598.002: "Chain with T1598.002 for deeper attack path"
---

# T1598.004 Spearphishing Voice

> **Sub-technique of:** T1598

## High-Level Description

Adversaries may use voice communications to elicit sensitive information that can be used during targeting. Spearphishing for information is an attempt to trick targets into divulging information, frequently credentials or other actionable information. Spearphishing for information frequently involves social engineering techniques, such as posing as a source with a reason to collect information (ex: Impersonation) and/or creating a sense of urgency or alarm for the recipient.

All forms of phishing are electronically delivered social engineering. In this scenario, adversaries use phone calls to elicit sensitive information from victims. Known as voice phishing (or "vishing"), these communications can be manually executed by adversaries, hired call centers, or even automated via robocalls. Voice phishers may spoof their phone number while also posing as a trusted entity, such as a business partner or technical support staff.

Victims may also receive phishing messages that direct them to call a phone number ("callback phishing") where the adversary attempts to collect confidential information.

Adversaries may also use information from previous reconnaissance efforts (ex: Search Open Websites/Domains or Search Victim-Owned Websites) to tailor pretexts to be even more persuasive and believable for the victim.

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Spearphishing Voice technique is applicable to target environment
- [ ] Check PRE systems for indicators of Spearphishing Voice
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Spearphishing Voice by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1598.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training
Users can be trained to identify and report social engineering techniques and spearphishing attempts, while also being suspicious of and verifying the identify of callers.


## Detection

### Detection of Spearphishing Voice


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Spearphishing Voice technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Avertium callback phishing](https://www.avertium.com/resources/threat-reports/everything-you-need-to-know-about-callback-phishing)
- [BOA Telephone Scams](https://business.bofa.com/en-us/content/what-is-vishing.html)
- [Atomic Red Team - T1598.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1598.004)
- [MITRE ATT&CK - T1598.004](https://attack.mitre.org/techniques/T1598/004)
