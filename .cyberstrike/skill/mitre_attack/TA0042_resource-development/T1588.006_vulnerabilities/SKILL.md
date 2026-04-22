---
name: "T1588.006_vulnerabilities"
description: "Adversaries may acquire information about vulnerabilities that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1588.006
  - resource-development
  - pre
  - sub-technique
technique_id: "T1588.006"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1588/006"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1588
  - T1588.001
  - T1588.002
  - T1588.003
  - T1588.004
  - T1588.005
  - T1588.007
prerequisites:
  - T1588
severity_boost:
  T1588: "Chain with T1588 for deeper attack path"
  T1588.001: "Chain with T1588.001 for deeper attack path"
  T1588.002: "Chain with T1588.002 for deeper attack path"
---

# T1588.006 Vulnerabilities

> **Sub-technique of:** T1588

## High-Level Description

Adversaries may acquire information about vulnerabilities that can be used during targeting. A vulnerability is a weakness in computer hardware or software that can, potentially, be exploited by an adversary to cause unintended or unanticipated behavior to occur. Adversaries may find vulnerability information by searching open databases or gaining access to closed vulnerability databases.

An adversary may monitor vulnerability disclosures/databases to understand the state of existing, as well as newly discovered, vulnerabilities. There is usually a delay between when a vulnerability is discovered and when it is made public. An adversary may target the systems of those known to conduct vulnerability research (including commercial vendors). Knowledge of a vulnerability may cause an adversary to search for an existing exploit (i.e. Exploits) or to attempt to develop one themselves (i.e. Exploits).

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Vulnerabilities technique is applicable to target environment
- [ ] Check PRE systems for indicators of Vulnerabilities
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Vulnerabilities by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1588.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Vulnerabilities


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Vulnerabilities technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [National Vulnerability Database](https://nvd.nist.gov/)
- [Atomic Red Team - T1588.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1588.006)
- [MITRE ATT&CK - T1588.006](https://attack.mitre.org/techniques/T1588/006)
