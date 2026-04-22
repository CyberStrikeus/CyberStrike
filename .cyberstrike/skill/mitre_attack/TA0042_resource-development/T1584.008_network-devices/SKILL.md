---
name: "T1584.008_network-devices"
description: "Adversaries may compromise third-party network devices that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1584.008
  - resource-development
  - pre
  - sub-technique
technique_id: "T1584.008"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1584/008"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1584
  - T1584.001
  - T1584.002
  - T1584.003
  - T1584.004
  - T1584.005
  - T1584.006
  - T1584.007
prerequisites:
  - T1584
severity_boost:
  T1584: "Chain with T1584 for deeper attack path"
  T1584.001: "Chain with T1584.001 for deeper attack path"
  T1584.002: "Chain with T1584.002 for deeper attack path"
---

# T1584.008 Network Devices

> **Sub-technique of:** T1584

## High-Level Description

Adversaries may compromise third-party network devices that can be used during targeting. Network devices, such as small office/home office (SOHO) routers, may be compromised where the adversary's ultimate goal is not Initial Access to that environment, but rather to leverage these devices to support additional targeting.

Once an adversary has control, compromised network devices can be used to launch additional operations, such as hosting payloads for Phishing campaigns (i.e., Link Target) or enabling the required access to execute Content Injection operations. Adversaries may also be able to harvest reusable credentials (i.e., Valid Accounts) from compromised network devices.

Adversaries often target Internet-facing edge devices and related network appliances that specifically do not support robust host-based defenses.

Compromised network devices may be used to support subsequent Command and Control activity, such as Hide Infrastructure through an established Proxy and/or Botnet network.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Network Devices technique is applicable to target environment
- [ ] Check PRE systems for indicators of Network Devices
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Devices by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1584.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Network Devices


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Network Devices technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [Wired Russia Cyberwar](https://www.wired.com/story/russia-ukraine-cyberattacks-mandiant/)
- [Mandiant Fortinet Zero Day](https://www.mandiant.com/resources/blog/fortinet-malware-ecosystem)
- [Justice GRU 2024](https://www.justice.gov/opa/pr/justice-department-conducts-court-authorized-disruption-botnet-controlled-russian)
- [Atomic Red Team - T1584.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1584.008)
- [MITRE ATT&CK - T1584.008](https://attack.mitre.org/techniques/T1584/008)
