---
name: "T1589.003_employee-names"
description: "Adversaries may gather employee names that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1589.003
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1589.003"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1589/003"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1589
  - T1589.001
  - T1589.002
prerequisites:
  - T1589
severity_boost:
  T1589: "Chain with T1589 for deeper attack path"
  T1589.001: "Chain with T1589.001 for deeper attack path"
  T1589.002: "Chain with T1589.002 for deeper attack path"
---

# T1589.003 Employee Names

> **Sub-technique of:** T1589

## High-Level Description

Adversaries may gather employee names that can be used during targeting. Employee names be used to derive email addresses as well as to help guide other reconnaissance efforts and/or craft more-believable lures.

Adversaries may easily gather employee names, since they may be readily available and exposed via online or other accessible data sets (ex: Social Media or Search Victim-Owned Websites). Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Search Open Websites/Domains or Phishing for Information), establishing operational resources (ex: Compromise Accounts), and/or initial access (ex: Phishing or Valid Accounts).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Employee Names technique is applicable to target environment
- [ ] Check PRE systems for indicators of Employee Names
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Employee Names by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1589.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Employee Names

## Risk Assessment

| Finding                             | Severity | Impact         |
| ----------------------------------- | -------- | -------------- |
| Employee Names technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [OPM Leak](https://web.archive.org/web/20230602111604/https://www.opm.gov/cybersecurity/cybersecurity-incidents/)
- [Atomic Red Team - T1589.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1589.003)
- [MITRE ATT&CK - T1589.003](https://attack.mitre.org/techniques/T1589/003)
