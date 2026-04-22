---
name: "T1656_impersonation"
description: "Adversaries may impersonate a trusted person or organization in order to persuade and trick a target into performing some action on their behalf."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1656
  - defense-evasion
  - linux
  - macos
  - office-suite
  - saas
  - windows
technique_id: "T1656"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1656"
tech_stack:
  - linux
  - macos
  - office
  - saas
  - windows
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1656 Impersonation

## High-Level Description

Adversaries may impersonate a trusted person or organization in order to persuade and trick a target into performing some action on their behalf. For example, adversaries may communicate with victims (via Phishing for Information, Phishing, or Internal Spearphishing) while impersonating a known sender such as an executive, colleague, or third-party vendor. Established trust can then be leveraged to accomplish an adversary’s ultimate goals, possibly against multiple victims.

In many cases of business email compromise or email fraud campaigns, adversaries use impersonation to defraud victims -- deceiving them into sending money or divulging information that ultimately enables Financial Theft.

Adversaries will often also use social engineering techniques such as manipulative and persuasive language in email subject lines and body text such as `payment`, `request`, or `urgent` to push the victim to act quickly before malicious activity is detected. These campaigns are often specifically targeted against people who, due to job roles and/or accesses, can carry out the adversary’s goal.  

Impersonation is typically preceded by reconnaissance techniques such as Gather Victim Identity Information and Gather Victim Org Information as well as acquiring infrastructure such as email domains (i.e. Domains) to substantiate their false identity.

There is the potential for multiple victims in campaigns involving impersonation. For example, an adversary may Compromise Accounts targeting one organization which can then be used to support impersonation against other entities.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Impersonation technique is applicable to target environment
- [ ] Check Linux systems for indicators of Impersonation
- [ ] Check macOS systems for indicators of Impersonation
- [ ] Check Office Suite systems for indicators of Impersonation
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Impersonation by examining the target platforms (Linux, macOS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1656 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training

Train users to be aware of impersonation tricks and how to counter them, for example confirming incoming requests through an independent platform like a phone call or in-person, to reduce risk.

### M1019 Threat Intelligence Program

Threat intelligence helps defenders and users be aware of and defend against common lures and active campaigns that have been used for impersonation.

## Detection

### Detection Strategy for Impersonation

## Risk Assessment

| Finding                            | Severity | Impact          |
| ---------------------------------- | -------- | --------------- |
| Impersonation technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [CrowdStrike-BEC](https://www.crowdstrike.com/cybersecurity-101/business-email-compromise-bec/)
- [VEC](https://www.cloudflare.com/learning/email-security/what-is-vendor-email-compromise/#:~:text=Vendor%20email%20compromise%2C%20also%20referred,steal%20from%20that%20vendor%27s%20customers.)
- [Atomic Red Team - T1656](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1656)
- [MITRE ATT&CK - T1656](https://attack.mitre.org/techniques/T1656)
