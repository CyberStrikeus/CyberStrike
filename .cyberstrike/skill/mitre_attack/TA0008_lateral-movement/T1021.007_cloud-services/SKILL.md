---
name: "T1021.007_cloud-services"
description: "Adversaries may log into accessible cloud services within a compromised environment using Valid Accounts that are synchronized with or federated to on-premises user identities."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1021.007
  - lateral-movement
  - iaas
  - identity-provider
  - office-suite
  - saas
  - sub-technique
technique_id: "T1021.007"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - IaaS
  - Identity Provider
  - Office Suite
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1021/007"
tech_stack:
  - cloud
  - identity
  - office
  - saas
cwe_ids:
  - CWE-284
chains_with:
  - T1021
  - T1021.001
  - T1021.002
  - T1021.003
  - T1021.004
  - T1021.005
  - T1021.006
  - T1021.008
prerequisites:
  - T1021
severity_boost:
  T1021: "Chain with T1021 for deeper attack path"
  T1021.001: "Chain with T1021.001 for deeper attack path"
  T1021.002: "Chain with T1021.002 for deeper attack path"
---

# T1021.007 Cloud Services

> **Sub-technique of:** T1021

## High-Level Description

Adversaries may log into accessible cloud services within a compromised environment using Valid Accounts that are synchronized with or federated to on-premises user identities. The adversary may then perform management actions or access cloud-hosted resources as the logged-on user.

Many enterprises federate centrally managed user identities to cloud services, allowing users to login with their domain credentials in order to access the cloud control plane. Similarly, adversaries may connect to available cloud services through the web console or through the cloud command line interface (CLI) (e.g., Cloud API), using commands such as <code>Connect-AZAccount</code> for Azure PowerShell, <code>Connect-MgGraph</code> for Microsoft Graph PowerShell, and <code>gcloud auth login</code> for the Google Cloud CLI.

In some cases, adversaries may be able to authenticate to these services via Application Access Token instead of a username and password.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** IaaS, Identity Provider, Office Suite, SaaS

## What to Check

- [ ] Identify if Cloud Services technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Services
- [ ] Check Identity Provider systems for indicators of Cloud Services
- [ ] Check Office Suite systems for indicators of Cloud Services
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Services by examining the target platforms (IaaS, Identity Provider, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1021.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication

Use multi-factor authentication on cloud services whenever possible.

### M1026 Privileged Account Management

Limit the number of high-privileged domain and cloud accounts, and ensure that these are not used for day-to-day operations. Ensure that on-premises accounts do not have privileged cloud permissions and that isolated, cloud-only accounts are used for managing cloud environments.

## Detection

### Behavioral Detection of Remote Cloud Logins via Valid Accounts

## Risk Assessment

| Finding                             | Severity | Impact           |
| ----------------------------------- | -------- | ---------------- |
| Cloud Services technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [Atomic Red Team - T1021.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1021.007)
- [MITRE ATT&CK - T1021.007](https://attack.mitre.org/techniques/T1021/007)
