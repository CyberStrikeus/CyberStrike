---
name: "T1535_unusedunsupported-cloud-regions"
description: "Adversaries may create cloud instances in unused geographic service regions in order to evade detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1535
  - defense-evasion
  - iaas
technique_id: "T1535"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1535"
tech_stack:
  - cloud
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1535 Unused/Unsupported Cloud Regions

## High-Level Description

Adversaries may create cloud instances in unused geographic service regions in order to evade detection. Access is usually obtained through compromising accounts used to manage cloud infrastructure.

Cloud service providers often provide infrastructure throughout the world in order to improve performance, provide redundancy, and allow customers to meet compliance requirements. Oftentimes, a customer will only use a subset of the available regions and may not actively monitor other regions. If an adversary creates resources in an unused region, they may be able to operate undetected.

A variation on this behavior takes advantage of differences in functionality across cloud regions. An adversary could utilize regions which do not support advanced detection services in order to avoid detection of their activity.

An example of adversary use of unused AWS regions is to mine cryptocurrency through Resource Hijacking, which can cost organizations substantial amounts of money over time depending on the processing power used.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Unused/Unsupported Cloud Regions technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Unused/Unsupported Cloud Regions
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Unused/Unsupported Cloud Regions by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1535 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1054 Software Configuration
Cloud service providers may allow customers to deactivate unused regions.


## Detection

### Detection of Adversary Use of Unused or Unsupported Cloud Regions (IaaS)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Unused/Unsupported Cloud Regions technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [CloudSploit - Unused AWS Regions](https://medium.com/cloudsploit/the-danger-of-unused-aws-regions-af0bf1b878fc)
- [Atomic Red Team - T1535](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1535)
- [MITRE ATT&CK - T1535](https://attack.mitre.org/techniques/T1535)
