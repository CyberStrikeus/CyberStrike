---
name: "T1585.003_cloud-accounts"
description: "Adversaries may create accounts with cloud providers that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1585.003
  - resource-development
  - pre
  - sub-technique
technique_id: "T1585.003"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1585/003"
tech_stack:
  - pre
cwe_ids: []
chains_with:
  - T1585
  - T1585.001
  - T1585.002
prerequisites:
  - T1585
severity_boost:
  T1585: "Chain with T1585 for deeper attack path"
  T1585.001: "Chain with T1585.001 for deeper attack path"
  T1585.002: "Chain with T1585.002 for deeper attack path"
---

# T1585.003 Cloud Accounts

> **Sub-technique of:** T1585

## High-Level Description

Adversaries may create accounts with cloud providers that can be used during targeting. Adversaries can use cloud accounts to further their operations, including leveraging cloud storage services such as Dropbox, MEGA, Microsoft OneDrive, or AWS S3 buckets for Exfiltration to Cloud Storage or to Upload Tools. Cloud accounts can also be used in the acquisition of infrastructure, such as Virtual Private Servers or Serverless infrastructure. Establishing cloud accounts may allow adversaries to develop sophisticated capabilities without managing their own servers.

Creating Cloud Accounts may also require adversaries to establish Email Accounts to register with the cloud provider.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Cloud Accounts technique is applicable to target environment
- [ ] Check PRE systems for indicators of Cloud Accounts
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Accounts by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1585.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Cloud Accounts

## Risk Assessment

| Finding                             | Severity | Impact               |
| ----------------------------------- | -------- | -------------------- |
| Cloud Accounts technique applicable | Low      | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [Awake Security C2 Cloud](https://awakesecurity.com/blog/threat-hunting-series-detecting-command-control-in-the-cloud/)
- [Atomic Red Team - T1585.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1585.003)
- [MITRE ATT&CK - T1585.003](https://attack.mitre.org/techniques/T1585/003)
