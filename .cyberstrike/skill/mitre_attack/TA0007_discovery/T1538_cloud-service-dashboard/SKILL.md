---
name: "T1538_cloud-service-dashboard"
description: "An adversary may use a cloud service dashboard GUI with stolen credentials to gain useful information from an operational cloud environment, such as specific services, resources, and features."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1538
  - discovery
  - iaas
  - saas
  - office-suite
  - identity-provider
technique_id: "T1538"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - IaaS
  - SaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1538"
tech_stack:
  - cloud
  - saas
  - office
  - identity
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1538 Cloud Service Dashboard

## High-Level Description

An adversary may use a cloud service dashboard GUI with stolen credentials to gain useful information from an operational cloud environment, such as specific services, resources, and features. For example, the GCP Command Center can be used to view all assets, review findings of potential security risks, and run additional queries, such as finding public IP addresses and open ports.

Depending on the configuration of the environment, an adversary may be able to enumerate more information via the graphical dashboard than an API. This also allows the adversary to gain information without manually making any API requests.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** IaaS, SaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Cloud Service Dashboard technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Service Dashboard
- [ ] Check SaaS systems for indicators of Cloud Service Dashboard
- [ ] Check Office Suite systems for indicators of Cloud Service Dashboard
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Service Dashboard by examining the target platforms (IaaS, SaaS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1538 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

Enforce the principle of least-privilege by limiting dashboard visibility to only the resources required. This may limit the discovery value of the dashboard in the event of a compromised account.

## Detection

### Detection of Cloud Service Dashboard Usage via GUI-Based Cloud Access

## Risk Assessment

| Finding                                      | Severity | Impact    |
| -------------------------------------------- | -------- | --------- |
| Cloud Service Dashboard technique applicable | High     | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [AWS Console Sign-in Events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-aws-console-sign-in-events.html)
- [Google Command Center Dashboard](https://cloud.google.com/security-command-center/docs/quickstart-scc-dashboard)
- [Atomic Red Team - T1538](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1538)
- [MITRE ATT&CK - T1538](https://attack.mitre.org/techniques/T1538)
