---
name: "T1534_internal-spearphishing"
description: "After they already have access to accounts or systems within the environment, adversaries may use internal spearphishing to gain access to additional information or compromise other users within th..."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1534
  - lateral-movement
  - windows
  - macos
  - linux
  - saas
  - office-suite
technique_id: "T1534"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Windows
  - macOS
  - Linux
  - SaaS
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1534"
tech_stack:
  - windows
  - macos
  - linux
  - saas
  - office
cwe_ids:
  - CWE-284
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1534 Internal Spearphishing

## High-Level Description

After they already have access to accounts or systems within the environment, adversaries may use internal spearphishing to gain access to additional information or compromise other users within the same organization. Internal spearphishing is multi-staged campaign where a legitimate account is initially compromised either by controlling the user's device or by compromising the account credentials of the user. Adversaries may then attempt to take advantage of the trusted internal account to increase the likelihood of tricking more victims into falling for phish attempts, often incorporating Impersonation.

For example, adversaries may leverage Spearphishing Attachment or Spearphishing Link as part of internal spearphishing to deliver a payload or redirect to an external site to capture credentials through Input Capture on sites that mimic login interfaces.

Adversaries may also leverage internal chat apps, such as Microsoft Teams, to spread malicious content or engage users in attempts to capture sensitive information and/or credentials.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Windows, macOS, Linux, SaaS, Office Suite

## What to Check

- [ ] Identify if Internal Spearphishing technique is applicable to target environment
- [ ] Check Windows systems for indicators of Internal Spearphishing
- [ ] Check macOS systems for indicators of Internal Spearphishing
- [ ] Check Linux systems for indicators of Internal Spearphishing
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Internal Spearphishing by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1534 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Internal Spearphishing via Trusted Accounts

## Risk Assessment

| Finding                                     | Severity | Impact           |
| ------------------------------------------- | -------- | ---------------- |
| Internal Spearphishing technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [Trend Micro When Phishing Starts from the Inside 2017](https://blog.trendmicro.com/phishing-starts-inside/)
- [Int SP - chat apps](https://www.microsoft.com/en-us/security/blog/2023/08/02/midnight-blizzard-conducts-targeted-social-engineering-over-microsoft-teams/)
- [Trend Micro - Int SP](https://www.trendmicro.com/en_us/research.html)
- [Atomic Red Team - T1534](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1534)
- [MITRE ATT&CK - T1534](https://attack.mitre.org/techniques/T1534)
