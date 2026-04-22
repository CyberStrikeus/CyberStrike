---
name: "T1526_cloud-service-discovery"
description: "An adversary may attempt to enumerate the cloud services running on a system after gaining access."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1526
  - discovery
  - iaas
  - identity-provider
  - office-suite
  - saas
technique_id: "T1526"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - IaaS
  - Identity Provider
  - Office Suite
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1526"
tech_stack:
  - cloud
  - identity
  - office
  - saas
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1526 Cloud Service Discovery

## High-Level Description

An adversary may attempt to enumerate the cloud services running on a system after gaining access. These methods can differ from platform-as-a-service (PaaS), to infrastructure-as-a-service (IaaS), or software-as-a-service (SaaS). Many services exist throughout the various cloud providers and can include Continuous Integration and Continuous Delivery (CI/CD), Lambda Functions, Entra ID, etc. They may also include security services, such as AWS GuardDuty and Microsoft Defender for Cloud, and logging services, such as AWS CloudTrail and Google Cloud Audit Logs.

Adversaries may attempt to discover information about the services enabled throughout the environment. Azure tools and APIs, such as the Microsoft Graph API and Azure Resource Manager API, can enumerate resources and services, including applications, management groups, resources and policy definitions, and their relationships that are accessible by an identity.

For example, Stormspotter is an open source tool for enumerating and constructing a graph for Azure resources and services, and Pacu is an open source AWS exploitation framework that supports several methods for discovering cloud services.

Adversaries may use the information gained to shape follow-on behaviors, such as targeting data or credentials from enumerated services or evading identified defenses through Disable or Modify Tools or Disable or Modify Cloud Logs.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** IaaS, Identity Provider, Office Suite, SaaS

## What to Check

- [ ] Identify if Cloud Service Discovery technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Service Discovery
- [ ] Check Identity Provider systems for indicators of Cloud Service Discovery
- [ ] Check Office Suite systems for indicators of Cloud Service Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Service Discovery by examining the target platforms (IaaS, Identity Provider, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1526 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Cloud Service Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Cloud Service Discovery technique applicable | High | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Azure AD Graph API](https://docs.microsoft.com/en-us/previous-versions/azure/ad/graph/howto/azure-ad-graph-api-operations-overview)
- [Azure - Resource Manager API](https://docs.microsoft.com/en-us/rest/api/resources/)
- [Azure - Stormspotter](https://github.com/Azure/Stormspotter)
- [GitHub Pacu](https://github.com/RhinoSecurityLabs/pacu)
- [Atomic Red Team - T1526](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1526)
- [MITRE ATT&CK - T1526](https://attack.mitre.org/techniques/T1526)
